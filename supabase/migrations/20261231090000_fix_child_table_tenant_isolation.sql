-- TASK-029 P2.4, finding F2 (docs/progress/2026-10-02-tenant-isolation-audit.md): eight tables were readable and writable by EVERY signed-in
-- user, because each had a row-level-security policy that was simply `true` and none has an `agency_id` of its own.
--
--   payment_reminders, booking_collection_risk, milestone_change_events   (20261109090000_p1_2_payment_plans_risk.sql)
--   quote_line_items                                                       (20261111090000_p1_4_quotes_lifecycle.sql)
--   package_content, package_faqs, package_media, package_seo_analyses     (exist on staging only; defined in no migration)
--
-- "Every signed-in user" includes staff of every other agency and every pilgrim or agent portal login. All eight were empty when this was
-- found, so nothing had leaked; the first quote line or payment reminder created would have been visible to, and editable by, everyone.
--
-- The four tables the repository defines belong to a tenant only through a parent row, so each policy now checks the PARENT's agency
-- explicitly, and the roles mirror the sibling tables:
--   * payment_reminders, booking_collection_risk, milestone_change_events hang off departure_groups and follow booking_payment_milestones:
--     read ADMIN, FINANCE, CEO, OPERATIONS, MARKETING; write ADMIN, FINANCE.
--   * quote_line_items hangs off lead_quotes and follows it: read ADMIN, CEO, MARKETING, FINANCE, OPERATIONS, VISA; write ADMIN, MARKETING.
-- The parent's agency is checked directly (not by reading the parent under row-level security) on purpose: departure_groups lets a pilgrim
-- portal login read their own group, and inheriting that would show them internal collection-risk scores and payment reminders. Writes also
-- check that the booking belongs to the caller's agency, so a row cannot be attached to another agency's booking.
--
-- The four package_* tables are not defined anywhere in the repository and no application code uses them: they are staging-only leftovers.
-- Their always-true policies are removed (row-level security stays on, so nobody but the server key can reach them). They are NOT dropped:
-- whether to delete them is the owner's decision. The step is skipped on a database that does not have them, so a fresh build still works.
--
-- Safe to apply: the four repository tables are empty on staging and the app writes to them with finance and admin roles, which the new
-- write policies allow. Rollback: re-create the `true` policies (do not, on any environment with real customers). Idempotent.

-- payment_reminders ---------------------------------------------------------------------------------------------------------------
drop policy if exists payment_reminders_select on public.payment_reminders;
create policy payment_reminders_select on public.payment_reminders
  for select to authenticated
  using (
    exists (select 1 from public.departure_groups g where g.id = payment_reminders.departure_group_id and g.agency_id = (select public.current_agency_id()))
    and public.staff_role_in('ADMIN', 'FINANCE', 'CEO', 'OPERATIONS', 'MARKETING')
  );

drop policy if exists payment_reminders_write on public.payment_reminders;
create policy payment_reminders_write on public.payment_reminders
  for all to authenticated
  using (
    exists (select 1 from public.departure_groups g where g.id = payment_reminders.departure_group_id and g.agency_id = (select public.current_agency_id()))
    and public.staff_role_in('ADMIN', 'FINANCE')
  )
  with check (
    exists (select 1 from public.departure_groups g where g.id = payment_reminders.departure_group_id and g.agency_id = (select public.current_agency_id()))
    and exists (select 1 from public.departure_group_bookings b where b.id = payment_reminders.booking_id and b.agency_id = (select public.current_agency_id()))
    and public.staff_role_in('ADMIN', 'FINANCE')
  );

-- booking_collection_risk ---------------------------------------------------------------------------------------------------------
drop policy if exists booking_collection_risk_select on public.booking_collection_risk;
create policy booking_collection_risk_select on public.booking_collection_risk
  for select to authenticated
  using (
    exists (select 1 from public.departure_groups g where g.id = booking_collection_risk.departure_group_id and g.agency_id = (select public.current_agency_id()))
    and public.staff_role_in('ADMIN', 'FINANCE', 'CEO', 'OPERATIONS', 'MARKETING')
  );

