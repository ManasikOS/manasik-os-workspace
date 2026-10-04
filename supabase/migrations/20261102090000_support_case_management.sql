-- ─────────────────────────────────────────────────────────────────────────────
-- Support & Incidents — case management (M11 of
-- docs/architecture/remaining-modules-master-plan.md), reusing `pilgrim_support_requests`
-- rather than building a parallel `support_cases` table.
--
-- 20261019090000_feedback_surveys.sql already made this call for Complaints
-- ("this agency already has pilgrim_support_requests ... with exactly the
-- severity/priority/assignment/resolution workflow a complaint needs. Rather
-- than build a second, near-identical table, this migration only widens its
-- category check"). This migration follows the same posture for the rest of
-- M11's asks:
--
--   * severity        -> already `priority` (LOW/NORMAL/HIGH/URGENT)
--   * category         -> already widened by 20261019090000
--   * SLA              -> new `sla_due_at`, set from priority at creation
--   * escalation        -> new `escalated_at` / `escalated_to_role`
--   * supplier linkage -> new `supplier_id`
--   * case history      -> new `support_case_events` (comments, status
--                          changes, escalations) — a case-specific thread,
--                          distinct from `pilgrim_activity_logs`'s per-pilgrim
--                          timeline, which stays as the cross-cutting log
--
-- `support_case_attachments` from the plan's M11 is deferred: it needs
-- storage-bucket wiring (like ticket/visa uploads have) that is a separate
-- slice, not a schema-only addition.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.pilgrim_support_requests
  add column if not exists sla_due_at timestamptz,
  add column if not exists escalated_at timestamptz,
  add column if not exists escalated_to_role text
    check (escalated_to_role is null or escalated_to_role in
      ('ADMIN', 'CEO', 'FINANCE', 'MARKETING', 'OPERATIONS', 'VISA', 'GUIDE')),
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;

comment on column public.pilgrim_support_requests.sla_due_at is
  'When this case should be resolved by, derived from priority at creation (URGENT 4h / HIGH 24h / NORMAL 72h / LOW 7d). Not re-derived if priority changes later.';
comment on column public.pilgrim_support_requests.supplier_id is
  'Set when the incident was caused by (or must be resolved through) a specific supplier — a hotel no-show, a transport delay.';

create index if not exists pilgrim_support_requests_sla_idx
  on public.pilgrim_support_requests (sla_due_at)
  where status in ('OPEN', 'IN_PROGRESS') and sla_due_at is not null;
create index if not exists pilgrim_support_requests_supplier_idx
  on public.pilgrim_support_requests (supplier_id) where supplier_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.support_case_events (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  support_request_id uuid not null references public.pilgrim_support_requests (id) on delete cascade,
  -- Denormalized for the same reason every other pilgrim-child table carries
  -- it (pilgrim_medical_records, pilgrim_support_requests itself): scoping
  -- and RLS without a join.
  pilgrim_id uuid not null references public.pilgrims (id) on delete cascade,

  event_type text not null
    check (event_type in ('COMMENT', 'STATUS_CHANGE', 'ESCALATED', 'REOPENED', 'SUPPLIER_LINKED')),
  message text not null,
  actor_name text not null default 'Staff',
  created_at timestamptz not null default now()
);

comment on table public.support_case_events is
  'A case-specific timeline (comments, status changes, escalations) for one pilgrim_support_requests row. Append-only.';

create index if not exists support_case_events_case_idx
  on public.support_case_events (support_request_id, created_at);
create index if not exists support_case_events_agency_idx
  on public.support_case_events (agency_id);

alter table public.support_case_events enable row level security;

-- Same role set as pilgrim_support_requests itself (manageSupportRequests:
-- ADMIN, OPERATIONS, GUIDE — see 20260822090000_rls_hardening.sql), plus
-- real agency scoping, which is the current convention for a new table (the
-- older pilgrim_* policies predate current_agency_id() being used this way).
drop policy if exists "staff read support_case_events" on public.support_case_events;
create policy "staff read support_case_events" on public.support_case_events
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'OPERATIONS', 'GUIDE'));

drop policy if exists "staff write support_case_events" on public.support_case_events;
create policy "staff write support_case_events" on public.support_case_events
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'OPERATIONS', 'GUIDE'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'OPERATIONS', 'GUIDE'));
