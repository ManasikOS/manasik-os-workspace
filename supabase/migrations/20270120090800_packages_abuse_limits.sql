-- TASK-043 Phase 3, step 3 (PKG-13): limits on how fast one person can create, copy and publish packages, and on how many drafts an agency can hold.
--
-- Before: nothing limited create, duplicate, publish or the code lookups, and there was no cap on draft rows, so a stuck loop, a script or one careless
-- person could fill the catalogue with thousands of rows.
--
-- After
--   * consume_package_rate_limit(action): one atomic step that counts the caller's recent uses of an action and records this one. Per person, per hour:
--       create_draft 30, duplicate 20, publish 30, code_lookup 200.
--     The count comes from package_rate_events, which no client can read or write; only this function touches it, and it prunes rows older than 2 hours.
--   * packages_cap_agency_drafts: a BEFORE INSERT trigger that refuses a new Draft once the agency already holds 500 of them.
--
-- Idempotent. Rollback: drop the trigger, both functions and the table.

create table if not exists public.package_rate_events (
  id          bigint generated always as identity primary key,
  agency_id   uuid not null,
  user_id     uuid not null,
  action      text not null,
  created_at  timestamptz not null default now()
);

comment on table public.package_rate_events is
  'Recent uses of the rate-limited package actions. Written and pruned only by consume_package_rate_limit(); no client access. TASK-043.';

create index if not exists package_rate_events_user_action_idx on public.package_rate_events (user_id, action, created_at desc);

alter table public.package_rate_events enable row level security;
revoke all on public.package_rate_events from anon, authenticated;

create or replace function public.consume_package_rate_limit(p_action text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := auth.uid();
  v_agency uuid := public.current_agency_id();
  v_limit integer;
  v_label text;
  v_used integer;
  v_oldest timestamptz;
  v_wait_minutes integer;
begin
  if v_actor is null or v_agency is null then
    raise exception 'Your session has no active agency.' using errcode = '28000';
  end if;

  select l.max_per_hour, l.label into v_limit, v_label
  from (values
    ('create_draft', 30, 'create a package'),
    ('duplicate',    20, 'copy a package'),
    ('publish',      30, 'publish a package'),
    ('code_lookup', 200, 'check a package code')
  ) as l (action, max_per_hour, label)
  where l.action = p_action;
  if v_limit is null then
    raise exception 'That action is not recognised.' using errcode = '22023';
  end if;

  -- Two calls started together must not both slip under the limit.
  perform pg_advisory_xact_lock(hashtextextended('package_rate:' || v_actor::text || ':' || p_action, 0));

  delete from public.package_rate_events where user_id = v_actor and created_at < now() - interval '2 hours';

  select count(*), min(created_at) into v_used, v_oldest
  from public.package_rate_events
  where user_id = v_actor and action = p_action and created_at > now() - interval '1 hour';

  if v_used >= v_limit then
    v_wait_minutes := greatest(1, ceil(extract(epoch from (v_oldest + interval '1 hour' - now())) / 60)::integer);
    raise exception 'You can only % % times an hour and you have reached that limit. Try again in % minute(s).', v_label, v_limit, v_wait_minutes
      using errcode = 'P0001';
  end if;

  insert into public.package_rate_events (agency_id, user_id, action) values (v_agency, v_actor, p_action);
  return jsonb_build_object('allowed', true, 'remaining', v_limit - v_used - 1);
end;
$$;

comment on function public.consume_package_rate_limit(text) is
  'Counts one use of a rate-limited package action against the caller''s hour and refuses when the limit is reached. TASK-043.';

revoke all on function public.consume_package_rate_limit(text) from public, anon;
grant execute on function public.consume_package_rate_limit(text) to authenticated, service_role;

-- Draft cap -------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.packages_cap_agency_drafts()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'Draft'
     and (select count(*) from public.packages where agency_id = new.agency_id and status = 'Draft') >= 500 then
    raise exception 'Your agency already holds 500 draft packages. Publish or delete some before creating more.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.packages_cap_agency_drafts() from public, anon, authenticated;

drop trigger if exists packages_cap_agency_drafts on public.packages;
create trigger packages_cap_agency_drafts
  before insert on public.packages
  for each row execute function public.packages_cap_agency_drafts();
