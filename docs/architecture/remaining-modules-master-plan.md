# ManasikOS — Remaining Modules Master Plan

> **Navigation update (TASK-013).** The Operate sidebar is now Operations, Documents and Visa Operations. `/flights-tickets`, `/hotels-rooming` (and `/rooming-board`), `/transport-movements` and `/support-incidents` are retired list pages that permanently redirect into `/operations?tab=…`. Sections below that describe those top-level routes are historical; any rebuild of them belongs inside Operations. See [TASK-013](../tasks/TASK-013-operate-navigation-consolidation.md).

Status: plan only. Nothing in this document has been implemented.

## 0. Why this plan differs from the brief it came from

The source brief was written as if ManasikOS had "Dashboard, Leads, Pilgrims,
Packages, Departure Groups, WhatsApp, auth, multi-tenancy, basic RBAC" and
nothing else. That is wrong by a wide margin. A repository inspection shows
roughly 60% of the brief's Phase 1 and Phase 2 "operational spine" already
exists in production-grade form:

| Brief claims missing | Reality in this repo |
| --- | --- |
| Booking / Family File does not exist | `departure_group_bookings` + `departure_group_pilgrims` (booking_id FK) already model one booking to many pilgrims, with room preference, price-per-person, total/paid/outstanding, seat holds, statuses |
| Quotes do not exist | `lead_quotes` exists with reference, pricing snapshot, pax split, room preference, deposit, validity, send channel |
| Invoices do not exist | `invoices` + `invoice_line_items` with unique numbering, credit-note self-FK, void reason, booking XOR supplier constraint |
| Payments / plans / refunds do not exist | `payments`, `payment_allocations`, `booking_payment_milestones`, `pilgrim_payment_milestones`, `refund_requests`, `finance_adjustments`, `finance_activity_events` |
| Expenses / payables do not exist | `supplier_commitments`, `supplier_payments`, `supplier_services`, `supplier_activity_events` plus a full `/suppliers` module with detail tabs |
| Readiness does not exist | `departure_group_readiness_items`, `lib/data/departure-groups-readiness.ts`, `lib/data/pilgrims-readiness.ts`, `/operations` Readiness Center |
| Flights / hotels / rooming / transport do not exist | `departure_group_flights`, `_flight_legs`, `_accommodations`, `_rooms`, `_room_assignments`, `_transports` — group-scoped, with capacity and per-accommodation room migrations |
| RBAC is "basic" | 14 capability modules in `lib/access/*`, dynamic roles + `role_permissions` table, capability-driven sidebar, repository-level field redaction |
| Tenancy is unproven | `current_agency_id()` resolver, `agency_id` on 50+ tables with FK + index, RLS hardening, tenant storage isolation, tenant uniqueness migrations |
| AI must be built from scratch | Agent kernel with proposals/approval gates (`lib/agent/kernel/proposals/kinds/*`), departure-ops agent with evals, sales copilot, `agent_proposals` + `agent_proposal_events` + `agent_runs` + `agent_tool_calls` |
| Sidebar IA needs designing | Already restructured into HOME / GROW / SELL / OPERATE / FINANCE / RELATIONSHIPS / INSIGHTS on branch `Updating-UI` |

So the real remaining work is **not** "build the spine". It is three things:

1. **Promote** two entities that exist as children of other modules into
   first-class modules: Booking (today a child of Departure Group) and Quote
   (today a child of Lead).
2. **Fill** ~21 `ComingSoonPage` placeholders with real modules, in an order
   driven by data dependency rather than by the brief's numbering.
3. **Close** the gaps the brief is genuinely right about: no top-level Booking
   record, no cross-group family file, no campaign attribution, no consent
   model, no announcement consent enforcement, no portal.

Everything below assumes: reuse existing patterns, never introduce a second
design system, never fork an existing table into a parallel one.

---

## 1. Existing routes and modules to reuse (not rebuild)

Fully built — treat as fixed integration points:

- `/dashboard` — attention feed, pace, layout (`lib/data/dashboard-*.ts`)
- `/leads` (+ `add-new-lead`, copilot) — `lib/data/leads*.ts`
- `/pilgrims`, `/pilgrims/[pilgrimId]`
- `/packages` (+ versions, snapshots, lifecycle, `packages_list_with_usage` RPC)
- `/departure-groups/[groupId]` — the deepest module: bookings, pilgrims,
  flights, accommodation, rooming, transport, readiness, tasks, charges,
  deviations, costing, pricing, ID cards
