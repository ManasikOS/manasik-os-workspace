# Inbox: scale, end-to-end readiness and Inngest implementation plan

Status: **proposed plan. No code, SQL or configuration has been changed.**
Date: 2026-09-25
Owner: Inbox + Copilot programme
Builds on: [`scale-review-inngest-2026-09-25.md`](./scale-review-inngest-2026-09-25.md) (defect evidence) and
[`scaling.md`](./scaling.md). This plan **replaces §6 and §9 of the review**. The review assumed Inngest runs every
message; this plan uses the agreed hybrid instead.

> **Partly superseded 2026-10-01 (decision R9).** The Inngest parts of this plan (Phase I: the outbox, forwarder, schedules, lifecycle functions and knowledge ingest, and decision R8 points 2 and 3) are replaced by [`supabase-native-scheduling-plan.md`](./supabase-native-scheduling-plan.md). The Postgres queue, worker and per-message work (Phases P0, Q, D, F, E) are unchanged and still current.

> **Before any slice is built:** amend [`architecture.md`](./architecture.md) §16 with resolved decision **R8**
> (§2 below) and update [`scaling.md`](./scaling.md) §2.3, §10 and §18 to match. The programme rule is that the
> Architecture changes first.

---

## 1. Summary

| Question | Answer |
|---|---|
| Does the current Inbox work? | Yes, at today's volume. Receiving and replying work on WhatsApp, Messenger and Instagram. |
| Is every flow proven end to end? | **No.** 0 of 33 programme slices have a measured exit criterion (`checklist.md` Progress table). The remodel runbook says the TASK-007/009 features have not yet been used by a signed-in person. Much is built and unit-tested; little is proven in a browser against real Meta traffic. §4 lists each flow. |
| Will it hold millions of rows and 500 msg/min? | The **schema and indexes** hold millions of rows. The **job execution** does not hold 500 msg/min: AI replies get stranded, a burst gets several replies, retries can send twice, and the database is on the 60-connection tier. §3 and §5. |
| Plan | Keep Postgres as the source of truth. Run per-message work on **one** Postgres queue (`channel_jobs`) with a small always-on worker. Use **Inngest** for low-volume lifecycle workflows and every scheduled job. §2 and §8. |
| Is data transferred securely? | In transit, yes: TLS everywhere, signed webhooks, private Realtime, 5-minute signed media URLs, tokens in Vault. Five gaps need closing. The largest is that the **default AI reply model is a free OpenRouter model**, so customer messages go to a provider whose data-retention terms have not been reviewed. §6. |
| Cost per agency (100 conversations/month) | **About US$2–4/month variable** (AI + storage), plus the agency's own Meta template fees (US$0–8), plus a share of about **US$230–290/month fixed** platform cost. Total about **US$7–9 per agency at 50 agencies** and about **US$27–29 at 10 agencies**. §9. |

---

## 2. Architecture decision R8 (to add to `architecture.md` §16)

> **R8 — Postgres owns state; one Postgres queue owns per-message work; Inngest owns lifecycle workflows and
> schedules.**
>
> 1. Every provider message, delivery status, AI reply, enrichment and media job is a row in `channel_jobs`. It is
>    queued in the same transaction as the data it serves, claimed with fair share, and run by an always-on worker.
>    `agent_jobs` is retired into it.
> 2. Inngest runs only work that is **time-based, multi-step, or triggered by a lifecycle change**: follow-up
>    sequences, SLA escalation, reply-window reminders, handoff acknowledgement, knowledge-document ingestion,
>    payment/booking follow-through, and every scheduled job now run by `pg_cron → pg_net`. Inngest is never
>    triggered once per message.
> 3. The bridge is one-directional and rare. A committed lifecycle change (handed to staff, lead created, booking
>    created, conversation closed) writes an `inngest_outbox` row in the same transaction. The worker forwards it to
>    Inngest with the row id as the event id.
> 4. Supabase Queues (`pgmq`) is not adopted: it has no merging of related messages, no per-conversation grouping,
>    no fair share and no priorities, and `channel_jobs` already has all four (analysis in the review follow-up).

**Why a worker instead of Vercel for per-message work.** At 500/min there are 40–85 AI turns in flight at once. The
live p95 turn time is 17.5 s (`agent_runs`, see §9.2). A long-running process with a fixed concurrency cap is
cheaper, keeps database connection use predictable, and removes the `after()` polling that currently holds function
instances open for up to 55 s per webhook. This is the dedicated-worker path already written into `scaling.md`
§10.2. The load results (Burst p95 20 s) already point to it.

```text
Meta ─► Vercel webhook ─► verify HMAC ─► resolve tenant ─► ingest RPC (message + jobs, 1 txn) ─► 200
                                                                  │
                          Postgres channel_jobs (REALTIME│STANDARD│BULK; REPLY/ENRICH/MEDIA/STATUS…)
                                                                  │ claim (fair share, 1 reply per conversation)
                                         Worker ×2 (Node, sin/ap-southeast-1, concurrency-capped)
                                          ├─ AI turn → outbox row → provider send (idempotent)
                                          ├─ enrichment / media / status batches
                                          └─ forwards inngest_outbox rows ──► Inngest
                                                                               ├─ followUpSequence (sleep 24 h…)
                                                                               ├─ slaEscalation / windowReminder
                                                                               ├─ handoffAcknowledgement
                                                                               ├─ knowledgeDocumentIngest
                                                                               └─ schedules (SLA sweep, retention,
                                                                                  usage rollup, billing sync, …)
Browser ◄─ Supabase Realtime Broadcast (IDs only, private topics) ◄─ DB triggers (SC5 routing)
```

---

## 3. Can it handle millions of rows?

### 3.1 Volume model

| Scale | Messages/month | Rows after 1 year (messages) | Webhook-event rows/month (today, never purged) |
|---|---:|---:|---:|
| 1 agency @ 100 conversations × 12 msgs | 1,200 | 14 k | ~3 k |
| 1,000 such agencies | 1.2 M | 14 M | ~3 M |
| 500 msg/min sustained (platform target) | 21.6 M | 260 M | ~86 M |

### 3.2 What already holds

`conversation_messages` and `conversations` have correct composite indexes with `agency_id` first:
`(agency_id, external_message_id)` for idempotency, `(conversation_id, sequence_number)` for the thread,
`(agency_id, lifecycle_status, last_activity_at DESC, id DESC)` for the list. Queue counts are exact counters, not
`count(*)`. The list uses cursor pagination and threads use sequence deltas. Up to about 50–100 M message rows none of
this needs redesign.

### 3.3 What breaks first, and the fix

| Risk | When it bites | Fix (slice) |
|---|---|---|
| `whatsapp_webhook_events`, `channel_jobs` DONE rows and `agent_jobs` DONE rows are never purged; webhook rows hold full JSON payloads | Months, not years | Retention: 14 days for raw events, 30 days for finished jobs, archived counts kept (D1) |
| Search uses leading-wildcard `ILIKE` on `conversations`/`leads` with no trigram index, so every search scans the whole agency | ~50 k conversations per agency | `pg_trgm` GIN indexes, `pg_trgm` moved out of `public` (D2) |
| Queue projection recomputed twice per inbound (message trigger + conversation trigger) | ~5 msg/s | Recompute once (D3) |
| `channel_jobs` claim scans all QUEUED rows with a window function under one per-lane lock | Large backlog | Per-lane partial index on `QUEUED`; claim restricted to the first N due rows (Q2) |
| Hot-table bloat (`channel_jobs`, `conversations`) | Sustained load | Per-table autovacuum settings (D4) |
| `conversation_messages` single table | > ~100 M rows | Monthly range partitioning **only when measured**. Prepared, not built (D5) |
| Database on the 60-connection tier, **and the organization is on the Free plan** | Now | Upgrade to Pro, then Medium compute, before any load test (P0.8) |

