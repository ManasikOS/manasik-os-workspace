# Manasik Inbox — 10K messages/minute, resilient real-time on Cloudflare

Status: **proposed design record. No code, SQL or configuration has been changed.**
Owner: Inbox + Copilot programme
Extends: [`architecture.md`](./architecture.md) §7 and R8–R10, and [`scaling.md`](./scaling.md).
Where this document contradicts either, **this one is a proposal and those are authoritative until an
amendment (R11) is accepted**. The programme rule is that the architecture changes first.

> **Provenance.** Cloudflare limits and prices below are from memory, not verified for this document. Every
> figure marked **(verify)** must be re-checked against current Cloudflare and Supabase documentation before
> an implementation slice depends on it.

---

## 1. Goal and non-goals

### 1.1 Goal

An agency member keeps the Inbox open all day, on a phone or laptop, on a bad connection, and:

1. never refreshes the page to see new messages or state changes;
2. can read recent conversations and **send** with no connectivity, with messages delivered when the
   connection returns (the WhatsApp behaviour);
3. sees an honest per-message state: queued on device → accepted → sent to provider → delivered → read → failed;
4. while the platform ingests **10,000 messages per minute** across tenants with no tenant starved.

### 1.2 Non-goals

- Replacing Postgres as the source of truth, or `channel_jobs` as the per-message queue.
- Moving provider sends, credentials or the Vault out of the existing outbox path in the first phases.
- Moving the knowledge base, pgvector, auth or storage to Cloudflare.
- A second database (D1), a second queue for fairness (Cloudflare Queues), or an external workflow engine.

---

## 2. Load model

Assumptions (state them, then measure them in the §12 proof): **platform-wide** 10,000 inbound customer
messages/min across about 200 agencies, 5 connected staff per agency on average, 3× at peak.

| Quantity | Sustained | 5× burst (5 min) | Note |
|---|---:|---:|---|
| Inbound customer messages | 167/s | 833/s | the 10K/min target |
| Provider webhook events (messages + statuses) | ~670/s | ~3,300/s | `scale-inngest` §3.1 says about 75% of traffic is delivery status |
| Outbound (staff + AI replies), 1:1 | 167/s | 833/s | each also produces 2–3 status events |
| Concurrent staff sockets | ~1,000 | ~3,000 | |
| Delivered list events (167 × 5 viewers) | ~835/s | ~4,200/s | thread events only reach viewers of that thread |
| Postgres row writes (≈15 per message) | ~2,500/s | ~12,500/s | **estimate**, replace with the MI6.5 measurement |
| `conversation_messages` growth | 14.4 M/day | | ≈ 430 M/month, ≈ 5 B/year |

Two consequences drive the design:

1. **Delivered fan-out and the database write rate are the binding constraints, not the inbound rate.**
2. At 14 M rows/day the single-table assumption in `scale-inngest` D5 ("partition only when measured")
   fails. **Partitioning and retention are required from day one at this load** (§9.3).

---

## 3. Design principles

1. **Push is best-effort; pull is the guarantee.** Real-time delivery may be lost, duplicated or reordered.
   Correctness comes from a durable, cursor-addressed change feed in Postgres that the client can always
   resume from. (This extends the existing rule "never depend on Realtime receipt for correctness".)
2. **The device is a participant, not a screen.** The client keeps a local store and a durable outbox. The
   network is an optimisation.
3. **Postgres owns state; the edge owns connections.** Cloudflare holds sockets, absorbs bursts and runs
   I/O-bound workers. It never owns business state.
4. **One transaction commits the message and its work.** The atomic ingest RPC (`scaling.md` SC1) remains the
   only way a canonical message is created.
5. **Events are identifiers, never content.** Unchanged from `scaling.md` §6.
6. **Least privilege at every new runtime.** No new component receives the Supabase service-role key.

---

## 4. Target topology