- `/documents`, `/visa` — AI review, submission batches, review events
- `/finance/payments` — invoices / payments / receivables / refunds / supplier
  payables / reconciliation tabs all already exist behind one route
- `/suppliers`, `/suppliers/[supplierId]` — this *is* the Expenses & Supplier
  Bills module the brief asks for
- `/operations` (+ `/operations/approvals`) — Readiness Center
- `/reports`, `/inbox`, `/management/*`, `/platform/*`

Placeholder routes to be replaced (all currently `ComingSoonPage`):
`/quotes`, `/bookings`, `/campaigns`, `/audiences`, `/content-templates`,
`/referrals`, `/flights-tickets`, `/hotels-rooming`, `/transport-movements`,
`/itinerary-services`, `/guides-field-team`, `/support-incidents`,
`/finance` (overview), `/finance/invoices`, `/finance/payment-plans`,
`/finance/refunds-credits`, `/finance/payables`, `/finance/commissions`,
`/finance/reconciliation`, `/finance/departure-profitability`,
`/relationships/*` (5 pages), `/analytics`, `/ai-insights`.

Patterns to copy verbatim per module (from `/suppliers`, the cleanest example):
`page.tsx` + `loading.tsx` + `error.tsx` + `actions.ts` + `types.ts` +
`utils.ts` + `<module>-store.tsx` + `<module>-table/*-columns.tsx` +
`components/*-sheet.tsx` / `*-dialog.tsx`, with
`lib/data/<module>-repository.ts` doing the tenant-scoped fetch and
capability-based redaction, and `lib/access/<module>-access.ts` exporting
`capabilitiesFor<Module>(role)`.

---

## 2. Existing tables to extend (never duplicate)

| Need | Extend this | Do NOT create |
| --- | --- | --- |
| Booking / Family File | `departure_group_bookings` | a new `bookings` table |
| Quote | `lead_quotes` | a new `quotes` table |
| Traveller on a booking | `departure_group_pilgrims` | a second traveller table |
| Invoice | `invoices` / `invoice_line_items` | — |
| Payment plan | `booking_payment_milestones` | a new instalments table |
| Refund | `refund_requests` | — |
| Supplier bill / payable | `supplier_commitments` / `supplier_payments` | an `expenses` table |
| Flight | `departure_group_flights` / `_flight_legs` | a parallel flights table |
| Hotel stay / room | `departure_group_accommodations` / `_rooms` / `_room_assignments` | — |
| Transport | `departure_group_transports` | — |
| Readiness | `departure_group_readiness_items` | — |
| Templates | `message_templates`, `whatsapp_templates` | a third template table |
| Audit | `*_activity_logs`, `finance_activity_events`, `supplier_activity_events` | one generic audit table |
| AI insight / approval | `agent_proposals`, `agent_proposal_events`, `agent_runs` | a second approval gate |

### Rename decision

`departure_group_bookings` is now a misnomer — it is the agency's booking
record, not a group's. **Do not rename the table** (50+ references, FK targets,
RLS policies, migrations). Instead expose it through a new
`lib/data/bookings-repository.ts` and a `Booking` domain type, and treat
`departure_group_id` as one nullable attribute of a booking rather than its
parent. A nullable `departure_group_id` is the single most consequential schema
change in this plan: it is what lets a booking exist before a group is assigned
and survive a group transfer.

---

## 3. Genuinely missing core entities

These have no home anywhere in the schema today:

1. **Booking payer** — a booking has `primary_contact_name/phone` strings only.
   Needs a real payer reference (pilgrim, lead, or standalone customer) plus
   payer-not-traveller support.
2. **Traveller relationships** — no mahram / spouse / child / companion edges
   between pilgrims on one booking.
3. **Quote lifecycle** — `lead_quotes` has no status column at all (only
   `sent_at` / `valid_until`); no accept / reject / supersede / revision chain.
4. **Booking lifecycle events** — no cancellation, transfer, or archival record.
5. **Consent and contactability** — no consent status, opt-out, DNC, or language
   preference on leads/pilgrims. Blocks Audiences, Campaigns, Announcements.
