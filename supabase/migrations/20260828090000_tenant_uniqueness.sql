-- Multi-tenancy Phase 2 — per-agency uniqueness, referential integrity on
-- the service-role write surface, and InitPlan-cached RLS predicates.
-- See docs/architecture/multi-tenancy-implementation-plan.md Phase 2 (F2, F10, F11).
--
-- Every block below checks the columns it needs exist before touching
-- anything, and emits a NOTICE naming what it skipped and why rather than
-- failing the whole migration on one table this database's migration
-- history has in a different shape than expected — the first version of
-- this file was not guarded this way and failed outright (42703, column
-- "agency_id" named in key does not exist) on a table somewhere in
-- section A or B whose exact identity the raw error didn't name. Rerunning
-- this version is safe either way: read the NOTICEs it prints, they name
-- the gap precisely.
--
-- Safe on a database with 20260808…20260827 applied — but no longer
-- *requires* every one of those to be fully applied to run without error;
-- it now does the best it can with whatever agency_id columns actually
-- exist and tells you what it couldn't do.

-- ─────────────────────────────────────────────────────────────────────────────
-- A/B/C combined, one DO block per table — per-agency uniqueness (F2),
-- composite (id, agency_id) + FK integrity on the service-role write
-- surface (F11), and the query-shape composite index (F10) for that same
-- table, all guarded on agency_id actually being present.
--
-- FK blocks additionally require the REFERENCED table to have agency_id
-- (checked separately) — a composite foreign key needs a composite unique
-- key to reference, and that key needs agency_id to exist on the parent
-- too.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  has_agency_id boolean;
begin
  -- departure_groups ──────────────────────────────────────────────────────
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'departure_groups' and column_name = 'agency_id'
  ) into has_agency_id;

  if has_agency_id then
    alter table public.departure_groups drop constraint if exists departure_groups_code_unique;
    alter table public.departure_groups drop constraint if exists departure_groups_code_agency_unique;
    alter table public.departure_groups
      add constraint departure_groups_code_agency_unique unique (agency_id, group_code);

    alter table public.departure_groups drop constraint if exists departure_groups_id_agency_unique;
    alter table public.departure_groups
      add constraint departure_groups_id_agency_unique unique (id, agency_id);

    create index if not exists departure_groups_agency_status_date_idx
      on public.departure_groups (agency_id, group_status, departure_date desc);
  else
    raise notice 'Skipped departure_groups — no agency_id column found. Re-run 20260824090000_tenancy.sql first.';
  end if;

  -- pilgrims ──────────────────────────────────────────────────────────────
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pilgrims' and column_name = 'agency_id'
  ) into has_agency_id;

  if has_agency_id then
    alter table public.pilgrims drop constraint if exists pilgrims_reference_key;
    alter table public.pilgrims drop constraint if exists pilgrims_reference_agency_unique;
    alter table public.pilgrims
      add constraint pilgrims_reference_agency_unique unique (agency_id, reference);

    drop index if exists public.pilgrims_passport_idx;
    create unique index if not exists pilgrims_passport_agency_unique
      on public.pilgrims (agency_id, upper(passport_number)) where passport_number is not null;

    create index if not exists pilgrims_agency_name_idx
      on public.pilgrims (agency_id, lower(full_name));
  else
    raise notice 'Skipped pilgrims — no agency_id column found.';
  end if;

  -- suppliers ─────────────────────────────────────────────────────────────
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'suppliers' and column_name = 'agency_id'
  ) into has_agency_id;

  if has_agency_id then
    alter table public.suppliers drop constraint if exists suppliers_code_unique;
    alter table public.suppliers drop constraint if exists suppliers_code_agency_unique;
    alter table public.suppliers
      add constraint suppliers_code_agency_unique unique (agency_id, supplier_code);

    create index if not exists suppliers_agency_status_idx
      on public.suppliers (agency_id, status);
  else
    raise notice 'Skipped suppliers — no agency_id column found.';
  end if;

  -- supplier_commitments ──────────────────────────────────────────────────
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'supplier_commitments' and column_name = 'agency_id'
  ) into has_agency_id;

  if has_agency_id then
    alter table public.supplier_commitments drop constraint if exists supplier_commitments_reference_unique;
    alter table public.supplier_commitments drop constraint if exists supplier_commitments_reference_agency_unique;
    alter table public.supplier_commitments
      add constraint supplier_commitments_reference_agency_unique unique (agency_id, reference_code);
  else
    raise notice 'Skipped supplier_commitments — no agency_id column found.';
  end if;

  -- payments ──────────────────────────────────────────────────────────────
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payments' and column_name = 'agency_id'
  ) into has_agency_id;

  if has_agency_id then
    alter table public.payments drop constraint if exists payments_reference_unique;
    alter table public.payments drop constraint if exists payments_reference_agency_unique;
    alter table public.payments
      add constraint payments_reference_agency_unique unique (agency_id, payment_reference);

    alter table public.payments drop constraint if exists payments_receipt_unique;
    alter table public.payments drop constraint if exists payments_receipt_agency_unique;
    alter table public.payments
      add constraint payments_receipt_agency_unique unique (agency_id, receipt_number);

    create index if not exists payments_agency_date_idx
      on public.payments (agency_id, paid_at desc);
  else
    raise notice 'Skipped payments — no agency_id column found.';
  end if;

  -- invoices ──────────────────────────────────────────────────────────────
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'agency_id'
  ) into has_agency_id;

  if has_agency_id then
    alter table public.invoices drop constraint if exists invoices_number_unique;
    alter table public.invoices drop constraint if exists invoices_number_agency_unique;
    alter table public.invoices
      add constraint invoices_number_agency_unique unique (agency_id, invoice_number);

    create index if not exists invoices_agency_status_idx
      on public.invoices (agency_id, status, created_at desc);
  else
    raise notice 'Skipped invoices — no agency_id column found.';
  end if;

  -- refund_requests ───────────────────────────────────────────────────────
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'refund_requests' and column_name = 'agency_id'
  ) into has_agency_id;

  if has_agency_id then
    alter table public.refund_requests drop constraint if exists refund_requests_reference_unique;
    alter table public.refund_requests drop constraint if exists refund_requests_reference_agency_unique;
    alter table public.refund_requests
      add constraint refund_requests_reference_agency_unique unique (agency_id, reference);
  else
    raise notice 'Skipped refund_requests — no agency_id column found.';
  end if;

  -- finance_adjustments ───────────────────────────────────────────────────
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'finance_adjustments' and column_name = 'agency_id'
  ) into has_agency_id;

  if has_agency_id then
    alter table public.finance_adjustments drop constraint if exists finance_adjustments_reference_unique;
    alter table public.finance_adjustments drop constraint if exists finance_adjustments_reference_agency_unique;
    alter table public.finance_adjustments
      add constraint finance_adjustments_reference_agency_unique unique (agency_id, reference);
  else
    raise notice 'Skipped finance_adjustments — no agency_id column found.';
  end if;

  -- agency_service_addons ─────────────────────────────────────────────────
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'agency_service_addons' and column_name = 'agency_id'
  ) into has_agency_id;

  if has_agency_id then
    alter table public.agency_service_addons drop constraint if exists agency_service_addons_code_unique;
    alter table public.agency_service_addons drop constraint if exists agency_service_addons_code_agency_unique;
    alter table public.agency_service_addons
      add constraint agency_service_addons_code_agency_unique unique (agency_id, code);
  else
    raise notice 'Skipped agency_service_addons — no agency_id column found.';
  end if;

  -- leads ─────────────────────────────────────────────────────────────────
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leads' and column_name = 'agency_id'
  ) into has_agency_id;

  if has_agency_id then
    alter table public.leads drop constraint if exists leads_id_agency_unique;
    alter table public.leads add constraint leads_id_agency_unique unique (id, agency_id);
    create index if not exists leads_agency_stage_idx on public.leads (agency_id, stage, created_at desc);
  else
    raise notice 'Skipped leads — no agency_id column found.';
  end if;

  -- lead_activity / lead_notes — children of leads ──────────────────────────
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lead_activity' and column_name = 'agency_id'
  ) into has_agency_id;

  if has_agency_id and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leads' and column_name = 'agency_id'
  ) then
    alter table public.lead_activity drop constraint if exists lead_activity_lead_id_fkey;
    alter table public.lead_activity drop constraint if exists lead_activity_lead_agency_fkey;
    alter table public.lead_activity
      add constraint lead_activity_lead_agency_fkey
        foreign key (lead_id, agency_id) references public.leads (id, agency_id) on delete cascade;
  else
    raise notice 'Skipped lead_activity — agency_id missing on lead_activity and/or leads.';
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lead_notes' and column_name = 'agency_id'
  ) into has_agency_id;

  if has_agency_id and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leads' and column_name = 'agency_id'
  ) then
    alter table public.lead_notes drop constraint if exists lead_notes_lead_id_fkey;
    alter table public.lead_notes drop constraint if exists lead_notes_lead_agency_fkey;
    alter table public.lead_notes
      add constraint lead_notes_lead_agency_fkey
        foreign key (lead_id, agency_id) references public.leads (id, agency_id) on delete cascade;
  else
    raise notice 'Skipped lead_notes — agency_id missing on lead_notes and/or leads.';
  end if;

  -- departure_group_bookings — child of departure_groups ────────────────────
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'departure_group_bookings' and column_name = 'agency_id'
  ) into has_agency_id;

  if has_agency_id then
    alter table public.departure_group_bookings drop constraint if exists departure_group_bookings_id_agency_unique;
    alter table public.departure_group_bookings
      add constraint departure_group_bookings_id_agency_unique unique (id, agency_id);
    create index if not exists departure_group_bookings_agency_status_idx
      on public.departure_group_bookings (agency_id, booking_status, created_at desc);

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'departure_groups' and column_name = 'agency_id'
    ) then
      alter table public.departure_group_bookings
        drop constraint if exists departure_group_bookings_departure_group_id_fkey;
      alter table public.departure_group_bookings
        drop constraint if exists departure_group_bookings_group_agency_fkey;
      alter table public.departure_group_bookings
        add constraint departure_group_bookings_group_agency_fkey
          foreign key (departure_group_id, agency_id)
          references public.departure_groups (id, agency_id) on delete cascade;
    else
      raise notice 'Skipped departure_group_bookings -> departure_groups FK — departure_groups has no agency_id.';
    end if;
  else
    raise notice 'Skipped departure_group_bookings — no agency_id column found.';
  end if;

  -- departure_group_pilgrims — child of departure_groups + bookings ─────────
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'departure_group_pilgrims' and column_name = 'agency_id'
  ) into has_agency_id;

  if has_agency_id then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'departure_groups' and column_name = 'agency_id'
    ) then
      alter table public.departure_group_pilgrims
        drop constraint if exists departure_group_pilgrims_departure_group_id_fkey;
      alter table public.departure_group_pilgrims
        drop constraint if exists departure_group_pilgrims_group_agency_fkey;
      alter table public.departure_group_pilgrims
        add constraint departure_group_pilgrims_group_agency_fkey
          foreign key (departure_group_id, agency_id)
          references public.departure_groups (id, agency_id) on delete cascade;
    else
      raise notice 'Skipped departure_group_pilgrims -> departure_groups FK — departure_groups has no agency_id.';
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'departure_group_bookings' and column_name = 'agency_id'
    ) then
      alter table public.departure_group_pilgrims
        drop constraint if exists departure_group_pilgrims_booking_id_fkey;
      alter table public.departure_group_pilgrims
        drop constraint if exists departure_group_pilgrims_booking_agency_fkey;
      alter table public.departure_group_pilgrims
        add constraint departure_group_pilgrims_booking_agency_fkey
          foreign key (booking_id, agency_id)
          references public.departure_group_bookings (id, agency_id) on delete cascade;
    else
      raise notice 'Skipped departure_group_pilgrims -> departure_group_bookings FK — no agency_id on the parent.';
    end if;
  else
    raise notice 'Skipped departure_group_pilgrims — no agency_id column found.';
  end if;

  -- conversations — child of leads ───────────────────────────────────────
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conversations' and column_name = 'agency_id'
  ) into has_agency_id;

  if has_agency_id then
    alter table public.conversations drop constraint if exists conversations_id_agency_unique;
    alter table public.conversations add constraint conversations_id_agency_unique unique (id, agency_id);
    create index if not exists conversations_agency_state_updated_idx
      on public.conversations (agency_id, state, updated_at desc);

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'leads' and column_name = 'agency_id'
    ) then
      alter table public.conversations drop constraint if exists conversations_lead_id_fkey;
      alter table public.conversations drop constraint if exists conversations_lead_agency_fkey;
      alter table public.conversations
        add constraint conversations_lead_agency_fkey
          foreign key (lead_id, agency_id) references public.leads (id, agency_id) on delete set null;
    else
      raise notice 'Skipped conversations -> leads FK — leads has no agency_id.';
    end if;
  else
    raise notice 'Skipped conversations — no agency_id column found (needs 20260825090000_whatsapp_channel.sql).';
  end if;

  -- conversation_messages — child of conversations ───────────────────────
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conversation_messages' and column_name = 'agency_id'
  ) into has_agency_id;

  if has_agency_id then
    create index if not exists conversation_messages_agency_conversation_idx
      on public.conversation_messages (agency_id, conversation_id, created_at desc);

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'conversations' and column_name = 'agency_id'
    ) then
      alter table public.conversation_messages drop constraint if exists conversation_messages_conversation_id_fkey;
      alter table public.conversation_messages drop constraint if exists conversation_messages_conversation_agency_fkey;
      alter table public.conversation_messages
        add constraint conversation_messages_conversation_agency_fkey
          foreign key (conversation_id, agency_id)
          references public.conversations (id, agency_id) on delete cascade;
    else
      raise notice 'Skipped conversation_messages -> conversations FK — conversations has no agency_id.';
    end if;
  else
    raise notice 'Skipped conversation_messages — no agency_id column found (needs 20260825090000_whatsapp_channel.sql).';
  end if;

  -- booking_sessions — child of leads / departure_groups / bookings ─────────
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'booking_sessions' and column_name = 'agency_id'
  ) into has_agency_id;

  if has_agency_id then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'leads' and column_name = 'agency_id'
    ) then
      alter table public.booking_sessions drop constraint if exists booking_sessions_lead_id_fkey;
      alter table public.booking_sessions drop constraint if exists booking_sessions_lead_agency_fkey;
      alter table public.booking_sessions
        add constraint booking_sessions_lead_agency_fkey
          foreign key (lead_id, agency_id) references public.leads (id, agency_id) on delete set null;
    else
      raise notice 'Skipped booking_sessions -> leads FK — leads has no agency_id.';
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'departure_groups' and column_name = 'agency_id'
    ) then
      alter table public.booking_sessions drop constraint if exists booking_sessions_departure_group_id_fkey;
      alter table public.booking_sessions drop constraint if exists booking_sessions_group_agency_fkey;
      alter table public.booking_sessions
        add constraint booking_sessions_group_agency_fkey
          foreign key (departure_group_id, agency_id)
          references public.departure_groups (id, agency_id) on delete set null;
    else
      raise notice 'Skipped booking_sessions -> departure_groups FK — departure_groups has no agency_id.';
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'departure_group_bookings' and column_name = 'agency_id'
    ) then
      alter table public.booking_sessions drop constraint if exists booking_sessions_booking_id_fkey;
      alter table public.booking_sessions drop constraint if exists booking_sessions_booking_agency_fkey;
      alter table public.booking_sessions
        add constraint booking_sessions_booking_agency_fkey
          foreign key (booking_id, agency_id)
          references public.departure_group_bookings (id, agency_id) on delete set null;
    else
      raise notice 'Skipped booking_sessions -> departure_group_bookings FK — no agency_id on the parent.';
    end if;
  else
    raise notice 'Skipped booking_sessions — no agency_id column found (needs 20260826090000_ai_agent.sql).';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. InitPlan-cache every RLS predicate's call to current_agency_id().
