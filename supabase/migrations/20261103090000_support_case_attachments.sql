-- ─────────────────────────────────────────────────────────────────────────────
-- Support & Incidents — case attachments, deferred from
-- 20261102090000_support_case_management.sql ("support_case_attachments
-- from the plan's M11 is deferred: it needs storage-bucket wiring ... that
-- is a separate slice, not a schema-only addition").
--
-- Reuses the existing private `pilgrim-documents` bucket (see
-- 20260811090000_departure_groups_documents_lifecycle.sql /
-- 20260827090000_tenant_storage_isolation.sql) rather than provisioning a
-- new bucket — same posture as every other file-carrying table in this
-- schema, one bucket per kind of sensitivity, not one per feature. Objects
-- are staged under `<agency_id>/support-cases/...`, a second path segment
-- that existing pilgrim-document policies don't match, so a new pair of
-- policies is added scoped to that segment and to `manageSupportRequests`'s
-- own role set (ADMIN, OPERATIONS, GUIDE — see
-- 20260822090000_rls_hardening.sql and lib/access/pilgrims-access.ts) rather
-- than the narrower ADMIN/OPERATIONS/VISA the plain document policies use.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.support_case_events drop constraint if exists support_case_events_event_type_check;
alter table public.support_case_events add constraint support_case_events_event_type_check
  check (event_type in
    ('COMMENT', 'STATUS_CHANGE', 'ESCALATED', 'REOPENED', 'SUPPLIER_LINKED', 'ATTACHMENT_ADDED', 'ATTACHMENT_REMOVED'));

create table if not exists public.support_case_attachments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  support_request_id uuid not null references public.pilgrim_support_requests (id) on delete cascade,
  pilgrim_id uuid not null references public.pilgrims (id) on delete cascade,

  file_path text not null,
  file_name text not null,
  content_type text not null,
  size_bytes integer not null check (size_bytes > 0),

  uploaded_by_name text not null default 'Staff',
  created_at timestamptz not null default now()
);

comment on table public.support_case_attachments is
  'Photos/documents attached to a support case — an incident photo, a supplier email, a signed acknowledgement. file_path is an object key in the pilgrim-documents bucket under <agency_id>/support-cases/<pilgrim_id>/<support_request_id>/.';

create index if not exists support_case_attachments_case_idx
  on public.support_case_attachments (support_request_id);
create index if not exists support_case_attachments_agency_idx
  on public.support_case_attachments (agency_id);

alter table public.support_case_attachments enable row level security;

drop policy if exists "staff read support_case_attachments" on public.support_case_attachments;
create policy "staff read support_case_attachments" on public.support_case_attachments
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'OPERATIONS', 'GUIDE'));

drop policy if exists "staff write support_case_attachments" on public.support_case_attachments;
create policy "staff write support_case_attachments" on public.support_case_attachments
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'OPERATIONS', 'GUIDE'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'OPERATIONS', 'GUIDE'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage: a second, distinctly-scoped pair of policies on the same bucket.
-- (storage.foldername(name))[2] = 'support-cases' is what separates these
-- objects from an ordinary traveller document at the same agency prefix —
-- see the path shape in the table comment above.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "staff read support case attachments" on storage.objects;
create policy "staff read support case attachments" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pilgrim-documents'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and (storage.foldername(name))[2] = 'support-cases'
    and public.staff_role_in('ADMIN', 'OPERATIONS', 'GUIDE')
  );

drop policy if exists "staff upload support case attachments" on storage.objects;
create policy "staff upload support case attachments" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pilgrim-documents'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and (storage.foldername(name))[2] = 'support-cases'
    and public.staff_role_in('ADMIN', 'OPERATIONS', 'GUIDE')
  );

drop policy if exists "staff delete support case attachments" on storage.objects;
create policy "staff delete support case attachments" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'pilgrim-documents'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and (storage.foldername(name))[2] = 'support-cases'
    and public.staff_role_in('ADMIN', 'OPERATIONS', 'GUIDE')
  );