6. **Campaign** — no campaign entity, no UTM capture, no attribution on lead.
7. **Audience / segment** — none.
8. **Referral** — no referrer, referral link, reward rule, or reward ledger.
9. **Commission** — no commission rule or accrual, despite a sidebar entry.
10. **Bank / reconciliation transaction** — the reconciliation tab exists but
    there is no imported-transaction table to match against.
11. **Guide** — guides are `staff_group_assignments` only: no guide profile,
    languages, availability, briefing, handover, or check-in.
12. **Itinerary** — no itinerary, day, or event entity at all.
13. **Support case / incident** — `pilgrim_support_requests` and
    `support_sessions` exist but are not a case system (no severity, SLA,
    escalation, category taxonomy, or supplier linkage).
14. **Feedback / survey** — none.
15. **Portal access** — a `managePortalAccess` capability exists but no portal
    session, magic-link, or portal content model.
16. **Agent / sub-agent** — no agent entity, credit limit, allocation, or
    settlement.
17. **Insight record** — agent *proposals* exist; a durable, evidence-linked
    *insight* with outcome and feedback does not.

---

## 4. Migration plan

All migrations additive, one per slice, following the existing
`supabase/migrations/YYYYMMDDHHMMSS_<name>.sql` naming, each with: an
`agency_id` column defaulting to `public.current_agency_id()`, FK to
`public.agencies`, an `agency_id` index, RLS enabled with policies folding in
`agency_id = current_agency_id()`, and indexes on `booking_id`, `pilgrim_id`,
`departure_group_id`, `supplier_id`, `status`, `due_date`, `created_at` as
applicable. No destructive DDL. Soft delete / archival (`archived_at`,
`status`) instead of deletes on anything financial or historical.

**M1 — Booking promotion**
- `departure_group_bookings`: add `payer_pilgrim_id`, `payer_lead_id`,
  `payer_name`, `payer_email`, `booking_type` (`GROUP` | `CUSTOM`),
  `sales_owner_id`, `operations_owner_id`, `cancelled_at`,
  `cancellation_reason`, `archived_at`. (`row_version` already added by
  20260904090000 — confirm before re-adding.)
- Extend the `booking_status` check to add `TRAVELLED`, `TRANSFERRED`,
  `ARCHIVED`.
- Defer `alter column departure_group_id drop not null` to slice A1b.
- New `booking_traveller_relationships` (booking_id, from_pilgrim_id,
  to_pilgrim_id, relationship, is_mahram).
- New `booking_events` (booking_id, event_type, payload jsonb, actor,
  created_at) — the booking audit spine, mirroring
  `departure_group_activity_logs`.

**M2 — Quote lifecycle**
- `lead_quotes`: add `status` (DRAFT / INTERNAL_REVIEW / SENT / VIEWED /
  ACCEPTED / REJECTED / EXPIRED / SUPERSEDED / CANCELLED),
  `supersedes_quote_id`, `accepted_at`, `rejected_at`, `rejection_reason`,
  `booking_id`, `discount_amount`, `discount_approved_by`,
  `discount_approved_at`, `terms`, `owner_id`, `viewed_at`.
- New `quote_line_items` (quote_id, scope PARTY|PILGRIM, pilgrim_id nullable,
  label, qty, unit_amount, total).

**M3 — Consent and contactability** (blocks all of Phase C)
- `leads` and `pilgrims`: `preferred_language`, `consent_status`
  (UNKNOWN / OPTED_IN / OPTED_OUT), `consent_source`, `consent_at`,
  `do_not_contact` boolean, `contactable_channels` text[].
- New `consent_events` (subject_type, subject_id, channel, action, source,
  actor).

**M4 — Campaigns and attribution**
- New `campaigns`, `campaign_spend_entries`.
- `leads`: `campaign_id`, `utm_source/medium/campaign/content/term`,
  `attribution_type` (DIRECT / ASSISTED / UNKNOWN).
- `departure_group_bookings`: `campaign_id`, `attribution_type`.

**M5 — Audiences**
- New `audiences` (type, definition jsonb, computed_count, computed_at),
  `audience_members` (static membership snapshot with included/excluded +
  reason).

**M6 — Content and templates**
- New `content_items`, `content_item_versions`. These *reference*
  `message_templates` and `whatsapp_templates` rather than replacing them —
  WhatsApp template approval state must stay where Meta sync writes it.