```text
                      Browser / PWA (IndexedDB store · durable outbox · service worker)
                         │  HTTP/3 pull + send            ▲ WebSocket push (hibernating)
                         ▼                                │
 Meta ──► Cloudflare edge (WAF · rate limit · Turnstile · DDoS · CDN)
              │                         │
              ▼                         ▼
      Worker: webhook-edge       Worker: sync-api          Durable Object: AgencyHub (1 per agency)
      verify HMAC, dedupe,       authorize, batch-read,    sockets, subscriptions, presence,
      call ingest RPC            resume by cursor          composer lock, fan-out
              │  Hyperdrive                │  Hyperdrive            ▲ publish (ids only)
              ▼                            ▼                        │
      ┌─────────────────────────────────────────────────────────────┴───────┐
      │ Supabase Postgres (single source of truth, agency-scoped RLS)        │
      │ ingest RPC · conversation_messages (partitioned) · channel_jobs      │
      │ inbox_change_feed · projections · outbox_messages                    │
      └───────────▲───────────────────────────────┬─────────────────────────┘
                  │ claim (fair share)            │ commit
      Worker: lane-dispatcher DO ──► ConversationRunner DO (1 per conversation, serial)
      (poke + poll, per lane/shard)   AI turn · enrichment · media · status batches
                  │
      Existing outbox drain ──► Meta (unchanged until phase CF5)

 Fallback path (DB unreachable or over pressure):
      webhook-edge ─► Cloudflare Queue "ingest-buffer" ─► consumer ─► same ingest RPC (idempotent)
```

---

## 5. Components

### 5.1 Edge protection (Cloudflare proxy)

- Proxy the app and webhook hostnames. WAF managed rules, per-IP and per-connection rate limits on
  `/api/webhooks/*`, Turnstile on login and invite flows, DDoS mitigation.
- HTTP/3 (QUIC) enabled: it recovers from packet loss and connection migration (Wi-Fi ↔ mobile data) better
  than TCP, which is directly relevant to the low-connectivity goal.
- Supabase Realtime sockets and Storage URLs are not proxied; the hub in §5.3 replaces the former for the
  Inbox.

### 5.2 `webhook-edge` Worker (ingest)

Responsibilities, in order:

1. Verify the Meta signature against the raw body.
2. Reject malformed or oversized payloads; rate-limit per channel connection.
3. Resolve the channel connection and agency **from the verified account id**, never from the body.
4. Call the atomic ingest RPC (`scaling.md` §9) through Hyperdrive. The RPC deduplicates on
   `(agency_id, external_message_id)`, creates the message and its required `channel_jobs`, and appends to the
   change feed.
5. Respond `2xx`. No AI, no media download, no provider calls.
6. After commit, `POST` a tiny publish request to the agency's `AgencyHub` and **poke** the lane dispatcher.
   Both are best-effort; §6 makes loss harmless.

Database role: a dedicated Postgres role with `EXECUTE` on the ingest RPC and nothing else. The Worker never
holds the service-role key.

Ack target: p95 < 300 ms (the existing SLO is < 500 ms).

**Buffer path.** If Hyperdrive/Postgres fails or the circuit breaker is open, the Worker writes the verified
raw event to a Cloudflare Queue and returns `2xx`; a consumer replays it into the same RPC. This is the **one**
sanctioned use of Cloudflare Queues: a short-lived ingest buffer in front of an idempotent write. It is not a
job queue, and it carries no fairness or coalescing semantics. Alert on non-empty buffer age > 60 s.

### 5.3 `AgencyHub` Durable Object (real-time hub)

One object per agency, using the WebSocket Hibernation API so idle sockets cost no duration.

- **Holds:** open sockets, their subscriptions (list; selected conversation), presence, composer locks,
  a small ring buffer of the last N published events for fast resume (an optimisation only).
- **Never holds:** message text, names, phone numbers, prices, passport data.
- **Accepts publishes** only from internal callers (webhook-edge, worker runtime, Next.js actions) using a
  signed service token. Never from browsers.
- **Authorizes a socket** from a short-lived token (§8.1). The agency is read from the token, never from the
  client.
- **Fans out** typed ID-only events `{ cursor, scope, conversationId, entity, entityId, version }` (the
  existing `lib/inbox/realtime/contracts.ts` envelope plus `cursor`).
- **Ephemeral signals** (typing, composer lease, "viewing") live only in object memory and are never written to
  Postgres.
- **Hot agency.** One object handles several thousand small messages per second **(verify)**; if one agency
  alone exceeds about 50% of that, shard by `conversation_id` bucket behind the same agency key. Do not
  pre-shard.

