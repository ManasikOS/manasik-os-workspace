# Campaigns Module — Command Center Implementation Plan

Turn **Campaigns** from a spend/leads/bookings/revenue reporting page into the thing it should be:
the place a marketing manager plans, launches, tracks, attributes, and learns from demand-generation
plays that fill real, profitable departures.

Status: **V1 implemented** (schema, marketing-access RBAC, repository metrics, AI diagnosis generators, list/create/detail UI —
see `supabase/migrations/20261027090000_campaigns_command_center.sql`). **V2 mostly implemented**: Audience tab (eligible/excluded
breakdown), Channels tab, Content tab, Experiments tab are live on the campaign detail page. Still open from V2: the
past-pilgrim-reactivation Audience filter preset and automatic `campaign_touchpoints` creation from web-form/WhatsApp
click-to-chat leads (both flagged as follow-up tasks — see git history for details).

**V3 implemented, with one real caveat**: weighted/time-decay attribution + a new Attribution tab (first/last/assisted
touchpoint lists, and a channel-level weighted-collected-revenue breakdown —
`getCampaignWeightedAttribution` in `lib/data/campaigns-repository.ts`); AI-assisted audience proposals and content
drafting via a new `lib/copilot/marketing/*` module reusing the existing OpenRouter client
(`lib/copilot/sales/llm/openrouter.ts`) — draft-only, gated behind `manageCampaigns`, never writes anything without an
explicit human click; and full Meta Ads / Google Ads OAuth connection scaffolding (`lib/ads/*`,
`lib/data/ads-integrations-repository.ts`, `supabase/migrations/20261029090000_campaigns_ad_platform_integrations.sql`,
connect cards under Settings → Integrations, `/api/oauth/{meta-ads,google-ads}/{start,callback}`) plus a per-channel spend
sync (`syncCampaignChannelSpendAction`) that pulls daily spend into `campaign_spend_entries` tagged by source. **The
caveat**: none of the ad-platform code can actually connect to anything until real credentials are supplied —
`META_ADS_APP_ID`/`META_ADS_APP_SECRET` (Meta app with `ads_read`, approved by Meta) and
`GOOGLE_ADS_CLIENT_ID`/`GOOGLE_ADS_CLIENT_SECRET`/`GOOGLE_ADS_DEVELOPER_TOKEN` (Google Ads API access, approved by
Google) — see `.env.example`. Until then the connect cards show "not configured" and the buttons are disabled; this is
by design, not a bug.

Product rule the whole plan enforces:

> **A campaign is a commercial growth initiative, not an ad container.** It must be linkable to a
> real Package/Departure Group, must respect Audience consent, must show quote/booking/collection
> outcomes (not just leads), and must never let marketing promote inventory that Operations cannot
> deliver.

This plan follows the same shape as [`leads-module-implementation-plan.md`](leads-module-implementation-plan.md)
and reuses architecture already proven in this repo — it does **not** invent a new access pattern,
a new AI pattern, or a new Audience/consent engine. Three existing systems are extended, not replaced:
Audiences + Announcements (targeting/consent), AI Insights (deterministic diagnosis), and
`agent_proposals` (any AI action that needs human approval before it fires).

---

## 1. What exists today

### 1.1 File inventory

| Area | File | State |
|---|---|---|
| Route (list) | `app/(main)/campaigns/page.tsx` | Working, Supabase-backed |
| Route (detail) | `app/(main)/campaigns/[campaignId]/page.tsx` | Working, 4 tabs: Overview/Leads/Bookings/Performance |
| Actions | `app/(main)/campaigns/actions.ts` | Create/update campaign, log spend, `setLeadCampaignAction` |
| List UI | `app/(main)/campaigns/components/campaigns-list-view.tsx` | Flat table + create dialog |
| Detail UI | `app/(main)/campaigns/[campaignId]/components/campaign-detail-view.tsx` | Tabs |
| Data layer | `lib/data/campaigns-repository.ts` | `listCampaignsWithMetrics`, live-joined metrics |
| Types | `lib/types/campaigns.ts` | `CampaignRow`, `AttributionType`, `CampaignChannel` |
| Schema | `supabase/migrations/20261013090000_campaigns.sql` | `campaigns`, `campaign_spend_entries`, adds `campaign_id`/`utm_*`/`attribution_type` to `leads` and `departure_group_bookings` |