--
-- `agency_id = current_agency_id()` evaluates the (security definer,
-- stable) function once per row Postgres considers. Wrapping the call in a
-- scalar subquery — `agency_id = (select current_agency_id())` — lets
-- Postgres evaluate it once per statement and reuse the result, per
-- Supabase's documented RLS performance guidance. This rewrites every
-- policy in place by reading its stored expression from pg_policies, the
-- same introspection approach 20260824090000_tenancy.sql §E used to fold in
-- the tenant filter in the first place — safer than hand-editing 100+
-- policies, because the rewrite cannot disagree with what is actually
-- enforced today. Purely dynamic and column-agnostic, so it needs no
-- agency_id guard of its own — it only ever touches a policy that already
-- exists and already references current_agency_id().
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  pol record;
  new_qual text;
  new_check text;
  check_clause text;
  -- Matches an optional `public.` prefix together with the call itself, as
  -- one unit, so the whole match — prefix included — is replaced. A plain
  -- string replace() on just `current_agency_id()` would leave a stray
  -- `public.` in front of the new `(select …)` wrapper whenever pg_policies
  -- happens to deparse the call unqualified (search_path–dependent, and not
  -- something this migration can assume either way).
  fn_pattern text := '(public\.)?current_agency_id\(\)';
  wrapped    text := '(select public.current_agency_id())';