---

## 4. End-to-end feature audit

Legend: **Works** = in use and receiving/replying today. **Built** = code and unit tests exist, not proven in a
browser or against Meta. **Defect** = a code-level bug that appears under load or retries. **Gap** = the feature is
missing.

| # | Flow | Status | Evidence / what is missing | Fixed in |
|---|---|---|---|---|
| 1 | Receive text: WhatsApp | Works; **Defect** under batching | First-message-only dedupe can drop the 2nd+ message of a batched delivery after a partial failure | P0.2 |
| 2 | Receive text: Messenger / Instagram | Works | Dedupe per `mid`, atomic RPC is the backstop | — |
| 3 | First contact from a new customer | Works; **Defect** under concurrency | Conversation select-then-insert race gives a 500 and a Meta retry; lead creation can race | P0.3 |
| 4 | Receive image / document / voice | Built | BULK lane downloads; video/sticker refused by design. Unsupported-media notice is a synchronous Meta call inside the webhook | P0.4 |
| 5 | AI auto-reply | Works at low volume; **Defect** ×3 | Claimed jobs stranded 5 min; parallel turns per burst; retry can send a second paid reply | P0.1, Q1 |
| 6 | AI model | **Risk** | Defaults to `inclusionai/ling-3.0-flash-vl:free` (rate-limited; unknown data retention). Paid fallback `openai/gpt-5.6-luna` | P0.6 |
| 7 | Staff text reply | Works; **Defect** | Outbox drain has the same claim-then-break stranding as #5 | P0.1 |
| 8 | Staff sends a file / image / PDF (itinerary, quote, visa copy) | **Built, not yet sent to Meta** | F1 built and tested against fakes and a rolled-back database; never sent through a real WhatsApp, Messenger or Instagram account, and the composer UI has not been seen in a browser | E1 |
| 9 | WhatsApp template / new chat | Built | Template picker, charge label; needs a Meta test-number acceptance run | E1 |
| 10 | Delivery ticks | Works | ~75% of webhook traffic, one UPDATE each; batch in Q4 | Q4 |
| 11 | Realtime list/thread sync | Built | SC4 client built; SC5 broadcast routing **is applied** (live check 2026-09-25); deployed-build confirmation, event-count measurement and two-session browser acceptance not done | P0.7, E1 |
| 12 | Assignment, owner select, bulk actions, saved views | Built | Runbook says `inbox_saved_views` is unapplied, but it exists in the live database: the docs are stale | P0.9, E1 |
| 13 | Routing and auto-assignment, staff availability | Built | Exit needs a saved policy and real traffic | E1 |
| 14 | SLA clock, breach alerts | Built | Runs every 2 min via pg_cron → HTTP | I3 |
| 15 | Handoff summary, collision/presence | Built | Two-session exit not demonstrated | E1 |
| 16 | Triage, intent, offer match, risk, identity merge | Built, mostly SHADOW/off | Exits need live shadow traffic and labelling | E2 |
| 17 | Conversions: lead, booking, quote, departure group, seat hold, passport | Built | Browser exit not done; checklist says MI4.6 code "uncommitted", but it is on `main` (checklist stale) | E1, P0.9 |
| 18 | Follow-ups, window-closing draft | Built | Minute-level cron; no durable per-conversation timer | I4 |
| 19 | Retention and deletion | Built | Resumable sweep exists; raw events and jobs are not covered | D1 |
| 20 | Search | Built; **scale risk** | Name/phone/lead fields only, unindexed `ILIKE`; no message-content search | D2 |
| 21 | Owner KPIs, AI cost ledger, entitlements | Built | Metering exists; the MI6.5 scale proof has not been run | E3 |
| 22 | Meta deauthorize / data-deletion callbacks | Built | Include in the E1 acceptance run | E1 |

**Conclusion.** The core loop (receive, see, reply) works. Everything built after it (intelligence, conversions,
routing, sync optimisations) is **unproven end to end**. Phase E (§8) turns "built" into "proven" with a scripted
acceptance run plus an automated browser suite. Until then, an agency may hit one of the defects above as soon as its
traffic grows.

---

## 5. Target runtime details

### 5.1 One queue: `channel_jobs` absorbs `agent_jobs`

- New kinds: `REPLY` (the AI turn), `TRANSCRIBE_VOICE` (existing), `APPLY_STATUS`, `SEND_OUTBOX`, `FORWARD_INNGEST`.
- `REPLY` rules:
  - It merges on `coalesce_key = 'reply:' || conversation_id` with a 3–4 s settle delay (the existing
    `enqueue_channel_job` behaviour), so a burst becomes one turn.
  - The claim query skips any conversation that already has a `REPLY` job `RUNNING`, so turns in one conversation
    never overlap.
  - The job payload stores `last_message_sequence`. The turn answers everything up to that sequence, and a newer
    message queues a fresh turn.
- Claim changes:
  - Timeout-based reclaim (`locked_until`, not a 5-minute stale release).
  - Unprocessed claims are handed back at the end of the budget.
  - A partial index `WHERE status = 'QUEUED'` replaces the full scan.
  - Fair share and per-agency caps stay exactly as they are.
- Retry safety: the AI reply is written as an `outbox_messages` row keyed `reply:<last inbound message id>` **before**
  the provider call. A retry finds the row and never runs a second model call or sends a second message. If the
  model output is already stored on the row, the retry skips the model.

### 5.2 Worker

- Node process packaged from the repository and sharing the same `processLane()`.
- Two instances in Singapore / ap-southeast-1, with a health check, graceful shutdown, and per-process concurrency
  caps: REALTIME 40, STANDARD 10, BULK 4.
- Wake-up: Postgres `LISTEN/NOTIFY` from the ingest RPC, with a 1 s poll as the fallback.
- Database access: service-role supabase-js for RPCs, plus the Supavisor pooler for any direct connection. The
  worker's total connection budget stays at or below 20% of the tier.
- Recovery: the Inngest schedule `laneGuaranteeSweep` (every minute) replaces the pg_cron HTTP drain as the safety net
  while the worker is scaled to zero.

### 5.3 Inngest scope

| Function | Trigger | Key Inngest features |
|---|---|---|
| `followUpSequence` | `conversation.gone_quiet` (from the worker) | `step.sleep`, `step.waitForEvent('inbox/customer.replied', match conversationId)`, `cancelOn` staff takeover |
| `slaEscalation` | `conversation.sla_started` | `step.sleepUntil(sla_due_at)` then re-check; replaces part of the 2-minute sweep |
| `replyWindowReminder` | `conversation.window_opened` | sleep until 22 h, then remind the owner if there is still no reply |
| `handoffAcknowledgement` | `conversation.handed_off` | `waitForEvent(ack, 30 min)`, escalate on timeout |
| `knowledgeDocumentIngest` | `knowledge.document_uploaded` | steps per chunk batch; retries; replaces `EMBED_DOCUMENT` |
| `bookingPaymentFollowThrough` | `booking.created` | milestone reminders |
| Schedules | `cron` | SLA sweep, retention, AI usage rollup, lead follow-ups, seat-hold release, billing sync, WhatsApp health, departure ops, lane guarantee sweep, raw-event reconciler |

Rules for every Inngest function:

- Events carry **ids only**. Step return values carry **ids and counts only**, never message text, names, phone
  numbers, passports or prices, because Inngest stores step output.
