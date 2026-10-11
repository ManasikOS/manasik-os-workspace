-- TASK-043 Phase 3, step 2 (PKG-17): exporting the package catalogue is audited and rate limited, not just a hidden button.
--
-- Before: the export button was hidden for roles without exportCatalogue, but every role that can open the module already holds the whole list in the
-- browser, and the file is built there. Nothing recorded who exported what, and nothing limited how often.
--
-- After
--   * The file is still built in the browser from the list that is already loaded (no second download, so it works on a slow or flaky connection).
--   * Before the file is built, the app calls authorise_package_export(): one small round trip that checks the exportCatalogue capability (the role's
--     saved value, else its tier default), limits each person to 10 exports an hour, and writes one row to package_export_logs. If it fails, no file is built.
--   * package_export_logs: append-only (no write policy or privilege), readable by the ADMIN tier of the same agency. The hourly limit counts these rows, so
--     there is no separate counter to drift.
--
-- Idempotent. Rollback: drop the function and the table.

create table if not exists public.package_export_logs (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies (id),
  user_id     uuid references auth.users (id) on delete set null,
  user_name   text not null default 'Staff',
  format      text not null check (format in ('csv', 'xlsx')),
  row_count   integer not null check (row_count between 1 and 100000),
  filters     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.package_export_logs is
  'One row per package-catalogue export: who, when, format, how many rows and which filters. Written only by authorise_package_export(); no INSERT, UPDATE or DELETE policy. The hourly export limit counts these rows. TASK-043.';

create index if not exists package_export_logs_user_idx on public.package_export_logs (user_id, created_at desc);
create index if not exists package_export_logs_agency_idx on public.package_export_logs (agency_id, created_at desc);

alter table public.package_export_logs enable row level security;
revoke insert, update, delete on public.package_export_logs from anon, authenticated;

drop policy if exists "admin read package export logs" on public.package_export_logs;
create policy "admin read package export logs" on public.package_export_logs
  for select to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and public.staff_role_in('ADMIN')
  );

create or replace function public.authorise_package_export(
  p_format text,
  p_row_count integer,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c_limit constant integer := 10;
  v_agency uuid := public.current_agency_id();
  v_actor uuid := auth.uid();
  v_name text;
  v_used integer;
  v_oldest timestamptz;
  v_wait_minutes integer;
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
begin
  if v_actor is null or not coalesce(public.has_package_capability('exportCatalogue'), false) then
    raise exception 'Your role cannot export packages.' using errcode = '42501';
  end if;
  if v_agency is null then
    raise exception 'Your session has no active agency.' using errcode = '28000';
  end if;
  if p_format is null or p_format not in ('csv', 'xlsx') then
    raise exception 'The export format is not supported.' using errcode = '22023';
  end if;
  if p_row_count is null or p_row_count < 1 or p_row_count > 100000 then
    raise exception 'There is nothing to export.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_filters) <> 'object' or length(v_filters::text) > 2000 then
    v_filters := '{}'::jsonb;
  end if;

  -- Two exports started together must not both slip under the limit.
  perform pg_advisory_xact_lock(hashtextextended('package_export:' || v_actor::text, 0));

  select count(*), min(created_at) into v_used, v_oldest
  from public.package_export_logs
  where user_id = v_actor and created_at > now() - interval '1 hour';

  if v_used >= c_limit then
    v_wait_minutes := greatest(1, ceil(extract(epoch from (v_oldest + interval '1 hour' - now())) / 60)::integer);
    raise exception 'You have reached the limit of % exports an hour. Try again in % minute(s).', c_limit, v_wait_minutes using errcode = 'P0001';
  end if;

  select coalesce(nullif(btrim(full_name), ''), 'Staff') into v_name from public.staff_profiles where id = v_actor;

  insert into public.package_export_logs (agency_id, user_id, user_name, format, row_count, filters)
  values (v_agency, v_actor, coalesce(v_name, 'Staff'), p_format, p_row_count, v_filters);

  return jsonb_build_object('allowed', true, 'remaining', c_limit - v_used - 1);
end;
$$;

comment on function public.authorise_package_export(text, integer, jsonb) is
  'Checks the exportCatalogue capability, enforces 10 exports an hour per person and records the export. The app builds the file only after this succeeds. TASK-043.';

revoke all on function public.authorise_package_export(text, integer, jsonb) from public, anon;
grant execute on function public.authorise_package_export(text, integer, jsonb) to authenticated, service_role;
