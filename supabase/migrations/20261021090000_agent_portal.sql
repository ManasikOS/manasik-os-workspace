-- ─────────────────────────────────────────────────────────────────────────────
-- Agent / Sub-Agent Portal (M14) — the agent directory, package allocations,
-- booking submissions, and the commission tracking this unblocks.
--
-- Like Pilgrim Portal, there is no actual agent-facing authenticated portal
-- app here (no `agent_users` login, no separate auth surface) — that is a
-- separate, much larger feature. This gives staff the agent directory and
-- workflow to manage now: agents, what they're allocated, what they submit,
-- and what they're owed.
--
-- Commissions were deliberately deferred out of the Referrals migration
-- (20261016090000_referrals.sql) because sales_agents didn't exist yet —
-- commission_rules/commission_accruals below are that other half of M7,
-- now that there's an agent to attach a rule to.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.sales_agents (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),

  name text not null,
  agency_name text,
  contact_phone text,
  contact_email text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'INACTIVE')),
  credit_limit numeric,

  created_by_name text not null,
  created_at timestamptz not null default now()
);

comment on table public.sales_agents is
  'A sales agent or sub-agent bringing in bookings. No login/auth of their own — staff manage this on their behalf.';

create index if not exists sales_agents_agency_idx on public.sales_agents (agency_id);

alter table public.sales_agents enable row level security;

drop policy if exists "staff read sales_agents" on public.sales_agents;
create policy "staff read sales_agents" on public.sales_agents
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write sales_agents" on public.sales_agents;
create policy "staff write sales_agents" on public.sales_agents
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

-- ─────────────────────────────────────────────────────────────────────────────
-- agent_package_allocations — seats an agent is allowed to sell from one
-- package. seats_used is deliberately not a column here — it is counted
-- live from agent_booking_submissions with status = CONVERTED, the same
-- "never store what can be computed" posture used throughout this phase.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.agent_package_allocations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  sales_agent_id uuid not null references public.sales_agents (id) on delete cascade,
  package_id uuid not null references public.packages (id) on delete cascade,

  allocated_seats integer not null check (allocated_seats > 0),

  created_by_name text not null,
  created_at timestamptz not null default now(),

  unique (sales_agent_id, package_id)
);

comment on table public.agent_package_allocations is
  'Seats one agent may sell from one package. Usage is counted live from agent_booking_submissions, never stored here.';

create index if not exists agent_package_allocations_agent_idx on public.agent_package_allocations (sales_agent_id);
create index if not exists agent_package_allocations_agency_idx on public.agent_package_allocations (agency_id);

alter table public.agent_package_allocations enable row level security;

drop policy if exists "staff read agent_package_allocations" on public.agent_package_allocations;
create policy "staff read agent_package_allocations" on public.agent_package_allocations
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write agent_package_allocations" on public.agent_package_allocations;
create policy "staff write agent_package_allocations" on public.agent_package_allocations
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

-- ─────────────────────────────────────────────────────────────────────────────
-- agent_booking_submissions — a prospect an agent brought in. Recorded by
-- staff (no agent self-service yet). Converting one to a real booking is a
-- manual staff step elsewhere (Leads/Bookings) — status here just tracks
-- where the submission is in that process, it does not create the booking.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.agent_booking_submissions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  sales_agent_id uuid not null references public.sales_agents (id) on delete cascade,
  package_id uuid references public.packages (id) on delete set null,

  lead_name text not null,
  lead_contact text,
  notes text,
  status text not null default 'SUBMITTED' check (status in ('SUBMITTED', 'REVIEWED', 'CONVERTED', 'REJECTED')),
  converted_booking_id uuid references public.departure_group_bookings (id) on delete set null,

  submitted_by_name text not null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

comment on table public.agent_booking_submissions is
  'A prospect an agent brought in, logged by staff. status tracks the review process; converted_booking_id links to the real booking once one exists.';

create index if not exists agent_booking_submissions_agent_idx on public.agent_booking_submissions (sales_agent_id);
create index if not exists agent_booking_submissions_agency_idx on public.agent_booking_submissions (agency_id);

alter table public.agent_booking_submissions enable row level security;

drop policy if exists "staff read agent_booking_submissions" on public.agent_booking_submissions;
create policy "staff read agent_booking_submissions" on public.agent_booking_submissions
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write agent_booking_submissions" on public.agent_booking_submissions;
create policy "staff write agent_booking_submissions" on public.agent_booking_submissions
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

-- ─────────────────────────────────────────────────────────────────────────────
-- commission_rules / commission_accruals / agent_settlements — the deferred
-- M7 remainder. Same shape as Referrals' reward_rules/reward_accruals:
-- amount is snapshotted on the accrual at grant time, never recomputed from
-- a later rule change.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  sales_agent_id uuid references public.sales_agents (id) on delete cascade,

  name text not null,
  rate_percentage numeric not null check (rate_percentage > 0),
  is_active boolean not null default true,

  created_by_name text not null,
  created_at timestamptz not null default now()
);

comment on table public.commission_rules is
  'A commission rate. sales_agent_id null means it is a default rate available to any agent when granting an accrual.';

create index if not exists commission_rules_agency_idx on public.commission_rules (agency_id);

alter table public.commission_rules enable row level security;

drop policy if exists "staff read commission_rules" on public.commission_rules;
create policy "staff read commission_rules" on public.commission_rules
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write commission_rules" on public.commission_rules;
create policy "staff write commission_rules" on public.commission_rules
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'));

create table if not exists public.agent_settlements (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  sales_agent_id uuid not null references public.sales_agents (id) on delete cascade,

  period_start date not null,
  period_end date not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'FINALIZED', 'PAID')),

  created_by_name text not null,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

comment on table public.agent_settlements is
  'A payout batch for one agent covering one period. total owed is the live sum of its linked commission_accruals, never stored here.';

create index if not exists agent_settlements_agent_idx on public.agent_settlements (sales_agent_id);
create index if not exists agent_settlements_agency_idx on public.agent_settlements (agency_id);

alter table public.agent_settlements enable row level security;

drop policy if exists "staff read agent_settlements" on public.agent_settlements;
create policy "staff read agent_settlements" on public.agent_settlements
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write agent_settlements" on public.agent_settlements;
create policy "staff write agent_settlements" on public.agent_settlements
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'));

create table if not exists public.commission_accruals (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  sales_agent_id uuid not null references public.sales_agents (id) on delete cascade,
  commission_rule_id uuid not null references public.commission_rules (id),
  booking_id uuid references public.departure_group_bookings (id) on delete set null,
  settlement_id uuid references public.agent_settlements (id) on delete set null,

  amount numeric not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'PAID', 'CANCELLED')),

  created_by_name text not null,
  created_at timestamptz not null default now(),
  approved_by_name text,
  approved_at timestamptz,
  paid_at timestamptz
);

comment on table public.commission_accruals is
  'One commission grant against one agent booking. amount is a snapshot at grant time. settlement_id is set once it is bundled into a payout.';

create index if not exists commission_accruals_agent_idx on public.commission_accruals (sales_agent_id);
create index if not exists commission_accruals_settlement_idx on public.commission_accruals (settlement_id);
create index if not exists commission_accruals_agency_idx on public.commission_accruals (agency_id);

alter table public.commission_accruals enable row level security;

drop policy if exists "staff read commission_accruals" on public.commission_accruals;
create policy "staff read commission_accruals" on public.commission_accruals
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write commission_accruals" on public.commission_accruals;
create policy "staff write commission_accruals" on public.commission_accruals
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'));

notify pgrst, 'reload schema';