- Every step re-reads from Postgres, scoped by `agencyId`.
- `concurrency` is keyed on `event.data.agencyId`.
- `idempotency` is on the event id (the `inngest_outbox` row id).

---

## 6. Secure data transfer

### 6.1 Current posture (verified in code or the live database)

| Path | Protection |
|---|---|
| Meta → webhook | HTTPS; HMAC-SHA256 `x-hub-signature-256` checked with `timingSafeEqual` on the raw body (`lib/meta/signature.ts`); bounded body size; unsigned payloads stored as a size stub only |
| Tenant resolution | From the verified `phone_number_id` / Page / IG account id. The payload's claims are never trusted |
| Channel access tokens | Supabase Vault (`lib/channels/vault.ts`), read server-side with the service role only |
| App → Supabase | TLS; service-role key server-only; browser uses the anon key + RLS; `agency_id` on every table and query |
| Realtime | Private channels with RLS on `realtime.messages`; typed PII-free payloads (ids only) |
| Media | Private bucket, signed URLs with a **300 s** TTL, created after an agency-scoped read |
| Browser | HSTS, `X-Frame-Options: DENY`, CSP (`next.config.ts`) |
| Cron | Bearer secret stored in Vault and sent over HTTPS |
| Definer functions | Inbox RPCs pin `search_path = ''`, revoke `public/anon/authenticated`, and check `current_agency_id()` and role (checked live on `set_inbox_autonomy_level`, the answer-cache functions and `enqueue_inbox_text_message`) |

### 6.2 Gaps to close

| # | Gap | Severity | Fix (slice) |
|---|---|---|---|
| S1 | The default AI reply model is a **free** OpenRouter model. Customer messages (names, phones, passport questions) go to a provider whose retention/training terms are not contracted | High | Paid model by default; restrict OpenRouter to providers that do not retain or train on prompts, set in the request's provider preferences and the account's privacy settings; record the subprocessor list (P0.6) |
| S2 | Inngest will store event payloads and step outputs | High (new) | Ids-only contract (§5.3) and the Inngest encryption middleware; Inngest listed as a subprocessor with a DPA (I1) |
| S3 | `app/api/cron/agent-jobs/route.ts` compares the bearer token with `!==` | Low | `hasValidBearerSecret` (P0.5), then the route is removed in Phase I |
| S4 | `set_inbox_autonomy_level` accepts `p_actor_id` from the caller, so the audit trail's "changed by" can be spoofed by an admin | Low | Derive the actor from `auth.uid()` inside the function (P0.5) |
| S5 | Raw webhook payloads (PII) kept forever | Medium | 14-day retention (D1) |
| S6 | Advisors: leaked-password protection off; 13 finance functions with mutable `search_path`; `pg_trgm` in `public` | Medium / low (mostly outside the Inbox) | Enable leaked-password protection; separate finance hardening task; move `pg_trgm` (D2) |
| S7 | The worker (new) holds the service-role key | Medium | Secret manager, no key in images, egress restricted to Supabase / Meta / OpenRouter / Inngest, logs carry ids only (Q3) |
| S8 | Inngest → app calls | Medium | `INNGEST_SIGNING_KEY` verification on `/api/inngest`; route added to the proxy machine-routes allow-list; no session trust (I1) |

---

## 7. Ground rules for every slice

- One slice, one PR, nothing adjacent. Tick [`checklist.md`](./checklist.md) in the same PR (AGENTS.md).
- Every migration: RLS or grants in the same file, `search_path = ''`, `EXPLAIN (ANALYZE, BUFFERS)` recorded for any
  new index, dry run in a rolled-back transaction, then applied through the migration tool so history stays in sync.
- Every business-rule branch (claiming, merging, idempotency, fair share) gets a Vitest test. Every tenancy test uses
  two agencies.
- `npm run lint`, `npm run typecheck` and `npm run test` must be green before a PR is opened.

---

## 8. Slices

### Phase P0: stabilise the current path (no new infrastructure)

**Progress (2026-09-25, branch `p0-inbox-scale-fixes`, uncommitted, not merged or deployed):**
P0.1, P0.2, P0.3, P0.4 (partly), P0.5 (partly) and P0.6 (partly) are built with tests; lint, typecheck and the full test suite pass.
Their exit measurements (Burst run, fault injection) need a deploy. P0.6 is built as: the free model is opt-in by
`AI_FREE_CHAT_MODEL` (unset = always the paid model) and `OPENROUTER_DATA_POLICY=deny|zdr` adds OpenRouter's provider
restriction to every chat request; both are environment settings, not the per-agency opt-in the table describes (that
needs a migration), and the policy stays off until set because it is unverified against the Anthropic-compatible
endpoint and can make a model with no qualifying provider fail. Embeddings requests do not carry it. P0.8 is not started and cannot be done from here: no tool changes compute, and
the organization is on the **Free** plan (checked 2026-09-25), which cannot buy compute add-ons. Free also means no backups,
projects pause after a week of inactivity, a 500 MB database limit (the database is 579 MB now), and 200 concurrent
Realtime connections / 2 M messages a month (the target needs 500+ connections). It needs a Pro upgrade first. P0.7 needs no change (SC5 is already applied). P0.9: the documentation half is done
(checklist and runbook corrected 2026-09-25); the migrations are NOT unrecorded as first thought: all 181 are
recorded, and exactly seven have a recorded version that differs from the file name (`20260925041420`…`20260925042011`
vs `20261202094000`…`20261203090000`). Renaming those seven history rows is not done: an attempt to run the `UPDATE` was
blocked by the session's permission check, so it is left for you to run (statement in the P0.9 hand-off).
Deviations from the table below: P0.1 keeps the 5-minute stale window (a shorter one without a heartbeat would let a
slow AI turn be run twice) and instead hands unreached claims back at once. P0.4 sends the unsupported-media notice in
`after()` after the 200 rather than as a queued job (a queued job needs a migration for the job-kind check); Messenger
and Instagram still send it inline. P0.5 covers the six cron routes that compared the secret with `!==`; the
`set_inbox_autonomy_level` actor change is a migration and is not written yet. P0.3 makes the losing request skip lead
creation; a customer's first two messages landing while the conversation exists but has no lead yet can still create
two leads (a pre-existing race that needs a database-level guard).

| Slice | Change | Tests | Exit |
|---|---|---|---|
| P0.1 | Agent and outbox drains: run the claimed batch with bounded concurrency and hand back what the budget did not reach; stale window 5 min → 60 s with a heartbeat | Claim 10, budget for 2 → 8 back in QUEUED immediately | No job RUNNING longer than its budget + 10 s under Burst |
| P0.2 | Webhook dedupe per **item** (each message id; each status id + status + timestamp) | Batched payload with a failure on item 2 → retry stores item 2 | Fault injection loses 0 messages |
| P0.3 | `upsertConversationForInbound` → `INSERT … ON CONFLICT (agency_id, channel, external_conversation_id) DO UPDATE`; the lead link uses its unique key likewise | Two parallel first messages → 1 conversation, 1 lead, 0 errors | No 5xx from concurrent first contact |
| P0.4 | Unsupported-media notice sent from a job, not inside the webhook | Webhook makes no outbound Meta call | Ack p95 recorded |
| P0.5 | Constant-time compare on the agent-jobs cron; actor derived from `auth.uid()` in `set_inbox_autonomy_level` | Unit + SQL test | Advisors unchanged or better |
| P0.6 | Paid model is the default reply model; free model only behind an explicit per-agency opt-in; OpenRouter provider privacy settings enforced | Routing unit tests | Subprocessor record written |
| P0.7 | **SC5 is already applied** (live check 2026-09-25), so nothing to apply. Confirm the SC4 client is the deployed build; run `verify-sc5-scoped-broadcasts.sql`; measure delivered events per inbound | Existing SC5 tests | Delivered events per inbound fall ≥ 70% |
| P0.8 | **Prerequisite: upgrade the Supabase organization from Free to Pro** (compute add-ons cannot be bought on Free). Then Medium compute (or larger per the harness); PostgREST pool sized | — | Connections < 70% at the Sustained profile |
| P0.9 | Rename the seven history rows whose recorded version differs from the file name (all 181 are recorded); correct the checklist (MI4.6, saved views, scaling track) and the remodel runbook | — | a name-by-name comparison of `schema_migrations` against the files returns no rows |

