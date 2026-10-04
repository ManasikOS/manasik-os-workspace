-- ─────────────────────────────────────────────────────────────────────────────
-- RLS hardening.
--
-- Every migration before `20260820090000_team_access.sql` shipped
-- `using (true)` / `with check (true)` policies with a comment promising to
-- "tighten to real role claims here once staff roles exist in the database."
-- `staff_profiles` and `current_staff_role()` now exist — this migration
-- keeps that promise for every table it is safe to do so on.
--
-- Role sets below are read directly off `lib/access/*-access.ts`, not
-- re-derived: <module>-access.ts is the single source of truth for who can
-- do what, and these policies exist only to make the database agree with it
-- for direct PostgREST / Storage access, which bypasses the application layer
-- entirely. Column-level nuance (nulling `internal_cost`, passport numbers,
-- medical fields for a role that can see the *row* but not that *field*)
-- remains an application-layer concern, exactly as every `*-access.ts` file
-- already documents — Postgres RLS is row-grain, not column-grain, and
-- splitting every sensitive column into its own masked view is future work,
-- not part of this pass.
--
-- Deliberate exception: the 13 core `departure_group_*` tables (flights,
-- accommodations, rooms, bookings, pilgrims-enrolment, readiness, tasks …)
-- are left as `using (true)`. Every one of the 7 roles has `viewModule: true`
-- in `departure-groups-access.ts`, so row-level read restriction would be a
-- no-op; and the module's `mutate()` unit-of-work
-- (`lib/data/departure-groups.ts`) loads and writes across several of these
-- tables in one call as a side effect of a single mutator (e.g. completing a
-- task can flip a linked readiness item), so restricting write per-table
-- without a live database to verify every mutator's side effects risks
-- breaking a legitimate write for the wrong role. Every entry point into
-- that module already re-checks `capabilitiesFor(role)` server-side (see
-- `app/(main)/departure-groups/actions.ts`), so this is a defended, not an
-- open, surface — the same posture the module's own migration comment
-- describes. `departure_group_pilgrim_documents` (a separate migration) and
-- `departure_group_activity_logs` (append-only) are tightened below, since
-- both stand apart from that shared unit of work.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Helpers
-- ─────────────────────────────────────────────────────────────────────────────

-- public.current_staff_role() already exists (20260820090000_team_access.sql).

create or replace function public.staff_role_in(variadic roles text[]) returns boolean
  language sql stable as $$
  select public.current_staff_role() = any(roles)
$$;

comment on function public.staff_role_in(text[]) is
  'True when the calling user''s staff_profiles.role is one of the given roles. Shorthand for RLS policies.';

-- Guide row-scoping: true when the signed-in user is assigned (any
-- responsibility, still active) to the given departure group. Mirrors
-- `loadAssignedGroupIds()` in lib/data/team-repository.ts.
create or replace function public.staff_assigned_to_group(group_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff_group_assignments
    where departure_group_id = group_id
      and staff_profile_id = auth.uid()
      and unassigned_at is null
  )
$$;

comment on function public.staff_assigned_to_group(uuid) is
  'True when the calling user has an active staff_group_assignments row for this departure group. Used to scope GUIDE row access.';

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Packages — lib/access/packages-access.ts
--    viewModule: everyone but GUIDE. Write: any role with a create/edit/price
--    capability (ADMIN, OPERATIONS, FINANCE, MARKETING) — CEO and VISA are
--    read-only in this module.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "staff read packages" on public.packages;
create policy "staff read packages" on public.packages
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'FINANCE', 'MARKETING', 'VISA'));

drop policy if exists "staff insert packages" on public.packages;
create policy "staff insert packages" on public.packages
  for insert to authenticated
  with check (public.staff_role_in('ADMIN', 'OPERATIONS', 'FINANCE', 'MARKETING'));

drop policy if exists "staff update packages" on public.packages;
create policy "staff update packages" on public.packages
  for update to authenticated
  using (public.staff_role_in('ADMIN', 'OPERATIONS', 'FINANCE', 'MARKETING'))
  with check (public.staff_role_in('ADMIN', 'OPERATIONS', 'FINANCE', 'MARKETING'));

drop policy if exists "staff delete packages" on public.packages;
create policy "staff delete packages" on public.packages
  for delete to authenticated
  using (public.staff_role_in('ADMIN'));

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Leads — lib/access/leads-access.ts
--    viewModule: everyone but GUIDE. Write: only ADMIN and MARKETING have any
--    create/edit capability; FINANCE/OPERATIONS/VISA/CEO are read-only.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  tbl text;
  tables text[] := array['leads', 'lead_activity', 'lead_notes', 'lead_quotes', 'lead_sources'];
