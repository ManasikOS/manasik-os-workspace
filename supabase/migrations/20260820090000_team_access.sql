-- Team & Access — who can use the agency OS, what they can access, which groups/tasks they
-- own, and whether seasonal staff (Guides) are currently active.
--
-- This is the table `getCurrentStaffRole()` in `lib/data/departure-groups.ts` has been waiting
-- for since it was written — see that function's own comment. Every capability matrix in
-- `lib/access/*-access.ts` becomes a real gate the moment this migration's role-resolution
-- change ships, not merely a set of unused functions.
--
-- staff_profiles is the agency's *view* of a Supabase Auth identity, not a replacement for it —
-- password, MFA and session handling stay with `auth.users`. A row can exist in `INVITED` state
-- before the corresponding auth user has completed setup.
--
-- Additive only. Safe on a database with 20260808…20260819 applied.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. staff_profiles
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.staff_profiles (
  id                     uuid primary key references auth.users (id) on delete cascade,
  full_name              text not null default '',
  email                  text not null,
  whatsapp               text,
  role                   text not null default 'GUIDE'
                           check (role in ('ADMIN','CEO','FINANCE','MARKETING','OPERATIONS','VISA','GUIDE')),
  branch                 text not null default 'ALL'
                           check (branch in ('COLOMBO','KANDY','ALL')),
  employment_type        text not null default 'PERMANENT'
                           check (employment_type in ('PERMANENT','SEASONAL','CONTRACT','EXTERNAL_PARTNER')),
  status                 text not null default 'INVITED'
                           check (status in ('ACTIVE','INVITED','DEACTIVATED','SEASONAL_INACTIVE')),
  access_starts_on       date,
  access_ends_on         date,
  job_title              text,
  last_active_at         timestamptz,
  activated_at           timestamptz,
  deactivated_at         timestamptz,
  deactivated_by         uuid references auth.users (id) on delete set null,
  deactivation_reason    text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint staff_access_window check (
    access_ends_on is null or access_starts_on is null or access_ends_on >= access_starts_on
  )
);

comment on table public.staff_profiles is
  'The agency''s view of a Supabase Auth identity: role, branch, employment type and access window. Not a replacement for auth.users — password and session handling stay there.';

create unique index if not exists staff_profiles_email_unique on public.staff_profiles (lower(email));
create index if not exists staff_profiles_status_role_idx    on public.staff_profiles (status, role);
create index if not exists staff_profiles_branch_idx         on public.staff_profiles (branch);
create index if not exists staff_profiles_access_ends_idx     on public.staff_profiles (access_ends_on) where access_ends_on is not null;
create index if not exists staff_profiles_last_active_idx     on public.staff_profiles (last_active_at);

drop trigger if exists staff_profiles_set_updated_at on public.staff_profiles;
create trigger staff_profiles_set_updated_at
  before update on public.staff_profiles
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- B. staff_invitations — one row per send, so a resend is a new row and the
--    history the spec's "View Invitation History" shows is truthful.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.staff_invitations (
  id                 uuid primary key default gen_random_uuid(),
  staff_profile_id   uuid not null references public.staff_profiles (id) on delete cascade,
  email              text not null,
  role               text not null,
  branch             text not null,
  employment_type    text not null,
  invited_by         uuid references auth.users (id) on delete set null,
  invited_by_name    text,
  sent_via           text[] not null default '{EMAIL}',
  status             text not null default 'PENDING'
                        check (status in ('PENDING','ACCEPTED','EXPIRED','REVOKED')),
  expires_at         timestamptz not null,
  accepted_at        timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists staff_invitations_profile_idx on public.staff_invitations (staff_profile_id, created_at desc);
create index if not exists staff_invitations_status_idx  on public.staff_invitations (status);

