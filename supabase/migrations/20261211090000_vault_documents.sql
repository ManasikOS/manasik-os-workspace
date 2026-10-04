-- ─────────────────────────────────────────────────────────────────────────────
-- Document Vault (supersedes the Content & Templates screen).
--
-- `content_items` (20261015090000, extended in 20261210090000 for TASK-023's
-- departure-group brochures) was marketing-collateral-shaped: a versioned
-- title/body/external_url with a fixed content_type enum. What's needed now
-- is a general document store — passports, visas, flight tickets, receipts,
-- brochures, and open-ended other categories — uploaded once and reused by
-- reference everywhere (the Inbox composer's "choose from vault" attaches
-- the same stored file to as many conversations as needed without asking
-- the browser to upload it again). That doesn't need marketing's versioning
-- or body/external_url shape, so this is a new table, not another
-- alteration of `content_items`.
--
-- `content_items` / `content_item_versions` are deliberately left in place,
-- unused, rather than dropped here — nothing in the app reads them after
-- this migration, and dropping them is a separate, explicit decision for
-- later, not bundled into this one. The one real piece of prior data worth
-- keeping — a brochure PDF already generated for a departure group — is
-- copied into `vault_documents` below.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.vault_documents (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),

  -- Free text, not an enum: the UI offers a curated starter set (Passport,
  -- Visa, Flight Ticket, Brochure, Receipt, Other) as tabs, but a new
  -- category typed on upload needs no migration to start working.
  category text not null default 'OTHER' check (length(trim(category)) > 0),
  title text not null check (length(trim(title)) > 0),

  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  file_size_bytes integer not null,

  -- Audit/linkage only for a brochure generated from a departure group.
  -- RLS stays scoped by agency_id, never this column.
  source_departure_group_id uuid references public.departure_groups (id) on delete set null,

  uploaded_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.vault_documents is
  'General document store: passports, visas, tickets, receipts, brochures and other categories, uploaded once and referenced everywhere (e.g. the Inbox composer) rather than re-uploaded per use.';

create index if not exists vault_documents_agency_category_idx
  on public.vault_documents (agency_id, category);

create index if not exists vault_documents_source_departure_group_idx
  on public.vault_documents (source_departure_group_id)
  where source_departure_group_id is not null;

alter table public.vault_documents enable row level security;

create policy "staff read vault documents" on public.vault_documents
  for select to authenticated
  using (agency_id = (select public.current_agency_id()));

create policy "staff write vault documents" on public.vault_documents
  for all to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'VISA', 'FINANCE', 'MARKETING')
  )
  with check (
    agency_id = (select public.current_agency_id())
    and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'VISA', 'FINANCE', 'MARKETING')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Carry forward the one real file this table needs to keep: a departure-group
-- brochure PDF already generated under the old `content_items` shape.
-- `content_items` itself is left untouched by this migration (see header).
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.vault_documents (
  id, agency_id, category, title, storage_path, file_name, mime_type, file_size_bytes,
  source_departure_group_id, uploaded_by_name, created_at, updated_at
)
select
  id, agency_id, 'BROCHURE', title, storage_path, file_name, mime_type, coalesce(file_size_bytes, 0),
  source_departure_group_id, created_by_name, created_at, updated_at
from public.content_items
where content_type = 'BROCHURE_PDF' and storage_path is not null
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- content-vault bucket: broaden from PDF-only to every type the outbound
-- WhatsApp send path already accepts (`lib/inbox/attachments/staff-attachment.ts`'s
-- ALLOWED_STAFF_ATTACHMENT_TYPES) — a vault document is only worth storing if
-- it can also be sent. New policies grant the broader operational roles
-- write access alongside (not instead of) the existing ADMIN/CEO/MARKETING
-- policies from 20261210090000 — Postgres combines permissive policies for
-- the same command with OR, so nothing needs to be dropped for this to take
-- effect; the old, narrower policies just become redundant, not wrong.
-- ─────────────────────────────────────────────────────────────────────────────
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]
where id = 'content-vault';

create policy "operational staff upload vault documents" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'content-vault'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'VISA', 'FINANCE', 'MARKETING')
  );

create policy "operational staff update vault documents" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'content-vault'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'VISA', 'FINANCE', 'MARKETING')
  )
  with check (
    bucket_id = 'content-vault'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'VISA', 'FINANCE', 'MARKETING')
  );

create policy "operational staff delete vault documents" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'content-vault'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'VISA', 'FINANCE', 'MARKETING')
  );

-- "staff read content vault files" (any authenticated staff in the agency) from
-- 20261210090000 already covers reads; nothing to add there.

notify pgrst, 'reload schema';
