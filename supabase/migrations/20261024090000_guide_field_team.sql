-- ─────────────────────────────────────────────────────────────────────────────
-- Guides & Field Team (M10) — profiles, briefings, handovers, check-ins.
--
-- "Who is assigned where" already exists in full:
-- staff_group_assignments (20260820090000_team_access.sql) is the source of
-- truth for PRIMARY_GUIDE/BACKUP_GUIDE assignment per departure group, and
-- team_directory_rows already surfaces it on /guides-field-team. This
-- migration does not touch either — it only adds the four things that were
-- genuinely missing: guide-specific profile fields (languages,
-- certifications, emergency contact — HR-adjacent data that doesn't belong
-- on every staff_profiles row, only guides'), pre-departure briefings,
-- shift/responsibility handovers, and a lightweight field check-in log.
--
-- Guides already have real staff accounts and log into this CRM — unlike
-- Pilgrim/Agent Portal, no separate auth surface is needed here. A guide
-- can acknowledge their own briefing, accept a handover addressed to them,
-- and check themselves in; RLS enforces "own rows only" for those three
-- self-service actions specifically, everything else stays
-- ADMIN/CEO/OPERATIONS-managed.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.guide_profiles (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  staff_id uuid not null unique references public.staff_profiles (id) on delete cascade,

  languages text[] not null default '{}',
  certifications text,
  years_experience integer,
  emergency_contact_name text,
  emergency_contact_phone text,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.guide_profiles is
  'Guide-specific profile fields, one row per GUIDE staff member. Kept separate from staff_profiles since these fields (languages, certifications, emergency contact) only make sense for guides.';

create index if not exists guide_profiles_agency_idx on public.guide_profiles (agency_id);

alter table public.guide_profiles enable row level security;

drop policy if exists "staff read guide_profiles" on public.guide_profiles;
create policy "staff read guide_profiles" on public.guide_profiles
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write guide_profiles" on public.guide_profiles;
create policy "staff write guide_profiles" on public.guide_profiles
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

-- ─────────────────────────────────────────────────────────────────────────────
-- guide_briefings — a pre-departure (or mid-trip) briefing addressed to one
-- guide for one departure group. acknowledged_at is set by the guide
-- themselves reading it, not by whoever wrote it.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.guide_briefings (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  departure_group_id uuid not null references public.departure_groups (id) on delete cascade,
  staff_id uuid not null references public.staff_profiles (id) on delete cascade,

  title text not null,
  content text not null,
  acknowledged_at timestamptz,

  created_by_name text not null,
  created_at timestamptz not null default now()
);

comment on table public.guide_briefings is
  'A briefing addressed to one guide for one departure group. acknowledged_at is set by that guide reading it.';

create index if not exists guide_briefings_staff_idx on public.guide_briefings (staff_id, created_at desc);
create index if not exists guide_briefings_group_idx on public.guide_briefings (departure_group_id);
create index if not exists guide_briefings_agency_idx on public.guide_briefings (agency_id);

alter table public.guide_briefings enable row level security;

drop policy if exists "staff read guide_briefings" on public.guide_briefings;
create policy "staff read guide_briefings" on public.guide_briefings
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write guide_briefings" on public.guide_briefings;
create policy "staff write guide_briefings" on public.guide_briefings
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

drop policy if exists "guide acknowledge own guide_briefings" on public.guide_briefings;
create policy "guide acknowledge own guide_briefings" on public.guide_briefings
  for update to authenticated
  using (agency_id = public.current_agency_id() and staff_id = auth.uid())
  with check (agency_id = public.current_agency_id() and staff_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- guide_handovers — responsibility passing from one guide to another for a
-- departure group (shift change, sickness, backup taking over). to_staff_id
-- accepts it themselves; from_staff_id is nullable for a handover assigned
-- rather than initiated by the outgoing guide.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.guide_handovers (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  departure_group_id uuid not null references public.departure_groups (id) on delete cascade,
  from_staff_id uuid references public.staff_profiles (id) on delete set null,
  to_staff_id uuid not null references public.staff_profiles (id) on delete cascade,

  handover_notes text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'ACKNOWLEDGED')),

  created_by_name text not null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);

comment on table public.guide_handovers is
  'A handover of guide responsibility for one departure group, from one guide to another. to_staff_id acknowledges it themselves.';

create index if not exists guide_handovers_to_staff_idx on public.guide_handovers (to_staff_id, created_at desc);
create index if not exists guide_handovers_group_idx on public.guide_handovers (departure_group_id);
create index if not exists guide_handovers_agency_idx on public.guide_handovers (agency_id);

alter table public.guide_handovers enable row level security;

drop policy if exists "staff read guide_handovers" on public.guide_handovers;
create policy "staff read guide_handovers" on public.guide_handovers
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write guide_handovers" on public.guide_handovers;
create policy "staff write guide_handovers" on public.guide_handovers
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

drop policy if exists "guide acknowledge own guide_handovers" on public.guide_handovers;
create policy "guide acknowledge own guide_handovers" on public.guide_handovers
  for update to authenticated
  using (agency_id = public.current_agency_id() and to_staff_id = auth.uid())
  with check (agency_id = public.current_agency_id() and to_staff_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- field_checkins — a lightweight, free-text status log a guide posts about
-- their own group while travelling. No GPS/location coordinates — a short
-- note ("Arrived Makkah, all pilgrims accounted for") is what an agency
-- actually needs and a guide can type from a hotel lobby with patchy signal.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.field_checkins (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  departure_group_id uuid not null references public.departure_groups (id) on delete cascade,
  staff_id uuid not null references public.staff_profiles (id) on delete cascade,

  status text not null check (status in ('ALL_CLEAR', 'DELAY', 'ISSUE', 'EMERGENCY')),
  note text,

  created_at timestamptz not null default now()
);

comment on table public.field_checkins is
  'A guide''s own free-text status update for their assigned departure group. No location tracking — a short note is the whole check-in.';

create index if not exists field_checkins_group_idx on public.field_checkins (departure_group_id, created_at desc);
create index if not exists field_checkins_staff_idx on public.field_checkins (staff_id, created_at desc);
create index if not exists field_checkins_agency_idx on public.field_checkins (agency_id);

alter table public.field_checkins enable row level security;

drop policy if exists "staff read field_checkins" on public.field_checkins;
create policy "staff read field_checkins" on public.field_checkins
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff manage field_checkins" on public.field_checkins;
create policy "staff manage field_checkins" on public.field_checkins
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

drop policy if exists "guide check in themselves" on public.field_checkins;
create policy "guide check in themselves" on public.field_checkins
  for insert to authenticated
  with check (agency_id = public.current_agency_id() and staff_id = auth.uid());

notify pgrst, 'reload schema';
