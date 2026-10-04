-- TASK-029 P2.4, finding F1 (docs/progress/2026-10-02-tenant-isolation-audit.md): any signed-in user could list, read, overwrite and
-- delete every agency's pilgrim documents.
--
-- What was wrong on staging: the four storage policies on `pilgrim-documents` checked only the bucket name, so any `authenticated`
-- session (a staff member of ANY agency, a pilgrim or agent portal login, or a freshly signed-up account) could reach every object.
-- Verified before this migration: a user belonging to no agency listed all 23 objects. `whatsapp-media` had a role check but no agency
-- check.
--
-- Why this is a corrective migration and not a new design: `20260827090000_tenant_storage_isolation.sql` already defines the scoped
-- policies (agency folder plus role) and is recorded as applied, but staging carries the original unscoped policies from
-- `20260811090000_departure_groups_documents_lifecycle.sql`. Something re-created them afterwards. This migration re-asserts the scoped
-- versions so the database matches the repository, and fails loudly if any policy on these two buckets is left without an agency check.
--
-- Safe to apply: every existing object already sits under an `<agency_id>/` folder (23 of 23 on staging), so no file is orphaned. The
-- application reaches these buckets with the signed-in user's own session (createSignedUrl, createSignedUploadUrl, remove) and with the
-- service key; the policies below are the ones that session needs for the roles in 20260827090000, so staff in the right roles keep
-- working inside their own agency. The `support case attachments` policies are already scoped and are not touched. Idempotent.
--
-- Rollback: re-apply the four unscoped policies from 20260811090000. Do not do that on any environment with real customers.

-- pilgrim-documents ---------------------------------------------------------------------------------------------------------------
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

-- whatsapp-media ------------------------------------------------------------------------------------------------------------------
-- The bucket is empty and no application code reads or writes it today, so adding the agency folder check changes nothing for users.
-- The role lists are the ones the policies already had.
drop policy if exists "staff read whatsapp media" on storage.objects;
create policy "staff read whatsapp media" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'whatsapp-media'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'VISA', 'FINANCE')
  );

drop policy if exists "staff write whatsapp media" on storage.objects;
create policy "staff write whatsapp media" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'whatsapp-media'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS', 'VISA')
  );

-- Guard: refuse to finish while any policy on either bucket lacks the agency check ----------------------------------------------------
do $$
declare
  v_unscoped text;
begin
  select string_agg(p.policyname || ' (' || p.cmd || ')', ', ' order by p.policyname)
    into v_unscoped
    from pg_policies p
   where p.schemaname = 'storage'
     and p.tablename = 'objects'
     and (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ 'bucket_id = ''(pilgrim-documents|whatsapp-media)'''
     and (coalesce(p.qual, '') || coalesce(p.with_check, '')) not like '%current_agency_id%';

  if v_unscoped is not null then
    raise exception 'Tenant isolation: these storage policies still have no agency check: %', v_unscoped;
  end if;
end;
$$;
