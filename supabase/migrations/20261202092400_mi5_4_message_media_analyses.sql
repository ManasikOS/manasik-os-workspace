create unique index if not exists message_attachments_id_agency_unique
  on public.message_attachments(id, agency_id);

-- The tenant-scoped intervention reference below requires the pair to be
-- unique. The intervention id is already the primary key, so this index only
-- makes the existing uniqueness available to the composite foreign key.
create unique index if not exists conversation_interventions_id_agency_unique
  on public.conversation_interventions(id, agency_id);

alter table public.conversation_messages
  add column if not exists redaction_state text not null default 'PENDING'
    check (redaction_state in ('PENDING','REDACTED','NOT_REQUIRED','FAILED')),
  add column if not exists sensitive_kinds text[] not null default '{}';

create table public.message_media_analyses (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies(id) on delete cascade,
  attachment_id uuid not null,
  message_id uuid not null,
  kind text not null check (kind in ('VOICE','PASSPORT','RECEIPT','BROCHURE','OTHER')),
  status text not null default 'PENDING' check (status in ('PENDING','READY','REVIEW_REQUIRED','FAILED')),
  candidate_fields jsonb not null default '{}'::jsonb,
  confidence numeric(3,2) check (confidence is null or confidence between 0 and 1),
  uncertainty jsonb not null default '[]'::jsonb,
  transcript text,
  source_model text,
  intervention_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_media_analyses_attachment_agency_fk foreign key (attachment_id, agency_id)
    references public.message_attachments(id, agency_id) on delete cascade,
  constraint message_media_analyses_message_agency_fk foreign key (message_id, agency_id)
    references public.conversation_messages(id, agency_id) on delete cascade,
  constraint message_media_analyses_intervention_agency_fk foreign key (intervention_id, agency_id)
    references public.conversation_interventions(id, agency_id) on delete set null,
  unique (agency_id, attachment_id)
);

create index message_media_analyses_message_idx on public.message_media_analyses(agency_id, message_id, created_at desc);
create unique index message_media_analyses_id_agency_unique on public.message_media_analyses(id, agency_id);
alter table public.message_media_analyses enable row level security;
revoke all on public.message_media_analyses from anon, authenticated;
grant select on public.message_media_analyses to authenticated;
create policy message_media_analyses_select on public.message_media_analyses
  for select to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and public.staff_role_in('ADMIN','CEO','MARKETING','OPERATIONS','FINANCE','VISA')
  );
create trigger message_media_analyses_set_updated_at before update on public.message_media_analyses
  for each row execute function public.set_updated_at();

-- Originals stay private. Workers use service_role to upload; an authenticated
-- staff member can sign only objects whose first path segment is their agency.
insert into storage.buckets (id, name, public, file_size_limit)
values ('inbox-attachments', 'inbox-attachments', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists inbox_attachments_staff_read on storage.objects;
create policy inbox_attachments_staff_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'inbox-attachments'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN','CEO','MARKETING','OPERATIONS','FINANCE','VISA')
  );

notify pgrst, 'reload schema';
