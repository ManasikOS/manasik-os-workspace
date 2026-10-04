# Leads Module — Implementation Plan

Bring **Leads** up to the sales-command-centre specification, and onto the same data, access and
action architecture already used by **Departure Groups** and **Packages**.

Status: **plan only. Nothing in here is implemented.**

Product rule the whole plan enforces:

> **Leads manage interest and follow-up. Bookings reserve seats. Departure Groups execute the journey.**
> A Lead must never decrement `departure_groups.available_seats`. Only a Booking does.

---

## 1. What exists today

### 1.1 File inventory

| Area | File | Lines | State |
|---|---|---|---|
| Route | `app/(main)/leads/page.tsx` | 42 | Server Component, `force-dynamic`, loads **seed** store |
| Client store | `app/(main)/leads/leads-store.tsx` | 241 | In-browser mutable store, context provider |
| Row types | `lib/types/leads.ts` | 153 | Well-shaped snake_case row types (no table behind them) |
| View models | `lib/data/leads.ts` | 711 | Row→view mapping + pure mutators + duplicate finder |
| Seed | `lib/data/leads-seed.ts` | 655 | Hardcoded staff, packages, leads, activity |
| UI types | `app/(main)/leads/types.ts` | 122 | Saved views, filters, KPI shape, add-lead form shape |
| Utils | `app/(main)/leads/utils.ts` | 622 | Labels, tones, formatters, sorting, filtering, KPIs |
| List | `components/leads-list.tsx` | 617 | Header, KPIs, saved views, filter chips, table, bulk bar |
| Table | `leads-table/*` | ~700 | Columns, sortable headers, data table, sort menu |
| Drawer | `components/lead-drawer.tsx` | 458 | Sheet: header, actions, follow-up, cards, stage bar, activity |
| Add lead | `add-new-lead/*` | ~1,100 | Sheet with 5 sections + duplicate check + preview card |
| Dialogs | `log-contact-dialog`, `mark-lost-dialog`, `import-leads-dialog` | — | Working |
| Export | `csv.ts` | — | `leadsToCsv`, `timestampedFilename` |

### 1.2 What is already good and must be kept

- **Row-vs-view-model separation.** `lib/types/leads.ts` (rows) → `lib/data/leads.ts` (view models).
  No component reaches past `app/(main)/leads/types.ts`. This is the right shape; the DB swap
  should not touch it.
- **Derived, not stored, follow-up status.** `followUpStatusFor()` computes `OVERDUE / TODAY /
  UPCOMING` from `next_follow_up_at` against a clock (`lib/data/leads.ts:127`). A stored status
  would go stale. Keep this — it means "overdue" needs **no** cron job, only the *notification* does.
- **Colombo-calendar day maths** (`colomboDayDiff`, `colomboDayKey`) so server render and hydration
  agree. Keep.
- **Pure mutators** returning `{ ok, error }` — they lift straight into Server Actions unchanged.
- **`nextLeadReference()`** derives `LD-YYYY-NNNN` from the highest existing number, not random.
- **Mobile normalisation** (`normaliseMobile`) so `0771234567` / `+94 77 123 4567` / `94771234567`
  all collapse to one comparable key. This is the backbone of duplicate detection.
- Table shell, sortable headers, filter chips, bulk bar, CSV export, import dialog, discard-confirm.

---

## 2. Findings — the gap between today and the specification

### 2.1 Architecture

**F1 — Leads is the only module with no database.** Packages and Departure Groups both run on
Supabase (`lib/data/packages-repository.ts:125`, `lib/data/departure-groups.ts:176`). Leads runs on
`createLeadStore()` from a seed file, mutated **in the browser**. Every lead created is lost on
refresh, invisible to other staff, and impossible to report on. This is the single blocking defect —
nothing else in the spec (automation, analytics, conversion, AI) can exist without it.

