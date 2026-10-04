-- ─────────────────────────────────────────────────────────────────────────────
-- Pilgrim Portal (M13 remainder) — access lifecycle and engagement tracking.
--
-- What the portal shows once a pilgrim is in it is already governed by
-- agency_settings.portal_flags / portal_active (Settings → Branding,
-- lib/types/settings.ts PortalFlags) — this migration does not duplicate
-- that. What was actually missing is per-pilgrim access itself: who has
-- been invited, who has activated, and what they've done once in.
--
-- There is deliberately no pilgrim-facing authenticated portal app in this
-- codebase yet (no magic-link auth, no /portal route) — building one is a
-- separate, much larger feature (a whole second auth surface). This gives
-- staff the access-lifecycle model and engagement log to manage and observe
-- against, the same way Announcements built the recipient/consent model
-- without wiring real message dispatch.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.portal_accounts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  pilgrim_id uuid not null references public.pilgrims (id) on delete cascade,

  status text not null default 'NOT_INVITED'
    check (status in ('NOT_INVITED', 'INVITED', 'ACTIVE', 'REVOKED')),

  invited_at timestamptz,
  invited_by_name text,
  activated_at timestamptz,
  revoked_at timestamptz,
  revoked_by_name text,
  last_login_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (pilgrim_id)
);

comment on table public.portal_accounts is
  'One row per pilgrim tracking portal access lifecycle. No credentials are stored here — actual pilgrim-facing auth is a separate, not-yet-built feature.';

create index if not exists portal_accounts_agency_idx on public.portal_accounts (agency_id);

alter table public.portal_accounts enable row level security;

drop policy if exists "staff read portal_accounts" on public.portal_accounts;
create policy "staff read portal_accounts" on public.portal_accounts
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write portal_accounts" on public.portal_accounts;
create policy "staff write portal_accounts" on public.portal_accounts
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

-- ─────────────────────────────────────────────────────────────────────────────
-- portal_access_events — append-only engagement log. Written by staff
-- actions (invite/revoke) today; once a real portal exists, its login and
-- content-view events land in the same table without a schema change.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.portal_access_events (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  pilgrim_id uuid not null references public.pilgrims (id) on delete cascade,

  event_type text not null check (
    event_type in (
      'INVITED', 'ACTIVATED', 'REVOKED', 'LOGIN',
      'VIEWED_ITINERARY', 'VIEWED_DOCUMENTS', 'VIEWED_PAYMENTS', 'SUPPORT_REQUEST_SUBMITTED'
    )
  ),
  actor_name text not null,
  created_at timestamptz not null default now()
);

comment on table public.portal_access_events is
  'Append-only portal access/engagement log, one row per event.';

create index if not exists portal_access_events_pilgrim_idx on public.portal_access_events (pilgrim_id, created_at desc);
create index if not exists portal_access_events_agency_idx on public.portal_access_events (agency_id);

alter table public.portal_access_events enable row level security;

drop policy if exists "staff read portal_access_events" on public.portal_access_events;
create policy "staff read portal_access_events" on public.portal_access_events
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write portal_access_events" on public.portal_access_events;
create policy "staff write portal_access_events" on public.portal_access_events
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

notify pgrst, 'reload schema';
