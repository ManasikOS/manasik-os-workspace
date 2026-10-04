-- WhatsApp billing and usage tracker — E10 of
-- docs/modules/whatsapp-meta-connection-implementation-plan.md.
--
-- Meta bills each agency directly (D9) — we never see money move. This
-- schema is purely observational: it captures what Meta's own webhook and
-- analytics APIs report, so the CRM can show an agency its spend without
-- them ever opening WhatsApp Manager.
--
-- Two data sources, kept in separate tables and never silently merged
-- (D10): whatsapp_message_charges is the CRM's own attribution, built from
-- the `statuses[].pricing` webhook field (F15) — it knows WHY a message
-- was sent. whatsapp_billing_daily is Meta's own daily rollup, pulled
-- verbatim from pricing_analytics (F14) — it is the billing figure.
-- whatsapp_rate_observations is the derived bridge between them (D11):
-- unit rates computed from Meta's own cost/volume data, never hardcoded,
-- so a dated Meta pricing change (F13) updates the rate card with no code
-- change and without repricing history.
--
-- Safe on a database with 20260808…20260925 applied.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. whatsapp_message_charges — one row per delivered message that carried
--    a `pricing` object (F15). Attribution: which lead, conversation,
--    departure group and actor caused the spend.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_message_charges (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null references public.agencies (id),
  conversation_id       uuid references public.conversations (id) on delete set null,
  message_id            uuid references public.conversation_messages (id) on delete set null,
  external_message_id   text not null,

  direction             text not null check (direction in ('OUTBOUND', 'INBOUND')),
  billable              boolean not null default false,
  pricing_model         text,                    -- 'PMP' | 'CBP' (F15)
  pricing_category      text,                    -- marketing | utility | authentication | service
  pricing_type          text,                    -- regular | free_customer_service | free_entry_point
  recipient_country     text,                    -- derived from the wa_id, for the rate lookup (D11)

  template_name         text,
  template_id           text,

  actor_kind            text check (actor_kind in ('AI', 'STAFF', 'SYSTEM')),
  actor_id              uuid,
  lead_id               uuid references public.leads (id) on delete set null,
  departure_group_id    uuid references public.departure_groups (id) on delete set null,

  estimated_cost         numeric(12, 6),
  estimated_currency      text,
  rate_observation_id    uuid,

  charged_on            date,                    -- Meta's billing day, for reconciliation against whatsapp_billing_daily
  created_at            timestamptz not null default now(),

  constraint whatsapp_message_charges_external_id_unique unique (agency_id, external_message_id)
);

comment on table public.whatsapp_message_charges is
  'One row per delivered WhatsApp message carrying a pricing object (webhook statuses[].pricing, F15). The attribution half of the billing tracker — D10.';

create index if not exists whatsapp_message_charges_agency_id_idx
  on public.whatsapp_message_charges (agency_id, charged_on desc);
create index if not exists whatsapp_message_charges_unpriced_idx
  on public.whatsapp_message_charges (agency_id) where estimated_cost is null and billable = true;
create index if not exists whatsapp_message_charges_lead_id_idx
  on public.whatsapp_message_charges (lead_id) where lead_id is not null;
create index if not exists whatsapp_message_charges_departure_group_id_idx
  on public.whatsapp_message_charges (departure_group_id) where departure_group_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. whatsapp_rate_observations — derived unit rates (D11). Never
--    hand-maintained: cost ÷ volume per bucket per day, computed by the
--    nightly sync job from pricing_analytics.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_rate_observations (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null references public.agencies (id),
  observed_on       date not null,
  country_code      text not null default '',
  pricing_category  text not null default '',
  pricing_type      text not null default '',
  tier              text not null default '',
  cost              numeric(12, 6) not null,
  volume            integer not null,
  unit_rate         numeric(12, 6) not null,
  currency          text not null,
  created_at        timestamptz not null default now(),

  constraint whatsapp_rate_observations_bucket_unique
    unique (agency_id, observed_on, country_code, pricing_category, pricing_type, tier)
);

comment on table public.whatsapp_rate_observations is
  'Unit rates derived from Meta''s own pricing_analytics cost/volume data — never a hardcoded rate card (D11/F13).';

create index if not exists whatsapp_rate_observations_lookup_idx
  on public.whatsapp_rate_observations (agency_id, country_code, pricing_category, pricing_type, tier, observed_on desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- C. whatsapp_billing_daily — Meta's own daily rollup, verbatim. This is
--    the billing figure shown alongside the CRM's attributed figure (D10).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_billing_daily (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null references public.agencies (id),
  day               date not null,
  phone_number_id   text not null default '',
  country_code      text not null default '',
  pricing_category  text not null default '',
  pricing_type      text not null default '',
  tier              text not null default '',
  cost              numeric(12, 6) not null default 0,
  volume            integer not null default 0,
  currency          text not null,
  source            text not null default 'PRICING_ANALYTICS'
                      check (source in ('PRICING_ANALYTICS', 'CONVERSATION_ANALYTICS')),
  synced_at         timestamptz not null default now(),

  constraint whatsapp_billing_daily_bucket_unique
    unique (agency_id, day, phone_number_id, country_code, pricing_category, pricing_type, tier)
);

comment on table public.whatsapp_billing_daily is
  'Meta''s own pricing_analytics/conversation_analytics daily rollup, pulled verbatim by the nightly sync (E10 layer 1). The billing figure, not an estimate — D10.';

