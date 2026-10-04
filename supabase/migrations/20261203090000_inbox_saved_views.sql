-- Saved Inbox views: a person's own named shortcut to a queue plus an optional search text.
--
-- Private to the person who saved it (never shared with the agency), scoped to their agency, and limited in the app to a
-- small number each. Nothing here changes how conversations are listed; a saved view only records which queue and search to
-- open. Row security is the boundary: a person can read, add and remove only their own rows, and only if their role can
-- open the Inbox.

create table if not exists public.inbox_saved_views (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null default public.current_agency_id()
                references public.agencies (id),
  staff_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 40),
  -- One of the Inbox view ids (lib/inbox/views.ts). Not a foreign key: views are a code catalogue, and the app ignores a
  -- saved view whose id it no longer knows.
  view        text not null check (length(view) between 1 and 40),
  search      text check (search is null or length(search) <= 60),
  created_at  timestamptz not null default now(),
  constraint inbox_saved_views_name_per_person unique (staff_id, name)
);

comment on table public.inbox_saved_views is
  'A person''s own saved Inbox shortcut: a queue and an optional search. Private to that person.';

create index if not exists inbox_saved_views_person_idx
  on public.inbox_saved_views (agency_id, staff_id, created_at);

alter table public.inbox_saved_views enable row level security;

revoke all on table public.inbox_saved_views from anon, authenticated;
grant select, insert, delete on table public.inbox_saved_views to authenticated;

drop policy if exists inbox_saved_views_select on public.inbox_saved_views;
create policy inbox_saved_views_select on public.inbox_saved_views
  for select to authenticated
  using (
    agency_id = public.current_agency_id()
    and staff_id = (select auth.uid())
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA')
  );

drop policy if exists inbox_saved_views_insert on public.inbox_saved_views;
create policy inbox_saved_views_insert on public.inbox_saved_views
  for insert to authenticated
  with check (
    agency_id = public.current_agency_id()
    and staff_id = (select auth.uid())
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA')
  );

drop policy if exists inbox_saved_views_delete on public.inbox_saved_views;
create policy inbox_saved_views_delete on public.inbox_saved_views
  for delete to authenticated
  using (
    agency_id = public.current_agency_id()
    and staff_id = (select auth.uid())
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA')
  );