**F2 — No access control.** There is no `lib/access/leads-access.ts`. The spec defines a six-role
matrix (Admin / CEO / Marketing-Sales / Finance / Visa-Operations / Guide). Today any authenticated
user can do everything, and `page.tsx:30` hardcodes `currentStaff = LEAD_STAFF[0]`.

**F3 — Staff and packages are fiction.** `LEAD_STAFF` is six hardcoded names; `LEAD_PACKAGES` is a
hardcoded catalogue with a single `price_per_person_lkr`, unrelated to the real `packages` table
(which has `quad_price / triple_price / double_price / single_price / child_price / infant_price`).
Every estimated value in the module is therefore wrong by construction.

**F4 — No link to Departure Groups.** The lead row has no `departure_group_id`, no `booking_id`.
"Find Available Groups", the quote, and "Convert to Booking" have nothing to hang on.

**F5 — No validation module.** Packages and Departure Groups both have `lib/validations/*.ts` shared
by client and Server Action. Leads validates ad hoc inside the mutators.

### 2.2 Domain model gaps

| Spec requirement | Today | Gap |
|---|---|---|
| Stages incl. `POSTPONED`, `DUPLICATE`, `SPAM` | 9 stages, has `CONVERTED` **and** `BOOKED` | 3 stages missing; `CONVERTED` is a duplicate of `BOOKED` and must be collapsed |
| Room preference (Quad/Triple/Double/Single) | absent | drives quote price and booking conversion — must be added |
| Preferred contact channel | absent | in spec Step 2 |
| Estimated value from room price × travellers | `price_per_person_lkr × travellers` | must use real room-type price from package/group |
| 10 lost reasons | 7, differently named | remap (`PRICE_TOO_HIGH`, `DATE_UNAVAILABLE`, `NO_SEATS`, `COMPETITOR`, `VISA_CONCERN`, `NO_RESPONSE`, `POSTPONED`, `PAYMENT_ISSUE`, `DUPLICATE`, `OTHER`) |
| Multiple internal notes with authors | one `notes` text column | notes must become rows |
| 14 timeline event types | 8 | add `QUOTE_SENT`, `PACKAGE_SUGGESTED`, `GROUP_SELECTED`, `FOLLOW_UP_COMPLETED`, `DEPOSIT_REQUESTED`, `BOOKING_CREATED`, `POSTPONED`, `MERGED`, `IMPORTED` |
| `Mosque Event` source, configurable sources | fixed `COMMUNITY_EVENT` enum, not configurable | spec has "Manage Lead Sources" |
| Campaign / reference | present | keep |

### 2.3 Screen gaps

**Leads list**
- KPI cards are **not clickable filters** and carry no "+18% vs previous 30 days" delta. Spec wants
  4 clickable cards + optional pipeline-value card for CEO/Marketing.
- Saved views are 6 generic ones (`All / My / Needs Action / Hot Pipeline / Untouched / Closed`).
  Spec names 12 (`New Today`, `Follow-up Today`, `Overdue Follow-ups`, `High-Value Leads`,
  `Deposit Pending`, `Unassigned Leads`, `Postponed Leads`, `Lost This Month`, `Duplicate Review`…).
- Missing columns: **Desired Package** as its own column, and every optional/toggleable column
  (traveller count, source, last contact, preferred period, budget, selected departure group,
  created date, temperature, campaign, lost reason). There is **no column-visibility control**.
- `More ▾` menu has Import/Export only — missing *Manage Lead Sources*, *Saved Views*,
  *Duplicate Review Queue*.
- Missing filters: Package, Source is behind "More", no Follow-up Status parity with spec labels.

**Add Lead**
- Spec calls for a **dialog** with 5 steps; today it is a one-scroll Sheet with 5 sections. The Sheet
  is consistent with `create-departure-group-sheet.tsx` and is *not* a full page, so it meets the
  intent — **recommendation: keep the Sheet**, but make Step 1 (duplicate check) a real gate.
- Duplicate check matches **leads only**, in-browser. Spec requires matching against pilgrim /
  customer records too, and offers *Open existing* / *Merge (admin)* / *Create anyway with reason*.
  `duplicateReason` / `createAnyway` exist on the form type but are never enforced or persisted.
