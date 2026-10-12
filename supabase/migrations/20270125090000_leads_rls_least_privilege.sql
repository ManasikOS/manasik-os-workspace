-- Leads module — database-enforced least privilege (docs/security/leads-module-security-audit-and-remediation-plan.md, Phase 1:
-- LD-01, LD-02, LD-03 (child tables), LD-11).
--
-- Before this migration every lead table had a single `FOR ALL` write policy for ADMIN and MARKETING, so rules the application states
-- ("only an Admin deletes a lead", "the activity trail is immutable", "a discounted quote waits for approval") were enforced only by the
-- Server Actions. A MARKETING user holds the anon key and a JWT, and could break each of them with one PostgREST call.
--
-- What this changes, and what it deliberately does not:
--   * Replaces every policy on the eight lead tables with one policy per command. No `FOR ALL`.
--   * lead_activity / lead_notes / lead_copilot_dismissals become INSERT-only (no UPDATE/DELETE policy, privilege revoked, trigger as a backstop).
--   * DELETE on leads/lead_quotes is ADMIN-only, plus one narrow exception: a MARKETING user may take back a lead THEY created in the last 15 minutes
--     that nothing refers to yet (the inbox's compensating delete, lib/inbox/lead-linking.ts removeUnlinkedNewLead).
--   * lead_quotes: a guard trigger stops a non-admin releasing a discount that is waiting for approval, editing a saved quote's money, or
--     forging an approval. An admin's approval is stamped with their user id.
--   * lead_activity / lead_notes / lead_quotes are readable by FINANCE / OPERATIONS / VISA only for converted leads (and FINANCE keeps all
--     quotes: the /quotes ledger shows them margin and discounts).
--   * Actor ids: lead_activity.actor_id, lead_notes.author_id, leads.created_by_id are stamped from auth.uid() by trigger.
--
-- NOT changed here (cross-module readers — inbox, reports, dashboard, campaigns — read `leads` as non-marketing roles; narrowing it needs a
-- projection view and is Phase 2): `leads` SELECT stays ADMIN/CEO/MARKETING/FINANCE/OPERATIONS/VISA. `estimated_value_lkr` therefore remains
-- readable to OPERATIONS/VISA at the database; the Leads page strips it (application layer).
-- NOT added: unique (agency_id, mobile) — the "create anyway" duplicate override is a supported feature and would be broken by it; and a
-- unique (lead_id) on bookings — other flows may attach a lead to more than one booking. Both need the Phase 2 conversion RPC first.
--
-- Service-role and SECURITY DEFINER callers (WhatsApp agent, cron sweeps, reset_agency_business_data) are not `authenticated`/`anon`, so the
-- triggers below let them through exactly as before; they bypass RLS already.

-- ── A. Helper: has this lead converted? ──────────────────────────────────────
-- SECURITY DEFINER so a policy on a child table can ask without recursing through leads' own RLS; the tenant is checked inside.
create or replace function public.lead_is_converted(p_lead_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead_id
      and l.booking_id is not null
      and l.agency_id = (select public.current_agency_id())
  )
$$;

revoke all on function public.lead_is_converted(uuid) from public, anon;
grant execute on function public.lead_is_converted(uuid) to authenticated;

comment on function public.lead_is_converted(uuid) is
  'True when the lead (in the caller''s agency) has a booking. Used by the read policies that limit FINANCE / OPERATIONS / VISA to converted leads.';

-- ── B. Actor stamping ────────────────────────────────────────────────────────
alter table public.lead_activity add column if not exists actor_id   uuid;
alter table public.lead_notes    add column if not exists author_id  uuid;
alter table public.leads         add column if not exists created_by_id uuid;

comment on column public.lead_activity.actor_id  is 'auth.users id of the staff member who caused the event; null for system / agent writes. actor_name stays as the display snapshot.';
comment on column public.lead_notes.author_id    is 'auth.users id of the staff member who wrote the note; null for agent writes.';
comment on column public.leads.created_by_id     is 'auth.users id of the staff member who created the lead; null when the agent or an import job did.';

-- A trigger, not a column default: a bulk upsert from supabase-js turns an absent key into NULL, which would defeat a default.
create or replace function public.stamp_actor_column() returns trigger
  language plpgsql set search_path = public as $$
declare
  col text := tg_argv[0];
begin
  if auth.uid() is not null and (to_jsonb(new) ->> col) is null then
    new := jsonb_populate_record(new, jsonb_build_object(col, auth.uid()));
  end if;
  return new;
end $$;

drop trigger if exists lead_activity_stamp_actor on public.lead_activity;
create trigger lead_activity_stamp_actor before insert on public.lead_activity
  for each row execute function public.stamp_actor_column('actor_id');

drop trigger if exists lead_notes_stamp_actor on public.lead_notes;
create trigger lead_notes_stamp_actor before insert on public.lead_notes
  for each row execute function public.stamp_actor_column('author_id');

drop trigger if exists leads_stamp_creator on public.leads;
create trigger leads_stamp_creator before insert on public.leads
  for each row execute function public.stamp_actor_column('created_by_id');

drop trigger if exists lead_quotes_stamp_creator on public.lead_quotes;
create trigger lead_quotes_stamp_creator before insert on public.lead_quotes
  for each row execute function public.stamp_actor_column('created_by_user_id');

-- ── C. Append-only backstop ──────────────────────────────────────────────────
create or replace function public.lead_history_is_append_only() returns trigger
  language plpgsql set search_path = public as $$
begin
  -- Browser sessions only. The service role, SECURITY DEFINER functions (reset_agency_business_data) and foreign-key cascades run as
  -- another database role and are unaffected.
  if current_user in ('authenticated', 'anon') then
    raise exception '% is append-only; rows cannot be changed or removed.', tg_table_name using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists lead_activity_append_only on public.lead_activity;
create trigger lead_activity_append_only before update or delete on public.lead_activity
  for each row execute function public.lead_history_is_append_only();

drop trigger if exists lead_notes_append_only on public.lead_notes;
create trigger lead_notes_append_only before update or delete on public.lead_notes
  for each row execute function public.lead_history_is_append_only();

drop trigger if exists lead_copilot_dismissals_append_only on public.lead_copilot_dismissals;
create trigger lead_copilot_dismissals_append_only before update or delete on public.lead_copilot_dismissals
  for each row execute function public.lead_history_is_append_only();

revoke update, delete, truncate on public.lead_activity, public.lead_notes, public.lead_copilot_dismissals from anon, authenticated;

-- ── D. Quote guard ───────────────────────────────────────────────────────────
-- Legacy rows: a discounted quote that already left DRAFT/PENDING_APPROVAL has no approval record because nothing ever wrote one. Label
-- them honestly so a revision of one is not refused by the guard below. (Runs as the migration owner, which the guard ignores.)
update public.lead_quotes
   set discount_approved_by = 'LEGACY_PRE_APPROVAL_GATE',
       discount_approved_at = coalesce(discount_approved_at, created_at)
 where discount_amount > 0
   and status not in ('PENDING_APPROVAL', 'CANCELLED')
   and discount_approved_by is null;

create or replace function public.lead_quotes_guard() returns trigger
  language plpgsql set search_path = public as $$
declare
  v_role     text;
  v_admin    boolean;
  v_inherits boolean := false;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  v_role  := public.current_staff_role();
  v_admin := v_role = 'ADMIN';

  if tg_op = 'INSERT' then
    if v_admin then
      -- An admin's own discount is its own approval; record who.
      if new.discount_amount > 0 and new.discount_approved_by is null and new.status in ('DRAFT', 'SENT') then
        new.discount_approved_by := auth.uid()::text;
        new.discount_approved_at := now();
      end if;
      return new;
    end if;

    -- A revision may carry the approval of the quote it replaces, but only when that quote really has one for the same discount.
    if new.supersedes_quote_id is not null then
      select exists (
        select 1 from public.lead_quotes s
        where s.id = new.supersedes_quote_id
          and s.lead_id = new.lead_id
          and s.discount_amount = new.discount_amount
          and s.discount_approved_by is not null
      ) into v_inherits;
    end if;

    if not v_inherits and (new.discount_approved_by is not null or new.discount_approved_at is not null) then
      raise exception 'A discount approval can only be recorded by an administrator.' using errcode = '42501';
    end if;
    if not v_inherits and new.discount_amount > 0 and new.status not in ('PENDING_APPROVAL', 'CANCELLED') then
      raise exception 'A discounted quote must wait for administrator approval.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if v_admin then
    if old.status = 'PENDING_APPROVAL' and new.status in ('DRAFT', 'SENT') and new.discount_approved_by is null then
      new.discount_approved_by := auth.uid()::text;
      new.discount_approved_at := now();
    end if;
    return new;
  end if;

  if new.discount_approved_by is distinct from old.discount_approved_by
     or new.discount_approved_at is distinct from old.discount_approved_at then
    raise exception 'A discount approval can only be recorded by an administrator.' using errcode = '42501';
  end if;

  if new.total_lkr         is distinct from old.total_lkr
     or new.deposit_lkr    is distinct from old.deposit_lkr
     or new.discount_amount is distinct from old.discount_amount
     or new.price_per_person is distinct from old.price_per_person
     or new.pricing_snapshot is distinct from old.pricing_snapshot
     or new.payment_milestones is distinct from old.payment_milestones then
    raise exception 'A saved quote''s amounts cannot be edited. Create a revision instead.' using errcode = '42501';
  end if;

  if old.status = 'PENDING_APPROVAL' and new.status is distinct from old.status and new.status <> 'CANCELLED' then
    raise exception 'This quote is waiting for administrator approval.' using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists lead_quotes_guard_trg on public.lead_quotes;
create trigger lead_quotes_guard_trg before insert or update on public.lead_quotes
  for each row execute function public.lead_quotes_guard();

-- ── E. Policies: drop everything, then one per command ───────────────────────
-- Dropped by enumeration, not by name: policies are OR-ed, so one forgotten permissive FOR ALL would silently cancel everything below.
do $$
declare
  pol record;
begin
  for pol in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('leads', 'lead_activity', 'lead_notes', 'lead_quotes', 'lead_sources',
                        'lead_copilot_context', 'lead_copilot_dismissals', 'lead_communication_drafts')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- leads -----------------------------------------------------------------------
create policy leads_select on public.leads for select to authenticated
  using (agency_id = (select public.current_agency_id())
         and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'FINANCE', 'OPERATIONS', 'VISA'));

