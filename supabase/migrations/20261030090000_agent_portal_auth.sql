-- ─────────────────────────────────────────────────────────────────────────────
-- Agent / Sub-Agent Portal — real authentication (v1).
--
-- 20261021090000_agent_portal.sql built the agent directory, allocations,
-- submissions and commission tracking, but said plainly "no agent_users
-- login, no separate auth surface" — staff did everything on the agent's
-- behalf. This migration is that missing surface, same shape as Pilgrim
-- Portal auth (20261026090000_pilgrim_portal_auth.sql): email magic-link
-- sign-in backed by Supabase's own auth.users, linked via
-- sales_agents.portal_user_id, so ordinary auth.uid() RLS keeps working
-- unmodified.
--
-- Unlike pilgrims, sales_agents already carries its own lifecycle column
-- (status ACTIVE/SUSPENDED/INACTIVE) — no separate portal_accounts table is
-- needed. portal_invited_at is the one new signal: it marks that staff
-- explicitly invited this agent, which is what the sign-in link check
-- (lib/data/agent-portal-auth.ts) requires before ever linking an
-- auth.users row to a sales_agents row. An agent whose email happens to
-- match but was never invited stays unlinked.
--
-- v1 scope: the agent's own profile, their package allocations, their
-- booking submissions (read AND create — this is the actual point of an
-- agent portal, letting them submit prospects themselves instead of
-- phoning staff), their commission accruals, and their settlements. They
-- can also see the packages they're allocated (needed to submit against
-- one). Nothing here narrows any existing staff policy.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.sales_agents
  add column if not exists portal_user_id uuid references auth.users (id) on delete set null,
  add column if not exists portal_invited_at timestamptz;

create unique index if not exists sales_agents_portal_user_id_unique
  on public.sales_agents (portal_user_id) where portal_user_id is not null;

create or replace function public.current_portal_agent_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select id from public.sales_agents where portal_user_id = auth.uid()
$$;

comment on function public.current_portal_agent_id() is
  'The calling user''s own sales_agents.id via portal_user_id, or null if they are not a signed-in portal agent (including every staff member).';

-- ─────────────────────────────────────────────────────────────────────────────
-- Agent self-read policies. Each is additive — the existing staff policy on
-- every one of these tables is untouched.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "agent read own record" on public.sales_agents;
create policy "agent read own record" on public.sales_agents
  for select to authenticated
  using (portal_user_id = auth.uid());

drop policy if exists "agent read own allocations" on public.agent_package_allocations;
create policy "agent read own allocations" on public.agent_package_allocations
  for select to authenticated
  using (sales_agent_id = public.current_portal_agent_id());

drop policy if exists "agent read allocated packages" on public.packages;
create policy "agent read allocated packages" on public.packages
  for select to authenticated
  using (
    id in (
      select package_id from public.agent_package_allocations
      where sales_agent_id = public.current_portal_agent_id()
    )
  );

drop policy if exists "agent read own submissions" on public.agent_booking_submissions;
create policy "agent read own submissions" on public.agent_booking_submissions
  for select to authenticated
  using (sales_agent_id = public.current_portal_agent_id());

-- The one write an agent gets directly: submitting a new prospect. Everything
-- else about the row (status, conversion) stays a staff-only update, per the
-- existing "staff write agent_booking_submissions" policy.
drop policy if exists "agent create own submissions" on public.agent_booking_submissions;
create policy "agent create own submissions" on public.agent_booking_submissions
  for insert to authenticated
  with check (sales_agent_id = public.current_portal_agent_id());

drop policy if exists "agent read own commission accruals" on public.commission_accruals;
create policy "agent read own commission accruals" on public.commission_accruals
  for select to authenticated
  using (sales_agent_id = public.current_portal_agent_id());

drop policy if exists "agent read own settlements" on public.agent_settlements;
create policy "agent read own settlements" on public.agent_settlements
  for select to authenticated
  using (sales_agent_id = public.current_portal_agent_id());

notify pgrst, 'reload schema';
