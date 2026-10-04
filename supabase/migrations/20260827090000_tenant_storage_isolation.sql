-- Multi-tenancy Phase 1 — close the two isolation holes RLS does not cover.
-- See docs/architecture/multi-tenancy-implementation-plan.md Phase 1 (F1, F3).
--
-- F1: every storage.objects policy on the four buckets this app uses keys on
-- bucket + role only — no policy checks which agency the object belongs to,
-- and no object path carries a tenant segment. Any authenticated staff member
-- with module access to a bucket can list and sign every other agency's
-- files in it. This migration prefixes every object path with the owning
-- agency's id and rewrites every policy to check that prefix against
-- current_agency_id(), the same resolver every table's RLS policy already
-- uses (20260824090000_tenancy.sql §B).
--
-- F3: pilgrim_price_rows / booking_price_rows were created in
-- 20260823090000, one migration after 20260822090000_rls_hardening.sql set
-- security_invoker = true on every other view in the schema, and never
-- picked it up. Without it they run as the view owner and do not apply RLS
-- to the tables they read — a cross-tenant leak over PostgREST.
--
-- Safe on a database with 20260808…20260826 applied.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. agency-assets becomes a private bucket.
--
-- A public bucket cannot be tenant-isolated at all: getPublicUrl() returns a
-- stable, unauthenticated URL that bypasses storage.objects policies by
-- construction — prefixing the path buys nothing while the bucket stays
-- public. The application moves to short-lived signed URLs, the same
-- pattern already used for pilgrim-documents, supplier-evidence and
-- payment-proofs (see logo-storage.ts).
-- ─────────────────────────────────────────────────────────────────────────────
update storage.buckets set public = false where id = 'agency-assets';

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Re-key every existing object under an `<agency_id>/` prefix.
--
-- One transaction, covering storage.objects.name and every column in public
-- that stores one of these paths — a bucket whose objects moved but whose
-- referencing rows still point at the old key is unreadable, which is worse
-- than not migrating at all.
--
-- Single agency on every database this migration can run against (the
-- tenancy migration backfills every pre-existing row onto one seeded
-- agency), so "prefix with the one agency's id" is unambiguous here. A
-- database that already has more than one agency by the time this runs
-- would need a per-row agency lookup instead of this constant — deployment
-- note, not a case this migration handles.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_agency_id uuid;
begin
  select id into v_agency_id from public.agencies order by created_at asc limit 1;
  if v_agency_id is null then
    raise notice 'No agency row found — skipping storage re-key (nothing to migrate).';
    return;
  end if;

  update storage.objects
  set name = v_agency_id::text || '/' || name
  where bucket_id in ('pilgrim-documents', 'supplier-evidence', 'payment-proofs', 'agency-assets')
    and name not like v_agency_id::text || '/%';

  -- pilgrim-documents bucket
  update public.departure_group_pilgrim_documents
  set file_path = v_agency_id::text || '/' || file_path
  where file_path is not null and file_path not like v_agency_id::text || '/%';

  update public.departure_group_pilgrims
  set visa_file_path = v_agency_id::text || '/' || visa_file_path
  where visa_file_path is not null and visa_file_path not like v_agency_id::text || '/%';

  update public.pilgrims
  set photo_path = v_agency_id::text || '/' || photo_path
  where photo_path is not null and photo_path not like v_agency_id::text || '/%';

  update public.pilgrim_payment_milestones
  set proof_path = v_agency_id::text || '/' || proof_path
  where proof_path is not null and proof_path not like v_agency_id::text || '/%';

  update public.document_ai_analyses
  set file_path = v_agency_id::text || '/' || file_path
  where file_path is not null and file_path not like v_agency_id::text || '/%';

  update public.visa_application_events
  set evidence_path = v_agency_id::text || '/' || evidence_path
  where evidence_path is not null and evidence_path not like v_agency_id::text || '/%';

  -- supplier-evidence bucket
  update public.supplier_commitments
  set evidence_path = v_agency_id::text || '/' || evidence_path
  where evidence_path is not null and evidence_path not like v_agency_id::text || '/%';

  update public.supplier_payments
  set document_path = v_agency_id::text || '/' || document_path
  where document_path is not null and document_path not like v_agency_id::text || '/%';

  -- payment-proofs bucket
  update public.payments
  set proof_path = v_agency_id::text || '/' || proof_path
  where proof_path is not null and proof_path not like v_agency_id::text || '/%';

  -- agency-assets bucket
  update public.agency_settings
  set logo_path = v_agency_id::text || '/' || logo_path
  where logo_path is not null and logo_path <> '' and logo_path not like v_agency_id::text || '/%';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Rewrite every storage.objects policy to check the agency prefix.
