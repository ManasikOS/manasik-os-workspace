-- Repair: re-apply the parts of 20260824090000_tenancy.sql that never landed.
--
-- Observed on the live database (2026-08-31): `agencies`, `current_agency_id()`
-- and every migration from 20260825 onward are present, but NOT ONE of the
-- `agency_id` columns section C of the tenancy migration was supposed to add.
-- Only `departure_groups.agency_id` (a reserved column from 20260809090000)
-- and `staff_profiles.agency_id` exist. That means the original migration
-- aborted inside section C and sections C-G never committed, while the
-- migrations after it were applied anyway.
--
-- The symptom: creating a departure group writes the `departure_groups` row,
-- then fails on the second table --
--   "Could not find the 'agency_id' column of
--    'departure_group_package_snapshots' in the schema cache"
-- because persistStore() (lib/data/departure-groups-repository.ts) stamps
-- agency_id onto every row it inserts. Every other tenant-scoped write path
-- is broken the same way; departure groups just happens to be the one that
-- reports it as a partial write.
--
-- This file re-runs sections C, D, E, F and G idempotently, so it is safe on
-- a database where some of it did land. The only behavioural change from the
-- original is in section E, which now SKIPS any policy whose expression
-- already carries the tenant clause -- necessary because migrations written
-- after 20260824 (agency membership, guide scoping) created policies that
-- section E must not wrap a second time.
--
-- AFTER this file, re-run 20260828090000_tenant_uniqueness.sql. That
-- migration self-guards on `agency_id` existing and therefore skipped almost
-- every table when it first ran; re-running it now applies the per-agency
-- unique keys and composite FKs it passed over.

-- ─────────────────────────────────────────────────────────────────────────────
-- C. agency_id on every tenant-owned table. (verbatim from 20260824090000)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  tbl text;
  tables text[] := array[
    'agency_service_addons', 'booking_payment_milestones', 'branches',
    'departure_group_accommodations', 'departure_group_activity_logs',
    'departure_group_bookings', 'departure_group_flight_legs',
    'departure_group_flights', 'departure_group_package_snapshots',
    'departure_group_pilgrim_charges', 'departure_group_pilgrim_deviations',
    'departure_group_pilgrim_documents', 'departure_group_pilgrims',
    'departure_group_readiness_items', 'departure_group_room_assignments',
    'departure_group_rooms', 'departure_group_tasks', 'departure_group_transports',
    'departure_groups', 'document_ai_analyses', 'document_review_events',
    'finance_activity_events', 'finance_adjustments', 'integration_connections',
    'invoice_line_items', 'invoices', 'lead_activity', 'lead_notes', 'lead_quotes',
    'lead_sources', 'leads', 'message_templates', 'packages',
    'payment_allocations', 'payments', 'pilgrim_activity_logs',
    'pilgrim_medical_records', 'pilgrim_payment_milestones',
    'pilgrim_support_requests', 'pilgrims', 'refund_requests',
    'settings_activity_logs', 'staff_activity_logs', 'staff_group_assignments',
    'staff_invitations', 'staff_profiles', 'supplier_activity_events',
    'supplier_commitments', 'supplier_contacts', 'supplier_payments',
    'supplier_services', 'suppliers', 'visa_application_events',
    'visa_submission_batches'
  ];
begin
  foreach tbl in array tables loop
    execute format('alter table public.%I add column if not exists agency_id uuid', tbl);
    execute format('alter table public.%I alter column agency_id set default public.current_agency_id()', tbl);
    execute format(
      'update public.%I set agency_id = (select id from public.agencies order by created_at asc limit 1) where agency_id is null',
      tbl
    );
    execute format('alter table public.%I alter column agency_id set not null', tbl);
    execute format('alter table public.%I drop constraint if exists %I', tbl, tbl || '_agency_id_fkey');
    execute format(
      'alter table public.%I add constraint %I foreign key (agency_id) references public.agencies (id)',
      tbl, tbl || '_agency_id_fkey'
    );
    execute format('create index if not exists %I on public.%I (agency_id)', tbl || '_agency_id_idx', tbl);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. agency_settings stops being a singleton.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.agency_settings add column if not exists agency_id uuid;
alter table public.agency_settings alter column agency_id set default public.current_agency_id();
update public.agency_settings
  set agency_id = (select id from public.agencies order by created_at asc limit 1)
  where agency_id is null;
alter table public.agency_settings alter column agency_id set not null;
alter table public.agency_settings drop constraint if exists agency_settings_agency_id_fkey;
alter table public.agency_settings add constraint agency_settings_agency_id_fkey
  foreign key (agency_id) references public.agencies (id);

alter table public.agency_settings drop constraint if exists agency_settings_one_row;
alter table public.agency_settings drop constraint if exists agency_settings_agency_id_unique;
alter table public.agency_settings add constraint agency_settings_agency_id_unique unique (agency_id);