### 5.4 `sync-api` Worker (pull)

The pull path is deliberately plain HTTPS over HTTP/3, not WebSocket request/response. It then works through
proxies that break sockets and is trivially retryable.

- `POST /sync` with `{ agencyCursor, conversations: [{ id, lastSequence }], limit }`.
- Authorizes with the same short-lived token, then performs the minimum scoped reads (list patches, thread
  deltas, notes, context) **in one round trip** and returns a single compressed batch plus `newCursor`.
- If the cursor is older than the feed retention window, returns `{ resync: true }` and the client loads a
  snapshot (first list page, counts, selected thread) once.
- Reuses the repository functions specified in `scaling.md` §7; it does not duplicate query logic. If those
  are TypeScript functions bound to Next.js, either (a) the Worker calls a thin internal route, or (b) the
  logic is extracted to a shared package. **Decision for CF1**, see §14.

### 5.5 Worker runtime (per-message work)

Replaces the Vercel `after()`-plus-cron drain and satisfies the `scaling.md` §10.2 dedicated-worker gate
**without** introducing ECS. `channel_jobs` stays the durable queue.

- **`lane-dispatcher` Durable Object**, one per `(lane, shard)`. Woken by (a) the ingest poke and (b) a
  1-second alarm as the safety net. It calls `claim_channel_jobs(lane, worker_id, limit, per_agency_cap)` over
  Hyperdrive, which keeps the existing fair-share claim, per-agency in-flight caps and `SKIP LOCKED`.
- **`ConversationRunner` Durable Object**, one per conversation. The dispatcher routes `REPLY`, `ENRICH` and
  related jobs for a conversation to its runner, which executes them **serially**. This removes the
  "parallel AI turns per burst" and "retry sends a second reply" defects structurally, not by locking.
- AI calls are I/O wait; they do not consume Worker CPU budget **(verify limits)**. Handlers honour
  `AbortSignal` and are idempotent: finishing after a timeout race is safe.
- Completion, retry (`run_after`) and dead-lettering stay in Postgres, so the Vercel cron remains a working
  recovery path during canary.

### 5.6 Provider send

Unchanged through CF4: staff and AI sends go through the transactional outbox and the existing drain. Moving
the drain to the worker runtime (CF5) requires a restricted role plus a function that returns one connection's
token for one send, so the Worker never lists or bulk-reads credentials.

---

## 6. Durable change feed and resumable sync (the low-connectivity core)

### 6.1 `inbox_change_feed`

```text
inbox_change_feed(
  agency_id uuid, feed_id bigint identity, conversation_id uuid,
  scope text,          -- LIST | THREAD | CONTEXT | INTELLIGENCE
  entity text, entity_id uuid, version bigint,
  created_at timestamptz default now()
)
index (agency_id, feed_id)   -- retention: 48 h, then deleted
```

- Written by the **same triggers** that today call `realtime.send`, in the same transaction as the data, so
  there is never an event without a change, or a change without an event.
- The feed stores identifiers and versions only.
- `feed_id` is monotonic but **not commit-ordered** (a lower id can commit after a higher one). The client
  therefore re-reads a bounded overlap (`cursor − 200 rows`) and deduplicates by `(entity, entityId, version)`.
  Documented here so nobody "fixes" it with a gap-free sequence that serialises all writers.

### 6.2 Resume protocol

```text
 connect  → socket authenticated, subscribed, hub replays ring buffer from client cursor if it can
 event    → client holds `cursor`; if event.cursor > cursor + 1 → gap → pull
 pull     → POST /sync (cursor, open conversations' last sequence) → patches + newCursor
 resync   → only when cursor is older than 48 h or the server says so
```

A reconnect after a train tunnel costs: one socket handshake, one `/sync`. Not four Server Actions and not a
page refresh.

### 6.3 Why not push the content over the socket

Keeping events ID-only means the hub needs no per-event authorization of content and holds no PII. The cost
is one extra round trip on the receiving client. On poor links this is the main latency lever, so §7.4
prefetches and batches. **Revisit** hydrated push (hub attaches the patch after a per-connection authorized
read) only if field telemetry shows event-to-visible p95 above target on 3G profiles.