### 1.2 What is already good and must be kept

- **Metrics computed live, never stored.** `listCampaignsWithMetrics` joins `leads`, `departure_group_bookings`,
  and sums `campaign_spend_entries` on every read — the same "derive, don't cache" convention used by
  `departure_groups.available_seats` (a generated column) and `audiences.computed_count`. Keep this
  pattern for every new metric this plan adds; never write a cron job that pre-aggregates campaign KPIs.
- **Attribution is deliberate, never inferred.** `setLeadCampaignAction` is an explicit staff action that
  writes `leads.campaign_id` + `leads.attribution_type` (`DIRECT`/`ASSISTED`/`UNKNOWN`). Nothing today
  guesses attribution from UTM strings automatically — this is correct for v1 and should stay correct;
  automatic first/last-touch derivation (§5) is additive, not a replacement.
- **Append-only spend log** (`campaign_spend_entries`) instead of a single mutable `actual_spend_amount`
  column — preserves who logged what spend and when. Keep this shape for any new cost entries (e.g.
  discount cost, agent commission) rather than collapsing them into one field.
- **`leads` already carries full UTM + campaign attribution columns** (`campaign_id`, `utm_source/medium/campaign/content/term`,
  `attribution_type`) and `departure_group_bookings` already carries `campaign_id` + `attribution_type`.
  This plan does not need to touch `leads` or `departure_group_bookings` schema for attribution — it needs
  to (a) extend `campaigns` itself, (b) close the **quotes gap** (see F1), and (c) add the
  offer/audience/channel/experiment tables that don't exist yet.

---

## 2. Findings — the gap between today and the specification

### 2.1 Architecture

**F1 — Quotes are invisible to campaigns.** `campaigns-repository.ts` hardcodes `quoteCount: 0` with a
comment that `lead_quotes` has no `campaign_id`. Per the package/departure master plan, **do not add a
new `quotes` table or a `campaign_id` column duplicated onto `lead_quotes`** — derive it transitively:
`lead_quotes.lead_id → leads.campaign_id`. This is a one-line join fix, not a migration, and it is the
single highest-value fix in this plan: without it, the "quote-to-booking bottleneck" diagnosis in the
brief (§ Example 1) is structurally impossible.

**F2 — No link from a campaign to a real Package or Departure Group.** `campaigns` has no
`linked_package_id` / `linked_departure_group_id`. This is the second-highest-value gap: without it,
"campaign promotes a departure that is full/at-risk" (capacity protection) cannot exist at all, because
the campaign has no idea which group it's selling.

**F3 — No Audience link.** A campaign today has no concept of *who* it's targeting beyond a free-text
`utm_source`. The Audiences module (`lib/data/audiences-repository.ts`, `audiences` /
`audience_members`) already exists and is already consumed by Announcements for consent-safe broadcast —
Campaigns should reference it (`campaigns.audience_id`), not reimplement targeting.

**F4 — No Channel breakdown.** `campaigns.channel` is a single enum value per campaign. The brief's
per-channel comparison (WhatsApp vs Facebook vs QR vs Referral, each with its own spend/leads/CPL) needs
a child table, not a wider `campaigns` row.

**F5 — No dedicated `marketing` capability module.** Campaigns borrows Leads'
`capabilitiesForLeads(role).manageSourcesAndAutomation`. `docs/remaining-modules-master-plan.md` §6
already specifies a `marketing` module (`viewModule, manageCampaigns, editSpend, manageAudiences,
useAudienceForBroadcast, manageContent, approveContent, manageReferralRules, approveRewards,
viewAttribution`) that was never built. This plan requires it — campaign budget changes, discount
approval, and audience export all need their own gate, distinct from Leads.

**F6 — No AI diagnosis layer.** Nothing in Campaigns talks to `lib/insights/generators/*`. The AI
Insights module (`insights` / `insight_evidence` / `insight_outcomes`, deterministic, no LLM call) is the
correct home for "Campaign Diagnosis" per the brief — not a new system.

