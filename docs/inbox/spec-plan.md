# Manasik Inbox - Product Specification and Delivery Plan

**Status:** Approved for implementation; Phase 0 baseline locked

**Date:** 2026-09-29

**Programme:** Inbox + Copilot

**Specification gate:** Reviewed on 2026-09-29. Decision defaults D1-D7 are locked in
[`2026-09-29-inbox-bln-01-baseline.md`](../progress/2026-09-29-inbox-bln-01-baseline.md);
later tasks remain dependency-gated by the implementation plan.

## 1. Purpose of this document

This document defines the complete target scope of Manasik Inbox, what already exists, what should be implemented next, the dependency order, and the observable result when the system is complete.

It reconciles five sources:

1. the current repository implementation;
2. `docs/inbox/architecture.md`;
3. `docs/inbox/implementation-plan.md` and `docs/inbox/checklist.md`;
4. `docs/usages/inbox/usage-guide.md`;
5. the 13-page product review PDF, *This is the usage and features of inbox. what do you think about this*.

The PDF is review evidence, not an instruction source. When it conflicts with current code, the code and programme architecture establish the current state. When it recommends a new product behavior, this specification decides whether that behavior is in scope, deferred, or rejected.

This file does not replace the ordered slice details in `implementation-plan.md` or the live completion state in `checklist.md`. After this specification is approved, each accepted capability must be translated into one or more implementation-plan slices and checklist entries. The Inbox programme rule remains: **one slice, one PR, nothing adjacent**.

## 2. Assumptions

1. Manasik Inbox remains a Next.js web application backed by Supabase/Postgres and private Supabase Storage.
2. The existing canonical conversation, outbox, intelligence, intervention, autonomy, retention, and CRM-module models remain the baseline; this is refinement, not a rewrite.
3. WhatsApp, Messenger, Instagram, and email remain the supported staff channels. Autonomous email handling remains out of scope.
4. The deterministic CRM remains authoritative for identity, seats, prices, bookings, payments, visa/document state, channel windows, and permissions.
5. The first target is a safe production pilot. Broad L2/L3 automation is gated by measured evidence and is not required to launch the staff-operated Inbox.
6. Staff-facing simplicity is a product requirement: implementation concepts such as surface rows, worker lanes, and entitlements must not be necessary to answer a customer.
7. The feature must remain useful when all model-backed surfaces are unavailable.

## 3. Objective

Build the daily communication and work-command surface for a travel agency: every customer conversation enters one agency-scoped workspace, is prioritised by business consequence, gains explainable assistance, and can be turned into safe, traceable CRM work.

### Primary users

- **Sales/Marketing:** qualify enquiries, match departures, draft replies and quotes, create or link leads, start guarded booking work.
- **Operations:** handle documents, bookings, rooming, transport, handoffs, complaints, and escalations.
- **Finance:** verify customer payment evidence without treating a screenshot as payment truth.
- **Visa:** review passport/visa work while respecting sensitive-data permissions.
- **Guides:** in a later phase, handle only conversations connected to their assigned departure groups.
- **Admins/owners:** configure channels, staffing, SLAs, knowledge, autonomy, retention, and measure outcomes.

### Product outcome

The finished system follows this loop:

```text
Customer message
  -> durable canonical conversation
  -> channel-policy and security checks
  -> business queue and owner
  -> deterministic facts + explainable intelligence
  -> one recommended next action
  -> human-approved or tightly bounded action
  -> traceable CRM record, reply, review, or handoff
  -> measurable operational and commercial outcome
```

### Success definition

The Inbox is successful when it reduces response and handoff time, improves enquiry-to-booking execution, prevents unsafe commitments, and makes every material action traceable to the customer's words. Message volume alone is not a success measure.

## 4. Phase 0 capability map

The request spans independently testable capabilities. These module identifiers are stable and must be used when creating implementation slices.

| Module ID | Responsibility | Current state | Depends on |
|---|---|---|---|
| `inbox-core` | Canonical conversations, channels, queues, ownership, search, composer, notes, outbox, realtime, retention | Existing; live exit proof still varies by slice | - |
| `autonomy-unification` | One effective autonomy decision and one admin-facing hierarchy | Partial; one send resolver exists, but legacy fallback remains for never-configured agencies | `inbox-core` |
| `staff-action-surface` | One next action, complete customer facts, draft provenance, actionable AI states, shift landing | Partial; underlying logic exists, some primary UI is hidden/commented | `inbox-core`, intelligence, offers, risk |
| `finance-evidence` | Promote an Inbox receipt into Finance evidence without confirming a payment | New | `inbox-core`, media intelligence, Finance |
| `media-routing` | Voice transcription, brochure/other routing, safe attachment-to-record extension | Partial | `inbox-core`, media intelligence, `finance-evidence` for receipts |
| `productivity-controls` | Safe bulk actions, expanded shortcuts, help/discovery | Partial; assignment/close and J/K/search exist | `inbox-core`, `staff-action-surface` |
| `outcomes-and-guidance` | Metrics, dashboards, acceptance evidence, role-specific documentation | Partial | All production-pilot modules |
| `guide-group-support` | Restricted group-scoped Inbox for Guides | New and deferred | `inbox-core`, access control, departure-group assignments |