---

## 7. Client: offline-first and WhatsApp-grade behaviour

### 7.1 Local store

- IndexedDB holds: the first list page per saved view, the last ~200 messages of each recently opened
  conversation, conversation metadata, drafts, and the outbox.
- Store is scoped by `user_id + agency_id`, size-capped (e.g. 50 MB), evicted LRU, and **wiped on sign-out
  and on agency switch**. It contains customer PII, so it is cleared on shared-device detection and never
  holds attachment bytes beyond thumbnails.
- The app shell and static assets are cached by a service worker, so the page **opens offline** and renders
  from the local store before any network call.

### 7.2 Durable outbox

- Sending writes to IndexedDB first, then shows the message immediately in a "queued" state. The id is the
  `client_idempotency_key` (`scaling.md` §8.5).
- A sender drains the outbox over HTTPS with exponential backoff and jitter, in order per conversation, and
  reuses the same key on retry. It survives tab close; where Background Sync is available the service worker
  drains it, otherwise it drains on next open.
- Server idempotency makes "response lost after commit" harmless.
- Tick states map to existing data: `QUEUED_LOCAL` → `ACCEPTED` (outbox row) → `SENT` → `DELIVERED` → `READ`,
  and `FAILED` with an explicit retry/discard. A failed send is never silently dropped.

### 7.3 What is *not* queued offline

Message sends and drafts queue. **State changes do not queue silently**: assign, close, priority, conversion
to lead/booking. They show as "pending connection" and, on reconnect, are applied only if the entity
`version` still matches; otherwise the user is shown the current state and asked. Silent last-write-wins on
assignment is how two staff end up both thinking they own a chat.

### 7.4 Transport ladder and adaptation

1. WebSocket to the hub, with application-level heartbeat (25 s) and server-side idle detection, because TCP
   keepalive alone does not detect a dead mobile link.
2. If the socket cannot establish or repeatedly drops: fall back to **SSE** over HTTP/3, then **long-poll**
   `/sync`. The sync protocol is identical; only push delivery degrades.
3. Reconnect with jittered backoff capped at 30 s, and immediately on `online`, `visibilitychange` and
   network-type change events.
4. Payloads: Brotli over HTTP, `permessage-deflate` on the socket, thumbnails first, full media on tap, and
   no more than one in-flight sync per client.
5. A visible, non-blocking status line: "Connecting…", "Waiting for network", "Syncing". Reading and composing
   are never disabled by connectivity.

### 7.5 Closed-tab alerts (optional, CF7)

Web Push for new inbound on assigned conversations, with ID-only payloads that open the Inbox. Subscription
is stored per user and device, and deleted at sign-out.

---

## 8. Security and tenancy

### 8.1 Hub and sync authorization

- A Server Action (`requireUser()`, agency resolved server-side) mints a **≤ 5-minute** token containing
  `user_id`, `agency_id`, role and an epoch. The client refreshes it before expiry over the live session.
- The hub and `sync-api` verify the signature with a rotating key pair, accept only topics within the token's
  agency, and reject an expired or older-epoch token. A per-user epoch bump is the revocation mechanism.
- This **replaces** RLS on `realtime.messages` for the Inbox topics, so it is a new isolation boundary. It
  needs its own two-agency tests: join another agency's hub, replay another agency's cursor, forge the agency
  claim, reuse an old epoch.

### 8.2 Data handled at the edge

- Webhook bodies (customer message text) transit Worker memory during ingest. **Cloudflare becomes a
  processor of message content in transit.** Update the privacy notice and DPA inventory before CF4.
- Workers and hub logs carry ids, counts and timings only. Never bodies, names, phones or signed URLs.
- Secrets per runtime: Meta app secret(s) for signature verification; a restricted DB role per Worker;
  hub-signing public key. No service-role key, no channel tokens (until CF5, and then only per-send).

### 8.3 Existing invariants preserved

Tenant from the verified connection, provider idempotency record before ack, human replies never blocked by
AI budget, risk detection never stops, never-autonomous list unchanged.

---

## 9. Postgres at this load

### 9.1 Capacity

