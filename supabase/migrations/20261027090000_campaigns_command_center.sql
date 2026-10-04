-- Campaigns Command Center (docs/modules/campaigns-command-center-implementation-plan.md, V1).
--
-- Extends the existing campaigns/campaign_spend_entries/leads/departure_group_bookings
-- attribution model (20261013090000_campaigns.sql) so a campaign can be a real
-- commercial growth initiative: linked to a Package/Departure Group with real
-- capacity, linked to a saved Audience, carrying targets, and able to log
-- multi-touch attribution and campaign assets. Additive only — every existing
-- column, metric and query keeps working unchanged.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. campaigns — commercial-initiative fields
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.campaigns
  add column if not exists campaign_type text not null default 'CUSTOM',
  add column if not exists objective text not null default 'GENERATE_ENQUIRIES',
  add column if not exists linked_package_id uuid references public.packages (id) on delete set null,
  add column if not exists linked_departure_group_id uuid references public.departure_groups (id) on delete set null,
  add column if not exists audience_id uuid references public.audiences (id) on delete set null,
  add column if not exists booking_cutoff_at timestamptz,
  add column if not exists target_leads integer check (target_leads is null or target_leads >= 0),
  add column if not exists target_qualified_leads integer check (target_qualified_leads is null or target_qualified_leads >= 0),
  add column if not exists target_quotes integer check (target_quotes is null or target_quotes >= 0),
  add column if not exists target_bookings integer check (target_bookings is null or target_bookings >= 0),
  add column if not exists target_seats integer check (target_seats is null or target_seats >= 0),
  add column if not exists target_collected_revenue numeric(14, 2) check (target_collected_revenue is null or target_collected_revenue >= 0),
  add column if not exists target_margin_pct numeric(5, 2),
  add column if not exists approval_status text not null default 'DRAFT';

alter table public.campaigns drop constraint if exists campaigns_campaign_type_check;
alter table public.campaigns add constraint campaigns_campaign_type_check
  check (campaign_type in (
    'PACKAGE_LAUNCH', 'DEPARTURE_FILL', 'RAMADAN_UMRAH', 'HAJJ_PRE_REGISTRATION', 'HAJJ_EDUCATION',
    'EARLY_BIRD', 'SCHOOL_HOLIDAY_UMRAH', 'FAMILY_UMRAH', 'WOMENS_GROUP_UMRAH', 'SENIOR_FRIENDLY_UMRAH',
    'REFERRAL_PROGRAM', 'PAST_PILGRIM_REACTIVATION', 'VISA_DOCUMENT_DEADLINE', 'EVENT_ROADSHOW',
    'PARTNER_AGENT', 'CONTENT_EDUCATION', 'CUSTOM'
  ));

alter table public.campaigns drop constraint if exists campaigns_objective_check;
alter table public.campaigns add constraint campaigns_objective_check
  check (objective in (
    'GENERATE_ENQUIRIES', 'GENERATE_QUALIFIED_LEADS', 'GENERATE_QUOTES', 'GENERATE_BOOKINGS',
    'COLLECT_DEPOSITS', 'COLLECT_FULL_PAYMENT', 'FILL_DEPARTURE', 'REACTIVATE_PAST_PILGRIMS',
    'GENERATE_REFERRALS', 'PROMOTE_EVENT', 'INCREASE_REPEAT_BOOKINGS'
  ));

alter table public.campaigns drop constraint if exists campaigns_approval_status_check;
alter table public.campaigns add constraint campaigns_approval_status_check
  check (approval_status in ('DRAFT', 'PENDING_APPROVAL', 'APPROVED'));

comment on column public.campaigns.linked_departure_group_id is
  'The departure this campaign is trying to fill. Capacity (available_seats, sales_status) is always read live from departure_groups, never copied here.';
comment on column public.campaigns.audience_id is
  'The saved Audience this campaign targets. Consent/exclusion is enforced at send time by whoever reads the audience (Announcements), not duplicated here.';