create index if not exists agency_settings_agency_id_idx on public.agency_settings (agency_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Fold `agency_id = current_agency_id()` into every policy that does not
--    already have it.
--
-- The skip guard is the one deliberate difference from the original section E.
-- Policies created by 20260829090000 (agency membership) and 20260903090000
-- (guide scoping) already resolve the tenant, and re-wrapping them would nest
-- the same predicate twice on every row read.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  pol record;
  tbl text;
  tenant_tables text[] := array[
    'agency_service_addons', 'booking_payment_milestones', 'branches',
    'departure_group_accommodations', 'departure_group_activity_logs',
    'departure_group_bookings', 'departure_group_flight_legs',
    'departure_group_flights', 'departure_group_package_snapshots',
    'departure_group_pilgrim_charges', 'departure_group_pilgrim_deviations',
    'departure_group_pilgrim_documents', 'departure_group_pilgrims',
    'departure_group_readiness_items', 'departure_group_room_assignments',
    'departure_group_rooms', 'departure_group_tasks', 'departure_group_transports',
    'departure_groups', 'document_ai_analyses', 'document_review_events',
    'finance_activity_events', 'finance_adjustments', 'integration_connections',
    'invoice_line_items', 'invoices', 'lead_activity', 'lead_notes', 'lead_quotes',
    'lead_sources', 'leads', 'message_templates', 'packages',
    'payment_allocations', 'payments', 'pilgrim_activity_logs',
    'pilgrim_medical_records', 'pilgrim_payment_milestones',
    'pilgrim_support_requests', 'pilgrims', 'refund_requests',
    'settings_activity_logs', 'staff_activity_logs', 'staff_group_assignments',
    'staff_invitations', 'staff_profiles', 'supplier_activity_events',
    'supplier_commitments', 'supplier_contacts', 'supplier_payments',
    'supplier_services', 'suppliers', 'visa_application_events',
    'visa_submission_batches', 'agency_settings'
  ];
  new_qual text;
  new_check text;
  check_clause text;
begin
  foreach tbl in array tenant_tables loop
    execute format('alter table public.%I enable row level security', tbl);
  end loop;

  for pol in
    select schemaname, tablename, policyname, cmd, roles, permissive, qual, with_check
    from pg_policies
    where schemaname = 'public' and tablename = any(tenant_tables)
      and coalesce(qual, '') !~ 'current_agency_id'
      and coalesce(with_check, '') !~ 'current_agency_id'
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);

    if pol.qual is not null then
      new_qual := format('(agency_id = public.current_agency_id()) and (%s)', pol.qual);
    else
      new_qual := null;
    end if;

    if pol.with_check is not null then
      new_check := format('(agency_id = public.current_agency_id()) and (%s)', pol.with_check);
    else
      new_check := null;
    end if;

    if pol.cmd = 'INSERT' then
      -- INSERT-only policies take WITH CHECK alone -- USING is not valid
      -- syntax there, so this branch must not emit one.
      execute format(
        'create policy %I on public.%I as %s for insert to %s with check (%s)',
        pol.policyname, pol.tablename, pol.permissive,
        array_to_string(pol.roles, ', '),
        coalesce(new_check, 'agency_id = public.current_agency_id()')
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
        coalesce(new_qual, 'agency_id = public.current_agency_id()'),
        check_clause
      );
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- F. Per-agency uniqueness. Each `add constraint` is preceded by a drop of
--    its own name as well as the old global one, so this block re-runs.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.leads drop constraint if exists leads_reference_key;
alter table public.leads drop constraint if exists leads_reference_agency_unique;
alter table public.leads add constraint leads_reference_agency_unique unique (agency_id, reference);

alter table public.lead_quotes drop constraint if exists lead_quotes_reference_key;
alter table public.lead_quotes drop constraint if exists lead_quotes_reference_agency_unique;
alter table public.lead_quotes add constraint lead_quotes_reference_agency_unique unique (agency_id, reference);

alter table public.lead_sources drop constraint if exists lead_sources_code_key;
alter table public.lead_sources drop constraint if exists lead_sources_code_agency_unique;
alter table public.lead_sources add constraint lead_sources_code_agency_unique unique (agency_id, code);

alter table public.integration_connections drop constraint if exists integration_connections_provider_key;
alter table public.integration_connections drop constraint if exists integration_connections_provider_agency_unique;
alter table public.integration_connections add constraint integration_connections_provider_agency_unique
  unique (agency_id, provider);

alter table public.message_templates drop constraint if exists message_templates_category_channel_language_key;
alter table public.message_templates drop constraint if exists message_templates_category_channel_language_agency_unique;
alter table public.message_templates add constraint message_templates_category_channel_language_agency_unique
  unique (agency_id, category, channel, language);

drop index if exists public.branches_code_unique;
create unique index if not exists branches_code_agency_unique on public.branches (agency_id, upper(code));
drop index if exists public.branches_primary_unique;
create unique index if not exists branches_primary_agency_unique on public.branches (agency_id, is_primary) where is_primary;

alter table public.departure_group_bookings drop constraint if exists departure_group_bookings_reference_unique;
alter table public.departure_group_bookings drop constraint if exists departure_group_bookings_reference_agency_unique;
alter table public.departure_group_bookings add constraint departure_group_bookings_reference_agency_unique
  unique (agency_id, booking_reference);

-- staff_profiles_email_unique stays exactly as it is (global, on lower(email))
-- -- it is keyed to auth.users identity, which is inherently one-per-email
-- across the whole Supabase project, not a per-agency concept.

-- ─────────────────────────────────────────────────────────────────────────────
-- G. agencies -- read-only to its own staff; no self-serve write path yet.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.agencies enable row level security;

drop policy if exists agencies_select on public.agencies;
create policy agencies_select on public.agencies
  for select to authenticated
  using (id = public.current_agency_id());

-- Make PostgREST pick the new columns up immediately rather than on its next
-- scheduled schema reload -- without this the "schema cache" error in the
-- header can outlive the fix by a few minutes.
notify pgrst, 'reload schema';