### Dependency direction and build order

```text
inbox-core baseline proof
  -> autonomy-unification
  -> staff-action-surface
  -> finance-evidence
  -> media-routing
  -> productivity-controls
  -> outcomes-and-guidance
  -> guide-group-support (separate later pilot)
```

`staff-action-surface` and `finance-evidence` may proceed in parallel after the baseline and autonomy contracts are fixed. `guide-group-support` must not be bundled into the production-pilot hardening work.

## 5. Current baseline - do not rebuild

The following capabilities already exist in the current branch. New work must preserve them and close their remaining checklist/live-verification gaps rather than introduce competing implementations. The repository and Manasik OS before-state is frozen in the [BLN-01 baseline](../progress/2026-09-29-inbox-bln-01-baseline.md); a baseline label does not imply that every release-level browser/provider exit has passed.

### 5.1 Omnichannel workspace

- Canonical WhatsApp, Messenger, Instagram, and email conversations.
- Provider-specific icons, delivery states, unread state, message history, and attachment display.
- New WhatsApp chat through approved templates.
- New email conversation through a connected mailbox.
- Customer-first initiation for Messenger and Instagram.
- Durable outbound outbox, provider retry behavior, and idempotent staff-send retry.
- Realtime invalidation with scoped reads rather than full-workspace reloads.

### 5.2 Work management

- Inbox, commercial, attention, and channel queues.
- Search across loaded and server-side conversation results.
- Saved queue/search views.
- Owner selection, take control, hand back to AI, close, bulk assign, and bulk close.
- Staff composing presence, internal notes, staff mentions, and saved replies.
- J/K conversation navigation and `/` search focus.
- Ownership notice when replying in a colleague-owned conversation.
- SLA clocks, nearing-deadline and overdue queues, business hours, and holidays.
- Owner-sticky/skill/availability/load-aware routing.

### 5.3 Copilot intelligence and sales support

- Gate, triage, structured travel-intent extraction, deterministic offer matching, risk detection, and on-demand draft stages.
- Intent, urgency, sentiment, language, confidence, evidence, and source labels.
- Translation of an inbound message or stored digest as non-authoritative text.
- Live offer card with price, seats, room, inclusions, constraints, missing information, alternatives, and live recheck.
- Draft quote, departure-group selection/opening, and guarded booking creation.
- A five-field deterministic lead completeness block with **Ask next question**.
- `nextBestActionFor()` logic for payment, complaint, visa, document, price, quote, and draft-reply decisions.
- Draft generation from a deterministic fact pack, claim verification, and approved answer cache.

### 5.4 Protection and traceable CRM work

- Deterministic and model-assisted signals.
- Human-review interventions with acknowledge, resolve, dismiss, routed role, evidence, and required notes.
- Protection gate for automated sends, AI drafts, and guarded staff claims.
- Hard-coded never-autonomous list.
- Identity-link review rather than weak automatic merging.
- Conversation conversion proposals with preview, confirmation, idempotency, and source links.
- Lead, quote, booking, follow-up, document task, visa task, Finance task, complaint, seat hold, recommendation, relationship, feedback, and Operations-handoff paths.

### 5.5 Media and retention

- Private retained originals with short-lived signed URLs.
- Background media work that does not delay message receipt.
- Passport candidate extraction, traveller selection, confidence/mismatch/expiry review, explicit pilgrim update, visa assignment, and Save to Documents.
- Receipt candidate extraction and Finance-owned blocking review without payment mutation.
- Audio playback.
- Bounded retention, promoted-passport exemption, Storage-before-row deletion, and audit.

### 5.6 Baseline corrections to the PDF review

The PDF was accurate about product direction, but these recommendations are already wholly or partly implemented:

| PDF observation | Current repository evidence | Spec decision |
|---|---|---|
| Working hours are not enforced for quiet-lead follow-ups | `quiet-lead-sweep.ts` loads the Inbox SLA calendar/timezone; eligibility returns `OUTSIDE_WORKING_HOURS`; consent, channel window, template, sequence, and minimum-gap checks exist | No duplicate feature. Require live acceptance and preserve the gate |
| Add lead completeness | Five-field checklist and one-click editable next question already render | Extend, do not rebuild |
| Clarify ownership before send | Composer already shows whether sending takes ownership or requires coordination | Preserve; refine copy only if usability evidence demands it |
| Add J/K navigation | J/K and `/` are already wired and tested | Extend shortcut set and add discovery |
| Add a next-best-action engine | Pure decision logic exists, but the prominent composer actions are commented out | Expose the existing logic through one supported UI |
| Passport promotion is needed | Passport Save to Documents is implemented | Preserve and complete live proof |
| Inbox L0 never overrides the legacy agent | An explicit Inbox autonomy audit makes Inbox policy authoritative; fallback remains only for agencies that have never configured Inbox autonomy | Complete migration and remove fallback |