**F7 — No experiments, no content/asset registry, no capacity/cutoff alerts.** All absent today; see §7–§9.

### 2.2 Domain model gaps (brief requirement → current state → gap)

| Brief requirement | Today | Gap |
|---|---|---|
| Campaign type (Ramadan Umrah, Hajj Pre-registration, Referral, …) | Only `channel` enum exists | Add `campaign_type` enum, separate from channel |
| Objective (generate leads / fill departure / collect deposits / …) | Absent | Add `objective` enum; drives which KPI is primary on Overview |
| Linked package / departure group | Absent | Add `linked_package_id`, `linked_departure_group_id` |
| Target seats / target bookings / target revenue / target margin | Absent | Add `target_*` columns |
| Booking cutoff date | Absent | Add `booking_cutoff_at` |
| Audience link + exclusion reasons | Absent | Add `audience_id`; reuse `audience_members.reason` pattern for exclusions |
| Per-channel spend/leads/CPL | Single channel + single spend total | Add `campaign_channels` child table |
| Content/template/tracking-link/QR registry | Absent | Add `campaign_assets`, `campaign_tracking_links` |
| Attribution touchpoints (first/last/assisted) with confidence | Only a manually-set `attribution_type` per lead | Add `campaign_touchpoints` table + confidence enum |
| Quotes tab / quote-to-booking conversion | `quoteCount` hardcoded 0 | Fix via join (F1) |
| Gross margin / collected vs booked revenue | Only `revenue` (booked) and `collected` exist | Add margin estimate calc using package cost data already on `packages`/`departure_group_costing` |
| Capacity/cutoff/margin risk alerts | Absent | Deterministic checks, same shape as AI Insights generators but simpler — plain workflow alerts (§8), not AI |
| Experiments (A/B variant tracking) | Absent | Add `campaign_experiments` / `campaign_experiment_variants` (v2, not v1) |
| Campaign lifecycle states incl. "At Risk", "Capacity Full" | `DRAFT/SCHEDULED/ACTIVE/PAUSED/COMPLETED/ARCHIVED` exists | These six are sufficient for `status`; "At Risk"/"Capacity Full"/"Budget Exhausted" should be **derived alert flags**, not additional `status` enum values — do not let two state machines fight over what "active" means |
| AI diagnosis with evidence | Absent | New `insight_type`s + generator, reusing `insights`/`insight_evidence`/`insight_outcomes` (F6) |

### 2.3 Screen gaps

**Campaigns list**
- Only 10 flat columns, no saved views. Brief wants views like `Filling Departures`, `Hajj Campaigns`,
  `At Risk`, `High ROI` — these are filter presets over existing/new columns, not new backend concepts.
- No package/departure/audience columns because the link doesn't exist yet (F2/F3).
- No cost-per-qualified-lead / cost-per-booking columns (need quote fix F1 + spend join, already available).

**Campaign creation**
- Today: single dialog (name/channel/dates/budget/notes). Brief wants a 7-step flow
  (Goal → Offer → Audience → Channels → Content → Budget/Attribution → Review). Recommendation: **do
  not build a 7-screen wizard in v1.** Ship v1 as a **Sheet with 4 grouped sections** (Goal+Type,
  Offer/Package link, Audience link, Budget) — consistent with how `leads-module-implementation-plan.md`
  chose a Sheet over a full-page wizard for Add Lead. Defer the full step-by-step wizard, multi-channel
  breakdown, and content/asset attachment to v2, once there's more than one field to fill per step.

**Campaign detail**
- Today: Overview / Leads / Bookings / Performance (4 tabs). Brief wants Overview / Performance / Leads /
  Quotes / Bookings / Revenue & Margin / Audience / Channels / Content / Experiments / Activity / AI
  Analysis (12 tabs). Recommendation: **v1 ships 6 tabs** — Overview, Leads, Quotes, Bookings, Revenue &
  Margin, AI Analysis — folding Performance's funnel chart into Overview and deferring
  Audience/Channels/Content/Experiments/Activity as their own tabs to v2 (their data mostly doesn't
  exist yet — see §7/§9 — so a tab with nothing in it is worse than no tab).

