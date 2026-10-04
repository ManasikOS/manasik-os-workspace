-- MI3.5 — routing and auto-assignment (Architecture §16 R3). docs/inbox/implementation-plan.md MI3.5.
--
--  1. inbox_routing_policy — one row per agency: whether the chain is on for it and its knobs. There is NO seed: an agency
--     with no row is routed exactly as before this slice (the AI handoff assigns the configured default owner, and nothing
--     else assigns automatically). Creating the row in Settings is what turns the four-step chain on.
--     coordinator_role_by_queue is { GROUP?, VISA_ISSUES?, DOCUMENTS? } → a staff role; a missing key uses the code default
--     (lib/inbox/routing/policy.ts): GROUP → OPERATIONS, VISA_ISSUES → VISA, DOCUMENTS → OPERATIONS.
--  2. staff_profiles.last_assigned_at — when this person was last given a conversation by the chain; the tie-break, so equal
--     loads rotate fairly.
--
-- RLS in this same migration (read: inbox roles; manage: ADMIN and CEO, like inbox_sla_policies). Additive and idempotent.

create table if not exists public.inbox_routing_policy (
  agency_id                  uuid primary key default public.current_agency_id() references public.agencies (id) on delete cascade,
  sticky_enabled             boolean not null default true,
  group_threshold            integer not null default 10 check (group_threshold between 2 and 500),
  load_balance_mode          text not null default 'LEAST_LOADED' check (load_balance_mode in ('LEAST_LOADED', 'ROUND_ROBIN')),
  respect_shifts             boolean not null default true,
  coordinator_role_by_queue  jsonb not null default '{}'::jsonb check (jsonb_typeof(coordinator_role_by_queue) = 'object'),
  updated_by                 uuid references public.staff_profiles (id) on delete set null,
  updated_at                 timestamptz not null default now()
);

comment on table public.inbox_routing_policy is
  'Per-agency auto-assignment knobs (Architecture §16 R3). No row = the chain is off and behaviour is unchanged.';

drop trigger if exists inbox_routing_policy_set_updated_at on public.inbox_routing_policy;
create trigger inbox_routing_policy_set_updated_at
  before update on public.inbox_routing_policy
  for each row execute function public.set_updated_at();

alter table public.inbox_routing_policy enable row level security;

drop policy if exists "staff read inbox_routing_policy" on public.inbox_routing_policy;
create policy "staff read inbox_routing_policy" on public.inbox_routing_policy
  for select to authenticated
  using (agency_id = (select public.current_agency_id())
         and (select public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA')));

drop policy if exists "owners manage inbox_routing_policy" on public.inbox_routing_policy;
create policy "owners manage inbox_routing_policy" on public.inbox_routing_policy
  for all to authenticated
  using (agency_id = (select public.current_agency_id()) and (select public.staff_role_in('ADMIN', 'CEO')))
  with check (agency_id = (select public.current_agency_id()) and (select public.staff_role_in('ADMIN', 'CEO')));

alter table public.staff_profiles
  add column if not exists last_assigned_at timestamptz;

comment on column public.staff_profiles.last_assigned_at is
  'When the Inbox routing chain last assigned this person a conversation. Round-robin and load ties break on it, oldest first.';

notify pgrst, 'reload schema';

-- Rollback (commented — additive migration, not applied automatically):
-- alter table public.staff_profiles drop column if exists last_assigned_at;
-- drop table if exists public.inbox_routing_policy;