## 6. Scope to implement

## 6.1 `autonomy-unification` - one policy, one effective result

### Problem

The server already has a central `authorizeAutomatedInboxSend()` decision, but a legacy active WhatsApp assistant can still stand in for Inbox reply autonomy when an agency has never recorded an Inbox autonomy choice. The admin must not need to understand legacy and new surface rows.

The stored `escalate_after_failed_turns` setting is also misleading: the runtime hands off after the first meaningful failed turn and does not read that setting.

### Requirements

1. Present one admin hierarchy:

   ```text
   Agency AI master switch
     -> per-channel assistant availability
       -> Inbox behavior: L0 / L1 / L2 / L3
   ```

2. Compute one server-side `effectiveAutonomy` result containing:
   - requested level;
   - plan ceiling;
   - channel availability;
   - surface mode;
   - human ownership state;
   - promotion/demotion evidence state;
   - channel-policy eligibility;
   - protection-gate result;
   - final level and plain-language reasons.
3. Use the same resolver for UI display, job eligibility, automated model execution, direct delivery, and outbox delivery.
4. Backfill every existing agency into the canonical Inbox autonomy contract. Preserve currently active agencies deliberately; do not silently enable a higher level.
5. After backfill and verification, remove the legacy authorisation fallback from runtime code.
6. Remove `escalate_after_failed_turns` from the editable admin form. Prefer immediate handoff. Deprecate/drop the unused column only through a documented migration.
7. Keep every autonomy change audited with actor, from/to level, reason, and evidence.
8. Fail closed when policy facts cannot be loaded; never block human messaging because model execution is unavailable.

### Acceptance criteria

- Setting Inbox to L0 prevents every autonomous Inbox/customer reply, including an agency migrated from the legacy WhatsApp switch.
- L1 produces drafts but cannot perform an autonomous send.
- L2/L3 remain bounded by the plan ceiling, evidence, promotion window, human ownership, channel rules, and protection gate.
- Direct and outbox sends return the same decision for the same context.
- No admin screen exposes “legacy versus new” configuration.
- Immediate failed-turn handoff is the documented and tested policy.
- A migration test proves every agency has an explicit canonical setting before fallback removal.

## 6.2 `staff-action-surface` - turn intelligence into one clear workflow

### A. Recommended next action

Expose exactly one primary action near the top of the customer/context panel and, where appropriate, beside the composer.

The action must be chosen by the existing deterministic decision function, not by free-form model text. Initial supported actions:

- draft a reply;
- ask for the next missing detail;
- create a draft quote;
- follow up on payment;
- open a complaint case;
- create a visa task;
- request documents;
- open Finance review;
- refresh/review a changed offer.

Each action shows one sentence explaining why it is recommended. An unavailable action shows the exact prerequisite or blocker and never disappears without explanation.

No recommended action directly sends a customer message, confirms a booking/payment, or creates a record without the existing preview/confirmation boundary.

### B. Lead completeness 2.0

Extend the current checklist from five to eight actionable facts:

1. journey type;
2. preferred period/dates;
3. contact details;
4. package interest;
5. traveller count;
6. room preference;
7. departure city/origin;
8. passport readiness.

Facts may come from authoritative lead fields or evidence-backed conversation intelligence. The UI must identify the source and must not silently write an inferred fact into the lead. The **Ask next question** button inserts editable text into the composer.

### C. Verified facts used by a draft

When Copilot inserts a draft, show a collapsible **Verified facts used** block with:

- offer/group name;
- requested travel window and party/room facts;
- price and currency source where used;
- availability check timestamp;
- approved inclusions or knowledge-answer source;
- open-review/channel-policy facts that constrained the draft.

The block is provenance, not hidden model reasoning. It must contain only data already present in the reply pack and source/evidence identifiers that the current user may access.

### D. Actionable Copilot state

| State | Staff meaning | Available action |
|---|---|---|
| Reading | Context is being prepared | Continue manually or wait |
| Ready | Insights are available | Review evidence |
| Keyword reading | Basic deterministic rules matched | Treat as limited context |
| Stale | A newer message exists | Refresh/re-run analysis |
| Skipped | Enrichment was unnecessary or gated | Use CRM facts |
| Failed | Copilot is unavailable | Continue manually; retry only if permitted |

AI state must never disable the core staff workflow.

### E. My Shift landing summary

Add a compact Inbox landing summary, not a separate dashboard page:

- urgent assigned work;
- needs reply;
- payments waiting;
- near reply deadline;
- overdue;
- unassigned team work for coordinators.

Every number is a deterministic queue count and opens the exact queue. The first recommended queue must follow business priority, not model judgement.

### Acceptance criteria