begin
  foreach tbl in array tables loop
    execute format('drop policy if exists "staff read %s" on public.%I', tbl, tbl);
    execute format('drop policy if exists "staff write %s" on public.%I', tbl, tbl);
    execute format(
      'create policy "staff read %s" on public.%I for select to authenticated using (public.staff_role_in(''ADMIN'',''CEO'',''MARKETING'',''FINANCE'',''OPERATIONS'',''VISA''))',
      tbl, tbl
    );
    execute format(
      'create policy "staff write %s" on public.%I for all to authenticated using (public.staff_role_in(''ADMIN'',''MARKETING'')) with check (public.staff_role_in(''ADMIN'',''MARKETING''))',
      tbl, tbl
    );
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Pilgrims — lib/access/pilgrims-access.ts
--    `pilgrims` itself carries passport_number alongside name/contact fields
--    every role needs, so — same reasoning as Departure Groups above — its
--    read stays open (viewModule is true for all 7 roles) and only write is
--    restricted to roles with `editPersonalDetails`. The three satellite
--    tables split cleanly by capability and are fully scoped.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "staff write pilgrims" on public.pilgrims;
create policy "staff write pilgrims" on public.pilgrims
  for all to authenticated
  using (public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS', 'VISA'))
  with check (public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS', 'VISA'));

-- viewMedical: ADMIN, OPERATIONS, GUIDE. editMedical: ADMIN, OPERATIONS only.
drop policy if exists "staff read pilgrim_medical_records" on public.pilgrim_medical_records;
create policy "staff read pilgrim_medical_records" on public.pilgrim_medical_records
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'OPERATIONS', 'GUIDE'));

drop policy if exists "staff write pilgrim_medical_records" on public.pilgrim_medical_records;
create policy "staff write pilgrim_medical_records" on public.pilgrim_medical_records
  for all to authenticated
  using (public.staff_role_in('ADMIN', 'OPERATIONS'))
  with check (public.staff_role_in('ADMIN', 'OPERATIONS'));

-- manageSupportRequests: ADMIN, OPERATIONS, GUIDE.
drop policy if exists "staff read pilgrim_support_requests" on public.pilgrim_support_requests;
create policy "staff read pilgrim_support_requests" on public.pilgrim_support_requests
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'OPERATIONS', 'GUIDE'));

drop policy if exists "staff write pilgrim_support_requests" on public.pilgrim_support_requests;
create policy "staff write pilgrim_support_requests" on public.pilgrim_support_requests
  for all to authenticated
  using (public.staff_role_in('ADMIN', 'OPERATIONS', 'GUIDE'))
  with check (public.staff_role_in('ADMIN', 'OPERATIONS', 'GUIDE'));

-- viewPayments: ADMIN, CEO, FINANCE. recordPayments: ADMIN, FINANCE.
drop policy if exists "staff read pilgrim_payment_milestones" on public.pilgrim_payment_milestones;
create policy "staff read pilgrim_payment_milestones" on public.pilgrim_payment_milestones
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'CEO', 'FINANCE'));

drop policy if exists "staff write pilgrim_payment_milestones" on public.pilgrim_payment_milestones;
create policy "staff write pilgrim_payment_milestones" on public.pilgrim_payment_milestones
  for all to authenticated
  using (public.staff_role_in('ADMIN', 'FINANCE'))
  with check (public.staff_role_in('ADMIN', 'FINANCE'));

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Documents — lib/access/documents-access.ts
--    GUIDE has `{ ...NONE }` (no viewModule at all) in this module, unlike
--    Departure Groups and Pilgrims, so restricting these tables carries none
--    of the cross-table side-effect risk noted above.
-- ─────────────────────────────────────────────────────────────────────────────

-- departure_group_pilgrim_documents: the base document row, incl. file_path
-- into the private pilgrim-documents bucket. viewModule: everyone but GUIDE.
-- Write (verify/rework/waive/upload): ADMIN, FINANCE, OPERATIONS, VISA.
drop policy if exists "staff read departure_group_pilgrim_documents" on public.departure_group_pilgrim_documents;
create policy "staff read departure_group_pilgrim_documents" on public.departure_group_pilgrim_documents
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'CEO', 'FINANCE', 'MARKETING', 'OPERATIONS', 'VISA'));

