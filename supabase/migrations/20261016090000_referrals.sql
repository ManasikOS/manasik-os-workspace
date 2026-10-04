-- ─────────────────────────────────────────────────────────────────────────────
-- Referrals and rewards (M7 remainder) — pilgrim/agent referral programs.
--
-- Scoped to referrers/referrals/reward rules & accruals only. Agent/sub-agent
-- commission_rules / commission_accruals / agent_settlements (the other half
-- of M7) are deferred to the Agent Portal slice (M14) where sales_agents
-- actually exists — a commission rule without an agent record to attach it
-- to would be unusable. Finance's existing Commissions page stays a
-- "coming soon" stub until that slice.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.referrers (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),

  name text not null,
  referrer_type text not null check (referrer_type in ('PILGRIM', 'LEAD', 'STAFF', 'EXTERNAL')),
  -- Points at pilgrims.id or leads.id depending on referrer_type; not a
  -- foreign key since it can reference either table. Null for EXTERNAL/STAFF.
  subject_id uuid,

  contact_phone text,
  contact_email text,
  referral_code text not null,

  created_by_name text not null,
  created_at timestamptz not null default now(),

  unique (agency_id, referral_code)
);

comment on table public.referrers is
  'A person or party who can refer new leads — a pilgrim, a lead, a staff member, or someone external. subject_id references pilgrims/leads depending on referrer_type.';

create index if not exists referrers_agency_idx on public.referrers (agency_id);

alter table public.referrers enable row level security;

drop policy if exists "staff read referrers" on public.referrers;
create policy "staff read referrers" on public.referrers
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write referrers" on public.referrers;
create policy "staff write referrers" on public.referrers
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));

-- ─────────────────────────────────────────────────────────────────────────────
-- referrals — one referred person's journey from invite to (maybe) a booking.
-- referred_lead_id links to the real lead once one exists, so conversion can
-- be read live off leads.stage / bookings rather than duplicated here.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  referrer_id uuid not null references public.referrers (id) on delete cascade,

  referred_name text not null,
  referred_contact text,
  referred_lead_id uuid references public.leads (id) on delete set null,

  status text not null default 'INVITED'
    check (status in ('INVITED', 'CONTACTED', 'CONVERTED', 'EXPIRED', 'REJECTED')),

  created_by_name text not null,
  created_at timestamptz not null default now(),
  converted_at timestamptz
);

comment on table public.referrals is
  'One referred prospect. status is set manually by staff working the referral, except CONVERTED which the app sets when referred_lead_id''s booking is created.';

create index if not exists referrals_agency_idx on public.referrals (agency_id);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id);

alter table public.referrals enable row level security;

drop policy if exists "staff read referrals" on public.referrals;
create policy "staff read referrals" on public.referrals
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write referrals" on public.referrals;
create policy "staff write referrals" on public.referrals
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));

-- ─────────────────────────────────────────────────────────────────────────────
-- reward_rules / reward_accruals — what a converted referral is worth, and
-- the record of that reward actually being granted. An accrual is created
-- manually against a rule when a referral converts — never auto-computed
-- from a rule change after the fact, so past accruals can't silently drift.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.reward_rules (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),

  name text not null,
  reward_type text not null check (reward_type in ('FIXED_CASH', 'PERCENTAGE_OF_BOOKING', 'DISCOUNT_VOUCHER')),
  amount numeric,
  percentage numeric,
  is_active boolean not null default true,

  created_by_name text not null,
  created_at timestamptz not null default now()
);

comment on table public.reward_rules is
  'A reward definition staff can grant against a converted referral. amount is used for FIXED_CASH/DISCOUNT_VOUCHER, percentage for PERCENTAGE_OF_BOOKING.';

create index if not exists reward_rules_agency_idx on public.reward_rules (agency_id);

alter table public.reward_rules enable row level security;

drop policy if exists "staff read reward_rules" on public.reward_rules;
create policy "staff read reward_rules" on public.reward_rules
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write reward_rules" on public.reward_rules;
create policy "staff write reward_rules" on public.reward_rules
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'));

create table if not exists public.reward_accruals (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  referral_id uuid not null references public.referrals (id) on delete cascade,
  reward_rule_id uuid not null references public.reward_rules (id),

  amount numeric not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'PAID', 'CANCELLED')),

  approved_by_name text,
  approved_at timestamptz,
  paid_at timestamptz,

  created_by_name text not null,
  created_at timestamptz not null default now()
);

comment on table public.reward_accruals is
  'One reward granted against one converted referral. amount is a snapshot at grant time — a later change to reward_rules never rewrites a past accrual.';

create index if not exists reward_accruals_agency_idx on public.reward_accruals (agency_id);
create index if not exists reward_accruals_referral_idx on public.reward_accruals (referral_id);

alter table public.reward_accruals enable row level security;

drop policy if exists "staff read reward_accruals" on public.reward_accruals;
create policy "staff read reward_accruals" on public.reward_accruals
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write reward_accruals" on public.reward_accruals;
create policy "staff write reward_accruals" on public.reward_accruals
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'));

notify pgrst, 'reload schema';
