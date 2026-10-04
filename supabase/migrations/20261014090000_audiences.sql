-- ─────────────────────────────────────────────────────────────────────────────
-- Audiences (M5) — reusable segments over leads and pilgrims.
--
-- Two kinds, distinguished by `audience_type`:
--   DYNAMIC — `filters` (jsonb) is the source of truth. Membership is never
--     stored; `lib/data/audiences-repository.ts` re-runs the filter against
--     `leads` / `pilgrims` every time the audience is opened, so it can never
--     go stale. `computed_count` / `computed_at` are a cache of the last run,
--     refreshed on every read — never the value a screen trusts blindly.
--   STATIC — a hand-picked, frozen list. Membership lives in
--     `audience_members`; `filters` is null.
--
-- Consent is deliberately NOT a stored membership condition — it is enforced
-- at send time by whatever reads the audience (Campaigns, Announcements),
-- against the live `consent_status` / `do_not_contact` / `contactable_channels`
-- columns from supabase/migrations/20261012090000_consent_and_contactability.sql.
-- Baking a consent snapshot into `filters` would let a later opt-out be
-- silently ignored by an audience computed before it happened.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.audiences (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),

  name text not null,
  description text,
  subject_type text not null check (subject_type in ('LEAD', 'PILGRIM')),
  audience_type text not null check (audience_type in ('DYNAMIC', 'STATIC')),

  -- Only meaningful when audience_type = 'DYNAMIC'. Shape is subject-specific;
  -- see AudienceFilters in lib/types/audiences.ts.
  filters jsonb,

  computed_count integer not null default 0,
  computed_at timestamptz,

  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.audiences is
  'Saved lead/pilgrim segments. DYNAMIC audiences store a filter definition and are recomputed live; STATIC audiences store a frozen member list in audience_members.';

create index if not exists audiences_agency_idx on public.audiences (agency_id);

alter table public.audiences enable row level security;

drop policy if exists "staff read audiences" on public.audiences;
create policy "staff read audiences" on public.audiences
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write audiences" on public.audiences;
create policy "staff write audiences" on public.audiences
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));

-- ─────────────────────────────────────────────────────────────────────────────
-- audience_members — STATIC membership only. `included = false` records a
-- deliberate exclusion (e.g. someone manually dropped from an otherwise
-- dynamic-looking hand-built list) with a reason, rather than silently
-- deleting the row and losing why.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.audience_members (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  audience_id uuid not null references public.audiences (id) on delete cascade,

  subject_type text not null check (subject_type in ('LEAD', 'PILGRIM')),
  subject_id uuid not null,

  included boolean not null default true,
  reason text,

  added_by_name text not null,
  added_at timestamptz not null default now(),

  unique (audience_id, subject_id)
);

comment on table public.audience_members is
  'Frozen membership for STATIC audiences. subject_id references leads.id or pilgrims.id depending on subject_type — not a foreign key, since it can point to either table.';

create index if not exists audience_members_audience_idx on public.audience_members (audience_id);
create index if not exists audience_members_agency_idx on public.audience_members (agency_id);

alter table public.audience_members enable row level security;

drop policy if exists "staff read audience_members" on public.audience_members;
create policy "staff read audience_members" on public.audience_members
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write audience_members" on public.audience_members;
create policy "staff write audience_members" on public.audience_members
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));

notify pgrst, 'reload schema';