- Every eligible open conversation has at most one visible primary recommendation.
- Payment/complaint/document/visa risk outranks commercial actions.
- A price request cannot recommend quote creation unless live price and seats are safe to quote.
- All eight completeness facts have a visible known/missing state and source.
- Draft provenance matches the exact reply pack used for that proposal.
- A failed Copilot state leaves reply, note, assignment, attachment, and CRM actions usable.
- Every My Shift count reconciles exactly with its opened queue.

## 6.3 `finance-evidence` - attach receipt proof without creating payment truth

### Problem

Receipt analysis correctly creates a blocking Finance review but the retained Inbox object cannot become formal Finance evidence. Staff must manually download and re-upload the proof, losing efficiency and risking loss of the source link.

### Product rule

**Attaching proof is not recording, completing, allocating, or reconciling a payment.**

### Target data contract

Introduce an agency-scoped Finance evidence-intake record separate from `payments` until Finance verifies the claim. It must contain:

- source conversation, message, attachment, and media-analysis identifiers;
- optional linked lead, booking, departure group, and customer;
- private `payment-proofs` Storage path;
- original checksum and MIME type;
- candidate amount/reference/date with confidence and attribution;
- state: `PENDING_REVIEW`, `MATCHED_TO_PAYMENT`, or `DISMISSED`;
- optional verified `payment_id` set only by the Finance workflow;
- created/reviewed actor and timestamps;
- review note.

Use a composite agency foreign-key pattern so a source from another agency cannot be attached. The new table must receive RLS in the same migration.

### Workflow

1. Receipt arrives and opens the existing blocking `PAYMENT_CLAIM` intervention.
2. Authorised staff select **Attach proof to Finance review**.
3. The server re-derives the source attachment and conversation, verifies the retained object/checksum, and copies it into the private `payment-proofs` bucket.
4. The Finance evidence-intake row is created idempotently with the source link.
5. Finance opens the intake from the Inbox or Finance queue, matches it to a booking/payment, and uses the existing Finance record/verification path.
6. Only the Finance path can set `payment_id` and resolve the protected review.
7. A failed copy leaves no evidence row. A repeated request returns the existing intake.

### Permissions

- Admin and Finance can view, match, dismiss, and complete the Finance review.
- Marketing/Operations may attach proof only if the existing Finance access policy explicitly grants that narrow capability; they cannot see the Finance ledger or verify payment.
- CEO remains read-only.
- Visa and Guide have no access.

### Acceptance criteria

- Attaching a receipt changes no payment amount, status, allocation, balance, booking, or seat state.
- The original conversation/message/attachment is traceable from Finance.
- The Finance object and copied Storage path are agency-isolated.
- A duplicate click/retry creates one evidence record and one retained copy.
- Storage failure creates no database record.
- Finance verification resolves the intervention through the existing guarded path.
- Retention follows Finance evidence policy after promotion; the Inbox copy follows Inbox retention.

## 6.4 `media-routing` - useful handling for every supported media family

### A. Passport

Preserve the current conservative flow. Complete live provider/storage/RLS/browser acceptance. Do not broaden silent writes. Saving to Documents remains a submitted document that needs normal verification.

### B. Voice note transcription

Add a staff-only, non-authoritative transcript before adding any voice summary or autonomous use.

Requirements:

- retain and play the original audio;
- transcribe through the shared AI provider/telemetry seam;
- label source model, detected language, confidence where supported, and timestamp;
- display **Non-authoritative transcript - confirm important details with the customer**;
- do not write names, passport numbers, payment facts, booking facts, or lead fields from a transcript without staff confirmation;
- failure leaves playback usable;
- transcript retention cannot outlive the governing conversation/voice policy;
- autonomous replies cannot treat transcript content as verified evidence in the first release.

Summary generation is a later opt-in step after transcript quality has been measured for English, Sinhala, and Tamil.

### C. Brochure and other media

For media classified as brochure/other, provide small deterministic actions:

- open original;
- add an internal note;
- classify/route to Documents, Operations, Finance, Visa, or no action when the user has permission;
- create an appropriate task through the existing conversion proposal flow.

Do not create a generic AI approval card that implies the file was understood.

### D. Office/text files

Keep manual review as the V1 behavior and label it plainly. Extraction for Word, Excel, PowerPoint, CSV, and text files is deferred until a secure parser and format-specific acceptance fixtures exist.

### E. Generic Attach to Record

Defer a universal attach-to-record action. Finance evidence and pilgrim Documents have different permissions, retention, and source-of-truth behavior. Future record types must register a typed promotion handler rather than use one unrestricted generic copier.

### Acceptance criteria

- A transcript failure never hides or blocks playable original audio.
- No transcript-derived sensitive field is persisted without explicit human confirmation.
- Passport and receipt actions remain type-specific and permission-specific.
- A routed brochure/other file creates only the chosen task/link and preserves the source conversation.
- Unsupported or unparsed files are described honestly as manual review.

## 6.5 `productivity-controls` - faster without unsafe bulk behavior

### Keyboard shortcuts

Preserve J/K and `/`, then add discoverable shortcuts where focus and permission allow:

