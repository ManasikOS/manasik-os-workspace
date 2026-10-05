-- SEC-3 of docs/progress/2026-10-05-inbox-security-and-bug-audit.md: a customer's passport photo, and the passport number / name / expiry the model read from
-- it, were readable by every role that can open the Inbox, including Marketing and Finance, who are denied traveller documents and sensitive traveller
-- data everywhere else (`viewSensitiveTravellerData`). The Inbox screen now withholds both from those roles; this makes the database say the same, so the
-- API cannot be used to get around the screen.
--
-- Roles that may see passport media are exactly those with `viewSensitiveTravellerData` in lib/access/departure-groups-access.ts: ADMIN, CEO, OPERATIONS,
-- VISA. A test (lib/inbox/media/passport-visibility-migration.test.ts) fails if that list and this one drift apart.
--
--   * message_media_analyses: the model's read-out of a PASSPORT is visible to those roles only. Every other kind stays visible to all Inbox roles.
--   * storage.objects (inbox-attachments): the original file of a PASSPORT attachment can be signed or read by those roles only.
--
-- Known gap: a photo is a passport only once the model has classed it, a few seconds after it arrives; until then it is an ordinary attachment.
--
-- Idempotent. Rollback: recreate message_media_analyses_select and inbox_attachments_staff_read from 20261202092400_mi5_4_message_media_analyses.sql,
-- then drop function public.inbox_object_is_passport(text) and index message_attachments_agency_storage_path_idx.

create index if not exists message_attachments_agency_storage_path_idx
  on public.message_attachments (agency_id, storage_path);

-- Is the stored object at this path (in the caller's agency) a passport? Security definer so that the answer does not depend on which tables the
-- caller's role may read; it reveals only a yes/no for a path the caller already named.
create or replace function public.inbox_object_is_passport(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.message_attachments a
      join public.message_media_analyses m on m.attachment_id = a.id and m.agency_id = a.agency_id
     where a.agency_id = public.current_agency_id()
       and a.storage_path = p_name
       and m.kind = 'PASSPORT'
  );
$$;

revoke all on function public.inbox_object_is_passport(text) from public, anon;
grant execute on function public.inbox_object_is_passport(text) to authenticated;

drop policy if exists message_media_analyses_select on public.message_media_analyses;
create policy message_media_analyses_select on public.message_media_analyses
  for select to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and public.staff_role_in('ADMIN','CEO','MARKETING','OPERATIONS','FINANCE','VISA')
    and (kind <> 'PASSPORT' or public.staff_role_in('ADMIN','CEO','OPERATIONS','VISA'))
  );

drop policy if exists inbox_attachments_staff_read on storage.objects;
create policy inbox_attachments_staff_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'inbox-attachments'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN','CEO','MARKETING','OPERATIONS','FINANCE','VISA')
    and (public.staff_role_in('ADMIN','CEO','OPERATIONS','VISA') or not public.inbox_object_is_passport(name))
  );

notify pgrst, 'reload schema';