- Room preference and preferred contact channel fields do not exist.

**Lead drawer**
- Missing quick actions: **Send Quote**, **Set Follow-up**, **Add Note**. WhatsApp is not visually
  the primary action.
- No overdue banner with `[Complete] [Reschedule]`.
- Notes render a single static paragraph; no add-note affordance.
- No package recommendation card, no "Find Available Groups", no quote preview, no convert-to-booking
  panel.

**Everything from spec §5 onward is absent**: quote builder, conversion, automation, analytics, AI.

---

## 3. Target architecture

Mirrors Departure Groups exactly, so there is one way to do things in this codebase.

```
supabase/migrations/
  2026XXXX_create_leads.sql          -- tables, enums, indexes, RLS, triggers

lib/types/leads.ts                   -- row types (extend, don't rewrite)
lib/access/leads-access.ts           -- LeadCapabilities + capabilitiesForLeads(role)
lib/validations/leads.ts             -- zod schemas + toLeadFieldErrors()
lib/data/leads.ts                    -- pure mutators + row→view mapping (KEEP AS IS)
lib/data/leads-repository.ts         -- Supabase load/persist, the only file that talks SQL
lib/data/leads-quotes.ts             -- quote build + pricing from package/group snapshots
lib/data/leads-conversion.ts         -- lead → booking, delegating to departure-groups-bookings
lib/data/leads-analytics.ts          -- source/conversion aggregates

app/(main)/leads/
  page.tsx                           -- role gate + server-side fetch + filtering
  actions.ts                         -- "use server", every mutation, capability-checked
  leads-store.tsx                    -- becomes a thin action-caller + router.refresh()
  components/…                       -- existing + new (see §4)
  insights/page.tsx                  -- analytics sub-tab (phase 8)
```

### 3.1 Schema sketch

```sql
create type lead_stage as enum (
  'NEW_LEAD','CONTACTED','QUALIFIED','PROPOSAL_SENT','NEGOTIATION',
  'DEPOSIT_PENDING','BOOKED','LOST','POSTPONED','DUPLICATE','SPAM');

create type lead_room_preference as enum ('QUAD','TRIPLE','DOUBLE','SINGLE','UNDECIDED');
create type lead_contact_channel  as enum ('WHATSAPP','CALL','EMAIL','SMS','IN_PERSON');

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,                    -- LD-YYYY-NNNN
  full_name text not null,
  mobile text not null,                              -- normalised 9 digits
  whatsapp text,
  email text,
  city text not null,
  preferred_language text not null,
  preferred_channel lead_contact_channel not null default 'WHATSAPP',

  journey_type text not null,
  interested_in text not null,
  desired_package_id uuid references public.packages (id) on delete set null,
  desired_package_name text,                         -- snapshot
  preferred_period text,
  adults int not null default 1 check (adults >= 1),
  children int not null default 0,
  room_preference lead_room_preference not null default 'UNDECIDED',
  departure_city text,
  budget_range text,
  quota_waitlist_interest boolean not null default false,

  source_id uuid references public.lead_sources (id),
  campaign_reference text,
  referral_name text,
  referred_pilgrim_id uuid,
  assigned_to uuid references auth.users (id),
  stage lead_stage not null default 'NEW_LEAD',
  temperature text not null default 'WARM',
  estimated_value_lkr bigint not null default 0,

  -- Sales-cycle links. Nullable until the customer commits.
  selected_departure_group_id uuid references public.departure_groups (id) on delete set null,
  booking_id uuid references public.departure_group_bookings (id) on delete set null,

  next_follow_up_at timestamptz,
  follow_up_type text,
  follow_up_owner uuid references auth.users (id),
  first_response_at timestamptz,                     -- for first-response-time analytics
  last_contacted_at timestamptz,
  follow_up_attempts int not null default 0,

  lost_reason text, lost_note text,
  postponed_until date,
  duplicate_of_lead_id uuid references public.leads (id) on delete set null,
  duplicate_override_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lead_sources (           -- "Manage Lead Sources"
  id uuid primary key default gen_random_uuid(),
  code text not null unique, label text not null,
  active boolean not null default true, sort_order int not null default 0);

create table public.lead_activity (          -- immutable timeline
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  type text not null, message text not null,
  actor_id uuid, actor_name text not null,
  metadata jsonb, created_at timestamptz not null default now());

create table public.lead_notes (             -- internal only, never portal-visible
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  body text not null, author_id uuid, author_name text not null,
  created_at timestamptz not null default now());

create table public.lead_quotes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  reference text not null unique,             -- QT-YYYY-NNNN
  package_id uuid, departure_group_id uuid,
  pricing_snapshot jsonb not null,            -- room price, deposit, milestones AT SEND TIME
  adults int not null, children int not null, room_preference lead_room_preference not null,
  total_lkr bigint not null, deposit_lkr bigint not null,
  valid_until timestamptz not null,
  sent_via text, sent_at timestamptz,
  created_by uuid, created_at timestamptz not null default now());

create index leads_stage_followup_idx on public.leads (stage, next_follow_up_at);
create index leads_assigned_idx       on public.leads (assigned_to, stage);
create index leads_mobile_idx         on public.leads (mobile);
create index leads_email_idx          on public.leads (lower(email));
```