- Plan, compute and connection limits must be raised before any run **(verify current tiers)**. Do not size
  from this document; size from the §12 baseline.
- Hyperdrive pools Worker connections; keep the app on Supavisor transaction mode. Set per-role connection
  caps so a Worker surge cannot starve the app.
- Keep thread and list reads on the primary until read-your-writes lag from a replica is measured. A read
  replica that shows a stale thread breaks the feel of the whole feature.

### 9.2 Write amplification

The ingest path is the hot path. Targets: one transaction, ≤ 5 round trips, one queue-projection refresh per
inbound (`scale-inngest` D3), delivery statuses applied in batches (`APPLY_STATUS` jobs, Q4), and change-feed
rows suppressed for no-op updates through trigger `WHEN` clauses.

### 9.3 Partitioning and retention (required)

- Range-partition `conversation_messages` by month on `created_at`, with the `(conversation_id,
  sequence_number)` and idempotency indexes defined per partition. Plan the unique-constraint change
  (`(agency_id, external_message_id)` must include the partition key or be enforced another way) as its own
  migration with a rehearsal; this is the riskiest schema change in the document.
- Retention jobs by `DROP PARTITION`, not `DELETE`, for raw webhook events and finished jobs
  (`inbox_change_feed` 48 h; `channel_jobs` DONE 7–30 days; raw events per the agency retention policy).
- Per-table autovacuum tuning for `channel_jobs`, `conversations` and `inbox_change_feed`.

---

## 10. Failure modes

| Failure | Behaviour |
|---|---|
| Hub object restarts or evicted | Sockets reconnect; clients `/sync` from cursor. No data loss. |
| Publish lost (hub unreachable) | Change feed holds it; next event, reconnect or 30 s safety pull catches up. |
| Cloudflare edge or Workers outage | App on Vercel still works. The client falls back to polling `/sync` against the origin route; webhooks fall to Meta's retry. Keep the origin route deployable as the break-glass path. |
| Postgres slow or down | webhook-edge writes to the ingest buffer queue and acks; reads served from local store with banner; no 5xx storm to Meta. |
| Duplicate provider delivery | Idempotent RPC returns canonical ids. |
| Worker dies after claim | Stale-lock release (existing) re-queues; runner serialisation plus idempotency prevent a double send. |
| Agency floods | Per-agency caps and fair-share claim isolate it; the hub shards if it is the hot object. |
| Client offline for days | Cursor beyond retention → snapshot resync; outbox drains first, in order. |
| Token expired mid-session | Hub closes with a typed code; client refreshes and reconnects without UI change. |

---

## 11. Observability

Extend `scaling.md` §11 with:

- Edge: ack p50/p95/p99, signature rejects, buffer depth and age, circuit-breaker state.
- Hub: sockets per agency, publish rate, delivered events/s, resume-from-ring-buffer ratio, token rejects.
- Sync: `/sync` p95, batch size, `resync` rate, calls per inbound message per client.
- Client (RUM, no content): event-to-visible latency by connection class, outbox age at drain, transport in
  use, offline duration, reconcile failures.
- Runtime: dispatcher claim rate, runner queue length, per-agency in-flight, AI timeout rate.

Alerts page on correctness (cross-tenant, duplicate send, message without job) and on age (REALTIME queue
age, outbox drain age), not on raw volume.

---

## 12. SLOs and proof

| SLO | Target |
|---|---|
| Webhook ack | p95 < 300 ms |
| Inbound visible, good network | p95 < 1.5 s |
| Inbound visible after reconnect (3G profile) | p95 < 3 s |
| Optimistic send appears | < 100 ms, always |
| Queued offline send delivered after reconnect | p95 < 5 s |
| REALTIME triage | p95 < 5 s |
| Zero cross-tenant event, row or cursor | exactly 0 |
| Duplicate provider-visible send | exactly 0 |

Proof (extend `scripts/load/inbox-multitenant.ts`, dry-run default, disposable staging only):

1. **Sustained** 10K inbound/min + status traffic for 60 min across ≥ 100 agencies.
2. **Burst** 50K/min for 5 min, then recovery time.
3. **Noisy tenant**: one agency at 50% of traffic; others' p95 within +20%.
4. **Sockets**: 3,000 authenticated connections, event amplification counted per inbound.
5. **Network chaos**: packet loss 10–30%, 2–10 s stalls, airplane-mode cycles, Wi-Fi ↔ mobile switches;
   assert convergence and exactly-once message display.