drop policy if exists "staff write departure_group_pilgrim_documents" on public.departure_group_pilgrim_documents;
create policy "staff write departure_group_pilgrim_documents" on public.departure_group_pilgrim_documents
  for all to authenticated
  using (public.staff_role_in('ADMIN', 'FINANCE', 'OPERATIONS', 'VISA'))
  with check (public.staff_role_in('ADMIN', 'FINANCE', 'OPERATIONS', 'VISA'));

-- viewAiFindings: ADMIN, CEO, OPERATIONS, VISA. runAiScan (write): ADMIN, OPERATIONS, VISA.
drop policy if exists "staff read document_ai_analyses" on public.document_ai_analyses;
create policy "staff read document_ai_analyses" on public.document_ai_analyses
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'VISA'));

drop policy if exists "staff write document_ai_analyses" on public.document_ai_analyses;
create policy "staff write document_ai_analyses" on public.document_ai_analyses
  for all to authenticated
  using (public.staff_role_in('ADMIN', 'OPERATIONS', 'VISA'))
  with check (public.staff_role_in('ADMIN', 'OPERATIONS', 'VISA'));

drop policy if exists "staff read document_review_events" on public.document_review_events;
create policy "staff read document_review_events" on public.document_review_events
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'CEO', 'FINANCE', 'MARKETING', 'OPERATIONS', 'VISA'));

drop policy if exists "staff insert document_review_events" on public.document_review_events;
create policy "staff insert document_review_events" on public.document_review_events
  for insert to authenticated
  with check (public.staff_role_in('ADMIN', 'FINANCE', 'OPERATIONS', 'VISA'));

-- ─────────────────────────────────────────────────────────────────────────────
-- F. Visa — lib/access/visa-access.ts
--    Visa status lives on departure_group_pilgrims itself (left alone, see
--    header note); these two satellite tables carry batch/portal detail that
--    GUIDE's read-only risk board never needs (`viewApplicationDetail: false`
--    for GUIDE) and FINANCE/MARKETING only see in aggregate.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists visa_submission_batches_select on public.visa_submission_batches;
create policy visa_submission_batches_select on public.visa_submission_batches
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'VISA'));

drop policy if exists visa_submission_batches_write on public.visa_submission_batches;
create policy visa_submission_batches_write on public.visa_submission_batches
  for all to authenticated
  using (public.staff_role_in('ADMIN', 'OPERATIONS', 'VISA'))
  with check (public.staff_role_in('ADMIN', 'OPERATIONS', 'VISA'));

drop policy if exists visa_application_events_select on public.visa_application_events;
create policy visa_application_events_select on public.visa_application_events
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'VISA'));

drop policy if exists visa_application_events_insert on public.visa_application_events;
create policy visa_application_events_insert on public.visa_application_events
  for insert to authenticated
  with check (public.staff_role_in('ADMIN', 'OPERATIONS', 'VISA'));

-- ─────────────────────────────────────────────────────────────────────────────
-- G. Suppliers — lib/access/suppliers-access.ts
--    MARKETING and VISA have `{ ...NONE }` — no supplier access at all.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'OPERATIONS', 'FINANCE', 'CEO', 'GUIDE'));

drop policy if exists suppliers_write on public.suppliers;
create policy suppliers_write on public.suppliers
  for all to authenticated
  using (public.staff_role_in('ADMIN', 'OPERATIONS'))
  with check (public.staff_role_in('ADMIN', 'OPERATIONS'));

drop policy if exists supplier_services_select on public.supplier_services;
create policy supplier_services_select on public.supplier_services
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'OPERATIONS', 'FINANCE', 'CEO', 'GUIDE'));

drop policy if exists supplier_services_write on public.supplier_services;
create policy supplier_services_write on public.supplier_services
  for all to authenticated
  using (public.staff_role_in('ADMIN', 'OPERATIONS'))
  with check (public.staff_role_in('ADMIN', 'OPERATIONS'));

drop policy if exists supplier_contacts_select on public.supplier_contacts;
create policy supplier_contacts_select on public.supplier_contacts
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'OPERATIONS', 'FINANCE', 'CEO', 'GUIDE'));

drop policy if exists supplier_contacts_write on public.supplier_contacts;
create policy supplier_contacts_write on public.supplier_contacts
  for all to authenticated
  using (public.staff_role_in('ADMIN', 'OPERATIONS'))
  with check (public.staff_role_in('ADMIN', 'OPERATIONS'));