**Deliberate omissions:** no `follow_up_status` column (derived), no `is_overdue` column (derived),
no seat columns anywhere on `leads`.

**RLS:** `select` gated on staff role; `update`/`delete` gated on role, **not** `using (true)` —
the mistake `packages` made (`20260808090000_create_packages.sql:194`). Guides get no policy at all.

### 3.2 Capability matrix (`lib/access/leads-access.ts`)

| Capability | ADMIN | CEO | MARKETING | FINANCE | OPERATIONS/VISA | GUIDE |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `viewModule` | ✓ | ✓ (read-only) | ✓ | ✓ (converted only) | ✓ (converted only) | ✗ |
| `createLead` / `editLead` | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| `changeStage` / `assignLeads` | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| `sendQuote` / `communicate` | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| `convertToBooking` | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| `mergeDuplicates` / `deleteLead` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `manageSourcesAndAutomation` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `viewPipelineValue` / `viewAnalytics` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| `viewAllOwners` (vs own leads only) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |

Applied **in the repository**, not just the UI: Finance/Operations receive only leads with a
`booking_id`; pipeline value is nulled for roles without `viewPipelineValue`.

---

## 4. Build phases

Follows the spec's own build order. Each phase is independently shippable.

### Phase 0 — Foundation (prerequisite for everything)
1. Migration from §3.1, plus a `lead_sources` seed row per current `LeadSource` enum value.
2. `lib/data/leads-repository.ts` — `loadLeadStore()` / `persistLeadStore()` against Supabase,
   same before/after diff-persist pattern as `departure-groups.ts:317-335`.
3. `lib/access/leads-access.ts`, `lib/validations/leads.ts`.
4. `app/(main)/leads/actions.ts` — one Server Action per existing mutator, each: resolve role →
   capability check → validate → call the **unchanged** pure mutator → persist → `revalidatePath`.
5. `leads-store.tsx` callbacks become `await action(...)` + `router.refresh()`. Component APIs unchanged.
6. `page.tsx` — `getCurrentStaffRole()`, `notFound()` when `!can.viewModule`, role-filtered fetch.
7. Replace `LEAD_STAFF` with real staff users; replace `LEAD_PACKAGES` with a
   `listPackageTemplateOptions()`-style query returning per-room prices.

**Acceptance:** a lead created in one browser is visible in another after refresh; a GUIDE gets 404.

### Phase 1 — List screen to spec
- Stage enum migration: add `POSTPONED / DUPLICATE / SPAM`; migrate `CONVERTED → BOOKED` and remove
  `CONVERTED`. Update `STAGE_LABELS`, `STAGE_ORDER`, `STAGE_TONES`, `CLOSED_STAGES`.