create index if not exists campaigns_campaign_type_idx on public.campaigns (campaign_type);
create index if not exists campaigns_linked_departure_group_idx on public.campaigns (linked_departure_group_id) where linked_departure_group_id is not null;
create index if not exists campaigns_linked_package_idx on public.campaigns (linked_package_id) where linked_package_id is not null;
create index if not exists campaigns_audience_idx on public.campaigns (audience_id) where audience_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. campaign_touchpoints — detailed multi-touch attribution log.
--
-- Additive alongside leads.campaign_id / leads.attribution_type, which stay
-- the simple single-value answer used by today's list/metrics queries. This
-- table is the detailed log read only by Performance / AI Analysis: first,
-- last and assisted touches, each with its own confidence — never a stronger
-- certainty than the data supports (see attribution_confidence below).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.campaign_touchpoints (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  booking_id uuid references public.departure_group_bookings (id) on delete cascade,

  touch_type text not null check (touch_type in ('FIRST', 'LAST', 'ASSISTED')),
  channel text,
  source_detail text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  tracking_code text,
  attribution_confidence text not null default 'UNKNOWN'
    check (attribution_confidence in ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')),

  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint campaign_touchpoints_subject_present check (lead_id is not null or booking_id is not null)
);

comment on table public.campaign_touchpoints is
  'One attribution touchpoint (first/last/assisted) for a lead or booking against a campaign, with an honest confidence label. Additive to leads.attribution_type, not a replacement.';

create index if not exists campaign_touchpoints_campaign_idx on public.campaign_touchpoints (campaign_id, occurred_at desc);
create index if not exists campaign_touchpoints_lead_idx on public.campaign_touchpoints (lead_id) where lead_id is not null;
create index if not exists campaign_touchpoints_booking_idx on public.campaign_touchpoints (booking_id) where booking_id is not null;
create index if not exists campaign_touchpoints_agency_idx on public.campaign_touchpoints (agency_id);

alter table public.campaign_touchpoints enable row level security;

drop policy if exists "staff read campaign_touchpoints" on public.campaign_touchpoints;
create policy "staff read campaign_touchpoints" on public.campaign_touchpoints
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write campaign_touchpoints" on public.campaign_touchpoints;
create policy "staff write campaign_touchpoints" on public.campaign_touchpoints
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));

-- ─────────────────────────────────────────────────────────────────────────────
-- C. campaign_assets — content/template/tracking-link/QR registry.
--
-- A pointer table, not a template store: MESSAGE_TEMPLATE points reference_id
-- at the existing message_templates / whatsapp_templates row rather than
-- duplicating content.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.campaign_assets (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,

  asset_type text not null check (asset_type in (
    'MESSAGE_TEMPLATE', 'LANDING_PAGE', 'BROCHURE', 'QR_CODE', 'TRACKING_LINK', 'CREATIVE', 'OTHER'
  )),
  reference_id uuid,
  label text not null,
  language text,
  url text,
  qr_code_value text,
  notes text,

  created_by_name text not null default 'Staff',
  created_at timestamptz not null default now()
);

comment on table public.campaign_assets is
  'Campaign-scoped registry of content/tracking assets. reference_id points at an existing template/asset row where applicable — never a second content store.';

create index if not exists campaign_assets_campaign_idx on public.campaign_assets (campaign_id, created_at desc);
create index if not exists campaign_assets_agency_idx on public.campaign_assets (agency_id);

alter table public.campaign_assets enable row level security;

drop policy if exists "staff read campaign_assets" on public.campaign_assets;
create policy "staff read campaign_assets" on public.campaign_assets
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write campaign_assets" on public.campaign_assets;
create policy "staff write campaign_assets" on public.campaign_assets
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));