--
-- (select public.current_agency_id()) rather than a bare call — the same
-- InitPlan-caching form the tenant-uniqueness migration standardises on —
-- so the resolver runs once per statement, not once per row scanned.
-- ─────────────────────────────────────────────────────────────────────────────

-- pilgrim-documents
drop policy if exists "staff read pilgrim documents" on storage.objects;
create policy "staff read pilgrim documents" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pilgrim-documents'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'VISA')
  );

drop policy if exists "staff upload pilgrim documents" on storage.objects;
create policy "staff upload pilgrim documents" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pilgrim-documents'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'OPERATIONS', 'VISA')
  );

drop policy if exists "staff update pilgrim documents" on storage.objects;
create policy "staff update pilgrim documents" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'pilgrim-documents'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'OPERATIONS', 'VISA')
  )
  with check (
    bucket_id = 'pilgrim-documents'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'OPERATIONS', 'VISA')
  );

drop policy if exists "staff delete pilgrim documents" on storage.objects;
create policy "staff delete pilgrim documents" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'pilgrim-documents'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'OPERATIONS', 'VISA')
  );

-- supplier-evidence
drop policy if exists "staff read supplier evidence" on storage.objects;
create policy "staff read supplier evidence" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'supplier-evidence'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'OPERATIONS', 'FINANCE', 'CEO')
  );

drop policy if exists "staff upload supplier evidence" on storage.objects;
create policy "staff upload supplier evidence" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'supplier-evidence'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'OPERATIONS')
  );

drop policy if exists "staff update supplier evidence" on storage.objects;
create policy "staff update supplier evidence" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'supplier-evidence'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'OPERATIONS')
  )
  with check (
    bucket_id = 'supplier-evidence'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'OPERATIONS')
  );

drop policy if exists "staff delete supplier evidence" on storage.objects;
create policy "staff delete supplier evidence" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'supplier-evidence'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'OPERATIONS')
  );

-- payment-proofs
drop policy if exists "staff read payment proofs" on storage.objects;
create policy "staff read payment proofs" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'FINANCE', 'CEO')
  );

drop policy if exists "staff upload payment proofs" on storage.objects;
create policy "staff upload payment proofs" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'FINANCE')
  );

drop policy if exists "staff update payment proofs" on storage.objects;
create policy "staff update payment proofs" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'FINANCE')
  )
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'FINANCE')
  );

drop policy if exists "staff delete payment proofs" on storage.objects;
create policy "staff delete payment proofs" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'FINANCE')
  );

-- agency-assets — now private (§A). Read is staff-only (any signed-in role,
-- matching every other module's default posture); write stays ADMIN-only.
drop policy if exists "public read agency assets" on storage.objects;
create policy "staff read agency assets" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'agency-assets'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
  );

drop policy if exists "admin upload agency assets" on storage.objects;
create policy "admin upload agency assets" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'agency-assets'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.current_staff_role() = 'ADMIN'
  );

drop policy if exists "admin update agency assets" on storage.objects;
create policy "admin update agency assets" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'agency-assets'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.current_staff_role() = 'ADMIN'
  )
  with check (
    bucket_id = 'agency-assets'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.current_staff_role() = 'ADMIN'
  );

drop policy if exists "admin delete agency assets" on storage.objects;
create policy "admin delete agency assets" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'agency-assets'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.current_staff_role() = 'ADMIN'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Views that skipped the 20260822090000 security_invoker pass.
-- ─────────────────────────────────────────────────────────────────────────────
alter view public.pilgrim_price_rows set (security_invoker = true);
alter view public.booking_price_rows set (security_invoker = true);