create policy leads_insert on public.leads for insert to authenticated
  with check (agency_id = (select public.current_agency_id())
              and public.staff_role_in('ADMIN', 'MARKETING'));

create policy leads_update on public.leads for update to authenticated
  using (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN', 'MARKETING'))
  with check (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN', 'MARKETING'));

create policy leads_delete on public.leads for delete to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and (
      public.staff_role_in('ADMIN')
      or (
        public.staff_role_in('MARKETING')
        and booking_id is null
        and stage = 'NEW_LEAD'
        and follow_up_attempts = 0
        and created_by_id = auth.uid()
        and created_at > now() - interval '15 minutes'
      )
    )
  );

-- lead_activity / lead_notes: insert-only; read narrowed to converted leads for FINANCE / OPERATIONS / VISA ----------
create policy lead_activity_select on public.lead_activity for select to authenticated
  using (agency_id = (select public.current_agency_id())
         and (public.staff_role_in('ADMIN', 'CEO', 'MARKETING')
              or (public.staff_role_in('FINANCE', 'OPERATIONS', 'VISA') and public.lead_is_converted(lead_id))));

create policy lead_activity_insert on public.lead_activity for insert to authenticated
  with check (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN', 'MARKETING'));

create policy lead_notes_select on public.lead_notes for select to authenticated
  using (agency_id = (select public.current_agency_id())
         and (public.staff_role_in('ADMIN', 'CEO', 'MARKETING')
              or (public.staff_role_in('FINANCE', 'OPERATIONS', 'VISA') and public.lead_is_converted(lead_id))));

create policy lead_notes_insert on public.lead_notes for insert to authenticated
  with check (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN', 'MARKETING'));

-- lead_quotes: FINANCE keeps every quote (margin / discount oversight); OPERATIONS / VISA only converted ones ----------
create policy lead_quotes_select on public.lead_quotes for select to authenticated
  using (agency_id = (select public.current_agency_id())
         and (public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'FINANCE')
              or (public.staff_role_in('OPERATIONS', 'VISA') and public.lead_is_converted(lead_id))));

create policy lead_quotes_insert on public.lead_quotes for insert to authenticated
  with check (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN', 'MARKETING'));

create policy lead_quotes_update on public.lead_quotes for update to authenticated
  using (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN', 'MARKETING'))
  with check (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN', 'MARKETING'));

create policy lead_quotes_delete on public.lead_quotes for delete to authenticated
  using (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN'));

-- lead_sources: everyone who can open the module reads; only an admin edits --------------------------------------------
create policy lead_sources_select on public.lead_sources for select to authenticated
  using (agency_id = (select public.current_agency_id())
         and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'FINANCE', 'OPERATIONS', 'VISA'));

create policy lead_sources_insert on public.lead_sources for insert to authenticated
  with check (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN'));

create policy lead_sources_update on public.lead_sources for update to authenticated
  using (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN'))
  with check (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN'));

create policy lead_sources_delete on public.lead_sources for delete to authenticated
  using (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN'));

-- Manasik Sales Intelligence: roles with `useCopilot` read (ADMIN, CEO, MARKETING); apply/draft roles write -------------
create policy lead_copilot_context_select on public.lead_copilot_context for select to authenticated
  using (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));
create policy lead_copilot_context_insert on public.lead_copilot_context for insert to authenticated
  with check (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN', 'MARKETING'));
create policy lead_copilot_context_update on public.lead_copilot_context for update to authenticated
  using (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN', 'MARKETING'))
  with check (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN', 'MARKETING'));
create policy lead_copilot_context_delete on public.lead_copilot_context for delete to authenticated
  using (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN'));

create policy lead_copilot_dismissals_select on public.lead_copilot_dismissals for select to authenticated
  using (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));
-- CEO has `useCopilot`, and dismissing an alert is part of that capability (dismissCopilotAlertAction).
create policy lead_copilot_dismissals_insert on public.lead_copilot_dismissals for insert to authenticated
  with check (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));

create policy lead_communication_drafts_select on public.lead_communication_drafts for select to authenticated
  using (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));
create policy lead_communication_drafts_insert on public.lead_communication_drafts for insert to authenticated
  with check (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN', 'MARKETING'));
create policy lead_communication_drafts_update on public.lead_communication_drafts for update to authenticated
  using (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN', 'MARKETING'))
  with check (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN', 'MARKETING'));
create policy lead_communication_drafts_delete on public.lead_communication_drafts for delete to authenticated
  using (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN'));

notify pgrst, 'reload schema';