**M7 — Referrals and commissions**
- New `referrers`, `referrals`, `reward_rules`, `reward_accruals`.
- New `commission_rules`, `commission_accruals`, `agent_settlements`.

**M8 — Reconciliation**
- New `bank_transactions`, `reconciliation_matches`, `reconciliation_periods`.

**M9 — Itinerary and services**
- New `itineraries`, `itinerary_days`, `itinerary_events`,
  `itinerary_event_pilgrims`, `service_vouchers`.

**M10 — Guides and field team**
- New `guide_profiles`, `guide_assignments`, `guide_briefings`,
  `guide_handovers`, `field_checkins`.

**M11 — Support and incidents**
- New `support_cases`, `support_case_events`, `support_case_attachments`,
  `incident_reports`. Backfill `pilgrim_support_requests` rows in; keep the old
  table read-only rather than dropping it.

**M12 — Feedback**
- New `surveys`, `survey_questions`, `survey_responses`, `survey_answers`.
  Prefer `support_cases` with `case_type = COMPLAINT` over a separate
  `complaints` table — decide at slice time.

**M13 — Portal and announcements**
- New `portal_accounts`, `portal_sessions`, `portal_access_events`,
  `portal_content_blocks`, `announcements`, `announcement_recipients`.

**M14 — Agent portal**
- New `sales_agents`, `agent_users`, `agent_package_allocations`,
  `agent_credit_limits`, `agent_booking_submissions`.

**M15 — Insights**
- New `insights`, `insight_evidence`, `insight_outcomes`.

Rollback posture: every new table gets a paired `drop table if exists` block
commented in the migration header. Additive columns are left in place — they are
not worth a destructive rollback.

---

## 5. New route map

```
SELL
  /quotes                          list + saved views
  /quotes/[quoteId]                detail (line items, revisions, accept/reject)
  /bookings                        list + views (deposit pending, at risk, ...)
  /bookings/[bookingId]            overview | travellers | commercials |
                                   payments | documents | visa | allocations |
                                   communications | support | activity

OPERATE
  /flights-tickets                 schedule | allocations | PNRs | ticketing |
                                   manifests | changes
  /flights-tickets/[flightId]
  /hotels-rooming                  directory | contracts | inventory | rooming
                                   board | unassigned | occupancy | vouchers
  /hotels-rooming/[hotelId]
  /transport-movements             vehicles | drivers | schedule | board |
                                   manifests | incidents
  /transport-movements/[movementId]
  /itinerary-services              builder | group itinerary | daily plan |
                                   services | vouchers
  /itinerary-services/[itineraryId]
  /guides-field-team               roster | assignments | workload | briefings
  /guides-field-team/[guideId]
  /field                           mobile-first guide workspace (separate shell)
  /support-incidents               inbox | open | urgent | resolution queue
  /support-incidents/[caseId]

FINANCE
  /finance                         overview cockpit
  /finance/invoices                (+ /[invoiceId])
  /finance/payment-plans           (+ /[planId])
  /finance/refunds-credits         (+ /[refundId])
  /finance/payables
  /finance/commissions
  /finance/reconciliation
  /finance/departure-profitability (+ /[groupId])

GROW
  /campaigns (+ /[campaignId])
  /audiences (+ /[audienceId])
  /content-templates (+ /[contentId])
  /referrals (+ /[referrerId])

RELATIONSHIPS
  /relationships/pilgrim-portal    agency-side configuration
  /relationships/announcements (+ /[announcementId])
  /relationships/feedback-complaints (+ /[responseId])
  /relationships/loyalty
  /relationships/agent-portal (+ /[agentId])

PORTALS (outside the (main) shell)
  app/(portal)/portal/*            pilgrim self-service, mobile-first
  app/(agent)/agent-portal/*       sub-agent workspace

INSIGHTS
  /analytics                       sectioned, role-aware
  /ai-insights (+ /[insightId])
```

Routes intentionally **not** created, despite the brief proposing them:
`/operations/flights`, `/operations/hotels`, `/operations/transport`,
`/operations/itinerary`, `/operations/guides`, `/support`, `/incidents`,
`/finance/expenses`, `/finance/refunds`, `/finance/profitability`, `/content`,
`/templates`, `/agents`. The sidebar on `Updating-UI` already uses the flat
`/flights-tickets`-style slugs, and `/suppliers` is the expenses module. One
canonical URL per concept.

