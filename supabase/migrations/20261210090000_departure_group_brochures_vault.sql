-- ─────────────────────────────────────────────────────────────────────────────
-- Departure group brochures + Storage Vault (TASK-023).
--
-- `content_items` (20261015090000_content_items.sql) already holds freeform
-- marketing content, versioned. This migration generalizes it into the
-- "Storage Vault": a new BROCHURE_PDF content_type for departure-group
-- brochures generated as real files, plus the file metadata columns and
-- private bucket a generated PDF needs. BROCHURE_LINK (a manually pasted
-- URL) is unchanged and keeps working exactly as before.
--
-- Category in the vault UI is still `content_type` — BROCHURE_LINK and
-- BROCHURE_PDF both group under "Brochures". No new category column.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.content_items
  drop constraint if exists content_items_content_type_check;

alter table public.content_items
  add constraint content_items_content_type_check check (
    content_type in ('OFFER_COPY', 'SOCIAL_CAPTION', 'BROCHURE_LINK', 'BROCHURE_PDF', 'IMAGE_LINK', 'LANDING_PAGE_COPY', 'OTHER')
  );

alter table public.content_items
  add column if not exists storage_path text,
  add column if not exists file_name text,
  add column if not exists mime_type text,
  add column if not exists file_size_bytes integer,
  add column if not exists source_departure_group_id uuid references public.departure_groups (id) on delete set null;

alter table public.content_items
  drop constraint if exists content_items_brochure_pdf_file_fields_check;

alter table public.content_items
  add constraint content_items_brochure_pdf_file_fields_check check (
    content_type <> 'BROCHURE_PDF'
    or (storage_path is not null and file_name is not null and mime_type is not null)
  );

create index if not exists content_items_source_departure_group_idx
  on public.content_items (source_departure_group_id)
  where source_departure_group_id is not null;

comment on column public.content_items.source_departure_group_id is
  'Set when this content item is a brochure generated for a specific departure group. Audit/linkage only — RLS stays scoped by agency_id, not this column.';

-- ─────────────────────────────────────────────────────────────────────────────
-- content-vault — private bucket for generated files (brochure PDFs today),
-- tenant-prefixed like every bucket added since 20260827090000. Read matches
-- content_items' own read policy (any authenticated staff in the agency);
-- write matches content_items' write policy (ADMIN, CEO, MARKETING only).
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('content-vault', 'content-vault', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "staff read content vault files" on storage.objects;
create policy "staff read content vault files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'content-vault'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
  );

drop policy if exists "staff upload content vault files" on storage.objects;
create policy "staff upload content vault files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'content-vault'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING')
  );

drop policy if exists "staff update content vault files" on storage.objects;
create policy "staff update content vault files" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'content-vault'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING')
  )
  with check (
    bucket_id = 'content-vault'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING')
  );

drop policy if exists "staff delete content vault files" on storage.objects;
create policy "staff delete content vault files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'content-vault'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING')
  );

notify pgrst, 'reload schema';