create index if not exists whatsapp_billing_daily_agency_day_idx
  on public.whatsapp_billing_daily (agency_id, day desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- D. whatsapp_volume_tiers — from account_update webhooks (F15). Meta may
--    send several webhooks describing one tier switch; the sync keeps the
--    one with the smallest tier_update_time.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_volume_tiers (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null references public.agencies (id),
  pricing_category  text not null,
  region            text not null default '',
  tier_lower        integer,
  tier_upper        integer,
  effective_month   date,
  tier_update_time  timestamptz not null,
  created_at        timestamptz not null default now(),

  constraint whatsapp_volume_tiers_unique unique (agency_id, pricing_category, region, effective_month)
);

comment on table public.whatsapp_volume_tiers is
  'Volume tier state from account_update webhooks. On a duplicate for the same (category, region, month), the row with the smaller tier_update_time wins (F15) — enforced in application code at upsert time, not here.';

-- ─────────────────────────────────────────────────────────────────────────────
-- E. whatsapp_billing_budgets — per-agency spend alerting (E10 layer 3).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_billing_budgets (
  agency_id             uuid primary key references public.agencies (id),
  monthly_budget        numeric(12, 2),
  currency              text,
  alert_at_percent      integer[] not null default '{50,80,100}',
  block_marketing_at_100 boolean not null default false,   -- opt-in; never blocks utility/auth/human replies (§5 E10 layer 3)
  notify_role           text not null default 'ADMIN' check (notify_role in ('ADMIN', 'CEO', 'FINANCE')),
  last_alerted_percent  integer not null default 0,
  updated_at            timestamptz not null default now()
);

comment on table public.whatsapp_billing_budgets is
  'Per-agency WhatsApp spend budget and alert thresholds. Blocking (block_marketing_at_100) is opt-in and scoped to marketing templates only — a budget guard must never silence a customer conversation.';

drop trigger if exists whatsapp_billing_budgets_set_updated_at on public.whatsapp_billing_budgets;
create trigger whatsapp_billing_budgets_set_updated_at
  before update on public.whatsapp_billing_budgets
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- F. ai_model_rates — platform-global, not agency-scoped. Cost per million
--    tokens per model, dated, so historical agent_runs cost correctly even
--    after a model's price changes (D12).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_model_rates (
  model                 text not null,
  effective_from        date not null,
  input_rate_per_million     numeric(12, 4) not null,
  output_rate_per_million    numeric(12, 4) not null,
  cache_read_rate_per_million  numeric(12, 4) not null default 0,
  cache_write_rate_per_million numeric(12, 4) not null default 0,
  currency              text not null default 'USD',
  created_at            timestamptz not null default now(),

  primary key (model, effective_from)
);

comment on table public.ai_model_rates is
  'Cost per million tokens by model, dated. Joined against agent_runs.model + created_at (nearest effective_from <= run date) to compute AI spend per conversation (D12).';

-- ─────────────────────────────────────────────────────────────────────────────
-- G. Row Level Security.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.whatsapp_message_charges enable row level security;
alter table public.whatsapp_rate_observations enable row level security;
alter table public.whatsapp_billing_daily enable row level security;
alter table public.whatsapp_volume_tiers enable row level security;
alter table public.whatsapp_billing_budgets enable row level security;
alter table public.ai_model_rates enable row level security;

-- Billing visibility follows money-visibility posture elsewhere in the app
-- (Finance module): ADMIN, CEO and FINANCE. Not MARKETING/OPERATIONS, who
-- can read conversations but have no reason to see agency-wide spend.
drop policy if exists "staff read whatsapp_message_charges" on public.whatsapp_message_charges;
create policy "staff read whatsapp_message_charges" on public.whatsapp_message_charges
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'FINANCE'));

drop policy if exists "staff read whatsapp_rate_observations" on public.whatsapp_rate_observations;
create policy "staff read whatsapp_rate_observations" on public.whatsapp_rate_observations
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'FINANCE'));

drop policy if exists "staff read whatsapp_billing_daily" on public.whatsapp_billing_daily;
create policy "staff read whatsapp_billing_daily" on public.whatsapp_billing_daily
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'FINANCE'));

drop policy if exists "staff read whatsapp_volume_tiers" on public.whatsapp_volume_tiers;
create policy "staff read whatsapp_volume_tiers" on public.whatsapp_volume_tiers
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'FINANCE'));

drop policy if exists "staff read whatsapp_billing_budgets" on public.whatsapp_billing_budgets;
create policy "staff read whatsapp_billing_budgets" on public.whatsapp_billing_budgets
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'FINANCE'));

drop policy if exists "staff write whatsapp_billing_budgets" on public.whatsapp_billing_budgets;
create policy "staff write whatsapp_billing_budgets" on public.whatsapp_billing_budgets
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'FINANCE'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'FINANCE'));

-- ai_model_rates is platform-global reference data — every signed-in staff
-- member may read it (needed to render any per-conversation AI cost), but
-- only service_role writes it.
drop policy if exists "staff read ai_model_rates" on public.ai_model_rates;
create policy "staff read ai_model_rates" on public.ai_model_rates
  for select to authenticated
  using (true);

-- Seed the model this app actually uses today. Additional rows (a price
-- change, a model switch) are inserted by hand or by a future admin tool —
-- there is no vendor API to pull this from.
insert into public.ai_model_rates (model, effective_from, input_rate_per_million, output_rate_per_million, cache_read_rate_per_million, cache_write_rate_per_million, currency)
values ('claude-sonnet-5', '2026-01-01', 3.00, 15.00, 0.30, 3.75, 'USD')
on conflict (model, effective_from) do nothing;