-- ─────────────────────────────────────────────────────────────────────────────
-- C. staff_group_assignments — the source of truth for "who owns what".
--    `departure_groups.*_owner_*` / `primary_guide_*` / `backup_guide_name`
--    stay as a denormalised cache, kept in sync by the assignment mutators in
--    `lib/data/team-repository.ts`. Responsibilities with no cache column
--    (BACKUP_OPERATIONS, a second BACKUP_GUIDE) live only here.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.staff_group_assignments (
  id                   uuid primary key default gen_random_uuid(),
  staff_profile_id     uuid not null references public.staff_profiles (id) on delete cascade,
  departure_group_id   uuid not null references public.departure_groups (id) on delete cascade,
  responsibility       text not null
                          check (responsibility in ('PRIMARY_GUIDE','BACKUP_GUIDE','OPERATIONS_OWNER',
                                                     'BACKUP_OPERATIONS','VISA_OWNER','FINANCE_OWNER',
                                                     'MARKETING_OWNER')),
  assigned_by          uuid references auth.users (id) on delete set null,
  assigned_by_name     text,
  assigned_at          timestamptz not null default now(),
  unassigned_at        timestamptz,
  constraint staff_assignment_unique unique (departure_group_id, staff_profile_id, responsibility)
);

create index if not exists staff_group_assignments_staff_active_idx
  on public.staff_group_assignments (staff_profile_id) where unassigned_at is null;
