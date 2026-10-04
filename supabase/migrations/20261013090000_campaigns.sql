-- Campaigns & attribution (docs/architecture/remaining-modules-master-plan.md, Phase C2).
--
-- Depends on 20261012090000_consent_and_contactability.sql having run —
-- a campaign is meaningless without a way to know who may actually be
-- contacted about it.
--
-- leads already had a free-text `campaign_reference` (never a real record,
-- no metrics, no spend). This adds a real `campaigns` table plus a
-- structured `campaign_id` link on leads and bookings, and keeps
-- `campaign_reference` untouched as a fallback for attribution to a
-- campaign this system has never tracked (an external/legacy one).

-- ─────────────────────────────────────────────────────────────────────────────
-- A. campaigns
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.campaigns (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null default public.current_agency_id()
                   references public.agencies (id),
  name           text not null,
  status         text not null default 'DRAFT'
                   check (status in ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED')),
  channel        text not null default 'OTHER'
                   check (channel in ('WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'GOOGLE',
                                       'WEBSITE', 'REFERRAL', 'WALK_IN', 'EVENT', 'PARTNER', 'OTHER')),
  start_date     date,
  end_date       date,
  budget         numeric(14, 2) check (budget is null or budget >= 0),
  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  notes          text,
  owner_id       uuid references auth.users (id) on delete set null,
  owner_name     text,
  created_by     uuid references auth.users (id) on delete set null,
  created_by_name text not null default 'Staff',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint campaigns_dates_order check (end_date is null or start_date is null or end_date >= start_date)
);

comment on table public.campaigns is
  'A marketing campaign. Metrics (leads, quotes, bookings, revenue) are computed live from leads.campaign_id / departure_group_bookings.campaign_id — never stored here, so they can never drift from the underlying records.';

create index if not exists campaigns_agency_idx on public.campaigns (agency_id);
create index if not exists campaigns_status_idx on public.campaigns (status);

drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

alter table public.campaigns enable row level security;

drop policy if exists "staff read campaigns" on public.campaigns;
create policy "staff read campaigns" on public.campaigns
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write campaigns" on public.campaigns;
create policy "staff write campaigns" on public.campaigns
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));

-- ─────────────────────────────────────────────────────────────────────────────
-- B. campaign_spend_entries — manual spend log. A campaign's total spend is
--    the sum of these, never a single editable number, so a correction
--    always has a reason attached rather than silently overwriting history.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.campaign_spend_entries (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null default public.current_agency_id()
                  references public.agencies (id),
  campaign_id   uuid not null references public.campaigns (id) on delete cascade,
  amount        numeric(14, 2) not null check (amount >= 0),
  spent_on      date not null default current_date,
  note          text,
  created_by_name text not null default 'Staff',
  created_at    timestamptz not null default now()
);

comment on table public.campaign_spend_entries is
  'Append-only manual spend log for one campaign. Sum of amount = the campaign''s total spend.';

create index if not exists campaign_spend_entries_campaign_idx on public.campaign_spend_entries (campaign_id, spent_on desc);
create index if not exists campaign_spend_entries_agency_idx on public.campaign_spend_entries (agency_id);

alter table public.campaign_spend_entries enable row level security;

drop policy if exists "staff read campaign_spend_entries" on public.campaign_spend_entries;
create policy "staff read campaign_spend_entries" on public.campaign_spend_entries
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write campaign_spend_entries" on public.campaign_spend_entries;
create policy "staff write campaign_spend_entries" on public.campaign_spend_entries
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Attribution on leads and bookings.
--
-- attribution_type follows the brief literally: "direct", "assisted", or
-- "unknown" — never a stronger certainty than the data supports. A lead
-- with a campaign_id but no other channel evidence is UNKNOWN, not DIRECT;
-- setting DIRECT/ASSISTED is a deliberate choice by whoever attributes it,
-- not inferred here.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.leads
  add column if not exists campaign_id uuid references public.campaigns (id) on delete set null;
alter table public.leads
  add column if not exists utm_source text;
alter table public.leads
  add column if not exists utm_medium text;
alter table public.leads
  add column if not exists utm_campaign text;
alter table public.leads
  add column if not exists utm_content text;
alter table public.leads
  add column if not exists utm_term text;
alter table public.leads
  add column if not exists attribution_type text not null default 'UNKNOWN'
    check (attribution_type in ('DIRECT', 'ASSISTED', 'UNKNOWN'));

create index if not exists leads_campaign_idx on public.leads (campaign_id) where campaign_id is not null;

alter table public.departure_group_bookings
  add column if not exists campaign_id uuid references public.campaigns (id) on delete set null;
alter table public.departure_group_bookings
  add column if not exists attribution_type text not null default 'UNKNOWN'
    check (attribution_type in ('DIRECT', 'ASSISTED', 'UNKNOWN'));

create index if not exists departure_group_bookings_campaign_idx on public.departure_group_bookings (campaign_id) where campaign_id is not null;

comment on column public.leads.campaign_id is
  'Structured link to campaigns. leads.campaign_reference (free text, pre-existing) stays available for a campaign this system has never tracked as a real record.';

notify pgrst, 'reload schema';