- Remap lost reasons to the spec's 10.
- KPI cards → clickable filters, with 30-day deltas and rate captions; 5th pipeline-value card gated
  on `viewPipelineValue`.
- Saved views → the spec's 12, as a scrollable chip bar; each is a predicate in `applySavedView`.
- Column set: add **Desired Package** column; add a column-visibility dropdown driving the 11
  optional columns; persist choice in `localStorage`.
- `More ▾`: add Manage Lead Sources, Saved Views, Duplicate Review Queue.
- Add Package and Source filter chips to the primary row.

### Phase 2 — Add Lead dialog to spec
- Step 1 becomes a **gate**: no other field is enabled until the number is entered and the duplicate
  search (leads **+ pilgrims/customers**, server-side, debounced) has returned.
- Duplicate outcome: *Open Existing* / *Merge* (admin only) / *Create anyway* — the last requires
  `duplicateReason`, which is persisted to `duplicate_override_reason` and written to the timeline.
- New fields: room preference, preferred contact channel, referred-by picker (conditional on
  `source = REFERRAL`).
- Enforce the spec's five hard requirements in `lib/validations/leads.ts`: owner, next follow-up,
  source, mobile, journey interest.
- Estimated value preview recomputed from **room-type price × travellers**.

### Phase 3 — Drawer to spec
- Quick-action row: `WhatsApp` (primary, filled) · `Call` · `Add Note` · `Send Quote` · `Set Follow-up`.
- Overdue banner with `[Complete]` and `[Reschedule]`; `Complete` writes `FOLLOW_UP_COMPLETED`,
  bumps `follow_up_attempts`, and prompts for the next one.
- Notes become a list from `lead_notes` with an inline composer, each stamped author + time, marked
  **Internal only**.
- Timeline: render the 14 event types with per-type icon and tone; group by day.
- Contact / Journey / Sales-state cards laid out exactly as the spec's four cards.

### Phase 4 — Package & Departure Group recommendation
- `Recommended Package` card: package name + the four room prices (from the real `packages` row),
  `[View Package]` `[Send Brochure]` `[Find Available Groups]`.
- `Find Available Groups` sheet queries `departure_groups` filtered by:
  `sales_status in ('SELLING','LIMITED_AVAILABILITY')` · `available_seats >= adults + children` ·
  not cancelled/completed/closed · journey type & package compatible.
- Selecting writes `selected_departure_group_id` + a `GROUP_SELECTED` timeline entry. **No seat
  movement.**

### Phase 5 — Quote builder
- `lib/data/leads-quotes.ts` composes package + group + room preference + traveller count + current
  price + deposit policy + payment milestones into a **snapshot** stored on `lead_quotes`, so a later
  price change cannot rewrite a quote already sent.
- Preview dialog → `[Send by WhatsApp]` (prefilled `wa.me` text) · `[Send by Email]` · `[Download PDF]`.
- Sending writes `QUOTE_SENT`, moves the stage to `PROPOSAL_SENT` if earlier, and schedules the
  2-day follow-up (Phase 7 rule).

### Phase 6 — Convert to booking
- Panel appears **only** when `selected_departure_group_id is not null` or stage ≥ `DEPOSIT_PENDING`.
- `lib/data/leads-conversion.ts` runs the spec's 10 steps in **one transaction**, delegating seat
  work to the existing, already-tested `createGroupBookingInStore()`
  (`lib/data/departure-groups-bookings.ts:115`) rather than reimplementing hold logic:
  create booking → link package + group → create N pilgrim placeholders → hold seats →
  copy document requirements → copy payment milestones → update capacity → `stage = BOOKED` →
  write `BOOKING_CREATED` on both timelines → store `booking_id` on the lead.
- Re-entrancy: a lead with a non-null `booking_id` can never convert twice.
- Failure (seats taken between selection and click) rolls back whole and reports "only N seats left".