### Phase Q: one queue and the worker

**Q1 progress (2026-09-25, branch `p0-inbox-scale-fixes`, uncommitted; the migration is NOT applied):**
built and tested (261 files, 2,639 tests, typecheck and lint clean). `supabase/migrations/20261204090000_q1_reply_queue.sql`
was dry-run against the Manasik OS project inside a transaction that always rolls back, using
`scripts/sql/verify-q1-reply-queue.sql`: all 11 checks passed and nothing persisted. What it does:
- `REPLY` is a `channel_jobs` kind (REALTIME lane, priority 10 so replies rank ahead of enrichment). The inbound database function
  queues it instead of an `agent_jobs` row, **only for agencies listed in `inbox_reply_queue_agencies`** (service role only).
  It merges on `reply:<conversation>`, waits at most 10 s (0 for a first contact), is never pushed later than 20 s after it was
  first queued, and records the newest message it answers. Voice notes and unlisted agencies are unchanged.
- The claim skips a `REPLY` whose conversation already has one RUNNING, so two turns for one conversation never overlap.
- Deviation from the table below: instead of routing AI sends through the outbox, `reply_intents` records each reply BEFORE the
  model runs or anything is sent (states GENERATING, GENERATED, SENDING, SENT, SKIPPED, UNKNOWN; every move is a compare-and-set).
  A retry sends a produced reply without calling the model again, does nothing for a sent one, and a send that began and never
  reported back becomes UNKNOWN and is handed to staff, never re-sent automatically. This meets the exit criteria without rewriting
  the send path. A reply is also dropped, not sent, when the customer wrote again and a newer REPLY job is already queued for it.
- `runAssistantTurn` (in `lib/agent/whatsapp/drain.ts`) is now shared by the legacy job and the REPLY job; the legacy path runs
  with no guard, as before. The after-webhook REALTIME drain now waits up to 8 s for a job scheduled just ahead (a settle delay
  used to leave the job for the once-a-minute cron) and has a 25 s budget (an assistant turn takes about 17 s at p95).
- Known limits: the bounded-intake flow sends its own reply and is not covered by the intent guard; a REPLY handler that outlives
  its job's time budget is protected by the intent lease, not cancelled; a worker that dies while a REPLY is RUNNING blocks that
  conversation's next reply until the 5-minute stale release (Q2 replaces this with a lease); `agent_runs.job_id` is null for REPLY
  jobs because it references `agent_jobs`.
- To turn on for one agency once the migration is applied (service role or SQL editor):
  `insert into public.inbox_reply_queue_agencies (agency_id, enabled_by) values ('<agency id>', 'q1 rollout');`
  To turn it off: delete that row. Jobs already queued finish where they are.
- Exit still to measure: a burst of three messages gives one reply, and a forced retry after the send makes 0 extra model calls
  and 0 extra sends, through a signed webhook on a deployed build.

**Q2 progress (2026-09-25, same branch, uncommitted; the migration is NOT applied):** built and tested.
`supabase/migrations/20261204090100_q2_queue_claim.sql` was dry-run on Manasik OS inside a transaction that always rolls back,
using `scripts/sql/verify-q2-queue-claim.sql`: every behaviour check passed and nothing persisted.
- **Measured** (51 agencies, 51,000 due jobs, 20 claims of 20 jobs, per-agency cap 10): before p50 80.30 ms, p95 84.02 ms, max
  87.93 ms; after **p50 3.31 ms, p95 5.41 ms, max 15.86 ms**. The exit (p95 under 20 ms at 50,000 queued) is met on this project.
- The old claim ranked every due job in the lane on each call. The new one skip-scans the agencies that have queued work and takes
  only each agency's top `cap - in_flight` jobs from a new partial index, so the work is about agencies x cap, not the backlog.
  Which jobs are chosen and in what order is unchanged (checked: priority then age within an agency, round-robin across agencies,
  the cap counts jobs already running, no job is handed out twice). The lane lock stays, since it is what keeps the cap exact.
- **Leases:** a claim stamps `locked_until` (REALTIME 90 s, STANDARD 120 s, BULK 180 s, each above the longest drain budget). A job
  whose lease has run out is released by the stale sweep, stops counting against its agency's cap, and stops blocking the next reply
  for its conversation. A dead worker used to hold a conversation's reply for up to 5 minutes; now for one lease. Rows without a
  lease keep the old 5-minute rule. This closes the Q1 limit "a dead worker blocks that conversation for 5 minutes".
- **Apply order:** Q1 migration, then Q2 migration, then deploy the code. The new code sends `p_lease_seconds`, which the old
  four-argument function does not accept, so deploying the code first would stop every claim. The old four-argument call keeps
  working against the new function (checked), so applying the migration first is safe. The two new indexes are created without
  `CONCURRENTLY` (a migration runs in a transaction); on a large `channel_jobs` build them first with `create index concurrently`.
- The timing rows leave dead space until vacuum when the check is run; on a size-limited plan, run it sparingly.

**F1 progress (2026-09-25, same branch; migration not applied, nothing deployed): staff can attach a photo or a document.**
- **Flow.** The paperclip in the composer asks the server for an upload (`prepareStaffAttachmentUpload`: role, conversation, type and size checked; the server names the path
  `<agency>/outbound/<conversation>/<uuid>.<ext>` and issues a one-file signed upload). The browser uploads straight to the private `inbox-attachments` bucket, so the file never
  passes through a serverless request body. On send, `sendStaffMessage` reads the stored file back and judges it from its own bytes, then calls
  `enqueue_inbox_media_message`, which writes the message, its `message_attachments` row and the outbox command in one transaction. The outbox drain signs a fresh 10-minute URL
  at send time and hands it to the adapter's new `sendMedia`. No URL is ever stored in a row. The thread shows the file through the existing attachment rendering.
- **What is allowed.** JPEG and PNG up to 5 MB; PDF, DOCX, XLSX and PPTX up to 10 MB. The declared type must match the file's signature. A Word/Excel/PowerPoint file containing
  `vbaProject.bin` (macros) and a PDF containing `/Launch` or `/JavaScript` are refused, and a refused file is deleted from the bucket. Everything else is refused, including legacy
  .doc/.xls, archives, SVG, HTML, video. This is an allow-list for what an agency should send a customer, **not a malware scanner**: attachments are stored `scan_status = PENDING`.
- **Per channel.** WhatsApp: image and document by link, with the caption on the file. Messenger: image or file, then the caption as a separate text. Instagram (Page and Login connections):
  photos only, then the caption as a text; a document is refused before it is uploaded. If a file goes out but its separate caption fails, the file is not resent; the message is marked
  sent with "The file was sent, but its caption was not."
- **Same gates as text.** The staff role, take-control, the 24-hour window rules, the protection gate (on the caption) and `authorizeProviderSend` all apply. The signed URL is created before
  the final authorization so nothing is read between that decision and the send (an existing test enforces this).