| Shortcut | Action |
|---|---|
| `r` | Focus customer reply |
| `n` | Focus internal note |
| `a` | Open owner assignment |
| `e` | Open linked lead |
| `b` | Open linked booking |
| `q` | Start draft quote flow |
| `g`, then `d` | Open linked departure group |
| `Esc` | Close the active sheet/panel where safe |
| `?` | Open shortcut help |

Shortcuts never fire while typing, using an IME, or interacting with an input/select/content-editable control. Permission checks remain server-side.

### Bulk actions

Allowed bulk actions:

- assign owner;
- close conversations;
- mark spam, after the spam-state contract is defined and reversible;
- apply an existing non-sensitive conversation tag, only if a canonical tag taxonomy is approved separately.

Never bulk-enable:

- customer sends or saved-reply sends;
- risk resolution/dismissal;
- payment or Finance mutation;
- quote, booking, hold, refund, or cancellation;
- identity merge;
- document verification;
- AI proposal approval.

### Acceptance criteria

- Every shortcut is discoverable in the `?` overlay and represented by `aria-keyshortcuts` where applicable.
- Shortcut tests cover typing targets, IME composition, permissions, list boundaries, and sequence timeout.
- Bulk actions retain the bounded limit, report changed/skipped records, and apply one agency-scoped server action.
- No bulk action makes an external or financially material commitment.

## 6.6 `outcomes-and-guidance` - prove value and reduce training cost

### Role-specific documentation

Keep `docs/usages/inbox/usage-guide.md` as the complete operating/engineering reference, then derive:

1. **Inbox Quick Start** - 1-2 pages for Sales/Operations: queues, reply, notes, lead conversion, escalation.
2. **Inbox Safety Guide** - 2-4 pages for Finance/Visa/Operations: payments, passports, visa, complaints, and handoff.
3. **Inbox Admin Manual** - connections, templates, routing, SLAs, autonomy, knowledge, retention, and rollout.
4. **Inbox Engineering Guide** - architecture, source map, worker/queue behavior, runbooks, and test contracts.

These are separate Markdown sources. Generated exports are optional and must not become the source of truth.

### Operational metrics

- median/p95 first-response time;
- percentage within SLA;
- overdue conversation count;
- time spent unassigned;
- time to Finance review;
- time from document/visa need to task creation;
- time from booking confirmation to acknowledged Operations handoff.

### Commercial metrics

- enquiry -> qualified lead;
- qualified lead -> quote;
- quote -> booking;
- booking -> verified deposit;
- conversation source -> departure occupancy;
- response delay -> lost-lead correlation.

### Safety metrics

- unverified payment confirmations blocked;
- stale-price attempts blocked;
- full-group confirmations blocked;
- unapproved bank-detail alerts;
- passport-expiry reviews completed before deadline;
- complaint handoff compliance;
- identity-link approvals/rejections;
- never-autonomous violations, which must remain zero.

### AI quality and cost metrics

- triage correction rate;
- draft accepted/heavily edited/rejected rate;
- offer-match acceptance rate;
- risk false-positive rate by detector;
- autonomy handoff/demotion rate;
- answer-cache hit/retirement rate;
- AI cost per enriched conversation, qualified lead, and booking;
- S0 skip rate and reason.

Every owner metric must drill into the exact deterministic queue or reviewed event set behind it. Currency values remain bucketed by currency and are never silently converted.

### Acceptance criteria

- Metrics are agency-, channel-, role-, and queue-filterable where meaningful.
- No metric is generated as an unexplained model estimate.
- Counts reconcile to source rows in a two-agency fixture.
- Staff docs contain no worker-lane or surface-setting detail unless the reader needs it.
- The complete guide and role guides agree on channel, payment, passport, and autonomy safety rules.

## 6.7 `guide-group-support` - deferred constrained Inbox

This is a separate Phase 2 pilot, not a production-pilot blocker.

### Guide scope

A Guide may view only conversations linked to departure groups to which that Guide is currently assigned, and only during a defined operational window around departure.

Guide may:

- read assigned-group conversations and permitted pilgrim contact context;
- send approved operational replies;
- add internal notes;
- draft or approve group reminders through the applicable policy path;
- report an incident or welfare concern;
- escalate to Operations.

Guide may not:

- see Finance records or payment proofs;
- confirm payment, refund, or cancellation;
- change a booking or price;
- promise visa outcomes;
- access passport files unless a separate least-privilege decision explicitly grants it;
- view another departure group's conversations;
- enable or configure automation.

### Security requirements

- Scope must be enforced in RLS/repository queries and mutation checks, not only hidden in UI.
- Assignment removal revokes access immediately.
- Historical audit retains which Guide acted without retaining access to the conversation after scope ends.
- Cross-group and cross-agency isolation require explicit tests.

### Acceptance criteria

- A Guide cannot list, search, open, subscribe to realtime events for, or mutate a conversation outside assigned groups.
- Permitted operational replies still pass channel policy, consent, protection, and outbox checks.
- Finance, price, payment proof, passport, and unrelated customer context are absent from the Guide response contract.