---

## 6. RBAC changes

Add to `PermissionModule` in `lib/access/role-permissions-shared.ts`, each with
a `lib/access/<module>-access.ts` and a `MODULE_CAPABILITY_KEYS` entry, then a
seed migration extending `role_permissions` the way 20260924090000 did:

| New module key | Covers | Sample capability keys |
| --- | --- | --- |
| `bookings` | /bookings | viewModule, createBooking, editCommercials, addTraveller, changePackageOrGroup, transferBooking, cancelBooking, approveDiscount, viewFinancials, viewSensitiveTravellerData, assignOwners, exportBookings, assignedGroupOnly |
| `quotes` | /quotes | viewModule, createQuote, editQuote, sendQuote, applyDiscount, applyUnrestrictedDiscount, approveDiscount, acceptOnBehalf, rejectQuote, convertToBooking, viewMargin |
| `marketing` | campaigns, audiences, content, referrals | viewModule, manageCampaigns, editSpend, manageAudiences, useAudienceForBroadcast, manageContent, approveContent, manageReferralRules, approveRewards, viewAttribution |
| `field_ops` | flights, hotels, rooming, transport, itinerary | viewModule, manageFlights, issueTickets, manageHotelContracts, manageRooming, unlockRoomAssignments, manageTransport, manageItinerary, publishItinerary, exportManifest, viewSupplierCosts, assignedGroupOnly |
| `guides` | guides and field team | viewModule, manageRoster, assignGuides, viewGuideWorkload, viewAssignedManifest, submitCheckin, recordHandover, viewPilgrimContacts, viewMedicalFlags |
| `support` | support and incidents | viewModule, createCase, assignCase, escalate, resolveCase, closeCase, viewMedicalDetail, viewComplaints, runPostTripReview |
| `relationships` | portal config, announcements, feedback, loyalty | viewModule, configurePortal, managePortalAccess, draftAnnouncement, approveAnnouncement, sendAnnouncement, manageSurveys, viewResponses, manageLoyalty, awardCredit |
| `agents` | sub-agent programme | viewModule, onboardAgent, setCreditLimit, allocatePackages, approveAgentBooking, viewAgentMargin, settleCommissions |
| `analytics` | /analytics | viewModule, viewGrowth, viewSales, viewFinance, viewMargin, viewSupplier, viewServiceQuality, viewAllBranches, exportAnalytics |
| `insights` | /ai-insights | viewModule, viewInsight, dismissInsight, actOnInsight, manageAiSettings, viewAiActionHistory |

Extensions to existing modules:

- `finance`: `viewProfitability`, `manageCommissionRules`, `approveCommissions`,
  `importBankTransactions`, `confirmReconciliationMatch`, `closePeriod`.
- `leads`: `manageCampaignAttribution`, `manageConsent`.
- `settings`: add `viewGlobalAuditLog`.

Two role archetypes the brief lists and the repo may lack: `GUIDE` (field-scoped,
assigned groups only) and `AUDITOR` (read-only across finance and audit log, no
writes anywhere). Check `staff_roles` before seeding either.

---

## 7. Dependencies and risks

**Hard dependencies — do not reorder past these**

- Every Phase-C growth module depends on M3 (consent). Building Campaigns or
  Announcements first produces a system that can broadcast to people who never
  opted in.
- Departure Profitability depends on supplier commitments being *allocated* to
  groups. Verify `supplier_commitments` carries `departure_group_id` before
  planning that slice.
- Reconciliation depends on M8 — the existing reconciliation tab is a view over
  payments with no counterparty ledger behind it.
- Itinerary composes flights + hotels + transport, all of which already exist
  group-scoped, so it does not wait on them.

**Risks**

1. *Booking promotion is the highest-blast-radius change here.* Making
   `departure_group_id` nullable touches every query assuming a group parent,
   including RLS policies keyed on guide group scoping (20260903 / 20260905).
   Mitigation: keep every existing query path working with a non-null group;
   introduce the nullable path only behind the new repository, in a later slice.
2. *Two competing template stores* (`message_templates`, `whatsapp_templates`).
   Content must reference, not replace, or WhatsApp approval state drifts from
   Meta.