- **Verified.** `enqueue_inbox_media_message` in a rolled-back run on Manasik OS (`scripts/sql/verify-f1-staff-media-message.sql`): photo and document-with-caption create message,
  attachment and outbox command together with no URL; a retry returns the same message; an executable type, an oversized photo, another agency's or conversation's path, a `..` path, a bad
  extension, a long caption, an AI-owned chat and another agency's staff are all refused; anon cannot run it. Unit tests cover the type and signature rules, the staged-file checks, the
  provider payloads, the drain's media branch and the action's wiring.
- **Not verified, and needed before relying on it (E1):** a real send of each type on each channel with Meta test assets (Messenger's and Instagram's attachment payloads follow Meta's
  documented shape but were not exercised; the WhatsApp document `filename` and image limits likewise); the composer UI in a browser (paperclip, chip, uploading state, the pending
  bubble); the Instagram document limitation is from documentation, not a test.
- **Known gaps.** A file that is uploaded and then never sent (the person removes it or leaves) stays in the bucket: nothing sweeps orphaned staging objects yet, and the D1 sweep
  covers rows, not storage objects. No malware scanning. Only one file per message. Videos and audio are not sent.
- Apply order: Q1, Q2, Q4, I1, I2, D1, D2, D3, F1 migrations, then the code.

**D3 progress (2026-09-25, same branch; migration not applied, nothing deployed):** one queue computation per inbound message, not four.
- Measured on Manasik OS (rolled back, real triggers, 300 inbound messages = the conversation update that records it plus the message insert):
  **4.00 `compute_conversation_queues` calls per inbound and 8.7 ms before; 1.00 call and 3.9 ms after.** The review said "twice"; it was worse,
  because each of the two refreshes also computed twice inside `refresh_conversation_queues`.
- Migration `20261204090700_d3_single_queue_recompute.sql`: (1) drops `conversation_messages_refresh_queues`. Queue membership is a function of
  `compute_conversation_queues`, which reads only `conversations`, `leads`, `conversation_intelligence` and `conversation_interventions`, never
  messages, so a message insert changes none of its inputs; what a message means for queues is written to the `conversations` row, whose own trigger
  refreshes. A test fails if the definition ever starts reading `conversation_messages`. (2) `refresh_conversation_queues` computes once and takes
  rank and activity time from that one result. Same rows, same counters, same advisory lock.
- Verified (`scripts/sql/verify-d3-single-queue-recompute.sql`, rolled back): 20 inbound messages run the computation 20 times; a message inserted
  alone runs it 0 times; after inbound, reply, needs-a-person, spam lead and closed, membership equals the definition and the per-queue counters equal
  the membership. The four triggers on the real inputs (conversations, intelligence, interventions, leads) remain.
- Not changed, and worth knowing: an inbound message still causes one refresh from the conversation update (correct), plus one more only when the
  lead link changes. The rest of ingest's cost (conversation upsert, lead link, message insert, sequence assignment, realtime broadcasts, jobs) is
  untouched. Timings are single-connection and include those other triggers; concurrency was not measured.
- Apply order: Q1, Q2, Q4, I1, I2, D1, D2, D3 migrations, then the code.

**D2 progress (2026-09-25, same branch; migration not applied, nothing deployed):** Inbox search is index-assisted.
- Migration `20261204090600_d2_trigram_search_indexes.sql`: `pg_trgm` moved from `public` to `extensions` (the live database had it in `public`),
  and five GIN trigram indexes: `conversations(contact_name, contact_phone)` and `leads(reference, full_name, desired_package_name)`.
  `desired_package_name` is not in the plan's list but is in the search's OR, and an OR only uses an index when every arm has one, so leaving
  it out would have made the other two useless. A test (`lib/data/inbox-search-indexes.test.ts`) reads the search source and fails if a
  searched column is not indexed. Nothing in the repository calls a `pg_trgm` function; the four existing trigram indexes on `packages` and
  `package_content` are unaffected by the move (checked in the dry-run).
- **Query plans (Manasik OS, rolled-back synthetic data: 20 agencies x 1,500 = 30,000 conversations and 30,000 leads, one agency's search):**

  | Search | Before | After |
  |---|---|---|
  | conversations (`contact_name` / `contact_phone` ILIKE, newest first, limit 50) | index scan on the agency, 1,499 of 1,500 rows read and discarded; 16 ms (55 ms on a cold run) | BitmapOr of both trigram indexes, 1 row read; 3.8 to 6.5 ms |
  | leads (`reference` / `full_name` / `desired_package_name` ILIKE, limit 50) | bitmap scan on the agency, 1,499 of 1,500 rows discarded; 5.6 ms | BitmapOr of three trigram indexes, 1 row read; 0.35 ms |

  Index sizes at that volume: 4.2 MB, 1.0 MB, 1.7 MB, 4.3 MB, 0.8 MB (about 12 MB for 60,000 rows). At this size the gain is small because
  one agency has only 1,500 rows; the "before" cost grows with the agency's own row count, the "after" cost with the number of matches.
  These are superuser plans, which skip row security; a signed-in user's query adds the RLS filter and was not measured.
- Limits to know: the search's minimum length is 2 characters and a trigram index needs 3, so a 2-character search still scans the agency's
  rows (correct, not faster). A pattern that matches many rows in other agencies is filtered by agency after the index. New rows enter a GIN
  index through a pending list that autovacuum merges; until then searches are slower, which is why the verify script merges it before reading
  a plan (`gin_clean_pending_list`).
- Built in the migration's transaction, which blocks writes to those tables while it runs: instant today, but on millions of rows create them
  by hand with `create index concurrently` first (the migration's lines are `if not exists`).
- Apply order: Q1, Q2, Q4, I1, I2, D1, D2 migrations, then the code.

**D1 progress (2026-09-25, same branch; migration not applied, nothing deployed):** retention now covers the tables that grew without bound.
- Found in the live database: the nightly sweep's `WEBHOOK_PAYLOADS` scope has failed every night since it first ran (it read `created_at`,
  which `channel_webhook_events` does not have; the column is `received_at`), and so has `INTELLIGENCE` (`conversation_intelligence` has no `id`;
  its key is `conversation_id`). Each failure made the cron return 500. Both are fixed. Neither had ever deleted a row.
- New scopes in the existing per-agency sweep (same cursors, batching and audit rows in `inbox_retention_sweeps`): `WHATSAPP_WEBHOOK_PAYLOADS`
  (`whatsapp_webhook_events`), `CHANNEL_JOBS` and `AGENT_JOBS` (only DONE and DEAD, 30 days, not agency-configurable).
- Migration `20261204090500_d1_retention_raw_events_and_jobs.sql`: partial indexes over finished jobs so each night's page is an index range
  scan, and `purge_unattributed_raw_events` for raw deliveries with no agency (unknown number or Page, rejected signature), which the
  per-agency sweep can never reach and which an unauthenticated caller can create. Called by the retention cron. Dry-run on Manasik OS passed
  and rolled back (`scripts/sql/verify-d1-retention.sql`).
- **Deviations from the D1 row above, on purpose:** (1) raw webhook events use the agency's webhook payload retention (default 30 days, 1 to
  90), not a fixed 14, because that is settled decision R7 in `architecture.md`; change the default there if 14 is wanted. (2) `ai_runs` keeps
  R7's 13 months (agency-configurable), not 180 days; `ai_usage_daily` already keeps the daily rollup. (3) `agent_runs` is not swept: the sweep
  documents them as evidence kept with their conversation, and no decision has changed that. (4) It runs as the existing nightly cron, not an
  Inngest schedule (the SDK is not installed, see I1).