## 7. Explicitly out of scope

- Replacing the canonical conversation/outbox architecture.
- Allowing an LLM to calculate or authoritatively supply price, seats, balance, payment, visa, or policy facts.
- Autonomous email conversations.
- Bulk customer messaging from the Inbox.
- Bulk approval of proposals or reviews.
- Automatic weak identity merges.
- Automatic payment verification from receipt imagery.
- Automatic passport-to-pilgrim writes.
- A universal attachment copier with unrestricted destination types.
- Office-file extraction before secure format-specific parsers and tests exist.
- Voice-driven autonomous commitments.
- Cross-currency pipeline totals.
- Agency-wide Inbox access for Guides.
- A new component library, colour system, test runner, or AI-provider client.

## 8. Non-functional requirements

### 8.1 Security and tenancy

- Every Server Action/Route Handler begins with `requireUser()`.
- Every input boundary uses Zod.
- Every read/write is scoped to `agency_id`.
- Every new table gets RLS in the same migration.
- Service-role access is limited to verified webhooks, queues/workers, and carefully bounded copy operations.
- New repository functions get two-agency isolation coverage.
- Sensitive attachments use private buckets and short-lived signed URLs.
- Composite foreign keys prevent cross-agency source linking.

### 8.2 Reliability

- Webhooks acknowledge before enrichment.
- Model failure never loses the inbound message or blocks staff operation.
- Every external send remains idempotent and goes through the approved provider-send boundary.
- Promotion/copy workflows are storage-first and leave no dangling database record after failure.
- Human review and payment/document source links survive retries.

### 8.3 Performance and cost

Maintain the programme SLOs:

- inbound message visible p95 under 2 seconds;
- realtime triage p95 under 5 seconds;
- full enrichment p95 under 30 seconds;
- on-demand draft p95 under 6 seconds;
- queue count render p95 under 300 ms at 100,000 conversations for one agency;
- steady-state AI cost per enriched conversation at or below USD 0.012;
- S0 skip rate at least 50% on measured traffic.

No new staff UI may synchronously wait for media analysis or model completion.

### 8.4 Accessibility and copy

- Use existing shadcn components and design tokens.
- Do not communicate state through colour alone.
- Every action has plain-language copy and a keyboard-accessible path.
- AI attribution says `Rules` versus `AI`, includes confidence when meaningful, and exposes evidence where permitted.
- Do not expose internal worker, model, or entitlement jargon to staff.

## 9. Technical specification

### 9.1 Tech stack

- Next.js App Router and React
- TypeScript with strict boundary validation
- Supabase/Postgres, RLS, Realtime, and private Storage
- Zod schemas
- Vitest in the current Node environment
- Playwright for existing Inbox browser acceptance
- Shared AI provider through `generateStructured()` and the existing tool runner
- Existing channel adapters and transactional outbox

### 9.2 Commands

```bash
# Development
npm run dev

# Required quality gates
npm run lint
npm run typecheck
npm run test

# Production build
npm run build

# Existing Inbox browser acceptance
npm run test:e2e -- e2e/inbox-lr2.spec.ts

# Worker verification when a slice changes the worker bundle
npm run worker:build
npm run worker:check
```

Live Supabase/RLS, provider, Storage, and load verification must follow the Inbox runbooks; Vitest is not a substitute for those exits.

### 9.3 Project structure

```text
app/inbox/**
  Staff Inbox route, Server Actions, controllers, and components

app/(main)/management/**
  Admin configuration, autonomy, routing, SLA, retention, channels

lib/inbox/**
  Inbox domain rules: autonomy, media, risk, routing, SLA, conversions,
  intelligence, outbox, retention, realtime, worker contracts

lib/channels/** and lib/whatsapp/**
  Provider-neutral and provider-specific messaging boundaries

lib/data/**
  Agency-scoped data access and repository contracts

lib/access/**
  Role/capability contracts

lib/validations/**
  Zod boundary schemas

supabase/migrations/**
  Schema, RPC, indexes, triggers, RLS, grants

e2e/**
  Browser acceptance

docs/inbox/**
  Architecture, this spec, implementation plan, checklist, programme status

docs/usages/inbox/**
  Staff/admin usage documentation

docs/runbooks/**
  Live operational and provider verification
```

### 9.4 Code style

Use specific names, typed results, authentication first, Zod at the boundary, capability checks, and agency-scoped repository calls.

```ts
export async function attachInboxReceiptToFinanceReviewAction(
  input: unknown,
): Promise<AttachInboxReceiptToFinanceReviewResult> {
  await requireUser();
  const parsed = attachInboxReceiptSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Choose a valid payment proof." };
  }

  const { agencyId, role, staffId } = await getCurrentStaffRole();
  if (!agencyId || !staffId || !canAttachInboxPaymentEvidence(role)) {
    return { ok: false, error: "Your role cannot attach payment evidence." };
  }

  return attachInboxReceiptToFinanceReview({
    agencyId,
    staffId,
    attachmentId: parsed.data.attachmentId,
  });
}
```