drop policy if exists supplier_commitments_select on public.supplier_commitments;
create policy supplier_commitments_select on public.supplier_commitments
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'OPERATIONS', 'FINANCE', 'CEO', 'GUIDE'));

drop policy if exists supplier_commitments_write on public.supplier_commitments;
create policy supplier_commitments_write on public.supplier_commitments
  for all to authenticated
  using (public.staff_role_in('ADMIN', 'OPERATIONS'))
  with check (public.staff_role_in('ADMIN', 'OPERATIONS'));

-- viewPayments / recordPayment: ADMIN, FINANCE (CEO reads via readOnly:true but is not a writer).
drop policy if exists supplier_payments_select on public.supplier_payments;
create policy supplier_payments_select on public.supplier_payments
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'FINANCE', 'CEO'));

drop policy if exists supplier_payments_write on public.supplier_payments;
create policy supplier_payments_write on public.supplier_payments
  for all to authenticated
  using (public.staff_role_in('ADMIN', 'FINANCE'))
  with check (public.staff_role_in('ADMIN', 'FINANCE'));

drop policy if exists supplier_activity_events_select on public.supplier_activity_events;
create policy supplier_activity_events_select on public.supplier_activity_events
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'OPERATIONS', 'FINANCE', 'CEO', 'GUIDE'));

drop policy if exists supplier_activity_events_insert on public.supplier_activity_events;
create policy supplier_activity_events_insert on public.supplier_activity_events
  for insert to authenticated
  with check (public.staff_role_in('ADMIN', 'OPERATIONS', 'FINANCE'));

-- ─────────────────────────────────────────────────────────────────────────────
-- H. Finance — lib/access/finance-access.ts
--    VISA and GUIDE have `{ ...NONE }`. OPERATIONS and MARKETING only ever
--    see `viewPaymentStatusOnly` (a column-nulled projection the application
--    layer builds from booking_payment_milestones) so they keep read there;
--    they never touch the money-grain tables below.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists booking_milestones_select on public.booking_payment_milestones;
create policy booking_milestones_select on public.booking_payment_milestones
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'FINANCE', 'CEO', 'OPERATIONS', 'MARKETING'));

drop policy if exists booking_milestones_write on public.booking_payment_milestones;
create policy booking_milestones_write on public.booking_payment_milestones
  for all to authenticated
  using (public.staff_role_in('ADMIN', 'FINANCE'))
  with check (public.staff_role_in('ADMIN', 'FINANCE'));

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'FINANCE', 'CEO'));

drop policy if exists payments_write on public.payments;
create policy payments_write on public.payments
  for all to authenticated
  using (public.staff_role_in('ADMIN', 'FINANCE'))
  with check (public.staff_role_in('ADMIN', 'FINANCE'));

drop policy if exists payment_allocations_select on public.payment_allocations;
create policy payment_allocations_select on public.payment_allocations
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'FINANCE', 'CEO'));

drop policy if exists payment_allocations_write on public.payment_allocations;
create policy payment_allocations_write on public.payment_allocations
  for all to authenticated
  using (public.staff_role_in('ADMIN', 'FINANCE'))
  with check (public.staff_role_in('ADMIN', 'FINANCE'));

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'FINANCE', 'CEO'));

drop policy if exists invoices_write on public.invoices;
create policy invoices_write on public.invoices
  for all to authenticated
  using (public.staff_role_in('ADMIN', 'FINANCE'))
  with check (public.staff_role_in('ADMIN', 'FINANCE'));

drop policy if exists invoice_line_items_select on public.invoice_line_items;
create policy invoice_line_items_select on public.invoice_line_items
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'FINANCE', 'CEO'));

drop policy if exists invoice_line_items_write on public.invoice_line_items;
create policy invoice_line_items_write on public.invoice_line_items
  for all to authenticated
  using (public.staff_role_in('ADMIN', 'FINANCE'))
  with check (public.staff_role_in('ADMIN', 'FINANCE'));

drop policy if exists refund_requests_select on public.refund_requests;
create policy refund_requests_select on public.refund_requests
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'FINANCE', 'CEO'));

drop policy if exists refund_requests_write on public.refund_requests;
create policy refund_requests_write on public.refund_requests
  for all to authenticated
  using (public.staff_role_in('ADMIN', 'FINANCE'))
  with check (public.staff_role_in('ADMIN', 'FINANCE'));

