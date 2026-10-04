-- Multi-tenancy retrofit.
--
-- Every table this application has shipped so far assumed one agency per
-- deployment: `agency_settings` was a hard singleton, every RLS policy keyed
-- on `staff_role_in(...)` alone, and nothing carried an `agency_id` column
-- except a single reserved, unused one on `departure_groups`. This migration
-- makes "which agency does this row belong to" a real, enforced question
-- across the whole schema — see docs/modules/whatsapp-ai-agent-implementation-plan.md
-- §2 / D1. It is the first migration of that plan and everything after it
-- (the WhatsApp channel, the AI agent, the Inbox) depends on it having run.
--
-- What this migration does NOT do: self-serve agency signup, plans, billing.
-- Every existing row is backfilled onto one seeded agency; a second agency
-- exists on this schema only once something creates one. That is deliberate
-- — see the plan's §2.1.
--
-- Safe on a database with 20260808…20260823 applied.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. agencies — the tenant root every business row is scoped under.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.agencies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default '',
  slug        text unique,
  status      text not null default 'ACTIVE'
                check (status in ('ACTIVE', 'SUSPENDED', 'CANCELLED')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.agencies is
  'The tenant root. Every table listed in section C below carries agency_id referencing this. See docs/modules/whatsapp-ai-agent-implementation-plan.md D1.';

drop trigger if exists agencies_set_updated_at on public.agencies;
create trigger agencies_set_updated_at
  before update on public.agencies
  for each row execute function public.set_updated_at();

-- Seed the one agency every pre-existing row belongs to. Named from
-- agency_settings.agency_name when a settings row already exists (it does,
-- on any database with 20260821090000 applied); falls back to a plain
-- default on a schema that somehow reached this migration without one.
insert into public.agencies (name, slug, status)
select coalesce(nullif(s.agency_name, ''), 'Default Agency'), 'default', 'ACTIVE'
from public.agency_settings s
where not exists (select 1 from public.agencies)
limit 1;

insert into public.agencies (name, slug, status)
select 'Default Agency', 'default', 'ACTIVE'
where not exists (select 1 from public.agencies);

-- `current_agency_id()` below references staff_profiles.agency_id. This must
-- exist before PostgreSQL parses that function on a fresh database; the broad
-- tenant-table retrofit in section C completes its default, backfill, FK and
-- index immediately afterwards.
alter table public.staff_profiles add column if not exists agency_id uuid;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. current_agency_id() — the resolver every RLS policy below folds in.
--
-- security definer: this reads staff_profiles directly, bypassing that
-- table's own RLS. Without that, evaluating a staff_profiles policy that
-- itself calls current_agency_id() would recurse into evaluating
-- staff_profiles' own policy again. Same pattern as current_staff_role()
-- (20260820090000) and staff_assigned_to_group() (20260822090000).
--
-- Returns null for a service-role connection (no auth.uid()) and for any
-- signed-in user with no staff_profiles row — both cases are handled by the
-- caller: a service-role client bypasses RLS entirely and must pass
-- agency_id explicitly (see AgentContext in lib/agent/*), and a null result
-- against `agency_id = current_agency_id()` simply matches no rows.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.current_agency_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select agency_id from public.staff_profiles where id = auth.uid()
$$;

comment on function public.current_agency_id() is
  'Security-definer helper: the calling user''s staff_profiles.agency_id, or null if they have no row. The tenant filter folded into every RLS policy in section E.';

-- ─────────────────────────────────────────────────────────────────────────────
-- C. agency_id on every tenant-owned table.
--
-- Backfilled to the one seeded agency; given `default public.current_agency_id()`
-- so every existing Server Action and repository function in lib/data/*
-- keeps working completely unchanged — none of them need to learn about
-- agency_id, because the session-scoped Supabase client they already use
-- resolves it both as the INSERT default and, via RLS (section E), as the
-- implicit SELECT/UPDATE/DELETE filter. Only code using the service-role
-- admin client (the WhatsApp webhook/agent) must pass agency_id explicitly.
--
-- `departure_groups.agency_id` already existed as a reserved, FK-less column
-- (20260809090000) — `add column if not exists` is a no-op there and the
-- rest of this block gives it the default, backfill, constraint and index
-- every other table gets, uniformly.
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
--
-- getAgencySettings() (lib/data/settings-repository.ts) queries
-- `eq('singleton', true).maybeSingle()` with no other filter. Once RLS scopes
-- every row to the caller's agency (section E), that query keeps returning
-- exactly one row — now correctly the CALLER's agency's row rather than the
-- only row in the database. No application code change needed. `singleton`
-- and its `check (singleton is true)` stay exactly as they were: every
-- agency's row is still "the" singleton for that agency, just no longer the
-- only row in the table.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.agency_settings add column if not exists agency_id uuid;
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
-- E. Every RLS policy on every tenant table gets an
--    `agency_id = current_agency_id()` clause folded in, ahead of whatever
--    role check it already enforced.
--
-- This reads each policy's actual stored expression from pg_policies rather
-- than hand-transcribing the 100+ policies written across nine prior
-- migrations — safer, because the rewrite can't disagree with what is
-- actually enforced today. RLS is (re-)enabled defensively on every table
-- first: a table with RLS on but zero policies denies all access by
-- default, which is the correct fail-closed state for anything this loop's
-- pg_policies scan doesn't find a policy for.
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
      -- INSERT-only policies take WITH CHECK alone — USING is not valid
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
-- F. Per-agency uniqueness — see the plan's D2b. Everything that was
--    globally unique becomes unique per agency. The reference-number
--    generators in lib/data/*-repository.ts (nextReferenceNumber(),
--    LD-YYYY-NNNN, QT-YYYY-NNNN) need no code change: they query through
--    the session client and are therefore already scoped by the RLS
--    policies rewritten in section E.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.leads drop constraint if exists leads_reference_key;
alter table public.leads add constraint leads_reference_agency_unique unique (agency_id, reference);

alter table public.lead_quotes drop constraint if exists lead_quotes_reference_key;
alter table public.lead_quotes add constraint lead_quotes_reference_agency_unique unique (agency_id, reference);

alter table public.lead_sources drop constraint if exists lead_sources_code_key;
alter table public.lead_sources add constraint lead_sources_code_agency_unique unique (agency_id, code);

alter table public.integration_connections drop constraint if exists integration_connections_provider_key;
alter table public.integration_connections add constraint integration_connections_provider_agency_unique
  unique (agency_id, provider);

alter table public.message_templates drop constraint if exists message_templates_category_channel_language_key;
alter table public.message_templates add constraint message_templates_category_channel_language_agency_unique
  unique (agency_id, category, channel, language);

drop index if exists public.branches_code_unique;
create unique index if not exists branches_code_agency_unique on public.branches (agency_id, upper(code));
drop index if exists public.branches_primary_unique;
create unique index if not exists branches_primary_agency_unique on public.branches (agency_id, is_primary) where is_primary;

alter table public.departure_group_bookings drop constraint if exists departure_group_bookings_reference_unique;
alter table public.departure_group_bookings add constraint departure_group_bookings_reference_agency_unique
  unique (agency_id, booking_reference);

-- staff_profiles_email_unique stays exactly as it is (global, on lower(email))
-- — it is keyed to auth.users identity, which is inherently one-per-email
-- across the whole Supabase project, not a per-agency concept.

-- ─────────────────────────────────────────────────────────────────────────────
-- G. agencies — read-only to its own staff; no self-serve write path yet.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.agencies enable row level security;

drop policy if exists agencies_select on public.agencies;
create policy agencies_select on public.agencies
  for select to authenticated
  using (id = public.current_agency_id());

-- Deliberately no insert/update/delete policy for `authenticated` — agency
-- lifecycle (create, suspend, rename) is a service-role-only operation until
-- self-serve onboarding exists. See the plan's §2.1.

-- ─────────────────────────────────────────────────────────────────────────────
-- H. Known follow-ups, out of scope for this migration:
--    * Supabase Storage bucket policies (agency-assets, pilgrim-documents,
--      etc.) are not touched here and remain scoped by role only. A second
--      agency's uploaded files are not yet isolated at the storage layer.
--    * Self-serve agency creation, plans and billing — see §2.1 of the plan.
-- ─────────────────────────────────────────────────────────────────────────────