- Not done: `inngest_outbox` sent rows are not purged yet. Deleting rows makes space reusable but does not shrink a table on disk; `VACUUM FULL`
  is a separate, locking operation, still to be run on `conversation_queue_membership` and `conversations`.
- Live sizes for scale: 288 WhatsApp raw events (416 kB), 1,725 `channel_jobs` (9 MB, the largest of these), 55 `agent_jobs`.
- Apply order: Q1, Q2, Q4, I1, I2, D1 migrations, then the code.

**I2 progress (2026-09-25, same branch; migration not applied, nothing deployed):** a delivery whose messages never landed is now repaired.
- Migration `20261204090400_i2_raw_event_reconcile.sql`: two partial indexes and `find_unreconciled_raw_events` / `mark_raw_events_reconciled`
  (candidates only; they never touch messages). Dry-run on Manasik OS passed and rolled back (`scripts/sql/verify-i2-raw-event-reconcile.sql`).
- `lib/inbox/reconcile/raw-events.ts`: every minute, for WhatsApp and Messenger/Instagram deliveries that hold messages and are 2 min to 6 h old,
  check each message is stored and replay the missing ones through the same idempotent ingest the webhook uses; stamp `processed_at` when
  every message is accounted for. It replays messages only (never the unsupported-media notice, ticks or echoes), only into the agency the
  event was recorded for, and with the same fail-closed assistant switch as the live path. Runs as a worker loop
  (`WORKER_RECONCILE_RAW_EVENTS`) and in the agent-jobs cron as the safety net. It is a worker loop and a cron, not an Inngest
  schedule, because the SDK is not installed (see I1); moving it under Inngest later is a wrapper.
- To make that replayable without Next.js in the worker, the WhatsApp message-ingest loop moved to `lib/whatsapp/inbound-ingest.ts` and
  `processMessengerEvents` to `lib/channels/messenger/process-events.ts`. The handlers re-export them; behaviour is unchanged, except that
  in a WhatsApp delivery all messages are now stored before echoes and ticks are applied, rather than interleaved.
- **Gap against the exit:** the exit says "deleting a job after ingest is repaired within 5 min". This does not do that. Ingest stores the message
  and its jobs in one transaction, so a message that landed but whose job was later deleted is "landed" here. That case needs a different
  check (an inbound message the assistant should answer with no REPLY job or reply intent) and is not built.
- Not run against real traffic: the replay path is covered by unit tests with fakes, not by a live delivery.
- Apply order: Q1, Q2, Q4, I1, I2 migrations, then the code.

**I1 to I6 progress (2026-09-25, same branch; migrations not applied, nothing deployed, nothing switched on).** The npm registry became reachable, so the SDK is now
installed (`inngest` 4.21, `@inngest/middleware-encryption` 2.0, and `esbuild` as a direct dev dependency as the worker runbook asked). Runbook: `docs/runbooks/inngest.md`.
- **I1, done.** R8 recorded in `architecture.md` §16. `inngest_outbox` (migration `..090300`, dry-run passed and rolled back), the ids-only Zod catalogue, the forwarder (worker, plus the
  agent-jobs cron as a safety net), the client with the encryption middleware, and `app/api/inngest/route.ts`, which in production serves only when both `INNGEST_SIGNING_KEY` and
  `INNGEST_ENCRYPTION_KEY` are set (otherwise 503, naming what is missing). **Exit, checked locally against the Inngest Dev Server, not a staging account:** the real forwarder sent an event; the Dev
  Server received it with the outbox row id as the event id and a payload of ids and one timestamp only; the app registered 15 functions; the run completed; and the run's stored output was libsodium
  ciphertext (`__ENCRYPTED__: true`). Not checked: request-signature verification (the Dev Server does not sign), and a real Inngest Cloud account. `scaling.md` is still not updated for R8.
- **I2, done, as an Inngest schedule** (`raw-event-reconcile`, every minute), running the unchanged reconciler. The gap recorded above stands: it does not repair a job deleted after ingest.
  When schedules are switched on, the worker's loop is turned off (`WORKER_RECONCILE_RAW_EVENTS=false`) and the agent-jobs cron skips it, so one runner remains.
- **I3, built, not switched on.** Ten schedules matching the ten live pg_cron jobs exactly (a test pins each cadence), each calling the same route handler in-process with the same bearer check, so no job
  logic changed. A 5xx now fails the run (pg_cron could only log it), which gives retries and alerts. Step output is numeric counts only. All are inert until `INNGEST_SCHEDULES_ENABLED`; the cutover is
  `scripts/sql/cutover-i3-pg-cron-to-inngest.sql` (unschedule pg_cron first, then enable), with a rollback block. **Not done:** removing `invoke_cron_route` and the Vault `cron_http_*` secrets: that
  is a later migration, after a week of clean Inngest runs. **Finding:** `/api/cron/finance-ops-sweep` says "wire this to run hourly" but nothing ever scheduled it. It is registered as
  `cron-finance-ops-sweep` behind its own switch, and has never run in production. **Cost:** the free Inngest plan (50,000 executions a month) is not enough with the per-minute drains on
  (about 86,000 a month on their own); see the runbook for the options.
- **I4, one of four built, deliberately.** `replyWindowReminder` is new and built end to end: migration `..090900` adds two trigger paths that write an outbox row in the same transaction when a
  reply window opens (or a chat with an open window becomes person-owned) on a chat a person owns, never per message (dry-run passed: a sliding window and an assistant-owned chat queue nothing);
  the function sleeps until two hours before the window closes, re-reads the chat, follows the window if the customer wrote again, and notifies the owner once per unanswered customer message through the
  existing exactly-once ledger. It sends nothing to the customer. `followUpSequence`, `slaEscalation` and `handoffAcknowledgement` are **not built**: `runQuietLeadSweep`, `runSlaSweepForAgency` and
  `runHandoffAlertSweep` already do them (with thresholds, business-hours arithmetic, opt-ins and ledgers), the first sends to customers, and a second implementation risked double-nudging. They now run on
  Inngest through the `cron-lead-followups` and `cron-inbox-sla` schedules. The exit "a customer reply cancels the pending nudge; staff takeover cancels the sequence" is therefore met by the existing
  sweeps' own rules, not by new code, and was not re-proven here.
- **I5, built, off by default.** `knowledge-document-ingest` runs the same work as the `EMBED_DOCUMENT` job in steps (prepare, embed 32 pieces per step, finalize); the text is stored as pieces in Postgres
  in the first step and never crosses a step boundary. The job's own read-and-chunk stage was extracted so both paths apply identical rules. `INNGEST_KNOWLEDGE_INGEST` selects it; if the outbox write fails the
  upload falls back to the old job. **Exit not met:** "a 200-page PDF ingests with resumable steps" was not run; the phases are unit-tested with fakes, and no real PDF, embedding call or restart was exercised.
- **I6, not built as specified.** `bookingPaymentFollowThrough` as a per-booking event workflow would duplicate the deterministic reminder cadence the Finance sweep already implements. What was done is to register
  that sweep as a schedule behind its own switch (above). Whether each milestone reminder fires exactly once was **not verified**.
