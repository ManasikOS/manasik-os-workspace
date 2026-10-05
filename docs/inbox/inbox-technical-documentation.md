# Inbox — How It Works (Technical Documentation)

> **Audience:** engineers who build, run or review the Inbox.
> **Scope:** the Inbox page (`/inbox`) and everything behind it — channels, queue, intelligence pipeline, outbound path, realtime, security, scheduled work.
> **Written:** 5 October 2026, from the code on branch `inbox-conversation-writing-hardening`. Where this file and a deeper design doc disagree, the code wins; tell the doc's owner.
> **Companion:** [`inbox-user-guide.md`](./inbox-user-guide.md) is the plain-language guide for staff. The design record and the 33-slice plan stay in [`architecture.md`](./architecture.md) and [`implementation-plan.md`](./implementation-plan.md); this file is the *map*, those are the *why*.

## Contents

1. [What the Inbox is](#1-what-the-inbox-is)
2. [The big picture](#2-the-big-picture)
3. [Design rules that shape everything](#3-design-rules-that-shape-everything)
4. [Where the code lives](#4-where-the-code-lives)
5. [Conversation model and states](#5-conversation-model-and-states)
6. [Inbound path: customer message → Inbox](#6-inbound-path-customer-message--inbox)
7. [The job queue, lanes and workers](#7-the-job-queue-lanes-and-workers)
8. [The intelligence pipeline (Copilot's reading)](#8-the-intelligence-pipeline-copilots-reading)
9. [Risk detection, reviews and the protection gate](#9-risk-detection-reviews-and-the-protection-gate)
10. [Queues, views and SLA](#10-queues-views-and-sla)
11. [Outbound path: staff reply → customer](#11-outbound-path-staff-reply--customer)
12. [Channel rules (reply windows)](#12-channel-rules-reply-windows)
13. [Ownership, assignment and routing](#13-ownership-assignment-and-routing)
14. [The assistant and the autonomy ladder](#14-the-assistant-and-the-autonomy-ladder)
15. [Media, attachments and voice notes](#15-media-attachments-and-voice-notes)
16. [Identity, leads and CRM links](#16-identity-leads-and-crm-links)
17. [Conversions, quotes, bookings and handoff](#17-conversions-quotes-bookings-and-handoff)
18. [Reading data: the UI's server actions](#18-reading-data-the-uis-server-actions)
19. [Realtime and client sync](#19-realtime-and-client-sync)
20. [The UI architecture](#20-the-ui-architecture)
21. [Security model](#21-security-model)
22. [Scheduled work](#22-scheduled-work)
23. [Retention, deletion and health](#23-retention-deletion-and-health)
24. [Testing](#24-testing)
25. [Configuration](#25-configuration)
26. [How to extend it](#26-how-to-extend-it)
27. [Known limits and caveats](#27-known-limits-and-caveats)
28. [Related documents](#28-related-documents)

---

## 1. What the Inbox is

The Inbox is the CRM's **unified customer-conversation workspace**. One screen receives and sends messages on four channels — **WhatsApp, Facebook Messenger, Instagram and Email** — and ties each conversation to the CRM (lead, booking, departure group, follow-up, tasks, Finance and Documents).

It has two halves:

| Half | What it does |
|---|---|
| **Inbox** | Conversation platform: receive, store, thread, show, reply, assign, close, search. Channel-neutral — every channel flows through the same tables and code. |
| **Copilot** | Intelligence layer: reads each conversation, classifies it, extracts trip details, matches a live departure, raises "human review" cards, proposes a next action, drafts replies, and (only if an administrator opts in) sends limited automatic replies. |

The Inbox opens at `app/inbox/page.tsx` as a **standalone full-screen page** with no CRM header or sidebar (`app/inbox/layout.tsx`). The same workspace component also backs a header launcher overlay (`components/header-inbox-launcher.tsx`).

---

## 2. The big picture

```
 CUSTOMER                                                                    STAFF
 ───────                                                                     ─────
 WhatsApp ─┐                                                      ┌─ Browser: /inbox
 Messenger ┼─▶ Webhook routes ─▶ raw event ─▶ ingest ─▶ Postgres  │   InboxWorkspaceController
 Instagram ┘   (verify sig,      (idempotent,   │  conversations  │        │ server actions (reads)
 Email ──▶ IMAP poll (cron)       stored)       │  messages       │        ▼
                                                │  attachments    │   lib/data/inbox-*-repository
                                                ▼                 │        │
                                        channel_jobs queue        │        │ Supabase RLS + agency scope
                                        (3 lanes, fair-share)     │        ▼
                                                │                 │   Postgres  ◀── Realtime broadcast
                                                ▼                 │        ▲        (invalidation only)
                       ┌────────────── lane workers ──────────────┘        │
                       │  ENRICH → S0 gate → S1 triage → S2 intent →       │
                       │  S3 offer match → risk detectors → projection     │
                       │  REPLY (assistant) · TRANSCRIBE_VOICE · …         │
                       └──────────────────────────────────────────────────┘

 STAFF REPLY:  sendStaffMessage ─▶ protection gate ─▶ enqueue_inbox_*_message RPC ─▶ outbox
               ─▶ outbox drain ─▶ authorize send ─▶ channel adapter ─▶ Meta / SMTP ─▶ delivery webhook
```

Three properties to hold in your head:

1. **The webhook does fast I/O only.** It verifies, stores and queues. It never calls a language model.
2. **Postgres owns state *and* the clock.** Queue membership, sequencing, idempotency, fairness, and schedules (`pg_cron`) all live in the database.
3. **Realtime is a doorbell, not a courier.** It says *what changed*; the browser then reads the data through normal, permission-checked server actions.

---

## 3. Design rules that shape everything

These come from [`architecture.md`](./architecture.md) §1, §9, §10, §16 and repeat in code comments. Break one and a test usually fails.

| Rule | What it means in code |
|---|---|
| **Deterministic core, LLM at the edges** | Queues, SLA, ownership, routing, window rules, and send gating are plain functions (`lib/inbox/**`) with unit tests. A model is only asked to *read* (classify, extract, summarise, draft). |
| **Never put a model on the critical path** | Webhook → persist → ack. Enrichment and replies are queued jobs. |
| **Risk is never gated on cost** | The S0 gate may skip the model to save money, but red-flag rules (refund, distress, unapproved bank number) still run (`lib/inbox/intelligence/gate.ts`). A test pins this; do not delete it. |
| **Never-autonomous list lives in code** | Eleven things an automated reply must never say (`lib/inbox/risk/never-promise.ts`). A constant, not a setting. |
| **Every query names the agency** | Row-level security is the second line, not the first. Every action and repository filters by `agency_id`. |
| **Server re-checks everything** | A hidden button is never the security boundary. `sendStaffMessage` re-checks role, agency, window, reviews, file bytes. |
| **Fail closed on unknown** | If the open-review check can't be read, nothing is sent. If a rate-limit counter is unreadable and the action costs money, it is refused. |
| **Idempotent writes** | Browser-generated `client_idempotency_key` on sends; `coalesce_key` on jobs; unique `external_event_id` on webhooks; compare-and-swap on bulk updates. |
| **Honest data states** | Intelligence is `PENDING / FRESH / STALE / SKIPPED / FAILED`. Outcome cards say "No data yet", "Not measurable yet" or "Could not be read" — never a fake zero. |

---

## 4. Where the code lives

| Area | Path | What is there |
|---|---|---|
| **Page** | `app/inbox/page.tsx`, `layout.tsx`, `error.tsx` | Role gate (`capabilitiesForInbox(role).viewModule` else `notFound()`), URL → request (`?conversation=`, `?view=`), suspended-agency page. |
| **UI components** | `app/inbox/components/*` (≈70 files) | Controller, list, thread, composer, rail, customer panel, dialogs. See §20. |
| **Server actions (writes)** | `app/inbox/actions.ts` (~2,650 lines) | Send, assign, take control, close, delete, notes, drafts, start chat, templates, bookings, passports, bulk, saved views, handoff, identity… |
| **Server actions (reads)** | `app/inbox/dialog-actions.ts` | `loadInbox*Action` family. Thin wrappers over the repository. |
| **Other actions** | `conversion-actions.ts`, `outcome-actions.ts`, `vault-actions.ts` | Turn-into-work, Outcomes panel, Document Vault. |
| **Shared UI types** | `app/inbox/types.ts` | `InboxConversation`, `InboxListData`, `InboxThreadDelta`, … |
| **Access (RBAC)** | `lib/access/inbox-access.ts` | `capabilitiesForInbox(role)` — the one permission table. |
| **Domain logic** | `lib/inbox/**` (≈250 files) | Pure rules, pipeline, risk, routing, SLA, outbox, media, retention, worker. |
| **Data layer** | `lib/data/inbox-*-repository.ts`, `conversation-*-repository.ts` | Typed reads/writes against Supabase. |
| **Validation** | `lib/validations/inbox.ts` | Zod schemas for every action input. |
| **AI surfaces** | `lib/ai/surfaces/inbox/*` | Triage, travel-intent, risk-classify, translation, handoff-narrate, workflows. |
| **Assistant (auto-reply)** | `lib/agent/whatsapp/*`, `lib/inbox/autonomy/*`, `lib/inbox/reply/*` | The customer-facing assistant turn and its gates. |
| **Channels** | `lib/channels/*`, `lib/whatsapp/*` | Adapters, profiles, policy state, webhook handlers, email IMAP. |
| **Webhooks** | `app/api/webhooks/{whatsapp,messenger,instagram,meta}` | Signed inbound endpoints. |
| **Cron routes** | `app/api/cron/inbox-*`, `reply-window-sweep`, `agent-jobs` | Scheduled drains and sweeps. |
| **Always-on worker** | `worker/index.ts`, `lib/inbox/worker/*` | Optional long-running process draining the lanes. |
| **Migrations** | `supabase/migrations/` (236 files) | Tables, RLS, RPCs, triggers, cron. |
| **Tests** | `*.test.ts` beside code; `e2e/inbox-*.spec.ts` | Vitest + Playwright. See §24. |

**Naming rule** (from `AGENTS.md`): never use generic component/function names; keep them specific to what they do. UI uses shadcn components only.

---

## 5. Conversation model and states

A **conversation** is one customer on one channel (`conversations` table; `channel` ∈ `WHATSAPP | MESSENGER | INSTAGRAM | GMAIL`, `external_conversation_id` = wa_id / PSID / IGSID / email). Each has a `lead_id` (nullable), an owner (`assigned_to_id`, `assigned_to_name`), messages, notes, attachments and a stored intelligence projection.

### 5.1 State machine (`lib/types/whatsapp.ts`)

| `state` | Plain meaning | Assistant may reply? | Next responder |
|---|---|---|---|
| `AI_ACTIVE` / `AI_RESUMED` | The assistant is handling replies | Yes | Assistant |
| `HUMAN_REQUESTED` | The assistant stopped; a person must reply | No | Staff |
| `HUMAN_ACTIVE` | A person owns the chat | No | Staff |
| `CLOSED` | Finished; a new customer message reopens it | No | Nobody |

`lib/inbox/ownership-status.ts` turns state + owner into the header chips ("Assigned to you", "Assistant paused", "Staff action needed"). Raw state names never reach the screen.

There is also `handling_mode` (`AI_ACTIVE | AI_PAUSED | HUMAN_REQUESTED | HUMAN_ACTIVE`) and a `lifecycle_status` used by spam handling (see [`spam-state-contract.md`](./spam-state-contract.md)).

### 5.2 Ownership transitions

Pure rules, in `lib/inbox/ownership-guard.ts` and `assignment.ts`:

- **Take control** — refused on a closed chat and on a chat a *colleague* owns.
- **Send a reply** — refused up front if someone else owns it (it would make the sender the owner). If the chat was assistant/unowned, sending auto-takes control first (and rolls that back if queueing fails).
- **Hand back to AI** — only the owner or an administrator, and never while a review is open.
- **Assign** — a separate, recorded action (`assignConversationAction`). A person owning a chat pauses the assistant. Removing the owner from a non-assistant chat puts it back to `HUMAN_REQUESTED` so it never sits silently ownerless.

### 5.3 Other tables you will meet

`conversation_messages` (canonical, with `sequence_number` assigned by the database and `client_idempotency_key`), `conversation_notes`, `message_attachments`, `conversation_intelligence` (one projection row per chat), `conversation_signals` (append-only observations), `conversation_interventions` (the red review cards), `conversation_queue_membership` (derived queue rows), `contact_identity_links`, `channel_jobs` (work queue), `outbox_messages` (provider-neutral send queue), `reply_intents`, `conversation_answer_cache`, `inbox_autonomy_decisions`, `inbox_sla_policies`, `inbox_routing_policy`, `inbox_rate_limit_overrides`, `saved_replies`, `whatsapp_templates`. Shape and rationale: [`architecture.md`](./architecture.md) §5.

---

## 6. Inbound path: customer message → Inbox

### 6.1 WhatsApp / Messenger / Instagram

`app/api/webhooks/whatsapp/route.ts` (and the Messenger/Instagram siblings) delegate to `lib/whatsapp/webhook-handler.ts` (`handleWebhookDelivery`). In order:

1. **Bound the body** (`readBoundedWebhookBody`) — an unauthenticated caller cannot make us buffer an arbitrary payload (413).
2. **Verify the signature** (`x-hub-signature-256`) against the app secret. Invalid → record only a *size stub* (rate-capped, SEC-7) and return 401. A forged payload never reaches a conversation.
3. **Resolve the tenant** from the `phone_number_id`. No match → record and stop; an agency is never guessed.
4. **Record the raw event** idempotently by external event id. A Meta redelivery returns `duplicate`.
5. **Ingest** (`lib/inbox/ingest.ts`, the one shared inbound path):
   upsert conversation → link or create the lead (never guessing across ambiguous matches) → store the message **and its required jobs in one transaction**.
6. **Echoes and statuses** — a message the agency typed in the WhatsApp Business app is shown as staff and keeps the assistant quiet; delivery statuses update `delivery_status`; Meta pricing info is captured into a charges table (priced later by a nightly sync).
7. **Unsupported types** — only `text`, `document`, `image`, `audio` are stored ([`whatsapp-supported-message-types.md`](./whatsapp-supported-message-types.md)). Others (video, location, sticker, contacts, …) are not stored and trigger at most one polite refusal per sender per delivery. Reactions are silently ignored.
8. **Acknowledge 200**, then — only if the always-on worker is *not* active — `after()` kicks short opportunistic drains of the agent and REALTIME lanes. The scheduled drains are the guarantee.

Inbound media is persisted and labelled before any media model may read it (`lib/inbox/media/ingest.ts`).

A **raw-event reconciler** (`lib/inbox/reconcile/raw-events.ts`) re-finds messages whose raw event arrived but whose message row is missing, so a crash between steps 4 and 5 loses nothing.

### 6.2 Email

There is no inbound webhook. `app/api/cron/inbox-email-poll` (every 2 minutes) polls the connected mailbox over IMAP (`lib/channels/email/imap-poll.ts`) and feeds the same `ingest`. A mailbox must have IMAP on; the Inbox only offers "new email" once `lib/inbox/email-mailbox-readiness.ts` says it is ready. Outbound mail uses SMTP through `lib/channels/email/adapter.ts`. Trust and deliverability (sender identity, SPF/DKIM/DMARC checks, bounce handling) live in `lib/inbox/email-trust/*` — see [`email-trust-guardian-implementation-plan.md`](./email-trust-guardian-implementation-plan.md).

### 6.3 Test agencies

An agency with `agencies.is_test` never talks to a real provider: its adapter is `lib/inbox/simulator/simulated-adapter.ts`, which answers every send from memory. Failures can be provoked by recipient id (`sim-fail-token-dead`, `sim-fail-rate-limited`, …). Outside production, `INBOX_OUTBOUND_ALLOWLIST` limits sends to named contacts (**empty = send to nobody**; `*` = everyone; ignored in production and flagged by the go-live gate).

---

## 7. The job queue, lanes and workers

Per-message work is queued in **`channel_jobs`** (migration series `mi1_*`; TypeScript face `lib/inbox/jobs/queue.ts`). All writes go through service-role RPCs: `enqueue_channel_job`, `claim_channel_jobs`, `complete_channel_job`, `fail_channel_job`, `release_stale_channel_jobs`. Fairness, coalescing and dead-lettering are enforced in SQL so they are atomic.

### 7.1 Lanes and job kinds (`lib/inbox/intelligence/contracts.ts`)

| Lane | Job kinds | Why this lane |
|---|---|---|
| **REALTIME** | `ENRICH`, `IDENTITY_MATCH`, `REPLY` | A customer is waiting. |
| **STANDARD** | `OFFER_MATCH`, `RISK_SCAN`, `QUEUE_REFRESH`, `HANDOFF_SUMMARY` | Soon, not instant. |
| **BULK** | `TRANSCRIBE_VOICE`, `READ_DOCUMENT`, `EXTRACT_RECEIPT`, `EMBED_KNOWLEDGE`, `RETENTION_SWEEP`, `USAGE_ROLLUP`, `REPLAY` | Can wait. |

`LANE_FOR_JOB_KIND` is an exhaustive record: a job kind can never land on the wrong lane. Statuses: `QUEUED → RUNNING → DONE | FAILED | DEAD`.

### 7.2 Properties

- **Per-tenant fair share** — a claim takes a batch with a per-agency cap so one noisy agency cannot starve others.
- **Burst coalescing** — five messages in eight seconds make *one* `ENRICH` run: a unique index on `(agency_id, coalesce_key)` while `QUEUED`, plus a short settle delay that each new message pushes out (`lib/inbox/jobs/settle.ts`). First-contact triage is not delayed.
- **Leases** — claims are leases. A dead worker's job is released (`release_stale_channel_jobs`). Handlers **must be idempotent** because JavaScript cannot cancel a promise; a job that outlives its budget is failed for retry and may still finish in the background.
- **No handler = loud failure** — a kind with no registered handler is dead-lettered, never silently consumed. Every entry point that drains must `import "@/lib/inbox/intelligence/register-handlers"`.
- **Fan-out** — a REALTIME backlog is absorbed by width: above a depth threshold the coordinator invokes N parallel shards (`lib/inbox/jobs/fan-out.ts`).
- **Repair** — `repair_missing_enrich_jobs` re-queues enrichment for any recent inbound message with no reading and no live job; a similar sweep re-queues attachment downloads (`lib/inbox/jobs/repair.ts`).

### 7.3 The REPLY job (`lib/inbox/reply/*`)

The assistant's answer, guarded by `reply_intents`: a retry of an already-produced reply sends *that* reply (no second model call); a retry of an already-sent one does nothing; an uncertain send is never auto-resent (staff are told); a reply is dropped if the customer wrote again and a newer REPLY job exists, so a burst ends in one answer.

### 7.4 Who drains the queues

| Drainer | How |
|---|---|
| **Scheduled** (guarantee) | `pg_cron` → `public.invoke_cron_route` → `GET /api/cron/inbox-lanes` (every minute) and `/api/cron/agent-jobs` (every minute). |
| **Opportunistic** | `after()` in the webhook / `sendStaffMessage`, only when `INBOX_WORKER_ACTIVE` is off. |
| **Always-on worker** (optional) | `worker/index.ts` + `lib/inbox/worker/*`: REALTIME / STANDARD / BULK lane workers, outbox drain, agent-jobs drain, delivery-status drain, raw-event reconcile, stale-lease sweep, health port. Defaults: concurrency REALTIME 40 / STANDARD 10 / BULK 4. On shutdown it hands unfinished jobs back with the attempt refunded. |

The worker is never required for correctness — only for latency. A down worker means replies are later, not lost. Set `INBOX_WORKER_ACTIVE=1` on the web deployment once a worker runs, so webhooks return in milliseconds. Runbook: [`../runbooks/inbox-worker.md`](../runbooks/inbox-worker.md).

---

## 8. The intelligence pipeline (Copilot's reading)

One `ENRICH` job = one run of `runEnrichment` (`lib/inbox/intelligence/pipeline.ts`) for one conversation:

| Stage | File | Model? | What it does |
|---|---|---|---|
| **S0 Gate** | `gate.ts` | **No** | Decides whether to enrich (skip reasons: surface off, plan exhausted, closed/spam, human active, unchanged fingerprint, one-word acknowledgement…). Every decision + reason is logged for the "skip rate" KPI. Target: 55–70 % of inbound exits here. Red flags still raise `escalateToRisk`. |
| Digest | `digest.ts` | rules | Rolling conversation digest. |
| **S1 Triage** | `lib/ai/surfaces/inbox/triage.ts` | one cheap call, rule fallback | Intent (13 codes: `PACKAGE_ENQUIRY`, `PRICE_REQUEST`, `BOOKING_REQUEST`, `PAYMENT_CLAIM`, `DOCUMENT_ISSUE`, `VISA_QUERY`, `ITINERARY_QUERY`, `COMPLAINT`, `CANCELLATION`, `GROUP_ENQUIRY`, `FAQ`, `SPAM`, `OTHER`), urgency (`LOW…CRITICAL`), sentiment (`POSITIVE…DISTRESSED`), language, confidence. |
| **S2 Travel intent** | `travel-intent.ts` | conditional | Only for commercial intents (package/price/booking/group): journey, party, period, room, budget, departure city. |
| **S3 Offer match** | `offer.ts` | **No** | Matches a live departure group (price, seats, inclusions, match reasons). Re-checked live every time an action runs. |
| Commercial stage | `commercial-stage.ts` | rules | `UNQUALIFIED → QUALIFYING → READY_TO_RECOMMEND → QUOTE_SENT → BOOKING_READY → BOOKED/LOST`. |
| **S4 Risk** | `lib/inbox/risk/*` | rules; model only on ambiguity | See §9. |
| **S5 Draft / next action** | `next-best-action.ts`, `actions.ts: suggestConversationReplyAction` | on demand only | Recommended next action card; Copilot draft on staff click. |

The result is written once as the **projection** (`conversation_intelligence`). Each fact carries a `reasoning_source` (`RULES` or `LLM`), a confidence and evidence spans, so the UI says "Keyword match, not the AI model" honestly and **Why?** can jump to the customer's own words.

The surface is `INBOX_TRIAGE` in `ai_surface_settings`. **No row = OFF**, not permissive. Each pipeline version is stored so reads can be replayed (`REPLAY` job). Operations: [`../runbooks/inbox-intelligence-operations.md`](../runbooks/inbox-intelligence-operations.md).

Cost controls: the gate, fingerprint idempotency (unchanged text = no rerun), an agency answer cache (`lib/inbox/answers/*`, only *approved* answers), plan entitlements and per-action rate limits (§21.4).

---

## 9. Risk detection, reviews and the protection gate

### 9.1 Detectors (`lib/inbox/risk/detectors/*`, pure, run by `risk/run.ts`)

A throwing detector is skipped and reported — one bad rule must not hide a payment claim.

| Detector | Fires when |
|---|---|
| `PAYMENT_CLAIM_UNVERIFIED` | Customer says they paid and no confirmed payment covers it. |
| `BANK_DETAIL_MISMATCH` | A bank word plus 6–20 digits not on the approved list. |
| `STALE_PRICE_QUOTED` | A sent price has since changed (**change-detected**, never age-based — decision R1). |
| `GROUP_FULL_REQUESTED` | Requested departure has fewer seats than the party, or is closed. |
| `PASSPORT_EXPIRY_RISK` | A passport expires before departure + the agency's validity months. |
| `SENSITIVE_DOC_RECEIVED` | An identity/financial document arrived (filename/caption based). |
| `MINOR_OR_ASSISTANCE_NEEDED` | Traveller under 18, accessibility need, or assistance words. |
| `UNRECORDED_BOOKING_CLAIM` | Customer quotes a booking reference we cannot find. |
| `WINDOW_CLOSING_SOON` | Free-reply window closes within 2 h and we still owe an answer. |
| `CONCURRENT_COMPOSER` | Someone is writing a reply right now (last two minutes). |
| `LOW_CONFIDENCE_DRAFT` | Intent confidence below the rail's threshold. |

Rule-only flags for refund, distress and fraud are raised in the pipeline whatever the gate decided.

### 9.2 Interventions (the red "Human review required" cards)

Table `conversation_interventions`. Kinds: `PAYMENT_CLAIM`, `BANK_DETAIL_MISMATCH`, `STALE_PRICE`, `GROUP_FULL`, `PASSPORT_EXPIRY`, `REFUND_REQUEST`, `DISTRESSED_CUSTOMER`, `COMPLAINT`, `FRAUD_CONCERN`, `MEDICAL_URGENCY`, `RELIGIOUS_RULING`, `SENSITIVE_DOCUMENT`, `ASSISTANCE_NEEDED`, `UNRECORDED_BOOKING`, `SLA_BREACH`. Severity `REVIEW` or `BLOCK`; status `OPEN → ACKNOWLEDGED → RESOLVED | DISMISSED`. "Open" = `OPEN` or `ACKNOWLEDGED`. Resolve and dismiss require a note (≤ 1,000 chars). Closing the four money reviews (payment, bank, refund, fraud) is limited to Finance/Admin; the guidance text lives in `lib/inbox/risk/interventions.ts`. Updates go through `updateInterventionAction`.

### 9.3 The protection gate (`lib/inbox/risk/protection-gate.ts`)

One pure decision, three audiences, **enforced on the server at every surface**:

| Audience | Rule |
|---|---|
| `AUTOMATED_SEND` (assistant) | Refused if it says anything on the never-autonomous list, and refused outright while *any* blocking review is open. |
| `AI_DRAFT` (Copilot draft for a person) | Refused if on the never-list, or if it says what an open blocking review guards. |
| `STAFF_SEND` (a person) | The never-list does **not** apply; only the open-review rule does ("we have received your payment" cannot be sent until Finance resolves the payment review). |

The text checked is everything the customer will see, via `outboundGateText` — subject, body **and file name** (`sendStaffMessage` passes all three).

### 9.4 The never-autonomous list (`never-promise.ts`)

Confirm a payment · promise visa approval · grant a discount · guarantee/hold seats or rooms · change/move a booking · give unapproved bank details · promise a refund or free cancellation · give a religious ruling · give health/safety advice · close a complaint · send a marketing broadcast. A phrase matcher that errs toward refusing. Three layers: prompt (weakest) → phrase matcher → outbound send gate (strongest). A test asserts each entry is refused at **every** autonomy level.

---

## 10. Queues, views and SLA

### 10.1 Queues are computed in SQL

Which conversations belong to which queue is decided **once, in SQL** (`compute_conversation_queues`, maintained by triggers) and stored in `conversation_queue_membership`. `lib/inbox/views.ts` only names the views and maps each to a `QueueCode` (`VIEW_QUEUE`, exhaustive by type). `lib/inbox/queues.ts` holds the catalogue (label, one-sentence description, group, icon, `available`).

| Group | Queues |
|---|---|
| **Inbox** | All, Assigned to me (`MINE`), Unassigned, Needs a reply, Waiting for customer, Waiting for our team, Closed (`RESOLVED`), Spam |
| **Sales** | New enquiries, Qualified, Ready to book (`BOOKING_READY`), Quote sent |
| **Needs attention** | Urgent (`ESCALATIONS`), Complaints, Payments (`PAYMENT_DISCUSSIONS`), Documents, Visa questions (`VISA_ISSUES`), Nearing deadline, Overdue (`SLA_BREACHED`) |
| **Channels** | WhatsApp, Instagram, Messenger, Email |

`DEPARTURE_CHANGES` and `GROUP_CHANGES` exist as codes with `available: false` (no predicate yet); they are hidden. The rail always shows the daily set (All, Mine, Unassigned, Needs reply, Waiting ×2) and tucks empty queues under "More queues". Counts come from `inbox_queue_counts`; the open view's badge is the *loaded* list size (`loadedListBadge`), so the rail never disagrees with the list. `agency_settings.inbox_queues_v2` switches an agency between the grouped rail and the simple menu.

Pagination is keyset (`QUEUE_PAGE_SIZE = 100`, cursor from `inbox-queue-repository.ts`).

### 10.2 SLA (`lib/inbox/sla/*`)

A deadline passes **without any row changing**, so triggers cannot notice it — a sweep does. `/api/cron/inbox-sla` (every 2 minutes) runs `runSlaSweepForAgency`: recompute `sla_due_at` with the pure `computeSlaDueAt()` (the *only* place business-hours arithmetic lives), refresh queue membership when the deadline band changes, and apply `decideBreachActions()`. Bounded per run (oldest waiting first). Paused queues (Waiting ×2, Closed) have no policy by design.

Defaults (minutes, `DEFAULT_SLA_POLICIES`, overridable per agency in `inbox_sla_policies`):

| Queue | First reply | Resolution | Clock |
|---|---|---|---|
| Urgent, Complaints | 15 | 24 h | Always |
| Ready to book | 15 | 4 h | Business hours |
| Payments | 30 | 4 h | Business hours |
| New enquiries | 30 | 8 h | Business hours |
| Needs reply | 60 | — | Business hours |
| Qualified, Quote sent | 120 | 48 h | Business hours |
| Documents, Visa | 240 | 3×8 h | Business hours |

Only Urgent, Complaints, Payments and Ready-to-book can open an `SLA_BREACH` review (`SLA_INTERVENTION_QUEUE_CODES`), and only if the agency opted in.

### 10.3 Search and saved views

`lib/inbox/search-query.ts`: ≥ 2 and ≤ 60 chars; characters outside letters/digits/marks/`+-.@#` are stripped (the text goes into a PostgREST `or` filter where a comma or bracket would change its meaning); at most 50 results; supports Sinhala/Tamil/Arabic (`arabic-script.ts`, trigram indexes). A saved view is a queue plus optional search per person (`saved-views.ts`, name ≤ 40 chars, small cap per person).

---

## 11. Outbound path: staff reply → customer

`sendStaffMessage` (`app/inbox/actions.ts`) is the single send entry point from the UI:

1. `requireUser()`; Zod-validate (`inboxStaffMessageSchema`, or the caption schema when a file is attached).
2. **In parallel**: role lookup + conversation read. Check `sendMessage` capability, agency match.
3. If a file is attached: **read it back from storage and judge it from its own bytes** (`verifyStagedAttachment`) — the browser's declared type is never proof.
4. **Protection gate** (`STAFF_SEND`) on subject + body + filename. Unreadable reviews → refuse.
5. Refuse if `CLOSED`; refuse if the channel has no adapter.
6. **Window check** (not for email): expired `service_window_expires_at` → WhatsApp: "only an approved template can be sent now"; Messenger/Instagram: allowed only for a human-written reply on an open support-type review inside the 7-day `human_agent_window_expires_at`.
7. If the chat is not `HUMAN_ACTIVE`, `takeControl` first (rolled back if the enqueue fails).
8. **Enqueue** via RPC `enqueue_inbox_text_message` / `enqueue_inbox_media_message` with the browser's `client_idempotency_key` (a retry returns the stored message; never a duplicate).
9. If the send came from a Copilot draft (`proposalId`), record staff acceptance/edit in `inbox_autonomy_decisions`; two substantial corrections retire the approved-answer it came from.
10. Kick `processDueInboxOutbox` via `after()` unless the worker is active.

**Outbox drain** (`lib/inbox/outbox/drain.ts`) claims `outbox_messages` rows, re-checks channel policy independently ("the only place HUMAN_AGENT is applied"), calls `authorizeProviderSend` (`lib/inbox/outbound/authorize-provider-send.ts`: allow-list, test-agency guard, automated-send gate), then the channel adapter. Provider selection happens **only here** — webhooks, UI and CRM workflows never import a provider. Failures a retry cannot fix are dead-lettered immediately and shown to staff with a plain explanation (`lib/channels/send-failure-explanation.ts`). Delivery webhooks update `sent → delivered → read | failed`.

**Client side** (`lib/inbox/pending-send.ts`): the message shows as "Sending…" immediately; accepted → read just the new message; refused → mark failed with the reason; request threw → it may have committed, so mark failed with a retry-safe message and read the thread (the canonical message settles the pending one by key).

### 11.1 Other outbound actions

| Action | Notes |
|---|---|
| `startWhatsAppChat` | Needs an approved template; consent check (`start-chat-consent.ts` refuses a lead who opted out / do-not-contact); reuses an existing conversation; refuses if a colleague owns it; rate-limited. |
| `startEmailConversation` | Needs a ready mailbox; rate-limited. |
| `sendConversationTemplateAction` | Template in an existing chat; charge shown first (`template-charge-label.ts`). |
| `prepareStaffAttachmentUpload` | Signed upload to a staging path; allowed: JPG/PNG ≤ 5 MB; PDF/DOCX/XLSX/PPTX ≤ 10 MB; magic-byte signature must match; macros/scripts refused (`attachments/file-inspection.ts`). Instagram: photos only. |
| `saveConversationDraft` | Per-person, per-chat private draft (≤ 10,000 chars). |
| `claim/releaseConversationComposerAction` | Soft "someone is writing" lease — **a warning, not a lock**. |

---

## 12. Channel rules (reply windows)

`lib/channels/policy-state.ts` (`resolveChannelPolicyState`) is the single source; `lib/inbox/composer-state.ts` renders it for the UI; `sendStaffMessage` and the outbox re-enforce it.

| Channel | Free text | After the window |
|---|---|---|
| **WhatsApp** | 24 h after the customer's last message | `APPROVED_TEMPLATE` (charge shown first) |
| **Messenger / Instagram** | 24 h | `HUMAN_AGENT` only: human-written, `HUMAN_ACTIVE` chat, an open support-type review (complaint, distressed, fraud, medical, refund), within 7 days. Otherwise `BLOCKED`. Business can never start these chats. |
| **Email** | Always (no window) | n/a |

Profiles (`lib/channels/profile.ts`): max text WhatsApp 4,096 chars; Messenger 2,000; Instagram 1,000 UTF-8 bytes; email 100,000. `text-split.ts` splits long text. The reply-window sweep (§22) reminds owners two hours before a window closes.

---

## 13. Ownership, assignment and routing

**Auto-assignment** (`lib/inbox/routing/*`, decision R3, off until an agency saves a policy). `resolveOwner` is pure; first match wins:

1. **Sticky** — the lead already has an available owner → them.
2. **Coordinator** — group enquiry (party ≥ threshold), visa or document topic → the role the agency named (least loaded, then longest idle). Topic beats party size.
3. **Least-loaded** (or round-robin) among available inbox staff; ties break on `lastAssignedAt`, then id, so the answer never depends on database row order.
4. **Fallback** — `ai_settings.default_lead_owner_id` if available.

Nobody unavailable is ever chosen (off shift, on leave, inactive, past access date). If no one qualifies the chat stays **Unassigned** with its clock running. Availability = shifts + leave (`routing/availability.ts`); leave overrides an overlapping shift.

**Bulk actions** (`bulkUpdateConversationsAction`, `lib/inbox/bulk-actions.ts`): `ASSIGN | CLOSE | MARK_SPAM | UNMARK_SPAM`, at most **50** (`BULK_ACTION_LIMIT`). Each write is a **compare-and-swap** on the state/owner/lifecycle the read saw, so a concurrent change is never overwritten. Spam changes fail closed (any foreign id → nothing changes) and skip chats with a booking, an open review, or a spam lead. Close skips chats with an open review. Mark/unmark and assign need the same capabilities as close/assign.

---

## 14. The assistant and the autonomy ladder

Per agency, per surface (`ai_surface_settings`), set through the audited RPC `set_inbox_autonomy_level`:

| Level | Name | `ai_surface_settings` | May | External sends |
|---|---|---|---|---|
| **L0** | Observe | `SHADOW` | read, classify, tag, raise reviews | none |
| **L1** | Assist | `PROPOSE` | draft replies/quotes for a person | every message human-approved |
| **L2** | Safe automate | `ACTIVE` + `safe_replies` | greet, acknowledge, approved qualifying questions, office-hours reply, approved brochure/checklist, approved cached FAQ | only from the approved set |
| **L3** | Bounded intake | `ACTIVE` + `intake_flow` | structured intake (dates, party, room, city), hands over *before* price/booking | declared flow, mandatory handover triggers |

Default for a new agency is L1; L2 is never on by default and is gated on **measured evidence**, not elapsed time (decision R5). Rejection above a threshold (default 0.40) **demotes automatically**.

**The effective level is the minimum of all authorities** (`lib/inbox/autonomy/level.ts`): agency setting → surface mode → plan entitlement → channel availability → human ownership → promotion evidence → channel policy → protection gate. Each limit records a reason code (`SETTING_MISSING`, `PLAN_CEILING_LIMIT`, `HUMAN_OWNERSHIP_ACTIVE`, `EVIDENCE_LIMIT`, `CHANNEL_POLICY_BLOCKED`, `PROTECTION_GATE_BLOCKED`, …). Malformed or missing facts resolve to L0. `authorizeAutomatedInboxSend` (`autonomy/runtime.ts`) re-caps at send time, and `send-gate.ts` re-applies the plan ceiling even if a call site forgets.

Inside the Inbox screen Copilot only **suggests**; staff press send. Automatic replies are a separate administrator opt-in and never cover the never-autonomous list.

---

## 15. Media, attachments and voice notes

- **Accepted inbound**: images, documents, audio (incl. voice). Video and anything else is refused and never stored (`media/classify.ts`).
- **Pipeline** (`lib/inbox/media/*`): persist → label → background reading (BULK lane): passport fields (`passport.ts`), receipt amount/reference/date (`receipt.ts`), voice transcript (`voice-transcript*.ts`, staff-only, machine text with confidence). Nothing the model reads is written to a traveller record without an explicit staff confirmation.
- **Routing** (`media/routing.ts`): a pure table of where a file may go next, from media type × viewer capabilities × file state. Passports and receipts are **deliberately kept out of the shared Document Vault** (every staff role can read it); they go only to the traveller's Documents (`savePassportToDocumentsAction`) or Finance intake (`copyReceiptToFinanceAction`). Brochures/other files can go to the Vault (`saveInboxMediaToVaultAction`, 10 MiB, bucket-matching types).
- **Passport access** (`media/passport-visibility.ts`): a role that may not open passports sees a `restricted` attachment with no link or file name.
- **Playback**: short-lived signed URLs, renewed once on failure (`media/playback.ts`); custom voice player (`inbox-voice-message-player.tsx`).
- **Retention**: unsaved inbox copies expire per agency policy (§23).

---

## 16. Identity, leads and CRM links

- **Resolution** (`lib/inbox/identity.ts`): exact provider identity is always primary. Phone/email are secondary candidates; ambiguity is flagged for staff, **never silently merged**. No country-code guessing.
- **Cross-channel graph** (`identity/graph.ts`, MI3.3): ranks existing leads for a conversation with no lead, by weighted signals (exact phone/email → `EXACT_IDENTITY`; same last-9 digits 0.60; same full name 0.50; similar name 0.30; same first word 0.15; month mentioned 0.20; capped 0.99) and shows **"Possible existing lead found"**. It never links on its own — staff choose **Link conversation** (`confirmIdentityLinkAction`), **Create separate lead** (`keepIdentitySeparateAction`, remembered), or later unlink.
- **Lead capture** (`captureConversationLead`, `lead-linking.ts`): link by exact phone, or create. Only Admin/Marketing.
- **Lead completeness** (`lead-completeness.ts`): which of package / period / contact / travellers / room are known; "Ask about …" drops the next missing question into the composer (never auto-sent).
- **Customer context** (`loadInboxLeadContext`): lead, booking, departure group, balance (only if the role may see money), follow-up, plus per-capability booleans (`canCreateBooking`, `canUseCopilot`, …) so the UI shows only what the role may do.

---

## 17. Conversions, quotes, bookings and handoff

- **Booking** — `selectConversationDepartureGroup` records interest only (no seats). `createBookingFromConversation` creates a booking that starts *Deposit pending* and holds seats; it needs a linked lead, selected group, phone, and enough lead data, and says exactly what is missing. Rules in `lib/inbox/conversation-booking.ts`.
- **Quote** — `createQuoteFromConversation` makes a **draft** quote from live price, seats, inclusions, **no discount**; nothing is sent.
- **Follow-up** — `scheduleConversationFollowUp` (future time required; caller becomes follow-up owner).
- **Turn into work** (`conversion-actions.ts`, `lib/inbox/conversions/*`, MI4.6): a **two-step safety flow** — *preview* (shows exactly what would be created; "nothing has been created yet") then *confirm*; cancelling withdraws the proposal. Each conversion is a proposal kind in the agent kernel (`lib/agent/kernel/proposals/kinds/conversation-*.ts`), so approval, audit and execution are inherited. The catalogue (`catalogue.ts`) lists the 12 items — request documents, visa task, payment follow-up, rooming request, transport requirement, escalate to guide, open complaint case, create traveller profile, record family/mahram link, hold seats, recommend a package, request post-trip feedback — and each reports a plain reason when it cannot yet be made. Created items stamp a source link back to the chat (`source-link.ts`).
- **Operations handoff** (`createConversationHandoffAction`, `handoff/build.ts`): for a *confirmed* booking, builds a deterministic point-in-time snapshot (customer & booking facts, expectations narrated by `handoff-narrate`, open items). Operations (or an admin) acknowledges on their own page (`acknowledgeConversationHandoffAction`).
- **Finance / Documents / Visa links**: copy receipt to Finance evidence (no payment is created or verified — [`finance-evidence-guide.md`](./finance-evidence-guide.md)); save passport to traveller Documents (marked *submitted*, not verified); apply confirmed passport number/expiry to the traveller; assign a visa officer.

---

## 18. Reading data: the UI's server actions

`dialog-actions.ts` exposes read-only `"use server"` actions, each wrapped in `runInboxDialogLoad` (timing, `"You do not have access to the Inbox."` on null, generic failure message on throw). They are deliberately **split so each part can render as soon as it is ready**:

| Action | Returns | Notes |
|---|---|---|
| `loadInboxListAction` | `InboxListData` — first page (≤ 100), counts, capabilities, templates, `nextCursor` | Includes the requested chat even if outside the view. |
| `loadInboxConversationAction` | messages, attachments, media analyses, notes, saved replies, mentionable staff, draft, composer presence | |
| `loadInboxLeadContextAction` | `InboxCustomerContext` | |
| `loadInboxIntelligenceAction` | Copilot's stored reading (rail view) | |
| `loadInboxConversationListPatchAction` | one list row + (optional) exact counts | SC3: patch, don't reload. Carries `conversationVersion` so an older patch is ignored. |
| `loadInboxThreadDeltaAction` | messages after a **sequence number** (≤ 200, `THREAD_DELTA_LIMIT`) plus artefacts of only those | `hasMore` → ask again from `highestSequence`. |
| `loadInboxNotesDeltaAction`, `loadInboxPresenceAction`, `loadInboxHistoryAction` | notes (keyset) / composer lease / owner-change history | |
| `searchInboxConversationsAction` | ≤ 50 matches across all conversations | |

Every writer starts with `requireUser()`, parses input with Zod, resolves `{ role, agencyId, staffId }` from `getCurrentStaffRole()`, checks the capability, then queries with `.eq("agency_id", agencyId)`.

---

## 19. Realtime and client sync

Realtime follows `docs/inbox/scaling.md` (SC2–SC6):

- **Typed, strict events** (`lib/inbox/realtime/contracts.ts`): a payload says *which thing changed and how new it is*, never the content. Every variant is `.strict()` — an event carrying a name or message text does not parse; the browser then does one bounded reconciliation. SQL builder: `public.build_inbox_realtime_event`.
- **Two private topics** (`inbox-realtime.tsx`): the agency list topic (list + counts), and — only while a chat is open — that conversation's topic (thread, notes, presence, context, intelligence). Switching chats replaces the subscription. The server lets a person join only their own agency's topics, decided from their token.
- **Batching** (`inbox-sync-plan.ts`): events are held ≈150 ms and folded into the smallest set of reads — coalesced per scope + conversation + entity. Many distinct conversations in one window = one first-page reload instead of N patches. A `catchup` runs once when the channel subscribes.
- **Merging** (`inbox-sync-merge.ts`, `single-flight-runner.ts`): deltas merge by sequence/version; one read per scope is in flight at a time.
- **Reconnect**: after sleep/offline the Inbox does one bounded reconciliation.
- Staff messages are shown optimistically (pending → settled by idempotency key).

Target SLO: an inbound message is visible in ≈ 2 seconds.

---

## 20. The UI architecture

`InboxFullPage` → `InboxWorkspaceController` (`inbox-workspace-controller.tsx`, the single stateful owner) → `InboxWorkspaceContent` which lays out four areas:

| Area | Components |
|---|---|
| **1 Queues** | `inbox-view-rail`, `inbox-view-navigation` (grouped rail / simple menu), `inbox-compact-queue-bar` (< 1024 px), `inbox-collapsible-layout`, `inbox-outcome-metrics` (Outcomes), `inbox-shortcut-help` |
| **2 List** | `conversation-list` (rows, search, saved views via `saved-views-menu`, selection mode via `bulk-selection-bar`), `inbox-conversation-peek-card` (hover card), `inbox-new-conversation-menu` → `new-chat-dialog` / `compose-email-dialog`, `inbox-conversation-list-empty-state` |
| **3 Conversation** | `conversation-panel` (header, thread, delivery ticks, new-message pill), `conversation-actions-menu`, `conversation-owner-select`, `conversation-ownership-badges`, `message-composer` (+ `composer-attachment`, `composer-notice-strip`, `channel-policy-banner`, `template-picker-sheet`, `closing-window-draft-button`), `inbox-message-media`, `inbox-voice-message-player`, `voice-transcript-panel` |
| **4 Customer** | `customer-context-panel` / `-accordion`, `customer-identity-header`, `conversation-intervention-card` (red reviews), `recommended-next-action-card`, `conversation-intelligence-rail` (Copilot reading, `intelligence-evidence-popover`), `conversation-offer-card`, `lead-completeness-block`, `departure-group-status-block`, `conversation-followup`, `conversation-convert-menu`, `handoff-summary-sheet`, `attachment-intelligence-card`, `passport-fields-review-form`, `receipt-finance-action`, `media-routing-actions`, `identity-match-card`, `conversation-history-block` |

**Responsive layout** is a pure budget (`lib/inbox/inbox-layout-budget.ts`, `use-inbox-layout-budget.ts`): ≥ ~1440 px four areas; 1280–1439 queue folded to icons; 1024–1279 customer panel becomes a side sheet; < 1024 queue becomes a bar above the list; < 768 shows *either* list *or* one chat. A person's explicit fold/hide choice is remembered and wins.

**Keyboard** — one registry (`lib/inbox/keyboard-shortcuts.ts`): `j`/`k` next/previous, `/` search, `r` reply, `n` note, `a` assign, `q` focus Create quote (focus only, never creates), `e` lead, `b` booking, `g` then `d` departure group, `Esc` close, `?` help. They never fire while typing, during IME composition, with Ctrl/Alt/Meta, or while a dialog is open (except Esc); each declares its permission needs and the server still enforces them.

**Input method safety** — Enter sends, Shift+Enter newline; Enter accepts an IME suggestion without sending (`composer-keys.ts`).

UI rules (`AGENTS.md`): shadcn components only; inputs use `InputGroup / InputGroupAddon align="block-start" / InputGroupInput`; colours follow `docs/architecture/design-tokens.md`; copy must be clear to non-technical staff.

---

## 21. Security model

### 21.1 Permissions (`lib/access/inbox-access.ts`)

Pure function of role; the same table is used in server components, client components and server actions.

| Capability | Admin | CEO | Marketing | Operations | Finance | Visa | Guide |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| viewModule | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✖ |
| takeControl / releaseToAi / sendMessage / closeConversation / assignConversation / convertConversation / manageSavedReplies | ✔ | ✖ | ✔ | ✔ | ✖ | ✖ | ✖ |
| deleteConversation | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| retryFailedJob | ✔ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |

Derived (module + another module's right): `saveAttachmentToDocuments` (Documents upload-on-behalf **and** sensitive-data), `reviewPassportFields` (manage documents/visa **and** sensitive-data), `assignVisaOfficer` (visa assign **and** sensitive-data), `openFinanceReview` (ledger view), `saveMediaToVault` (vault manage). CEO is overview-only.

### 21.2 Layers

1. `proxy.ts` / layout: authenticated session; suspended agency → suspended page.
2. Page: role gate (`notFound()` for roles without `viewModule`).
3. Every action: `requireUser()` → Zod → role capability → agency check → agency-scoped query.
4. RLS on every table (every new table ships RLS in the same migration — `AGENTS.md`).
5. Service-role RPCs (queue, outbox) are not callable by any signed-in session.
6. Webhooks: signature verification, bounded bodies, capped unsigned-stub writes, tenant gate by connected phone id.
7. Files: byte-signature validation, macro/script rejection, private storage with short-lived signed links, passports hidden from roles without sensitive-data access.
8. Outbound: protection gate, never-promise list, test-agency guard, allow-list, consent check for new chats.

### 21.3 Hard rules

- A hidden control is never the boundary; the server re-decides.
- Bulk spam change: any foreign id → *nothing* changes.
- Delete (`deleteConversationAction`, `lib/inbox/delete-conversation.ts`): admin-only, confirms the conversation belongs to the agency before deleting; removes messages, notes, drafts, attachments (and stored files), assistant runs and send queue; leads/bookings/finance evidence are kept and merely lose the link.
- Mentions only notify colleagues who can open the Inbox (`mentions.ts`).
- Realtime payloads are content-free.

### 21.4 Rate limits (`lib/inbox/rate-limit/*`)

Per staff per hour / per agency per Sri Lanka day (resets at local midnight, UTC+5:30). Overridable per agency by platform staff only (`inbox_rate_limit_overrides`) — see [`../runbooks/inbox-rate-limits.md`](../runbooks/inbox-rate-limits.md).

| Action | Per user / hour | Per agency / day | Counter unreadable |
|---|---|---|---|
| Start WhatsApp chat | 15 | 60 | **Refuse** |
| Start email conversation | 20 | 100 | **Refuse** |
| Send template | 60 | 400 | **Refuse** |
| Copilot suggestion | 40 | 600 | Allow |
| Translate | 60 | 600 | Allow |
| Prepare offer | 120 | 1000 | Allow |

Anything that costs money or could hurt the WhatsApp quality rating fails closed; drafts and translations fail open.

---

## 22. Scheduled work

Scheduling is **Postgres-native** (decision R9): `pg_cron` fires, `pg_net` calls `public.invoke_cron_route(path)`, which hits a `GET` route guarded by `Authorization: Bearer $CRON_SECRET`. Base URL and secret live in Supabase Vault (`set_cron_http_config`, run once per environment). `vercel.json` carries only the region.

| Job | Route | Schedule | Purpose |
|---|---|---|---|
| `inbox-lanes` | `/api/cron/inbox-lanes` | every minute | Drain REALTIME/STANDARD/BULK lanes |
| `whatsapp-agent-jobs-drain` | `/api/cron/agent-jobs` | every minute | Legacy assistant jobs |
| `inbox-sla` | `/api/cron/inbox-sla` | every 2 min | SLA due-times, Nearing deadline / Overdue |
| `inbox-email-poll` | `/api/cron/inbox-email-poll` | every 2 min | IMAP polling |
| `reply-window-sweep` | `/api/cron/reply-window-sweep` | every 5 min | In-app reminder to the owner 2 h before a window closes (once per unanswered customer message, via the follow-up ledger) |
| `inbox-health` | `/api/cron/inbox-health` | every 5 min | Report stuck cron jobs, ageing outbox, dead-lettered jobs to Sentry (counts/names/ages only, no content) |
| `inbox-retention` | `/api/cron/inbox-retention` | daily 02:17 | Retention sweep |
| `whatsapp-health-check` / `-billing-sync` | `/api/cron/whatsapp-*` | daily 03:00 / 04:00 | Connection health; Meta pricing sync |
| `release-seat-holds` | `/api/cron/release-seat-holds` | hourly | Release expired seat holds |
| `ai-usage-rollup` | `/api/cron/ai-usage-rollup` | scheduled | AI cost ledger |

`public.cron_job_health()` reports each job `OK / STALE / FAILING`. Every cron route processes one agency at a time under a budget so a huge agency cannot stall the rest.

---

## 23. Retention, deletion and health

- **Retention** (`lib/inbox/retention/*`, decision R7 — *retention follows the record, not the plan tier*): configurable per agency in Settings → Data: booking-linked messages 3–10 years, unconverted enquiries, attachments (max 365 d), voice audio (max 365 d), intelligence, AI audit, raw webhook data (max 90 d). Finished queue rows are kept a fixed short time for debugging. Nightly; the same destructive primitive serves expiry and explicit privacy deletion. Promoted attachments (saved to Documents) are exempt. Runbook: [`../runbooks/inbox-retention-and-deletion.md`](../runbooks/inbox-retention-and-deletion.md).
- **Meta data-deletion / deauthorize callbacks**: `app/api/webhooks/meta/*`.
- **Health** (`lib/inbox/health/*`): a pure `evaluate` over a snapshot (cron freshness, outbox age, dead-lettered jobs, lane lag vs. the latency target). Runbook: [`../runbooks/inbox-health-alerts.md`](../runbooks/inbox-health-alerts.md).
- **Outcomes panel** (`outcome-actions.ts`, `owner-kpis.ts`): role-filtered cards with honest states (number / *No data yet* / *Not measurable yet* / *Could not be read*).

---

## 24. Testing

| Layer | Where | What |
|---|---|---|
| Unit | `lib/inbox/**/*.test.ts`, `lib/channels/*.test.ts` | Pure rules: routing, SLA, gate, never-promise, composer state, search, shortcuts, rate limits, sync plan. |
| Action | `app/inbox/*.test.ts` | Agency scoping (`agency-scoped-conversation-actions`), protection (`actions.protection`), bulk/spam, close, ownership override, metering, rate limits, booking, saved reply, vault, start-email, identity. |
| Migration contract | `lib/**/…-migration.test.ts`, `supabase/tests`, `scripts/sql/verify-*.sql` | Queue counts, cron health, write-hardening, search indexes, SLA seed parity. |
| E2E | `e2e/inbox-*.spec.ts` (Playwright) | Accessibility, composer, customer context, keyboard & responsive, ownership & bulk, shortcuts (denied/unavailable), start chat/presence/Copilot, two-agency isolation, views & search, LR2 acceptance. |
| Eval | `lib/inbox/autonomy/__evals__` | Intake flow evaluation. |
| CI | `.github/workflows/inbox-ci.yml` | |

Gate before any PR (`AGENTS.md`): `npm run lint`, `npm run typecheck`, `npm run test`. Business-rule branching (race conditions, pricing, capacity, identity) must have a Vitest test.

---

## 25. Configuration

| Setting | Where | Effect |
|---|---|---|
| `INBOX_WORKER_ACTIVE` | web env | Webhook/send skip their own drains (worker owns it). |
| `WORKER_CONCURRENCY_<LANE>`, `WORKER_PER_AGENCY_CAP_<LANE>`, `WORKER_JOB_TIMEOUT_MS_<LANE>`, `WORKER_DRAIN_*`, `WORKER_PORT`, `WORKER_SHUTDOWN_GRACE_MS`, `WORKER_STALE_SWEEP_MS` | worker env | Validated at start; a timeout above `lease − 5 s` is rejected. |
| `INBOX_OUTBOUND_ALLOWLIST` | non-production env | Recipients the app may send to. Empty = nobody. |
| `SENTRY_ENVIRONMENT=production` | env | Disables the allow-list; enables full sends. |
| `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | env | Webhook verification. |
| `CRON_SECRET` + vault config | env / `set_cron_http_config` | Cron auth. |
| `agency_settings.inbox_queues_v2` | DB | Grouped rail vs simple menu. |
| `ai_surface_settings` (`INBOX_TRIAGE`, autonomy) | DB | Copilot on/off, level. |
| `inbox_routing_policy`, `inbox_sla_policies`, working hours, `inbox_rate_limit_overrides`, retention | DB, Settings UI | Admin-managed behaviour (Settings → Operations / Data, Management → AI agent). |

Admin settings UIs: `app/(main)/management/settings/operations/*` (routing, SLA, staff availability), `.../data/inbox-retention-actions.ts`, `app/(main)/management/ai-agent/inbox-autonomy-control.tsx`. Dashboard panel: `app/(main)/dashboard/components/inbox-intelligence-panel.tsx`.

---

## 26. How to extend it

Always: read [`feature-development-workflow.md`](../standards/feature-development-workflow.md); for Inbox work build **one slice from [`implementation-plan.md`](./implementation-plan.md)** and tick [`checklist.md`](./checklist.md) in the same PR.

| To add… | Do this |
|---|---|
| **A new queue** | Add the code to `QUEUE_CODES` (`intelligence/contracts.ts`) → catalogue entry (`queues.ts`, `available: false` until SQL exists) → SQL predicate in `compute_conversation_queues` (new migration with RLS/tests) → add to `INBOX_VIEWS` + `VIEW_QUEUE` (a missing mapping is a compile error) → rail order → SLA policy if it has a target. |
| **A risk detector** | New pure file in `risk/detectors/`, register in `risk/registry.ts`, fixtures + precision test, add an intervention kind + guidance (`interventions.ts`) if it opens a card; decide REVIEW vs BLOCK; check the protection gate's guarded phrases. |
| **A job kind** | Add to `JOB_KINDS` **and** `LANE_FOR_JOB_KIND` and the SQL check constraint; register its handler (`registerLaneJobHandler`); make it idempotent; ensure every draining entry point imports the registration. |
| **A conversion** | New proposal kind in the agent kernel; catalogue entry with typed `fields`, preconditions and plain "why not" text; server-supplied `choices.ts`; stamp `source-link`. |
| **A channel** | Provider adapter + `ChannelProfile` + policy-state branch; webhook/poller into `ingest`; register in `registry.ts`; outbox picks it up. Nothing outside the drain imports a provider. |
| **A permission** | Add to `InboxCapabilities` and every role in `CAPABILITIES`; enforce in the action *and* hide in the UI; add an access test. |
| **A shortcut** | Add to the registry in `keyboard-shortcuts.ts` with its `requires`; the help overlay and tests follow automatically. |
| **A rate-limited action** | Add to `INBOX_RATE_LIMITED_ACTIONS` + defaults, choose `REFUSE` vs `ALLOW` on counter failure. |

---

## 27. Known limits and caveats

- **Departure changes / Group changes** queues exist but have no predicate and are hidden.
- **Spam** stops Copilot reading a chat; it does **not** stop a WhatsApp assistant from replying to a later message (see the spam contract).
- **"Someone is writing"** is advisory; two people can still send.
- **Outcomes**: first-response time, within-target rate, conversion rates, draft acceptance and triage corrections are *not measurable yet*; AI cost excludes image and voice work (treat it as a floor).
- **Channel gaps**: Messenger/Instagram cannot be started by the business and have no reopen template; Instagram carries photos only; WhatsApp video/location/etc. are refused.
- **Voice transcripts** are machine text and can be wrong.
- **Bulk close** has no confirmation and no undo (a customer message reopens the chat).
- **Docs drift**: the Inbox has many dated plans and audits in `docs/inbox`, `docs/progress`, `docs/tasks`; some describe states since superseded (for example Inngest, replaced by R9). Verify against code. The latest audit is [`../progress/2026-10-05-inbox-security-and-bug-audit.md`](../progress/2026-10-05-inbox-security-and-bug-audit.md).

---

## 28. Related documents

| Need | Read |
|---|---|
| Staff how-to | [`inbox-user-guide.md`](./inbox-user-guide.md); deeper: [`../usages/inbox/everyday-user-guide.md`](../usages/inbox/everyday-user-guide.md) |
| Design decisions R1–R9, data model, cost model | [`architecture.md`](./architecture.md) |
| Build sequence and status | [`implementation-plan.md`](./implementation-plan.md), [`checklist.md`](./checklist.md) |
| Scale and Realtime | [`scaling.md`](./scaling.md) |
| Channels and AI agent (functional) | [`channels-and-ai-agent-guide.md`](./channels-and-ai-agent-guide.md) |
| Email channel | [`email-channel-implementation-plan.md`](./email-channel-implementation-plan.md), [`email-trust-guardian-implementation-plan.md`](./email-trust-guardian-implementation-plan.md) |
| Spam semantics | [`spam-state-contract.md`](./spam-state-contract.md) |
| Operations runbooks | [`../runbooks/`](../runbooks/README.md): `inbox-worker`, `inbox-health-alerts`, `inbox-rate-limits`, `inbox-retention-and-deletion`, `inbox-intelligence-operations`, `inbox-attachment-checks`, `inbox-launch-readiness-acceptance` |
| Platform security | [`../security/security-guidelines.md`](../security/security-guidelines.md), [`../security/access-control.md`](../security/access-control.md) |