3. *`pilgrim_support_requests` vs a real case system.* A backfill is required or
   support history splits across two tables.
4. *Guide scoping already lives in RLS* via `staff_group_assignments`.
   `guide_profiles` must not become a second source of truth for "which groups
   can this person see".
5. *No AI cost model beyond WhatsApp.* `ai_model_rates`, `ai_settings` and
   billing exist for the WhatsApp agent; a per-tenant ceiling for insight agents
   does not. Insights stay deterministic stubs until that is settled.
6. *Multi-currency.* `invoices.currency` exists but there is no FX table. Finance
   Overview must show per-currency breakdowns, never a converted total.
7. *Sheer scale.* 21 modules, ~15 migrations. Shipping this as one change would
   be unreviewable. One slice per PR, each independently deployable, with the
   placeholder still standing for anything not yet replaced.

---

## 8. Phased implementation order

Re-ordered from the brief to respect what already exists.

**Phase A — Promote the spine (must come first)**

- A1. Booking promotion — M1 + `lib/data/bookings-repository.ts` +
  `lib/access/bookings-access.ts` + `/bookings` + `/bookings/[bookingId]`.
- A1b. Nullable `departure_group_id` + booking transfer / cancellation flows.
- A2. Quote promotion — M2 + `/quotes` + `/quotes/[quoteId]` + accepted-quote to
  booking conversion. `convertLeadToBookingAction` becomes "convert via quote",
  with the direct path retained for walk-ins.
- A3. Finance re-surfacing — split the existing `/finance/payments` tabs into
  their own routes (`/finance/invoices`, `/finance/payment-plans`,
  `/finance/refunds-credits`, `/finance/payables`, `/finance/reconciliation`)
  reusing the same repository, plus the `/finance` overview cockpit. Mostly
  routing and composition, not new data work.

**Phase B — Fulfilment surfaces**

- B1. Flights & Tickets — cross-group views over the existing group flight tables.
- B2. Hotels & Rooming — hotel directory and contracts are new; the rooming board
  reuses `departure_group_rooms` / `_room_assignments`.
- B3. Transport & Movements.
- B4. Itinerary & Services (M9).
- B5. Guides & Field Team + `/field` mobile workspace (M10).
- B6. Support & Incidents (M11).
- B7. Departure Profitability, plus commissions groundwork (M7 partial, M8).

**Phase C — Growth and relationships**

- C1. Consent and contactability (M3) — a prerequisite slice with no UI of its
  own beyond settings and lead/pilgrim fields.
- C2. Campaigns and attribution (M4).
- C3. Audiences (M5).
- C4. Content & Templates (M6).
- C5. Referrals (M7 remainder).
- C6. Announcements (M13 partial).
- C7. Pilgrim Portal (M13 remainder).
- C8. Feedback & Complaints (M12).
- C9. Loyalty & Repeat Umrah.
- C10. Agent / Sub-agent Portal (M14).

**Phase D — Insights**

- D1. Analytics workspace — read-only over everything above.
- D2. AI Insights shell + insight / evidence / outcome model (M15), deterministic
  generators only.
- D3. Contextual agent surfaces, one module at a time, reusing
  `lib/agent/kernel/proposals` for the approval gate.

---

## 9. The exact first implementation slice

**Slice A1 — Booking as a first-class record, read-only.**

Writes are deliberately excluded so the blast radius is provably zero.

Files to create:

- `supabase/migrations/2026xxxx_bookings_promotion.sql` — M1 above, minus the
  `departure_group_id` nullability change.
- `lib/access/bookings-access.ts` — `capabilitiesForBookings(role)`.
- `lib/data/bookings-repository.ts` — tenant-scoped list + detail, joining
  `departure_group_bookings` to `departure_group_pilgrims` / `pilgrims`,
  `invoices`, `payments`, `booking_payment_milestones`,
  `departure_group_pilgrim_documents`, visa events, room / flight / transport
  assignments, `refund_requests`.
- `lib/data/bookings.ts` — domain types plus status and readiness derivation.
- `app/(main)/bookings/{page,loading,error}.tsx`, `types.ts`, `utils.ts`,
  `bookings-store.tsx`, `bookings-table/bookings-columns.tsx`,
  `components/bookings-list.tsx`.