drop policy if exists finance_adjustments_select on public.finance_adjustments;
create policy finance_adjustments_select on public.finance_adjustments
  for select to authenticated
  using (public.staff_role_in('ADMIN', 'FINANCE', 'CEO'));

drop policy if exists finance_adjustments_write on public.finance_adjustments;
create policy finance_adjustments_write on public.finance_adjustments
  for all to authenticated
  using (public.staff_role_in('ADMIN', 'FINANCE'))
  with check (public.staff_role_in('ADMIN', 'FINANCE'));

-- ─────────────────────────────────────────────────────────────────────────────
-- I. departure_group_activity_logs — append-only, stands apart from the
--    shared unit-of-work tables (see header note). Read matches DG's
--    viewModule (everyone); write is insert-only, matching every other
--    activity-log table in the schema (staff_activity_logs, pilgrim_activity_logs).
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "staff write departure_group_activity_logs" on public.departure_group_activity_logs;
drop policy if exists "staff read departure_group_activity_logs" on public.departure_group_activity_logs;
create policy "staff read departure_group_activity_logs" on public.departure_group_activity_logs
  for select to authenticated using (true);
create policy "staff insert departure_group_activity_logs" on public.departure_group_activity_logs
  for insert to authenticated with check (true);
-- Deliberately no update/delete policy: the timeline cannot be edited or erased.

-- ─────────────────────────────────────────────────────────────────────────────
-- J. Views — force security_invoker so every view above respects the base
--    table's RLS instead of running as the view owner. Definitions are
--    unchanged from their origin migrations; only the `with` clause is added.
-- ─────────────────────────────────────────────────────────────────────────────

alter view public.departure_group_payment_summaries set (security_invoker = true);
alter view public.package_usage set (security_invoker = true);
alter view public.pilgrim_journey_rows set (security_invoker = true);
alter view public.document_queue_rows set (security_invoker = true);
alter view public.visa_application_rows set (security_invoker = true);
alter view public.supplier_directory_rows set (security_invoker = true);
alter view public.finance_receivable_rows set (security_invoker = true);
alter view public.finance_payment_rows set (security_invoker = true);
alter view public.finance_invoice_rows set (security_invoker = true);
alter view public.finance_supplier_payable_rows set (security_invoker = true);
alter view public.report_booking_facts set (security_invoker = true);
alter view public.report_payment_facts set (security_invoker = true);
alter view public.report_milestone_facts set (security_invoker = true);
alter view public.report_lead_facts set (security_invoker = true);
alter view public.report_group_facts set (security_invoker = true);
alter view public.report_pilgrim_compliance_facts set (security_invoker = true);
alter view public.report_supplier_facts set (security_invoker = true);
alter view public.report_task_facts set (security_invoker = true);
alter view public.team_directory_rows set (security_invoker = true);
alter view public.audit_log_rows set (security_invoker = true);
alter view public.branch_directory_rows set (security_invoker = true);

-- ─────────────────────────────────────────────────────────────────────────────
-- K. Storage — role-scope the buckets holding traveller PII, supplier
--    evidence and payment proofs. `bucket_id = '...'` alone (the previous
--    policy) let any authenticated user list and sign every object in a
--    private bucket regardless of their module capability.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "staff read pilgrim documents" on storage.objects;
create policy "staff read pilgrim documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'pilgrim-documents' and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'VISA'));

drop policy if exists "staff upload pilgrim documents" on storage.objects;
create policy "staff upload pilgrim documents" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pilgrim-documents' and public.staff_role_in('ADMIN', 'OPERATIONS', 'VISA'));

drop policy if exists "staff update pilgrim documents" on storage.objects;
create policy "staff update pilgrim documents" on storage.objects
  for update to authenticated
  using (bucket_id = 'pilgrim-documents' and public.staff_role_in('ADMIN', 'OPERATIONS', 'VISA'))
  with check (bucket_id = 'pilgrim-documents' and public.staff_role_in('ADMIN', 'OPERATIONS', 'VISA'));

drop policy if exists "staff delete pilgrim documents" on storage.objects;
create policy "staff delete pilgrim documents" on storage.objects
  for delete to authenticated
  using (bucket_id = 'pilgrim-documents' and public.staff_role_in('ADMIN', 'OPERATIONS', 'VISA'));

