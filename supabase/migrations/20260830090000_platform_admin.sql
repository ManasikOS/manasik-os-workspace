-- Multi-tenancy Phase 4 — the platform operator console's database layer.
-- See docs/architecture/multi-tenancy-implementation-plan.md Phase 4 (F8).
--
-- Deliberate scope note: the plan sketches session-level "impersonation" —
-- an operator's own signed-in session temporarily gaining a real tenant
-- membership. Building that correctly runs straight into a structural gap
-- this schema does not have an answer for: `staff_profiles.agency_id` is
-- NOT NULL, and a pure platform operator has no "home" agency to fall back
-- to when a support session ends. Solving that (a reserved internal
-- agency every operator defaults to, or relaxing the NOT NULL) is a real
-- design decision, not something to improvise inside a migration with no
-- database to test it against.
--
-- What this migration ships instead: `platform_admins` and
-- `is_platform_admin()` as the identity/authorization primitives, write
-- access to `agencies` for operators, and `log_support_access()` — an
-- audited, read-only diagnostic path. The platform console queries a
-- target agency's data with the service-role client, explicitly filtered
-- by `agency_id` (the same discipline `lib/agent/*` already follows), and
-- every such view is required to log why first. This is "supervised
-- support access", not "become the customer" — arguably the safer shape
-- for a support tool regardless, and it ships without touching the
-- membership model Phase 3 just landed. Full session-level impersonation,
-- if still wanted, is a follow-up with its own migration once the
-- operator "home agency" question has an actual answer.
--
-- Safe on a database with 20260808…20260829 applied.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. platform_admins — service-role-only membership. No self-serve path;
--    the first row is inserted by hand (see this file's footer).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  granted_by  uuid references auth.users (id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);

comment on table public.platform_admins is
  'Operators of the platform itself, distinct from any agency''s staff_profiles/agency_members. No RLS policy grants authenticated access — every row is written by hand or by a service-role script, never through the app.';

alter table public.platform_admins enable row level security;
-- No policies: authenticated has zero access, matching the header note
-- above. Reads and writes both go through the service-role client only.

create or replace function public.is_platform_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

comment on function public.is_platform_admin() is
  'Security-definer helper: true when the caller is a platform operator. Used by app/(platform)/ route gating and the agencies write policy below.';

-- ─────────────────────────────────────────────────────────────────────────────
-- B. agencies — operators can create and update tenants. Read policy from
--    20260829090000_agency_membership.sql §E is untouched; this only adds
--    write access, and only for platform admins — no tenant-table policy
--    anywhere else gets an `or is_platform_admin()` clause bolted on. See
--    this plan's Phase 4 for why that line is drawn here deliberately.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists agencies_platform_write on public.agencies;
create policy agencies_platform_write on public.agencies
  for all to authenticated
  using ((select public.is_platform_admin()))
  with check ((select public.is_platform_admin()));

-- ─────────────────────────────────────────────────────────────────────────────
-- C. support_sessions — the audit trail. Not a session in the auth sense —
--    one row per "an operator looked at (or acted on) this agency, and
--    said why". log_support_access() is the only writer.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.support_sessions (
  id           uuid primary key default gen_random_uuid(),
  operator_id  uuid not null references auth.users (id) on delete cascade,
  agency_id    uuid not null references public.agencies (id) on delete cascade,
  reason       text not null,
  action       text not null default 'VIEW' check (action in ('VIEW', 'SUSPEND', 'RESUME', 'PROVISION')),
  created_at   timestamptz not null default now()
);

comment on table public.support_sessions is
  'Audit log of platform-operator access to one agency''s data — see log_support_access() below. Every row is mirrored into that agency''s own settings_activity_logs, so the customer can see it too.';

create index if not exists support_sessions_agency_idx on public.support_sessions (agency_id, created_at desc);
create index if not exists support_sessions_operator_idx on public.support_sessions (operator_id, created_at desc);

alter table public.support_sessions enable row level security;

drop policy if exists support_sessions_select on public.support_sessions;
create policy support_sessions_select on public.support_sessions
  for select to authenticated
  using ((select public.is_platform_admin()) or agency_id = (select public.current_agency_id()));

-- No insert/update/delete policy for `authenticated` — writes go through
-- log_support_access() only.

create or replace function public.log_support_access(
  p_agency_id uuid,
  p_reason text,
  p_action text default 'VIEW'
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_operator_email text;
begin
  if not public.is_platform_admin() then
    raise exception 'Not a platform operator.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required for support access.' using errcode = '22004';
  end if;

  insert into public.support_sessions (operator_id, agency_id, reason, action)
  values (auth.uid(), p_agency_id, p_reason, p_action)
  returning id into v_id;

  select email into v_operator_email from auth.users where id = auth.uid();

  insert into public.settings_activity_logs
    (actor_id, actor_name_snapshot, section, event_type, entity_type, entity_id, message)
  values (
    auth.uid(),
    coalesce(v_operator_email, 'Platform operator'),
    'PLATFORM_SUPPORT',
    'SUPPORT_ACCESS',
    'AGENCY',
    p_agency_id::text,
    format('Platform operator accessed this workspace (%s): %s', lower(p_action), p_reason)
  );

  return v_id;
end;
$$;

comment on function public.log_support_access(uuid, text, text) is
  'Records why a platform operator looked at or acted on one agency''s data — one row in support_sessions, one mirrored row in that agency''s own settings_activity_logs so the customer sees it too. Call before every platform-console read of a specific agency.';

revoke all on function public.log_support_access(uuid, text, text) from public, anon;
grant execute on function public.log_support_access(uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. suspend_agency() / resume_agency() — thin, logged wrappers around the
--    one-column change that is F7's entire enforcement mechanism
--    (current_agency_id() already refuses a non-ACTIVE agency).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.suspend_agency(p_agency_id uuid, p_reason text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not a platform operator.' using errcode = '42501';
  end if;

  update public.agencies set status = 'SUSPENDED' where id = p_agency_id;
  perform public.log_support_access(p_agency_id, p_reason, 'SUSPEND');
end;
$$;

create or replace function public.resume_agency(p_agency_id uuid, p_reason text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not a platform operator.' using errcode = '42501';
  end if;

  update public.agencies set status = 'ACTIVE' where id = p_agency_id;
  perform public.log_support_access(p_agency_id, p_reason, 'RESUME');
end;
$$;

revoke all on function public.suspend_agency(uuid, text) from public, anon;
grant execute on function public.suspend_agency(uuid, text) to authenticated;
revoke all on function public.resume_agency(uuid, text) from public, anon;
grant execute on function public.resume_agency(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Bootstrap. This migration ships zero platform admins on purpose — a
--    seeded superuser account is a standing risk in every database this
--    runs against, including anyone's local/staging copy. Grant yourself
--    access once, by hand, after this migration runs:
--
--    insert into public.platform_admins (user_id, note)
--    values ('<your auth.users id>', 'initial bootstrap');
--
--    Find your id with: select id, email from auth.users where email = '<you>';
-- ─────────────────────────────────────────────────────────────────────────────