---

## 3. Target data model

New tables (additive migrations only, following the house convention: `agency_id` FK + default +
index, RLS `staff read`/`staff write` policies scoped to `ADMIN, CEO, MARKETING` [+`OPERATIONS`
where capacity data is read], `updated_at` trigger, ends with `notify pgrst, 'reload schema';`).

### 3.1 Extend `campaigns` (new migration, alters existing table)

```sql
alter table public.campaigns
  add column campaign_type text not null default 'CUSTOM',
  add column objective text not null default 'GENERATE_ENQUIRIES',
  add column linked_package_id uuid references public.packages(id),
  add column linked_departure_group_id uuid references public.departure_groups(id),
  add column audience_id uuid references public.audiences(id),
  add column booking_cutoff_at timestamptz,
  add column target_leads integer,
  add column target_qualified_leads integer,
  add column target_quotes integer,
  add column target_bookings integer,
  add column target_seats integer,
  add column target_collected_revenue numeric(14,2),
  add column target_margin_pct numeric(5,2),
  add column approval_status text not null default 'DRAFT'; -- DRAFT/PENDING_APPROVAL/APPROVED
```

`campaign_type` values: `PACKAGE_LAUNCH, DEPARTURE_FILL, RAMADAN_UMRAH, HAJJ_PRE_REGISTRATION,
HAJJ_EDUCATION, EARLY_BIRD, SCHOOL_HOLIDAY_UMRAH, FAMILY_UMRAH, WOMENS_GROUP_UMRAH,
SENIOR_FRIENDLY_UMRAH, REFERRAL_PROGRAM, PAST_PILGRIM_REACTIVATION, VISA_DOCUMENT_DEADLINE,
EVENT_ROADSHOW, PARTNER_AGENT, CONTENT_EDUCATION, CUSTOM`. `objective` values: `GENERATE_ENQUIRIES,
GENERATE_QUALIFIED_LEADS, GENERATE_QUOTES, GENERATE_BOOKINGS, COLLECT_DEPOSITS,
COLLECT_FULL_PAYMENT, FILL_DEPARTURE, REACTIVATE_PAST_PILGRIMS, GENERATE_REFERRALS, PROMOTE_EVENT,
INCREASE_REPEAT_BOOKINGS`. Both as plain `text` + `check (... in (...))`, matching how `CampaignRow.status`
and `CampaignRow.channel` are already declared in `lib/types/campaigns.ts` — do not introduce a Postgres
`enum` type where the rest of the schema uses `text + check`.

### 3.2 New table: `campaign_channels` (replaces single `channel` as source of per-channel truth)