No generic `Card`, `handleAction`, `processData`, or untyped payload names. No direct provider or model calls from UI components.

## 10. Testing strategy

### 10.1 Unit tests

Use Vitest for every business-rule branch:

- effective autonomy and legacy migration cases;
- quiet-lead hours, holidays, consent, windows, sequence, and frequency caps;
- next-best-action priority and blocker explanations;
- eight-field completeness and next-question choice;
- draft provenance construction and redaction;
- receipt promotion idempotency and no-payment-mutation invariant;
- voice transcript authority/retention rules;
- Guide group/time-window scope;
- shortcut focus/IME/boundary behavior;
- safe bulk-action allow/deny catalogue.

### 10.2 Repository and migration contract tests

- RLS and composite agency foreign-key assertions.
- Security-invoker view/function checks.
- Search-path and grant checks for security-definer functions.
- Two-agency isolation for every new read/write path.
- Static proof that Finance evidence cannot mutate a payment without the Finance workflow.

### 10.3 Integration tests

Through the real action/kernel boundary with fake database/storage dependencies:

- receipt copy success, failure cleanup, retry, cross-tenant refusal, and Finance match;
- same autonomy result for direct and outbox sends;
- next action -> preview -> confirm creates exactly one correct object;
- transcript failure preserves playback;
- Guide reply uses the normal policy and outbox path.

### 10.4 Browser acceptance

Verify signed-in golden, empty, denied, loading, stale, and failure states for:

- My Shift -> exact queue drill-down;
- one visible recommended action and blocker copy;
- eight-field completeness and editable question insertion;
- verified facts used by a draft;
- receipt -> Finance evidence -> verified resolution;
- transcript/playback behavior;
- ownership warning and composer presence;
- shortcut help and keyboard flows;
- Guide cross-group denial.

### 10.5 Live and load acceptance

- Real channel inbound/outbound tests for WhatsApp, Messenger, Instagram, and email.
- Real private Storage copy/sign/read/retention tests.
- Finance reconciliation test against a non-production bank fixture.
- Existing multi-tenant load harness and all Architecture SLOs.
- L0/L1/L2/L3 promotion, refusal, demotion, and audit proof.

## 11. Boundaries

### Always

- Preserve deterministic sources of truth.
- Use the existing channel adapters, AI seam, outbox, proposal kernel, and access modules.
- Show provenance and uncertainty for model-derived content.
- Keep human messaging available during AI degradation.
- Update `architecture.md`, `implementation-plan.md`, and `checklist.md` in the same slice when behavior or status changes.
- Tick checklist items only after their exit criterion is demonstrated.

### Ask first

- Changing plan packaging or autonomy ceilings.
- Adding a new external AI, OCR, transcription, messaging, or analytics provider.
- Changing retention bounds for passports, payment evidence, audio, or transcripts.
- Granting Marketing/Operations permission to promote Finance evidence.
- Enabling Guide support outside assigned-group scope.
- Adding a new UI/test framework or dependency.
- Changing Meta policy interpretations or supported message limits.

### Never

- Confirm a payment from an image or model extraction.
- Let an LLM calculate or invent price, seats, balance, or policy eligibility.
- Merge identities from weak evidence without staff approval.
- Persist passport/transcript facts without explicit authorised confirmation.
- Allow a bulk action to send or make a material commitment.
- Weaken RLS, agency scoping, validation, audit, or the protection gate for convenience.
- Hide a failed/disabled AI state in a way that prevents staff from working manually.
- Mark an implementation/checklist item complete without passing evidence.

## 12. Delivery plan

Each row becomes its own detailed slice in `implementation-plan.md` after this specification is approved.

| Slice | Deliverable | Depends on | Exit evidence |
|---|---|---|---|
| ISP0 | Baseline reconciliation and live pilot matrix | Existing programme | Current code, flags, migrations, channels, and checklist agree |
| ISP1 | Canonical autonomy backfill and legacy fallback removal | ISP0 | L0-L3 direct/outbox/live proof; no legacy override |
| ISP2 | Remove misleading failed-turn setting and document immediate handoff | ISP1 | UI/schema/runtime/docs agree; failure handoff tests pass |
| ISP3 | Expose recommended next action and actionable Copilot states | ISP0 | One action per scenario; no AI-state blocking |
| ISP4 | Lead completeness 2.0 and verified draft facts | ISP3 | Eight facts, source labels, exact proposal provenance |
| ISP5 | My Shift landing and exact queue drill-down | ISP3 | Counts reconcile to queue rows |
| ISP6 | Finance evidence intake and receipt promotion | ISP0 | No-payment-mutation, Storage/RLS/idempotency/live proof |
| ISP7 | Voice transcript and brochure/other routing | ISP6 contracts where Finance is involved | Playback fallback, attribution, permission, retention proof |
| ISP8 | Shortcut expansion, help, and safe bulk controls | ISP3 | Keyboard/bulk unit and browser acceptance |
| ISP9 | Outcome metrics and role-specific docs | ISP1-ISP8 | Exact drill-down, tenant reconciliation, docs acceptance |
| ISP10 | Guide group-support design and pilot | ISP9 and separate approval | Cross-group/RLS denial plus operational reply proof |