- `app/(main)/bookings/[bookingId]/page.tsx`,
  `components/booking-detail.tsx`, `components/tabs/*.tsx` (overview,
  travellers, commercials, payments, documents, visa, allocations,
  communications, support, activity). Tabs with no data source yet render an
  explicit "not wired yet" state rather than fabricated rows.
- `lib/data/bookings.test.ts` — status and readiness derivation, redaction,
  tenant isolation.

Files to modify:

- `lib/access/role-permissions-shared.ts` and
  `lib/access/module-capability-keys.ts` — register the `bookings` module.
- `components/app-sidebar.tsx` — swap `visible: true` for
  `capabilitiesForBookings(role).viewModule` on the Bookings entry.
- `app/(main)/departure-groups/[groupId]/components/tabs/*` — link each booking
  row to `/bookings/[bookingId]` instead of only opening in place.
- `app/(main)/leads/components/lead-drawer.tsx` — link a converted lead to its
  booking route.

Authorization: `requireUser()` + `getCurrentStaffRole()` in the page, capability
check before fetch, repository nulls out amounts for roles without
`viewFinancials` and passport / medical fields without
`viewSensitiveTravellerData`, RLS enforces `agency_id = current_agency_id()` on
every table touched, and `assignedGroupOnly` roles get a
`departure_group_id in (assigned)` filter mirroring
`departure-groups-access.ts`.

Connections: Leads (via `leads.booking_id`), Pilgrims (via
`departure_group_pilgrims.pilgrim_id`), Packages (via the group's package
snapshot), Departure Groups (via `departure_group_id`), Finance (invoices,
payments, milestones, refunds), Documents / Visa (per traveller), WhatsApp
(conversations keyed to the booking's contacts).

Exit criteria: `npm run typecheck`, `npm run lint`, `npm test` all clean; every
new table has RLS proven by a tenant-isolation test; no existing route changes
behaviour except gaining a link.

---

## 10. Answers to the brief's closing questions

**Final sidebar map** — already shipped on `Updating-UI`. The only change this
plan makes is replacing `visible: true` with real capability checks as each
module lands, and adding badges (pending refund approvals, documents awaiting
verification, departures at risk, unmatched transactions, unread incidents) only
once the underlying counts actually exist.

**Data-model relationship summary (target)**

```
Lead -1:N- Quote -1:1- Booking -1:N- BookingTraveller(Pilgrim)
                          |                  \- relationships (mahram/family)
                          |- DepartureGroup (nullable) - Package(+snapshot)
                          |- Invoice -N:M- Payment (via PaymentAllocation)
                          |- PaymentMilestone
                          |- RefundRequest
                          |- Document / VisaCase (per traveller)
                          |- Allocation: Flight | Room | Transport | ItineraryEvent
                          |- SupportCase
                          \- BookingEvent (audit)

DepartureGroup - Readiness - Profitability - SupplierCommitment - SupplierPayment
Campaign - Lead - Booking (attribution)
Audience - (Lead | Pilgrim) filtered by Consent
Referrer - Referral - RewardAccrual - Commission/Payout
```

**Actions requiring human approval** — AI may draft, never execute: sending any
message or broadcast; scheduling an announcement; creating or changing a
booking; applying a discount; holding or releasing capacity; submitting visa
data; changing room or transport allocation; issuing, voiding or crediting an
invoice; verifying a payment; approving or paying a refund; paying a supplier;
paying a commission; exporting sensitive data; changing roles or permissions.
These map onto the existing `agent_proposals` approval flow — reuse it, do not
build a second gate.

**Intentionally deferred** — pilgrim portal authentication beyond magic-link (no
second auth system); a statutory accounting ledger (out of scope, the brief
agrees); live GDS / airline integration (no configuration exists in the repo);
OCR for supplier bills beyond the existing document AI; FX conversion (show
per-currency breakdowns instead); SMS as a channel (no provider configured).

**Commands**

```
npx supabase db push      # apply migrations to the linked project
npm run typecheck
npm run lint
npm test
npm run dev               # https dev server (certificates/ present)
```

**Environment** — no new variables. Everything in this plan runs on the existing
Supabase and Anthropic configuration in `.env.example`. If an AI insight surface
later needs a provider beyond the configured `@anthropic-ai/sdk` usage, that is a
separate decision, not part of this plan.