```sql
create table public.campaign_channels (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  channel text not null, -- reuses CampaignChannel enum values
  status text not null default 'ACTIVE',
  owner_id uuid references public.staff(id),
  budget_allocation numeric(14,2),
  tracking_link text,
  asset_id uuid references public.campaign_assets(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Keep `campaigns.channel` as-is (do not drop) for backward compatibility with existing rows / the
current list column — treat it as "primary channel" once `campaign_channels` exists. Per-channel
leads/quotes/bookings/spend are **derived**, joined from `campaign_touchpoints`/`campaign_spend_entries`
filtered by channel — not stored on this row.

### 3.3 New table: `campaign_touchpoints` (attribution)

```sql
create table public.campaign_touchpoints (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  booking_id uuid references public.departure_group_bookings(id) on delete cascade,
  touch_type text not null, -- FIRST / LAST / ASSISTED
  channel text,
  source_detail text,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  tracking_code text,
  attribution_confidence text not null default 'UNKNOWN', -- HIGH/MEDIUM/LOW/UNKNOWN
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
```

This is additive alongside the existing `leads.campaign_id` / `leads.attribution_type` — those two
columns remain the *simple* single-value answer used by today's list/metrics queries; `campaign_touchpoints`
is the detailed multi-touch log used only by the Overview/Performance/AI Analysis tabs. Do not migrate
existing behavior to require this table; it is purely additive.

### 3.4 New table: `campaign_assets`

```sql
create table public.campaign_assets (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  asset_type text not null, -- MESSAGE_TEMPLATE/LANDING_PAGE/BROCHURE/QR_CODE/TRACKING_LINK/CREATIVE/OTHER
  reference_id uuid, -- e.g. points at message_templates.id / whatsapp_templates.id when applicable
  label text not null,
  language text,
  url text,
  qr_code_value text,
  notes text,
  created_at timestamptz not null default now()
);
```

Do **not** create a new template store — `asset_type = MESSAGE_TEMPLATE` points `reference_id` at the
existing `message_templates` / `whatsapp_templates` tables. This table is a campaign-scoped *pointer and
QR/tracking-link registry*, matching the brief's "required campaign assets" list without duplicating
content storage.

### 3.5 New table: `campaign_experiments` + `campaign_experiment_variants` (v2, schema reserved now)

```sql
create table public.campaign_experiments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  hypothesis text not null,
  primary_metric text not null, -- e.g. QUOTE_TO_BOOKING_RATE
  status text not null default 'DRAFT', -- DRAFT/RUNNING/COMPLETE
  decision text,
  notes text,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.campaign_experiment_variants (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  experiment_id uuid not null references public.campaign_experiments(id) on delete cascade,
  variant_label text not null, -- "A" / "B"
  description text,
  audience_split_pct numeric(5,2),
  result_summary text,
  created_at timestamptz not null default now()
);
```

Build the migration in v1 (cheap, additive) but do not build the UI tab until v2 — this avoids a second
migration later and keeps the "Experiments" tab absent (not empty) in v1.

### 3.6 RLS / roles

Every new table: `staff read` = `ADMIN, CEO, MARKETING, OPERATIONS` (Operations needs read access to see
capacity-linked campaigns); `staff write` = `ADMIN, CEO, MARKETING` only. This matches the existing
`campaigns`/`campaign_spend_entries` policies — check the current policy roles in
`20261013090000_campaigns.sql` before writing the new migration and mirror them exactly rather than
guessing the role list.

---

## 4. RBAC — new `marketing` capability module

Add `lib/access/marketing-access.ts` per the shape already used by every other module
(`capabilitiesFor<Module>(role): <Module>Capabilities`, a `NONE` baseline, a `Record<StaffRole, Capabilities>`
map). Per `docs/remaining-modules-master-plan.md` §6:

```ts
interface MarketingCapabilities {
  viewModule: boolean;
  manageCampaigns: boolean;      // create/edit/pause/complete a campaign
  editSpend: boolean;            // log campaign_spend_entries
  manageAudiences: boolean;      // create/edit audiences (if not already gated elsewhere)
  useAudienceForBroadcast: boolean; // link audience to campaign / hand off to Announcements
  manageContent: boolean;        // create campaign_assets
  approveContent: boolean;       // approve a message template / creative before send
  viewAttribution: boolean;      // see campaign_touchpoints / AI Analysis tab
}
```

Migrate `app/(main)/campaigns/actions.ts` off `capabilitiesForLeads(role).manageSourcesAndAutomation`
onto `capabilitiesForMarketing(role).manageCampaigns` / `.editSpend`. Keep `leads.manageCampaignAttribution`
(already listed in the master plan's Leads extension) as the gate for `setLeadCampaignAction` specifically,
since that's a Leads-side mutation, not a Campaigns-side one — don't conflate the two.

---

## 5. Repository changes (`lib/data/campaigns-repository.ts`)

1. **Fix the quote gap (F1).** Add a join: `lead_quotes` inner-joined on `leads.id = lead_quotes.lead_id`
   filtered by `leads.campaign_id = campaign.id`, to populate real `quoteCount`, `acceptedQuoteCount`,
   `quoteValue`. This alone unblocks the Quotes tab and the quote-to-booking conversion metric.
2. **Add capacity read.** When `linked_departure_group_id` is set, join `departure_groups` for
   `capacity, booked_seats, held_seats, available_seats, sales_status, group_status` — read-only, never
   duplicate these numbers onto the campaign row (§ house convention: derive, don't cache).
3. **Add margin estimate.** Compute `estimated_gross_margin = attributed_collected_revenue -
   estimated_direct_cost - marketing_spend`, where `estimated_direct_cost` comes from the linked
   package/departure's existing costing data (`departure_group_costing`/`packages` pricing) times booked
   pax — reuse whatever repository already computes per-pax cost for Departure Profitability reporting
   (check `lib/data/reports-*.ts` / `departure-groups-costing.ts` before writing a new calculation) rather
   than re-deriving margin math from scratch.
4. **Add three attribution view functions**, per the brief's "three views, not multi-touch" rule:
   `listCampaignFirstTouchLeads`, `listCampaignLastTouchLeads`, `listCampaignAssistedLeads` — all reading
   `campaign_touchpoints`, no weighting/decay logic in v1.
5. Keep everything else (spend log, `listCampaignsWithMetrics` shape, `AttributionType`) unchanged —
   additive fields only.

---

## 6. UI changes

### 6.1 List page (`campaigns-list-view.tsx`)

- Add columns (behind a column-visibility control, matching the pattern already specified for Leads in
  `leads-module-implementation-plan.md` §2.3): Campaign type, Objective, Linked package/departure,
  Target seats vs available seats, Quotes, Cost per qualified lead, Cost per booking, Deposits collected.
- Add saved views as filter presets (client-side, no new backend): `Active`, `Upcoming`,
  `Filling Departures` (`linked_departure_group_id is not null and status = ACTIVE`), `Hajj Campaigns`
  (`campaign_type = HAJJ_%`), `Ramadan Campaigns`, `Referral Campaigns`, `Past-Pilgrim Reactivation`,
  `At Risk` (derived flag, §8), `High ROI` (`estimated_gross_margin / spend` above a threshold),
  `Completed`, `Archived`.
- Add filters: campaign type, objective, package, departure group, owner, branch, channel, audience,
  spend range, revenue range, booking count.

### 6.2 Create flow

Replace the single dialog with a 4-section Sheet (see §2.3 recommendation):
1. **Goal** — name, campaign_type, objective, owner, branch, start/end date, notes.
2. **Offer** — linked package, linked departure group (autocomplete showing `available_seats`/`sales_status`
   inline so marketing sees capacity before committing), target seats/bookings/revenue/margin, booking cutoff.
3. **Audience** — pick an existing Audience (link to `/relationships/audiences` if none exists yet — do
   not let campaign creation silently create a new Audience type).
4. **Budget** — budget amount, primary channel, initial spend entry (optional).

Server action: extend `createCampaignAction` in `app/(main)/campaigns/actions.ts` to accept the new
fields; validate `linked_departure_group_id` capacity/status server-side (reject or warn if
`sales_status = SALES_CLOSED` or `available_seats = 0`) before insert — this is the "must not continue
promoting a full departure" rule enforced at the one place that matters (creation/edit), not just as a
later dashboard warning.

### 6.3 Detail page tabs (v1: 6 tabs)

- **Overview** — KPI cards (target vs actual bookings, seats, spend vs budget, qualified leads, quotes,
  bookings, collected vs outstanding, estimated margin, days to cutoff) + the funnel chart (folded in from
  the old Performance tab: Audience eligible → Leads → Qualified → Quotes → Bookings → Deposits) + the
  Campaign Diagnosis card (§7) + an Action Queue list (expiring quotes, bookings awaiting deposit, capacity
  warnings — reuse `insights` rows filtered to `subject_type = CAMPAIGN`).
- **Leads** — table filtered to `leads.campaign_id = this campaign`, reusing the existing Leads table
  columns/components rather than building a parallel leads table.
- **Quotes** — new, powered by the F1 join: quote value, status, expiry, discount requested, room type
  demand, quote→booking conversion.
- **Bookings** — existing tab, extend with deposit status/outstanding amount columns already available
  on `departure_group_bookings`.
- **Revenue & Margin** — new: booked vs collected vs outstanding vs refunds vs spend vs estimated margin,
  labelled precisely per the brief ("booked revenue is not collected revenue" — never merge these into one
  number).
- **AI Analysis** — the Campaign Diagnosis detail view (§7), full evidence list, dismiss/act/resolve
  actions wired to `insight_outcomes`.

Defer to v2: Audience tab (eligible/excluded breakdown), Channels tab, Content tab, Experiments tab,
Activity tab — each needs `campaign_channels`/`campaign_assets`/`campaign_experiments` populated by real
usage first; an empty tab is worse than no tab.

---

## 7. AI layer — "Manasik Marketing Intelligence"

**Do not build a fourth AI pattern.** This repo already has three (found during codebase review):

1. `lib/insights/generators/*` + `insights`/`insight_evidence`/`insight_outcomes` — deterministic,
   rule-based, no LLM call, human-reviewable evidence + outcome trail. **This is the correct home for
   Campaign Diagnosis** — the brief's own examples (Example 1: response-time bottleneck; Example 2:
   capacity conflict; Example 3: lead-quality vs revenue) are all arithmetic over existing tables, not
   generative reasoning.
2. `lib/copilot/sales/*` — LLM-backed, embedded in the Lead Drawer, draft-only. Not the right place for
   campaign-level diagnosis (it's lead-scoped), but *is* the right place if content drafting/translation
   (brief's "Content and channel analysis" / draft WhatsApp copy) is added in v2 — reuse this, don't build
   a second LLM integration.
3. `lib/agent/kernel/proposals/*` + `agent_proposals` — the approval-gate kernel for any AI output that
   could become an action (pause a campaign, reallocate budget). **Required** if v2/v3 ever lets the AI
   suggest "pause this campaign" as a one-click action — route it through `agent_proposals`, not a new
   approve/reject UI.

### 7.1 v1: extend AI Insights, not a new module

- Add `"CAMPAIGN"` to `InsightSubjectType` in `lib/types/insights.ts`.
- Add generator file `lib/insights/generators/campaign-diagnosis.ts`, registered in the `GENERATORS`
  array in `insights-repository.ts`, following the exact shape of `stalled-leads.ts` (pure function,
  `(client) => GeneratedInsight[]`, no model call).
- Insight types to implement first (each maps directly to a brief example):
  - `CAMPAIGN_QUOTE_RESPONSE_BOTTLENECK` — qualified leads with no quote after N hours vs campaign's
    median response time (Example 1).
  - `CAMPAIGN_CAPACITY_CONFLICT` — enquiries for a room type/departure exceeding
    `available_seats`/room inventory for that type (Example 2). This generator reads
    `departure_groups.available_seats` and room-level capacity — never invent a number the DB already
    derives.
  - `CAMPAIGN_LOW_REVENUE_QUALITY` — low cost-per-lead campaigns whose quote-to-booking rate or average
    booked value is materially below the agency's average for the same period/package (Example 3).
  - `CAMPAIGN_BUDGET_AT_RISK` — spend pacing vs days remaining vs bookings pacing.
  - `CAMPAIGN_BOOKING_CUTOFF_APPROACHING` — `booking_cutoff_at` within N days with seats still unbooked.
- Severity/evidence/outcome machinery, idempotency key (`agency_id, insight_type, subject_type='CAMPAIGN', subject_id`),
  and "terminal statuses don't silently reopen" behavior are all inherited automatically from the existing
  `insights-repository.ts` — do not reimplement any of it.
- Surface: small "Campaign Diagnosis" card on the Overview tab (§6.3) reading the latest OPEN insight for
  this campaign; full list + evidence + dismiss/resolve on the AI Analysis tab.

### 7.2 What the agent must never do (from the brief, directly enforceable in code review)

Hard rule for every generator and any future LLM-backed feature under this module: it may **read** and
**diagnose**, and it may **draft** (content, audience filter, experiment note) for a human to review — it
must never call `sendWhatsAppBroadcast`, `updateCampaignBudget`, `applyDiscount`, `holdSeats`, or any
booking-mutating action directly. Any output that could become such an action must go through
`agent_proposals` with an explicit human-approval step, per the Departure Ops Agent's existing pattern —
do not add a second, softer approval mechanism for Marketing.

### 7.3 v2/v3 (explicitly deferred)

Audience opportunity analysis, offer/capacity analysis surfaced as an "Offer" tab widget, content/channel
A/B comparison tied to `campaign_experiments`, and any LLM-generated audience proposal or content draft —
all deferred until v1's deterministic diagnosis is live and campaign data (touchpoints, channels, assets)
is actually being populated by real usage. Building the AI layer before the data model exists produces
the exact "AI says you have 35 leads" shallow feature the brief explicitly warns against.

---

## 8. Deterministic workflow alerts (not AI)

Separate from `insights` (which are diagnostic and dismissible), add a small set of hard validation
checks enforced at write time in `app/(main)/campaigns/actions.ts`:

- Reject/warn on creating or activating a campaign whose `linked_departure_group_id` has
  `sales_status = SALES_CLOSED` or `available_seats = 0`.
- Warn (non-blocking) if `booking_cutoff_at` is within, e.g., 7 days at campaign activation.
- Warn if `actual_spend_amount` (sum of `campaign_spend_entries`) exceeds `budget_amount`.
- Warn if a campaign has no `audience_id` and no `campaign_assets` row at the point of moving from
  `DRAFT` to `SCHEDULED`/`ACTIVE` ("no eligible audience" / "no linked content" from the brief's alert list).

These are plain `if` checks returning `{ ok: false, error }` from the existing pure-mutator pattern
(`lib/data/leads.ts` mutators are the reference shape) — they are not insights, do not need evidence
rows, and must not be implemented as a fifth AI-adjacent system.

---

## 9. Phased build

### Version 1 — connected campaign record (this plan's primary scope)
- Extend `campaigns` schema (§3.1), add `campaign_touchpoints`, `campaign_assets` (§3.3–3.4), migration for
  `campaign_channels`/`campaign_experiments` schema (built, not yet surfaced in UI).
- `lib/access/marketing-access.ts` (§4).
- Repository: quote join fix (F1), capacity read, margin estimate, three attribution views (§5).
- UI: extended list + saved views + filters (§6.1), 4-section create Sheet (§6.2), 6-tab detail page (§6.3).
- AI: `CAMPAIGN` insight subject type + 5 generators (§7.1).
- Deterministic alerts (§8).

### Version 2 — operational marketing workflows
- Audience tab (eligible/excluded breakdown reusing Audiences' consent-exclusion pattern), Channels tab
  (`campaign_channels` UI), Content tab (`campaign_assets` UI, WhatsApp template approval flow tying into
  the existing `message_templates`/`whatsapp_templates` approval state), Experiments tab.
- Automatic lead creation from web forms / WhatsApp click-to-chat into `campaign_touchpoints` (webhook,
  not manual entry).
- Past-pilgrim reactivation as a first-class `campaign_type` with a matching Audience filter preset.

### Version 3 — channel and AI depth
- Meta/Google ad-platform conversion integrations (spend + conversion feed instead of manual
  `campaign_spend_entries`).
- LLM-backed audience proposal and content drafting (reusing `lib/copilot/sales/*`'s pattern), gated by
  `agent_proposals` for anything actionable.
- Configurable weighted/time-decay attribution, once `campaign_touchpoints` has enough clean data.

---

## 10. Non-goals (explicitly out of scope, per the brief's own restraint)

- No in-house ad-platform manager (Meta/Google Ads clone).
- No new `quotes` or `bookings` table — always derive through `lead_quotes` / `departure_group_bookings`.
- No new AI/LLM system for diagnosis — deterministic generators only in v1.
- No automatic sending, budget change, discount application, seat hold, or booking creation by the AI
  layer, ever, without an explicit human action through the existing approval-gate pattern.
- No multi-touch weighted attribution in v1 — first/last/assisted views only.

---

## 11. Before writing code

Per `AGENTS.md`, skim `node_modules/next/dist/docs/01-app` for Server Actions / `revalidatePath` /
async-`params`/`cookies()` notes — the existing Campaigns/Leads/Packages routes already follow the
async-params convention correctly; match it exactly in every new file this plan adds rather than copying
patterns from memory of standard Next.js.