### Release checkpoints

#### Checkpoint A - safe staff-operated pilot

Required: existing core, ISP0-ISP6, channel acceptance, payment/passport protection, no unresolved P0 security defects.

L2/L3 automation, Guide support, voice-derived autonomous behavior, and campaigns are not required.

#### Checkpoint B - measured assisted operation

Required: ISP7-ISP9, one week of operational metrics, reviewed triage/risk samples, stable channel delivery, zero never-autonomous violations.

#### Checkpoint C - bounded autonomy pilot

Requires the existing R5 evidence thresholds and no blockers. Enable one agency and one narrow action set at a time, with automatic demotion and rollback.

#### Checkpoint D - Guide group-support pilot

Separate decision after assigned-group security and privacy review.

## 13. Final system capability

When this specification and the standing Inbox programme are complete, Manasik Inbox can:

1. Receive and send agency conversations across WhatsApp, Messenger, Instagram, and email under provider rules.
2. Organise work by ownership, customer waiting state, sales stage, payment/document/visa need, complaint, urgency, and SLA.
3. Route work using owner stickiness, role/skill, staff availability, and load.
4. Show one explainable next action while keeping all consequential actions human-confirmed or explicitly bounded.
5. Read intent, urgency, sentiment, language, and travel facts with evidence and confidence.
6. Match live sellable departure options without using a model for prices or availability.
7. Create editable grounded replies and show the verified facts used.
8. Link identities safely across channels through staff-reviewed evidence.
9. Turn a conversation into leads, quotes, booking/seat-hold work, follow-ups, tasks, cases, relationships, recommendations, and handoffs with source traceability.
10. Review passports, update traveller fields only after confirmation, assign visa work, and save the passport to Documents.
11. Treat receipts as payment claims, copy them into a Finance evidence intake, and keep payment verification inside Finance.
12. Play voice notes and show a clearly non-authoritative staff transcript without making autonomous commitments from it.
13. Protect sends from stale price, full inventory, unverified payment, unapproved bank details, passport risk, complaint/refund, medical/religious, and other guarded claims.
14. Enforce channel windows, templates, HUMAN_AGENT rules, consent, working hours, quiet-lead frequency, and final provider-send authorisation.
15. Support L0-L3 autonomy through one auditable, evidence-gated policy that can only be reduced by risk, plan, channel, or human ownership state.
16. Remain fully usable when AI is slow, skipped, disabled, exhausted, or failed.
17. Preserve private media, tenant isolation, retention, audit, and least-privilege access.
18. Show owners whether Inbox performance improves response, conversion, safety, and handoff outcomes rather than merely increasing AI activity.
19. Later provide Guides with a strictly assigned-group operational support surface without exposing Finance or unrelated customer data.

The intended product is not an AI chat window. It is the agency's safe daily command centre:

```text
messages -> priorities -> verified context -> guarded action -> accountable work -> measurable outcome
```

## 14. Resolved approval questions

The Phase 0 decision lock accepts D1-D7 from the implementation plan. In
product terms:

1. Finance evidence promotion is allowed for ADMIN, CEO, FINANCE, and assigned
   conversation staff with `openFinanceReview`; the server-side capability
   check is authoritative.
2. Unmatched evidence follows the agency Inbox retention policy, with legal
   hold taking precedence.
3. Transcription stays behind the existing provider abstraction; English,
   Arabic, and mixed-language output are allowed, and low confidence is visible.
4. The eight facts visually distinguish `confirmed`, `customer-stated`,
   `inferred`, and `missing`; only the first two satisfy readiness.
5. My Shift is the default for staff roles; ADMIN/CEO keep the current default
   until usage evidence supports a change.
6. Bulk tagging is deferred until an agency tag taxonomy and permission
   contract exist.
7. Guide access, including its operational window, moves to a separate
   approval-gated pilot specification after the core release.

The evidence and exact before-state are recorded in the
[BLN-01 baseline](../progress/2026-09-29-inbox-bln-01-baseline.md).

## 15. Specification approval checklist

- [x] Capability module boundaries and dependency direction are approved.
- [x] Existing-versus-new reconciliation is accepted.
- [x] Finance evidence model and permissions are approved.
- [x] Voice transcript authority, languages, provider, and retention are approved.
- [x] Guide support is moved to a separate pilot specification.
- [x] Success metrics and SLOs are accepted.
- [x] Open questions are resolved or explicitly deferred.
- [x] Approved requirements are represented by the dependency-ordered tasks in `spec-task-list.md`; the standing `implementation-plan.md` links the BLN-01 lock.
- [x] BLN-01 is recorded in `checklist.md`; later task boxes are added only when their delivery slice begins.

