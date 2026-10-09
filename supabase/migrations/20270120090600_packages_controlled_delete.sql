-- TASK-043 Phase 3, step 1 (PKG-10): deleting a package is a controlled, recorded operation, not a bare DELETE.
--
-- Before: an ADMIN could delete a package in ANY status straight through the API when no departure group used it. The delete cascaded to the package's
-- activity log, its versions, its agent allocations and its website/SEO content, and silently unlinked leads, quotes, campaigns and agent submissions
-- (Phase 0, 2026-10-09: foreign keys to packages(id)). Nothing recorded who did it or why.
--
-- After
--   * The DELETE policy on public.packages is removed. Nobody deletes a package by writing to the table; only delete_package() can.
--   * package_delete_impact(id): what a delete would touch, for the confirmation dialog.
--   * delete_package(id, expected_updated_at, confirm_code, reason):
--       - ADMIN tier AND the deletePackage capability, own agency, row locked, optimistic-concurrency compare;
--       - only a Draft or an Archived package (a package on sale is closed and archived first);
--       - the person must type the package's code (or, for a package with no code yet, the first 8 characters of its id);
--       - a reason of 1 to 500 characters;
--       - refused while any departure group or group snapshot uses the package, and while lead quotes or agent booking submissions refer to it
--         (those would lose their link to the package; archive it instead);
--       - before deleting, the package row, its activity log, its versions, its change requests and the impact counts are copied into package_deletions.
--   * package_deletions: append-only record, readable by the ADMIN tier of the same agency, with no write policy or privilege.
--
-- Leads that named the package as their desired package, campaigns linked to it, agent allocations and website/SEO content are allowed to go (the first two
-- lose the link, the rest are removed); their counts are shown before the delete and kept in the record.
-- Idempotent. Rollback: recreate the DELETE policy from 20270119090000 and drop the two functions and the table.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. No direct deletes
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "staff delete packages" on public.packages;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The record
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.package_deletions (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references public.agencies (id),
  package_id          uuid not null,
  package_code        text not null default '',
  package_title       text not null default '',
  status_at_delete    text not null,
  reason              text not null check (char_length(btrim(reason)) between 1 and 500),
  deleted_by          uuid references auth.users (id) on delete set null,
  deleted_by_name     text not null default 'Staff',
  deleted_at          timestamptz not null default now(),
  package             jsonb not null,
  activity            jsonb not null default '[]'::jsonb,
  versions            jsonb not null default '[]'::jsonb,
  change_requests     jsonb not null default '[]'::jsonb,
  impact              jsonb not null default '{}'::jsonb
);

comment on table public.package_deletions is
  'Append-only record of every deleted package: the full row, its activity log, versions and change requests, who deleted it, why, and what the delete touched. Written only by delete_package(); there is no INSERT, UPDATE or DELETE policy. TASK-043.';

create index if not exists package_deletions_agency_idx on public.package_deletions (agency_id, deleted_at desc);
create index if not exists package_deletions_package_idx on public.package_deletions (package_id);

alter table public.package_deletions enable row level security;
revoke insert, update, delete on public.package_deletions from anon, authenticated;

drop policy if exists "admin read package deletions" on public.package_deletions;
create policy "admin read package deletions" on public.package_deletions
  for select to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and public.staff_role_in('ADMIN')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. package_delete_impact
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.package_delete_impact(p_package_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_status text;
begin
  if not coalesce(public.staff_role_in('ADMIN'), false)
     or not coalesce(public.has_package_capability('deletePackage'), false) then
    raise exception 'Your role cannot delete packages.' using errcode = '42501';
  end if;
  if v_agency is null then
    raise exception 'Your session has no active agency.' using errcode = '28000';
  end if;

  select status into v_status from public.packages where id = p_package_id and agency_id = v_agency;
  if not found then
    raise exception 'That package no longer exists.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'status', v_status,
    'departureGroups', (select count(*) from public.departure_groups where package_template_id = p_package_id),
    'groupSnapshots', (select count(*) from public.departure_group_package_snapshots where package_template_id = p_package_id),
    'leadQuotes', (select count(*) from public.lead_quotes where package_id = p_package_id),
    'agentSubmissions', (select count(*) from public.agent_booking_submissions where package_id = p_package_id),
    'leadsPreferringIt', (select count(*) from public.leads where desired_package_id = p_package_id),
    'campaigns', (select count(*) from public.campaigns where linked_package_id = p_package_id),
    'agentAllocations', (select count(*) from public.agent_package_allocations where package_id = p_package_id),
    'websiteContent',
      (select count(*) from public.package_content where package_id = p_package_id)
      + (select count(*) from public.package_faqs where package_id = p_package_id)
      + (select count(*) from public.package_media where package_id = p_package_id)
      + (select count(*) from public.package_seo_analyses where package_id = p_package_id),
    'pendingChanges', (select count(*) from public.package_change_requests where package_id = p_package_id and status = 'PENDING')
  );