- **Verification.** Tests, typecheck and lint pass; `next build` passes with `/api/inngest` in the route table; `npm audit --omit=dev` reports 0 vulnerabilities.
- Apply order: Q1, Q2, Q4, I1, I2, D1, D2, D3, F1, then the I4 migration (it needs I1's `enqueue_inngest_event`), then the code.

**Q4 progress (2026-09-25, same branch; migration not applied, nothing deployed):** delivery ticks are applied in batches.
- Migration `20261204090200_q4_delivery_status_batching.sql`: `apply_message_delivery_updates` applies many statuses in one statement,
  collapses several ticks for one message to the furthest (READ > DELIVERED > SENT), never moves a message backwards (the old
  last-write-wins code could), and skips rows that would not change. `message_delivery_status_buffer` plus
  `drain_message_delivery_status_buffer` (SKIP LOCKED, rows deleted in the statement that applies them). The table is not named
  `message_delivery_events`: that name is already the outbox's table.
- With `INBOX_WORKER_ACTIVE` the WhatsApp and Messenger/Instagram webhooks append to the buffer; the worker's `delivery_status` loop
  (`WORKER_DRAIN_DELIVERY_STATUS`, default on) applies up to 500 a second, and the agent-jobs cron drains it as the safety net.
  Without a worker, or if the append fails, the tick is applied at once through the same function. Code deployed before the migration
  falls back to the old UPDATE.
- Dry-run on Manasik OS (rolled back): 3 ticks for one message become 1 write and READ wins in any order; a late DELIVERED changes
  nothing; a failure keeps its reason until a later delivery; agency-scoped; the buffer drains once and is left empty
  (`scripts/sql/verify-q4-delivery-status.sql`).
- Not measured: the exit figure (status writes/min divided by 20 or more) needs real traffic on the worker.
- Apply order: Q1, Q2, Q4 migrations, then the code.

**Q3 progress (2026-09-25, same branch, uncommitted; nothing deployed):** the worker is built, tested and packaged, but not running
anywhere. Runbook: `docs/runbooks/inbox-worker.md`.
- `worker/index.ts` and `lib/inbox/worker/`: one lane worker each for REALTIME, STANDARD and BULK (default concurrency 40 / 10 / 4),
  plus loops for the outbox (staff sends) and the legacy `agent_jobs`, a stale-lease sweep, and a health port (`/healthz`,
  `/readyz`, counters only). It claims exactly as many jobs as it has free slots, is woken the moment a slot frees, polls an idle
  lane every 250 ms to 1 s, and on SIGTERM stops claiming, lets jobs finish, then hands the rest back with their attempt refunded.
  Jobs run through `runClaimedJob`, now shared with the budgeted drain, so a job is settled the same way wherever it runs.
- **Deviation from the plan:** no LISTEN/NOTIFY. It would need a direct database connection string (another secret to guard) and the
  `pg` package (which cannot be added without network access here). Polling at 250 ms costs one indexed claim per lane per poll, now
  about 1 to 3 ms, and adds about 125 ms on average. It can be added later without changing anything else.
- `INBOX_WORKER_ACTIVE=1` on the web deployment stops the WhatsApp and Messenger/Instagram webhooks and the staff send from starting
  their own drain after responding. Off by default; the scheduled drains stay as the safety net either way.
- **Verified here:** the bundle builds; `--check` proves all five job handlers load under plain Node and fails (exit 1, secrets not
  printed) when required variables are missing; a started worker serves its health port, answers 404 to anything else and keeps
  running while the database is unreachable; 31 unit tests cover concurrency, slot wake-ups, timeouts, shutdown handback, config
  validation, health and log contents. **Not verified:** the Docker image (no daemon here), Windows signal handling, and any real load.
- **Least privilege:** the worker gets the service-role key and the model key, and deliberately not `META_APP_SECRET`,
  `INSTAGRAM_APP_SECRET`, verify tokens or `CRON_SECRET`, which only the web tier uses.
- Known limits: `esbuild` is present only through `vite` (add it as a direct dev dependency when the network is available);
  `agent_runs.job_id` is still empty for REPLY jobs; the aux drains (outbox, agent_jobs) are polled once a second, not woken.

| Slice | Change | Exit |
|---|---|---|
| Q1 | `REPLY` kind in `channel_jobs` with merging + one-per-conversation claim + `last_message_sequence`; AI replies go through the outbox with a deterministic key; per-agency flag switches the ingest RPC from `agent_jobs` to `REPLY` | 3 messages in 4 s → 1 reply; a forced retry after send → 0 extra model calls, 0 extra sends |
| Q2 | Claim rework: `locked_until` reclaim, partial `QUEUED` index, bounded candidate scan, per-lane lock only around the fair-share pick | Claim p95 < 20 ms with 50 k queued rows |
| Q3 | Worker package + deployment (2 instances, ap-southeast-1), `LISTEN/NOTIFY` wake-up, health check, secrets, egress policy; `after()` drains removed for flagged agencies | Sustained: REALTIME p95 < 5 s; Burst: back to normal ≤ 60 s after the burst |
| Q4 | `APPLY_STATUS` batched: 100 statuses per job → one `UPDATE … FROM unnest()` | Status writes/min ÷ ≥ 20; ticks still update the open thread |
| Q5 | Retire `agent_jobs` (all agencies on `REPLY`), shard fan-out route and lane HTTP crons | 7 stable days |

### Phase I: Inngest (lifecycle and schedules only)

| Slice | Change | Exit |
|---|---|---|
| I1 | `inngest` client, `/api/inngest` with signing key, proxy allow-list, encryption middleware, typed event catalogue + Zod, `inngest_outbox` table (RLS: service-role only) + worker forwarder; Inngest Dev Server documented in the README | Staging event round trip; payload inspection shows ids only |
| I2 | Raw-event reconciler as an Inngest schedule (re-queues raw events whose message never landed) | Deleting a job after ingest is repaired within 5 min |
| I3 | Every `pg_cron → invoke_cron_route` schedule moved to Inngest `cron`; `invoke_cron_route` and the Vault HTTP config removed | All schedules visible with run history and failure alerts |
| I4 | `followUpSequence`, `replyWindowReminder`, `slaEscalation`, `handoffAcknowledgement` | A customer reply cancels the pending nudge; staff takeover cancels the sequence |
| I5 | `knowledgeDocumentIngest` replaces `EMBED_DOCUMENT` | 200-page PDF ingests with resumable steps |
| I6 | `bookingPaymentFollowThrough` | Milestone reminders fire once each |

### Phase D: data at scale

| Slice | Change |
|---|---|
| D1 | Retention: raw webhook events 14 days, finished jobs 30 days, `agent_runs`/`ai_runs` detail 180 days with daily rollups kept; all as keyset-batched Inngest schedules |
| D2 | `pg_trgm` moved to the `extensions` schema; GIN trigram indexes on `conversations(contact_name, contact_phone)` and `leads(reference, full_name)`; query plans recorded |
| D3 | Single queue-projection recompute per inbound message |
| D4 | Autovacuum settings for `channel_jobs`, `conversations`, `outbox_messages` |
| D5 | Written partitioning runbook for `conversation_messages` (monthly ranges); build only when the table passes ~100 M rows or p95 thread reads regress |

### Phase F: feature gaps

| Slice | Change |
|---|---|
| F1 | Staff attachments: upload to the private bucket → outbox `command` with media → adapter `sendMedia` for WhatsApp (image/document), Messenger and Instagram (image/file); size/type validation with Zod; malware-type allow-list |

### Phase E: prove every flow end to end

| Slice | Change | Exit |
|---|---|---|
| E1 | Run [`../runbooks/inbox-remodel-verification.md`](../runbooks/inbox-remodel-verification.md) on staging with two signed-in sessions and Meta test assets for all three channels; then add an automated browser suite (Playwright; needs a dependency decision) for the flows in §4 rows 1–3, 5, 7–12, 15, 17 | Every row in §4 is "Works" or has a named follow-up; checklist exits ticked with evidence |
| E2 | Shadow period for intelligence surfaces with staff labelling | Precision/recall recorded per surface |
| E3 | Load harness driving **signed webhooks** for all three channels: Sustained 500/min for 60 min, 5× Burst for 5 min, noisy tenant, reconnect storm, worker kill, model outage | All `scaling.md` §11.3 SLOs met with ≥ 30% headroom; MI6.5 ticked |
| E4 | Staged rollout: internal → 5% → 25% → 100% agencies, one business day each, stop conditions from `scaling.md` §14.2 | 100% on the new path |

**Order:** P0 (all) → Q1 → Q2 → Q3 → E1 (can start in parallel with Q) → Q4 → I1 → I2 → I3 → D1–D3 → Q5 → I4–I6 → F1
→ E2 → E3 → E4. P0 alone removes the customer-visible defects and should ship first.

---

## 9. Cost per agency: 100 conversations per month, all channels

### 9.1 Assumptions (change these and the numbers scale linearly)

- 100 conversations/month, averaging **12 messages** (6 inbound, 6 outbound) → 600 inbound, 600 outbound.
- The assistant answers about **70%** of inbound; merging reduces that to **~300 AI reply turns**.
- About 300 enrichment runs (triage/intent/risk), 100 staff-requested drafts, 50 images/documents read, 30 voice
  notes, and 5% of turns escalated to the premium model.
- Channel split does not change AI cost. It only changes Meta fees (Messenger and Instagram messages are free).
- Prices in USD from the repository's `ai_model_rates` table and the vendors' public pricing pages on 2026-09-25.

### 9.2 Measured AI turn cost (live `agent_runs`)

`openai/gpt-5.6-luna`: average **941 input + 3,257 cached + 360 output tokens**, p50 7.2 s, p95 17.5 s.
At $0.10 / $0.01 (cached) / $0.60 per million tokens → **~$0.00034 per turn**. The table uses 3× that (~$0.001) to
allow for tool-call loops and longer histories.

### 9.3 Variable cost per agency

| Item | Calculation | US$/month |
|---|---|---:|
| AI replies (luna) | 300 × $0.001 | 0.30 |
| Premium escalations (`claude-opus-5`, 5%) | 15 × (4k in × $5/M + 400 out × $25/M) = 15 × $0.03 | 0.45 |
| Enrichment (triage/intent/risk, luna) | 300 × 3 calls × ~$0.0003 | 0.27 |
| Staff drafts / Copilot (`gemini-3.8-flash`) | 100 × (4k × $0.375/M + 400 × $1.875/M) | 0.23 |
| Media + voice reading | 50 × $0.0005 + 30 × ~$0.002 | 0.09 |
| Embeddings / answer cache | negligible | 0.01 |
| OpenRouter credit fee (~5.5%; confirm on the account) | on the above | 0.07 |
| **AI subtotal** | | **≈ 1.40** |
| Database growth (~1,200 messages + jobs + events ≈ 10 MB) | within the included 8 GB until thousands of agencies | ≈ 0.00 |
| Media storage (~50 files × 0.5 MB = 25 MB) | within the included 100 GB | ≈ 0.00 |
| Realtime (~1,200 messages × 2 events × 5 staff ≈ 12 k) | within the included 5 M | ≈ 0.00 |
| Contingency (retries, longer threads, heavier Copilot use) | ×2 on AI | +1.40 |
| **Variable total** | | **≈ 2–4** |

### 9.4 Meta messaging fees (billed by Meta to the agency's own WhatsApp account, not to the platform)

| Item | Rate | US$/month |
|---|---|---:|
| Replies to customers inside the 24 h window (text/media) | Free per Meta's current pricing page | 0 |
| Utility templates inside an open window | Free | 0 |
| Utility templates outside the window (e.g. 50 reminders) | ~$0.002 each (Sri Lanka standalone rate from 1 Oct 2026, as reported) | 0.10 |
| Marketing templates (e.g. 100 campaign sends) | ~$0.06 each (current "Rest of World" group rate; the Sri Lanka marketing rate is not yet confirmed) | 6.00 |
| Messenger / Instagram | Free | 0 |
| **Range** | | **0–8** |

Third-party sources report that Meta will charge for service messages from **1 October 2026**, with 1,000 free per
business phone number per month. Meta's pricing page as fetched today still says non-template messages are free.
Either way, at 600 outbound messages this agency stays inside the reported free tier. **Confirm against Meta's
downloadable rate card before quoting prices to customers.**

### 9.5 Fixed platform cost (shared by all agencies)

| Service | Plan | US$/month |
|---|---|---:|
| Supabase | Pro $25 + Medium compute $60 − $10 included credit | 75 |
| Vercel | Pro, 1–2 seats + light usage (webhooks/UI; drains move to the worker) | 20–50 |
| Inngest | Pro (1 M executions included; schedules alone use tens of thousands per month) | 99 |
| Worker hosting | 2 small always-on containers, ap-southeast-1 (e.g. Fargate/Fly/Railway) | 30–60 |
| **Fixed total** | | **≈ 225–285** |

### 9.6 All-in per agency

| Agencies on the platform | Fixed share | + Variable | = Platform cost per agency | + Meta fees (agency-paid) |
|---:|---:|---:|---:|---:|
| 10 | ~$25 | $2–4 | **~$27–29** | $0–8 |
| 50 | ~$5 | $2–4 | **~$7–9** | $0–8 |
| 200 | ~$1.3 | $2–4 | **~$3.5–5.5** | $0–8 |

At 100 conversations/month an agency's usage is small, so its cost is mostly its **share of the fixed platform**. AI
cost only overtakes it at about 1,000+ conversations per agency. Compute, Inngest and worker tiers step up at the
platform level as agency count grows (for example Large compute at $110), which keeps the per-agency figure in the
same range.

Sources (checked 2026-09-25): [Inngest pricing](https://www.inngest.com/pricing),
[Supabase pricing](https://supabase.com/pricing), [Vercel pricing](https://vercel.com/pricing),
[Meta WhatsApp pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing),
[ChatMaxima rate summary](https://chatmaxima.com/whatsapp-api-pricing/),
[ChatMaxima: service-message pricing from 1 Oct 2026](https://chatmaxima.com/blog/whatsapp-service-message-pricing-october-2026/).
AI rates are from `supabase/migrations/20261126090002_ai_model_rates_openrouter_models.sql`.

---

## 10. Definition of done

- [ ] R8 recorded in `architecture.md`; `scaling.md` updated to match.
- [ ] Live migration history equals the repository; checklist and runbooks match reality.
- [ ] No AI reply waits on a stranded claim; a burst produces one reply; a retry never re-bills the model or re-sends.
- [ ] Zero lost messages under batched, duplicated and out-of-order webhooks (fault injection).
- [ ] `agent_jobs`, `after()` drains, shard fan-out and pg_net HTTP crons are removed.
- [ ] Every schedule and lifecycle workflow runs in Inngest with ids-only payloads and encryption middleware.
- [ ] Paid, privacy-configured model is the default; subprocessor list documented (OpenRouter, Inngest, worker host).
- [ ] Retention is in place for raw events, jobs and AI run detail; trigram search indexes exist with recorded plans.
- [ ] Staff can send files on all three channels.
- [ ] Every flow in §4 is proven in a signed-in browser against Meta test assets; the automated suite runs in CI.
- [ ] 500 msg/min sustained for 60 min and a 5× burst meet the `scaling.md` §11.3 SLOs with ≥ 30% headroom.
- [ ] Cost model re-checked against one month of real `ai_usage_daily` data and Meta invoices.