6. **Outbox**: kill the tab and network mid-send; assert one canonical message.
7. **DB outage 5 min**: buffer fills, drains, no loss, no duplicate.
8. **Token revocation and agency-isolation attack suite.**

Keep each optimisation a separate experiment with before/after numbers (`scaling.md` §12.3).

---

## 13. Delivery slices

One slice, one PR. Order is by user value and vendor-neutrality, so the first two work on today's
infrastructure.

| Slice | Content | Depends on | Exit |
|---|---|---|---|
| **CF0** | Cloudflare proxy, WAF, rate limits, Turnstile, HTTP/3. Baseline run at current load. | — | Baseline recorded; webhooks reachable only through the proxy |
| **CF1** | `inbox_change_feed` + `/sync` + cursor protocol. **Push still Supabase Broadcast.** | CF0 | A client killed for 10 min resumes with one call, no refresh |
| **CF2** | Offline-first client: IndexedDB, durable outbox, service worker, status line, SSE/long-poll fallback | CF1 | Airplane-mode send test passes; chaos profile converges |
| **CF3** | `AgencyHub` DO + token minting; dual publish with Broadcast, per-agency flag | CF1, CF2 | Hub parity on two-agency suite; Broadcast removed after canary |
| **CF4** | `webhook-edge` Worker + Hyperdrive + restricted role + ingest buffer queue | CF0 | Ack p95 < 300 ms; DB-outage test passes |
| **CF5** | Worker runtime: lane dispatcher + ConversationRunner; optional outbox drain move | CF4 | Sustained + burst meet queue SLOs with 30% headroom |
| **CF6** | Partitioning, retention, autovacuum, capacity sizing; full proof (§12) | CF1–CF5 | Every §12 SLO passes; MI6.5 closed |
| **CF7** | Web Push for closed tabs | CF3 | Optional |

Rollback: every Cloudflare component has an origin fallback (§10). Never delete queued jobs, outbox rows or
canonical messages as rollback.

---

## 14. Decisions and open questions

### 14.1 Proposed decisions (R11)

1. Push is best-effort over a Cloudflare Durable Object hub; the guarantee is the Postgres change feed and
   cursor pull.
2. The client is offline-first: local store and durable outbox, with versioned state changes never queued
   silently.
3. Cloudflare Queues is used only as an idempotent ingest buffer; `channel_jobs` remains the job queue.
4. Per-message work runs in Workers with one Durable Object per conversation; Postgres stays the system of
   record.
5. No component outside Vercel holds the service-role key.
6. Monthly partitioning and drop-partition retention are mandatory at this load.

### 14.2 Rejected for this scope

| Alternative | Why |
|---|---|
| Cloudflare Queues for jobs | No per-agency fairness, priority or coalescing, and it breaks same-transaction enqueue |
| D1 / KV for message or queue state | Second source of truth; splits tenant isolation away from RLS |
| Cloudflare Workflows | Duplicates R9 (Postgres sweep plus `pg_cron`) |
| Vectorize / Workers AI for knowledge | Moves tenant-scoped retrieval away from pgvector and RLS |
| Hydrated push over the socket now | Puts content through the hub; only if 3G telemetry demands it |
| Read replicas for threads | Replica lag breaks read-your-writes; measure first |

### 14.3 Open questions (need an owner's answer)

1. Is 10K/min **platform-wide** or could **one agency** reach it? A single hot agency changes the hub
   sharding and the per-agency queue cap.
2. Is the product web-only, or is a native/PWA mobile app planned? Push and background sync depth differ.
3. Are customers' message bodies allowed to transit Cloudflare under your data-protection commitments?
4. Is the shared repository logic extractable into a package, or does `/sync` call a thin Next.js route?
5. Can the database plan and compute be raised for the proof run?
6. Which Cloudflare limits are binding for you **(verify)**: Durable Object message throughput, Hyperdrive
   connection caps, Queue throughput, Worker subrequest and duration limits?