end;
$$;

comment on function public.package_delete_impact(uuid) is
  'What deleting this package would touch: groups and quotes that block it, and the leads, campaigns, allocations and website content that would lose their link or be removed. ADMIN with deletePackage only. TASK-043.';

revoke all on function public.package_delete_impact(uuid) from public, anon;
grant execute on function public.package_delete_impact(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. delete_package
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.delete_package(
  p_package_id uuid,
  p_expected_updated_at timestamptz,
  p_confirm_code text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_pkg public.packages;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_expected_code text;
  v_impact jsonb;
  v_deletion_id uuid;
begin
  if not coalesce(public.staff_role_in('ADMIN'), false)
     or not coalesce(public.has_package_capability('deletePackage'), false) then
    raise exception 'Your role cannot delete packages.' using errcode = '42501';
  end if;
  if v_agency is null then
    raise exception 'Your session has no active agency.' using errcode = '28000';
  end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then
    raise exception 'A reason is required to delete a package.' using errcode = '22023';
  end if;

  select * into v_pkg from public.packages where id = p_package_id and agency_id = v_agency for update;
  if not found then
    raise exception 'That package no longer exists.' using errcode = 'P0002';
  end if;
  if p_expected_updated_at is not null and v_pkg.updated_at is distinct from p_expected_updated_at then
    raise exception 'This package changed elsewhere. Reload and try again.' using errcode = '40001';
  end if;
  if v_pkg.status not in ('Draft', 'Archived') then
    raise exception 'This package is % — a package must be archived before it can be deleted.', v_pkg.status using errcode = '22023';
  end if;

  v_expected_code := lower(coalesce(nullif(btrim(v_pkg.internal_code), ''), left(v_pkg.id::text, 8)));
  if lower(btrim(coalesce(p_confirm_code, ''))) is distinct from v_expected_code then
    raise exception 'The confirmation text does not match the package code.' using errcode = '22023';
  end if;

  v_impact := public.package_delete_impact(p_package_id);
  if (v_impact ->> 'departureGroups')::int > 0 or (v_impact ->> 'groupSnapshots')::int > 0 then
    raise exception 'This package cannot be deleted — departure groups use it. Archive it instead, or move those groups to another package first.' using errcode = '22023';
  end if;
  if (v_impact ->> 'leadQuotes')::int > 0 or (v_impact ->> 'agentSubmissions')::int > 0 then
    raise exception 'This package cannot be deleted — lead quotes or agent booking submissions refer to it. Archive it instead.' using errcode = '22023';
  end if;

  select full_name into v_actor_name from public.staff_profiles where id = v_actor;

  insert into public.package_deletions
    (agency_id, package_id, package_code, package_title, status_at_delete, reason, deleted_by, deleted_by_name, package, activity, versions, change_requests, impact)
  values (
    v_agency, v_pkg.id, coalesce(v_pkg.internal_code, ''), coalesce(v_pkg.title, ''), v_pkg.status, v_reason, v_actor, coalesce(v_actor_name, 'Staff'),
    to_jsonb(v_pkg),
    (select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at), '[]'::jsonb) from public.package_activity_logs l where l.package_id = v_pkg.id),
    (select coalesce(jsonb_agg(to_jsonb(v) order by v.version_number), '[]'::jsonb) from public.package_versions v where v.package_id = v_pkg.id),
    (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at), '[]'::jsonb) from public.package_change_requests r where r.package_id = v_pkg.id),
    v_impact
  )
  returning id into v_deletion_id;

  delete from public.packages where id = v_pkg.id;

  return jsonb_build_object('deletion_id', v_deletion_id, 'impact', v_impact);
end;
$$;

comment on function public.delete_package(uuid, timestamptz, text, text) is
  'The only way to delete a package. ADMIN with deletePackage; Draft or Archived only; the package code must be typed; a reason is required; refused while groups, group snapshots, lead quotes or agent submissions refer to it. Copies the package, its history and what the delete touched into package_deletions first. TASK-043 PKG-10.';

revoke all on function public.delete_package(uuid, timestamptz, text, text) from public, anon;
grant execute on function public.delete_package(uuid, timestamptz, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
