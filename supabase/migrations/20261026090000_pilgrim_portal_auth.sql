-- ─────────────────────────────────────────────────────────────────────────────
-- Pilgrim Portal — real authentication (v1).
--
-- supabase/migrations/20261018090000_pilgrim_portal_access.sql built the
-- staff-side access lifecycle (invite/activate/revoke) and explicitly said
-- "no pilgrim-facing authenticated portal app exists yet — that's a
-- separate, much larger feature." This migration is that feature's first
-- real slice: email magic-link sign-in, backed by Supabase's own auth.users
-- (the same table staff accounts live in) rather than a bespoke session
-- system, so RLS's ordinary `auth.uid()` machinery works unmodified.
--
-- A pilgrim is NOT a staff_profiles row — current_agency_id() /
-- staff_role_in() (which both read staff_profiles) return null/false for
-- them, so none of the existing "staff read/write" policies accidentally
-- grant them anything. Every policy below is a new, additive permissive
-- policy scoped to pilgrims.portal_user_id = auth.uid(), stacking (OR'd)
-- alongside the staff ones already on each table — nothing here narrows
-- staff access.
--
-- v1 scope is deliberately READ-ONLY: the pilgrim's own profile, their
-- departure-group bookings, a PUBLISHED itinerary's pilgrim-visible events,
-- and their own document checklist status. Payment schedule viewing,
-- document upload, payment-proof upload and support-request submission —
-- all real PortalFlags (lib/types/settings.ts) — are deferred to a
-- fast-follow slice; see the module's implementation notes.
--
-- Email-only sign-in is a real, known limitation: a pilgrim with no email
-- on file cannot be invited yet (enforced in invitePilgrimToPortal). A
-- WhatsApp-OTP alternative, reusing the Cloud API client Announcements
-- already dispatches through, is future work.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.pilgrims
  add column if not exists portal_user_id uuid references auth.users (id) on delete set null;

create unique index if not exists pilgrims_portal_user_id_unique
  on public.pilgrims (portal_user_id) where portal_user_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Security-definer helpers, same posture as current_agency_id() /
-- current_staff_role() — the calling pilgrim's own identity, resolved once
-- and reused across every policy below instead of repeating the subquery.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.current_portal_pilgrim_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select id from public.pilgrims where portal_user_id = auth.uid()
$$;

comment on function public.current_portal_pilgrim_id() is
  'The calling user''s own pilgrims.id via portal_user_id, or null if they are not a signed-in portal pilgrim (including every staff member).';

create or replace function public.current_portal_group_ids() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select departure_group_id from public.departure_group_pilgrims
  where pilgrim_id = public.current_portal_pilgrim_id()
$$;

comment on function public.current_portal_group_ids() is
  'Every departure_groups.id the calling portal pilgrim has a booking-row in.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Pilgrim self-read policies. Each is additive — the existing staff policy
-- on every one of these tables is untouched.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "pilgrim read own record" on public.pilgrims;
create policy "pilgrim read own record" on public.pilgrims
  for select to authenticated
  using (portal_user_id = auth.uid());

drop policy if exists "pilgrim read own booking rows" on public.departure_group_pilgrims;
create policy "pilgrim read own booking rows" on public.departure_group_pilgrims
  for select to authenticated
  using (pilgrim_id = public.current_portal_pilgrim_id());

drop policy if exists "pilgrim read own departure groups" on public.departure_groups;
create policy "pilgrim read own departure groups" on public.departure_groups
  for select to authenticated
  using (id in (select public.current_portal_group_ids()));

drop policy if exists "pilgrim read own published itineraries" on public.itineraries;
create policy "pilgrim read own published itineraries" on public.itineraries
  for select to authenticated
  using (status = 'PUBLISHED' and departure_group_id in (select public.current_portal_group_ids()));

drop policy if exists "pilgrim read own itinerary days" on public.itinerary_days;
create policy "pilgrim read own itinerary days" on public.itinerary_days
  for select to authenticated
  using (
    itinerary_id in (
      select id from public.itineraries
      where status = 'PUBLISHED' and departure_group_id in (select public.current_portal_group_ids())
    )
  );

drop policy if exists "pilgrim read own visible itinerary events" on public.itinerary_events;
create policy "pilgrim read own visible itinerary events" on public.itinerary_events
  for select to authenticated
  using (
    visible_to_pilgrims = true
    and departure_group_id in (select public.current_portal_group_ids())
    and itinerary_day_id in (
      select d.id from public.itinerary_days d
      join public.itineraries i on i.id = d.itinerary_id
      where i.status = 'PUBLISHED'
    )
  );

drop policy if exists "pilgrim read own documents" on public.departure_group_pilgrim_documents;
create policy "pilgrim read own documents" on public.departure_group_pilgrim_documents
  for select to authenticated
  using (
    pilgrim_id in (
      select id from public.departure_group_pilgrims where pilgrim_id = public.current_portal_pilgrim_id()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- portal_accounts / portal_access_events — the pilgrim writing about their
-- own session (activation, login, page views). Distinct from the staff
-- policies added in 20261018090000, which manage every pilgrim's row.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "pilgrim update own portal_accounts" on public.portal_accounts;
create policy "pilgrim update own portal_accounts" on public.portal_accounts
  for update to authenticated
  using (pilgrim_id = public.current_portal_pilgrim_id())
  with check (pilgrim_id = public.current_portal_pilgrim_id());

drop policy if exists "pilgrim read own portal_accounts" on public.portal_accounts;
create policy "pilgrim read own portal_accounts" on public.portal_accounts
  for select to authenticated
  using (pilgrim_id = public.current_portal_pilgrim_id());

drop policy if exists "pilgrim log own portal_access_events" on public.portal_access_events;
create policy "pilgrim log own portal_access_events" on public.portal_access_events
  for insert to authenticated
  with check (pilgrim_id = public.current_portal_pilgrim_id());

drop policy if exists "pilgrim read own portal_access_events" on public.portal_access_events;
create policy "pilgrim read own portal_access_events" on public.portal_access_events
  for select to authenticated
  using (pilgrim_id = public.current_portal_pilgrim_id());

notify pgrst, 'reload schema';
