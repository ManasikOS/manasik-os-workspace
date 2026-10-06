-- SEC-05 (docs/tasks/TASK-037-departure-groups-security-and-flaw-remediation.md):
-- a record of who opened a traveller's file (passport scan, visa, ticket).
--
-- Opening one issues a short-lived signed link; nothing recorded that it happened.
-- The row is written by the same Server Action that signs the link, so a file that
-- cannot be logged is not opened.
--
-- Append-only: authenticated staff may INSERT their own rows for their own agency
-- and ADMIN / CEO may read their agency's rows. There is no UPDATE or DELETE policy,
-- so the trail cannot be edited from the app. Rows go with their agency, not with a
-- traveller, so erasing a traveller does not erase the fact that a file was opened.
--
-- Rollback: drop table public.departure_group_document_access_log;

create table if not exists public.departure_group_document_access_log (
  id                 uuid primary key default gen_random_uuid(),
  agency_id          uuid not null references public.agencies (id) on delete cascade,
  staff_id           uuid not null references auth.users (id) on delete cascade,
  staff_name         text not null default '',
  departure_group_id uuid,
  pilgrim_id         uuid,
  file_path          text not null,
  action             text not null default 'VIEW' check (action in ('VIEW')),
  created_at         timestamptz not null default now()
);

create index if not exists departure_group_document_access_log_agency_created_idx
  on public.departure_group_document_access_log (agency_id, created_at desc);
create index if not exists departure_group_document_access_log_pilgrim_idx
  on public.departure_group_document_access_log (pilgrim_id, created_at desc);

alter table public.departure_group_document_access_log enable row level security;

drop policy if exists document_access_log_insert on public.departure_group_document_access_log;
create policy document_access_log_insert on public.departure_group_document_access_log
  for insert to authenticated
  with check (
    agency_id = (select public.current_agency_id())
    and staff_id = (select auth.uid())
  );

drop policy if exists document_access_log_select on public.departure_group_document_access_log;
create policy document_access_log_select on public.departure_group_document_access_log
  for select to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and public.staff_role_in('ADMIN', 'CEO')
  );