-- ─────────────────────────────────────────────────────────────────────────────
-- D. campaign_channels — per-channel spend/tracking breakdown.
--    Schema only in V1 (no UI yet) — reserved so a later migration is not
--    needed once the Channels tab is built.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.campaign_channels (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,

  channel text not null check (channel in (
    'WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'GOOGLE', 'WEBSITE', 'REFERRAL', 'WALK_IN',
    'EVENT', 'PARTNER', 'OTHER'
  )),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PAUSED', 'ENDED')),
  owner_id uuid references auth.users (id) on delete set null,
  budget_allocation numeric(14, 2) check (budget_allocation is null or budget_allocation >= 0),
  tracking_link text,
  asset_id uuid references public.campaign_assets (id) on delete set null,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.campaign_channels is
  'Per-channel breakdown for a campaign that runs across more than one channel. Leads/quotes/bookings/spend per channel are derived from campaign_touchpoints.channel and campaign_spend_entries, never stored here.';

create index if not exists campaign_channels_campaign_idx on public.campaign_channels (campaign_id);
create index if not exists campaign_channels_agency_idx on public.campaign_channels (agency_id);

drop trigger if exists campaign_channels_set_updated_at on public.campaign_channels;
create trigger campaign_channels_set_updated_at
  before update on public.campaign_channels
  for each row execute function public.set_updated_at();

alter table public.campaign_channels enable row level security;

drop policy if exists "staff read campaign_channels" on public.campaign_channels;
create policy "staff read campaign_channels" on public.campaign_channels
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write campaign_channels" on public.campaign_channels;
create policy "staff write campaign_channels" on public.campaign_channels
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));

-- ─────────────────────────────────────────────────────────────────────────────
-- E. campaign_experiments / campaign_experiment_variants — schema reserved
--    for V2; no UI in V1.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.campaign_experiments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,

  hypothesis text not null,
  primary_metric text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'RUNNING', 'COMPLETE')),
  decision text,
  notes text,
  started_at timestamptz,
  ended_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists campaign_experiments_campaign_idx on public.campaign_experiments (campaign_id);
create index if not exists campaign_experiments_agency_idx on public.campaign_experiments (agency_id);

alter table public.campaign_experiments enable row level security;

drop policy if exists "staff read campaign_experiments" on public.campaign_experiments;
create policy "staff read campaign_experiments" on public.campaign_experiments
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write campaign_experiments" on public.campaign_experiments;
create policy "staff write campaign_experiments" on public.campaign_experiments
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));

create table if not exists public.campaign_experiment_variants (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  experiment_id uuid not null references public.campaign_experiments (id) on delete cascade,

  variant_label text not null,
  description text,
  audience_split_pct numeric(5, 2),
  result_summary text,

  created_at timestamptz not null default now()
);

create index if not exists campaign_experiment_variants_experiment_idx on public.campaign_experiment_variants (experiment_id);
create index if not exists campaign_experiment_variants_agency_idx on public.campaign_experiment_variants (agency_id);

alter table public.campaign_experiment_variants enable row level security;

drop policy if exists "staff read campaign_experiment_variants" on public.campaign_experiment_variants;
create policy "staff read campaign_experiment_variants" on public.campaign_experiment_variants
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write campaign_experiment_variants" on public.campaign_experiment_variants;
create policy "staff write campaign_experiment_variants" on public.campaign_experiment_variants
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));

-- ─────────────────────────────────────────────────────────────────────────────
-- F. AI Insights — add CAMPAIGN as a subject_type so Campaign Diagnosis
--    reuses the existing insights/insight_evidence/insight_outcomes engine
--    (supabase/migrations/20261022090000_ai_insights.sql) instead of a new
--    AI system.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.insights drop constraint if exists insights_subject_type_check;
alter table public.insights add constraint insights_subject_type_check
  check (subject_type in ('LEAD', 'PILGRIM', 'DEPARTURE_GROUP', 'SURVEY_RESPONSE', 'AGENT', 'CAMPAIGN'));

notify pgrst, 'reload schema';