### Phase 7 — Follow-up automation
- Overdue stays **derived** — no job needed for correctness.
- A `pg_cron` job + Server Action handles only the *push*: notify owners of overdue follow-ups,
  run the deposit-reminder sequence, and suggest Postponed/Lost after X unanswered attempts.
- Round-robin assignment for Website/Facebook/Instagram leads, with a first-contact task due within
  the configured SLA (30 min default), stored in a `lead_automation_settings` row.
- Quote sent → follow-up in 2 days. Booking created → handover task for Operations/Finance/Visa.

### Phase 8 — Lead insights
- `lib/data/leads-analytics.ts` + `/leads/insights`: leads by source, first-response time, contact
  rate, quote rate, conversion rate, revenue by source and by package, conversion by owner, lost
  reasons. All from `lead_activity` + `leads` + `lead_quotes` — which is why the timeline must be
  written faithfully from Phase 0 onward.
- Gated on `viewAnalytics`; uses `recharts`, already a dependency.

### Phase 9 — AI sales agent
- Read/draft only. Allowed: capture enquiry, duplicate search, answer package questions, find
  sellable groups, qualify, draft WhatsApp replies, draft quotes, schedule follow-ups, summarise.
- Blocked without staff approval: reserve seats, confirm bookings, change prices, promise hotel or
  flight details, refunds, verify documents, change visa status, bulk messages.
- Enforced structurally: the AI layer is given only the read queries plus `draft*` actions; every
  seat- or money-touching action stays behind `capabilitiesForLeads(role)` and a
  `[Staff Approve Booking]` confirmation.

---

## 5. Decisions and risks

| # | Decision | Rationale |
|---|---|---|
| D1 | Keep the Add-Lead **Sheet**, not a Dialog | Matches `create-departure-group-sheet.tsx`; the spec's concern ("not a full page") is met |
| D2 | Collapse `CONVERTED` into `BOOKED` | Two success terminals in one enum will diverge; `BOOKED` is the spec's word |
| D3 | Notes become rows, `leads.notes` retired | Spec needs authored, timestamped, appendable notes |
| D4 | Quotes store a price **snapshot** | A package repricing must not silently alter a quote already sent |
| D5 | Conversion delegates to `createGroupBookingInStore` | Seat-hold, waitlist and expiry logic is already written and tested there |
| D6 | Capabilities applied in the repository | Same as Departure Groups; UI-only gating leaks data into the RSC payload |
| D7 | No `follow_up_status` column | Storing a clock-relative value is how lists go stale |

**Risks**
- **R1 — Data migration.** Seed leads are demo data. Decide before Phase 0: seed the table for
  staging and start empty in production, or import the agency's current Excel list via the existing
  import dialog. *Needs the user's answer.*
- **R2 — Staff identity.** Phase 0 depends on a real staff/user table with roles. If auth roles are
  not yet wired, Phase 0 stalls at step 7. Confirm what `getCurrentStaffRole()` resolves against.
- **R3 — Pilgrim/customer duplicate search** (Phase 2) needs the `pilgrims` module's table; check its
  readiness before committing that step.
- **R4 — Concurrency at conversion.** Two salespeople converting into the last seats must be
  serialised by the booking transaction, not by the UI.

**Open questions for the user**
1. Migrate the existing Excel/WhatsApp lead list, or start clean?
2. Is WhatsApp integration link-out only (`wa.me`), or a Business API account for real send/receive?
3. Is quote PDF generation in scope for Phase 5, or is WhatsApp text enough for v1?
4. Should CEO see other owners' lead values, or only aggregates?

---

## 6. Suggested sequencing

Phase 0 is the gate — everything else is theatre until leads persist. Phases 1–3 then land the
daily-use surface, 4–6 the revenue path, 7–9 the leverage.

```
Phase 0 ──► 1 ──► 2 ──► 3 ──► 4 ──► 5 ──► 6 ──► 7 ──► 8 ──► 9
  DB       list   add   drawer  groups  quote  convert  auto  insights  AI
```