begin
  for pol in
    select schemaname, tablename, policyname, cmd, roles, permissive, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (qual ~ fn_pattern or with_check ~ fn_pattern)
      and coalesce(qual, '') not like '%(select%current_agency_id())%'
      and coalesce(with_check, '') not like '%(select%current_agency_id())%'
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);

    new_qual := case when pol.qual is not null
      then regexp_replace(pol.qual, fn_pattern, wrapped, 'g')
      else null
    end;
    new_check := case when pol.with_check is not null
      then regexp_replace(pol.with_check, fn_pattern, wrapped, 'g')
      else null
    end;

    if pol.cmd = 'INSERT' then
      execute format(
        'create policy %I on public.%I as %s for insert to %s with check (%s)',
        pol.policyname, pol.tablename, pol.permissive,
        array_to_string(pol.roles, ', '),
        coalesce(new_check, 'agency_id = (select public.current_agency_id())')
      );
    else
      check_clause := case when new_check is not null
        then format(' with check (%s)', new_check)
        else ''
      end;
      execute format(
        'create policy %I on public.%I as %s for %s to %s using (%s)%s',
        pol.policyname, pol.tablename, pol.permissive, pol.cmd,
        array_to_string(pol.roles, ', '),
        coalesce(new_qual, 'agency_id = (select public.current_agency_id())'),
        check_clause
      );
    end if;
  end loop;
end $$;