drop policy if exists booking_collection_risk_write on public.booking_collection_risk;
create policy booking_collection_risk_write on public.booking_collection_risk
  for all to authenticated
  using (
    exists (select 1 from public.departure_groups g where g.id = booking_collection_risk.departure_group_id and g.agency_id = (select public.current_agency_id()))
    and public.staff_role_in('ADMIN', 'FINANCE')
  )
  with check (
    exists (select 1 from public.departure_groups g where g.id = booking_collection_risk.departure_group_id and g.agency_id = (select public.current_agency_id()))
    and exists (select 1 from public.departure_group_bookings b where b.id = booking_collection_risk.booking_id and b.agency_id = (select public.current_agency_id()))
    and public.staff_role_in('ADMIN', 'FINANCE')
  );

-- milestone_change_events (insert only: it is an append-only trail) ---------------------------------------------------------------
drop policy if exists milestone_change_events_select on public.milestone_change_events;
create policy milestone_change_events_select on public.milestone_change_events
  for select to authenticated
  using (
    exists (select 1 from public.departure_groups g where g.id = milestone_change_events.departure_group_id and g.agency_id = (select public.current_agency_id()))
    and public.staff_role_in('ADMIN', 'FINANCE', 'CEO', 'OPERATIONS', 'MARKETING')
  );

drop policy if exists milestone_change_events_write on public.milestone_change_events;
create policy milestone_change_events_write on public.milestone_change_events
  for insert to authenticated
  with check (
    exists (select 1 from public.departure_groups g where g.id = milestone_change_events.departure_group_id and g.agency_id = (select public.current_agency_id()))
    and exists (select 1 from public.departure_group_bookings b where b.id = milestone_change_events.booking_id and b.agency_id = (select public.current_agency_id()))
    and public.staff_role_in('ADMIN', 'FINANCE')
  );

-- quote_line_items ----------------------------------------------------------------------------------------------------------------
drop policy if exists "staff read quote_line_items" on public.quote_line_items;
create policy "staff read quote_line_items" on public.quote_line_items
  for select to authenticated
  using (
    exists (select 1 from public.lead_quotes q where q.id = quote_line_items.quote_id and q.agency_id = (select public.current_agency_id()))
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'FINANCE', 'OPERATIONS', 'VISA')
  );

drop policy if exists "staff write quote_line_items" on public.quote_line_items;
create policy "staff write quote_line_items" on public.quote_line_items
  for all to authenticated
  using (
    exists (select 1 from public.lead_quotes q where q.id = quote_line_items.quote_id and q.agency_id = (select public.current_agency_id()))
    and public.staff_role_in('ADMIN', 'MARKETING')
  )
  with check (
    exists (select 1 from public.lead_quotes q where q.id = quote_line_items.quote_id and q.agency_id = (select public.current_agency_id()))
    and public.staff_role_in('ADMIN', 'MARKETING')
  );

-- Staging-only package_* tables: remove the always-true policies, keep row-level security on (no policy = no access for users) ---------
do $$
declare
  v_table text;
begin
  foreach v_table in array array['package_content', 'package_faqs', 'package_media', 'package_seo_analyses'] loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('drop policy if exists %I on public.%I', 'staff read ' || v_table, v_table);
      execute format('drop policy if exists %I on public.%I', 'staff write ' || v_table, v_table);
      execute format('alter table public.%I enable row level security', v_table);
    end if;
  end loop;
end;
$$;

-- Guard: no public table may keep an unconditional policy, apart from genuinely global reference data -----------------------------------
do $$
declare
  v_open text;
begin
  select string_agg(c.relname || '.' || p.polname, ', ' order by c.relname, p.polname)
    into v_open
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
   where c.relnamespace = 'public'::regnamespace
     and c.relname not in ('ai_model_rates', 'country_locale_defaults')
     and (pg_get_expr(p.polqual, p.polrelid) in ('true', '(true)') or pg_get_expr(p.polwithcheck, p.polrelid) in ('true', '(true)'));

  if v_open is not null then
    raise exception 'Tenant isolation: these policies are still unconditional: %', v_open;
  end if;
end;
$$;