drop policy if exists "staff read supplier evidence" on storage.objects;
create policy "staff read supplier evidence" on storage.objects
  for select to authenticated
  using (bucket_id = 'supplier-evidence' and public.staff_role_in('ADMIN', 'OPERATIONS', 'FINANCE', 'CEO'));

drop policy if exists "staff upload supplier evidence" on storage.objects;
create policy "staff upload supplier evidence" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'supplier-evidence' and public.staff_role_in('ADMIN', 'OPERATIONS'));

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'staff update supplier evidence'
  ) then
    execute 'drop policy "staff update supplier evidence" on storage.objects';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'staff delete supplier evidence'
  ) then
    execute 'drop policy "staff delete supplier evidence" on storage.objects';
  end if;
end;
$$;

create policy "staff update supplier evidence" on storage.objects
  for update to authenticated
  using (bucket_id = 'supplier-evidence' and public.staff_role_in('ADMIN', 'OPERATIONS'))
  with check (bucket_id = 'supplier-evidence' and public.staff_role_in('ADMIN', 'OPERATIONS'));

create policy "staff delete supplier evidence" on storage.objects
  for delete to authenticated
  using (bucket_id = 'supplier-evidence' and public.staff_role_in('ADMIN', 'OPERATIONS'));

-- payment-proofs bucket: policy names follow finance's own migration, which
-- (unlike the others) never scoped storage.objects by bucket at all — add
-- the full set here.
drop policy if exists "staff read payment proofs" on storage.objects;
create policy "staff read payment proofs" on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-proofs' and public.staff_role_in('ADMIN', 'FINANCE', 'CEO'));

drop policy if exists "staff upload payment proofs" on storage.objects;
create policy "staff upload payment proofs" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payment-proofs' and public.staff_role_in('ADMIN', 'FINANCE'));

drop policy if exists "staff update payment proofs" on storage.objects;
create policy "staff update payment proofs" on storage.objects
  for update to authenticated
  using (bucket_id = 'payment-proofs' and public.staff_role_in('ADMIN', 'FINANCE'))
  with check (bucket_id = 'payment-proofs' and public.staff_role_in('ADMIN', 'FINANCE'));

drop policy if exists "staff delete payment proofs" on storage.objects;
create policy "staff delete payment proofs" on storage.objects
  for delete to authenticated
  using (bucket_id = 'payment-proofs' and public.staff_role_in('ADMIN', 'FINANCE'));

-- ─────────────────────────────────────────────────────────────────────────────
-- L. agency-assets — drop SVG from the public logo bucket. A stored SVG is
--    served as image/svg+xml from *.supabase.co and executes script when
--    opened directly: stored XSS on the Supabase origin. PNG/WEBP is
--    sufficient for an agency logo. Write policies (admin-only) are unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'agency-assets';

-- ─────────────────────────────────────────────────────────────────────────────
-- M. Last-Admin invariant as a database guarantee, not just an application
--    check. `changeStaffRole()` in lib/data/team-repository.ts already
--    refuses to demote the last active Admin, but it does so by counting
--    then updating in two round trips — two concurrent demotions can both
--    read count = 2 and both proceed, leaving zero Admins with no recovery
--    path short of the service key. A constraint trigger closes that race;
--    the application check stays in place for the friendly error message on
--    the common, non-concurrent path.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.enforce_last_admin() returns trigger
  language plpgsql as $$
declare
  remaining_admins integer;
begin
  -- Only a change that could remove the last active Admin needs the check.
  if tg_op = 'UPDATE' and old.role = 'ADMIN' and old.status = 'ACTIVE'
     and (new.role <> 'ADMIN' or new.status <> 'ACTIVE') then
    select count(*) into remaining_admins
    from public.staff_profiles
    where role = 'ADMIN' and status = 'ACTIVE' and id <> old.id;

    if remaining_admins = 0 then
      raise exception 'Cannot change the role or status of the last remaining Admin.'
        using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'DELETE' and old.role = 'ADMIN' and old.status = 'ACTIVE' then
    select count(*) into remaining_admins
    from public.staff_profiles
    where role = 'ADMIN' and status = 'ACTIVE' and id <> old.id;

    if remaining_admins = 0 then
      raise exception 'Cannot remove the last remaining Admin.' using errcode = 'P0001';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists staff_profiles_enforce_last_admin on public.staff_profiles;
create constraint trigger staff_profiles_enforce_last_admin
  after update or delete on public.staff_profiles
  for each row execute function public.enforce_last_admin();