create index if not exists staff_group_assignments_group_idx
  on public.staff_group_assignments (departure_group_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- D. staff_activity_logs — account lifecycle, role changes, assignments and
--    access events. Group *work* stays in `departure_group_activity_logs`;
--    the profile's Activity tab merges both streams at read time rather than
--    duplicating group events here.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.staff_activity_logs (
  id                    uuid primary key default gen_random_uuid(),
  staff_profile_id      uuid not null references public.staff_profiles (id) on delete cascade,
  actor_id              uuid references auth.users (id) on delete set null,
  actor_name_snapshot   text not null default 'System',
  event_type            text not null
                           check (event_type in ('INVITED','INVITATION_RESENT','INVITATION_REVOKED',
                                                  'ACCOUNT_ACTIVATED','ROLE_CHANGED','BRANCH_CHANGED',
                                                  'PROFILE_UPDATED','GROUP_ASSIGNED','GROUP_UNASSIGNED',
                                                  'ACCOUNT_DEACTIVATED','ACCOUNT_REACTIVATED',
                                                  'ACCESS_EXPIRED','ACCESS_EXTENDED',
                                                  'PASSWORD_RESET_SENT','SESSIONS_REVOKED',
                                                  'SENSITIVE_DATA_VIEWED')),
  before_value          jsonb,
  after_value           jsonb,
  message               text not null default '',
  is_high_impact        boolean not null default false,
  created_at            timestamptz not null default now()
);

create index if not exists staff_activity_logs_profile_idx on public.staff_activity_logs (staff_profile_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- E. team_directory_rows — one row per staff profile, flattened for the list.
--    Same shape as `supplier_directory_rows` / `pilgrim_journey_rows`.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.team_directory_rows as
select
  p.*,
  (select count(*) from public.staff_group_assignments a
     where a.staff_profile_id = p.id and a.unassigned_at is null)              as assigned_group_count,
  (select coalesce(jsonb_agg(jsonb_build_object(
             'groupId', g.id, 'groupName', g.group_name,
             'responsibility', a.responsibility) order by g.departure_date), '[]'::jsonb)
     from (select * from public.staff_group_assignments a
            where a.staff_profile_id = p.id and a.unassigned_at is null
            limit 3) a
     join public.departure_groups g on g.id = a.departure_group_id)             as primary_groups,
  (select count(*) from public.departure_group_tasks t
     where t.owner_id = p.id and t.status <> 'COMPLETE')                        as open_task_count,
  (select count(*) from public.departure_group_tasks t
     where t.owner_id = p.id and t.status <> 'COMPLETE' and t.due_at < now())   as overdue_task_count,
  (select count(*) from public.departure_group_tasks t
     where t.owner_id = p.id and t.status <> 'COMPLETE'
       and t.due_at::date = current_date)                                       as due_today_count,
  (select max(i.created_at) from public.staff_invitations i
     where i.staff_profile_id = p.id and i.status = 'PENDING')                  as pending_invitation_at
from public.staff_profiles p;

comment on view public.team_directory_rows is
  'Flattened Team list projection: one row per staff profile with assignment and task counts. Server-only — read through lib/data/team-repository.ts.';

-- ─────────────────────────────────────────────────────────────────────────────
-- F. Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.current_staff_role() returns text
  language sql stable security definer set search_path = public as $$
  select role from public.staff_profiles where id = auth.uid()
$$;

comment on function public.current_staff_role() is
  'Security-definer helper: the calling user''s staff_profiles.role, or null if they have no row. Used by RLS policies below and reusable by future migrations.';

alter table public.staff_profiles enable row level security;
alter table public.staff_invitations enable row level security;
alter table public.staff_group_assignments enable row level security;
alter table public.staff_activity_logs enable row level security;

drop policy if exists staff_profiles_select on public.staff_profiles;
create policy staff_profiles_select on public.staff_profiles
  for select to authenticated
  using (id = auth.uid() or public.current_staff_role() in ('ADMIN', 'CEO'));

drop policy if exists staff_profiles_write on public.staff_profiles;
create policy staff_profiles_write on public.staff_profiles
  for all to authenticated
  using (public.current_staff_role() = 'ADMIN')
  with check (public.current_staff_role() = 'ADMIN');

drop policy if exists staff_invitations_select on public.staff_invitations;
create policy staff_invitations_select on public.staff_invitations
  for select to authenticated
  using (public.current_staff_role() in ('ADMIN', 'CEO'));

drop policy if exists staff_invitations_write on public.staff_invitations;
create policy staff_invitations_write on public.staff_invitations
  for all to authenticated
  using (public.current_staff_role() = 'ADMIN')
  with check (public.current_staff_role() = 'ADMIN');

-- Group ownership names are shown on group screens to every role, so
-- assignments are readable agency-wide; only Admin and Operations may write.
drop policy if exists staff_group_assignments_select on public.staff_group_assignments;
create policy staff_group_assignments_select on public.staff_group_assignments
  for select to authenticated using (true);

drop policy if exists staff_group_assignments_write on public.staff_group_assignments;
create policy staff_group_assignments_write on public.staff_group_assignments
  for all to authenticated
  using (public.current_staff_role() in ('ADMIN', 'OPERATIONS'))
  with check (public.current_staff_role() in ('ADMIN', 'OPERATIONS'));

drop policy if exists staff_activity_logs_select on public.staff_activity_logs;
create policy staff_activity_logs_select on public.staff_activity_logs
  for select to authenticated
  using (staff_profile_id = auth.uid() or public.current_staff_role() in ('ADMIN', 'CEO'));

-- Append-only: any authenticated request may insert (server actions write on
-- the caller's behalf); there is deliberately no update or delete policy.
drop policy if exists staff_activity_logs_insert on public.staff_activity_logs;
create policy staff_activity_logs_insert on public.staff_activity_logs
  for insert to authenticated with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- G. Backfill — one staff_profiles row per existing auth.users row.
--
-- Deployment note: this activates every capability matrix in the app (see
-- `getCurrentStaffRole()` in lib/data/departure-groups.ts). Verify the role
-- backfilled below matches the intended person before deploying to an
-- environment with more than one user.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.staff_profiles (id, full_name, email, role, branch, employment_type, status, activated_at)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'full_name', u.email, ''),
  coalesce(u.email, ''),
  case
    when upper(coalesce(u.raw_user_meta_data ->> 'staff_role', '')) in
         ('ADMIN','CEO','FINANCE','MARKETING','OPERATIONS','VISA','GUIDE')
    then upper(u.raw_user_meta_data ->> 'staff_role')
    else 'ADMIN'
  end,
  'ALL',
  'PERMANENT',
  'ACTIVE',
  now()
from auth.users u
on conflict (id) do nothing;
