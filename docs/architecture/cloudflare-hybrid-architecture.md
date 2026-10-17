# Cloudflare hybrid architecture: a CRM that one part-time person can run

Status: **proposed. No code, SQL or configuration has been changed.**
Scope: the whole platform. The Inbox-specific design in
[`docs/inbox/architecture-10k-edge-realtime.md`](../inbox/architecture-10k-edge-realtime.md) is the detailed plan
for the real-time and ingest parts and this document agrees with it. Where they overlap, that document wins.

> **Prices and limits are from memory and marked (verify).** Check every figure against current Cloudflare,
> Supabase and Vercel pricing pages before relying on it. Products in the 2026 catalogue I cannot describe with
> confidence (K2, Basin, Artifacts) are marked *evaluate* and nothing depends on them.

---

## 1. Correcting the brief

Three things in the brief need correcting before any design work.

1. **Inngest is already gone.** Decision R9 removed it and `lib/inbox/no-inngest.test.ts` keeps it out.
   Background work runs through `pg_cron`, the Postgres sweep, `channel_jobs` and the always-on Node worker
   (`worker/index.ts`). The real stack today is **Next.js on Vercel (sin1) + Supabase + OpenRouter + one Node
   worker container**.
2. **"Millions of requests per minute against the shared DB without errors" is the wrong target.** 1M req/min
   is about 17K req/s. A single Postgres with RLS can't serve that cheaply, and it doesn't need to. The goal is
   **millions of requests per minute at the edge, with Postgres seeing only 2–5% of them** (§4).
3. **Aim for no user-visible errors, not zero errors.** At any scale some requests fail: networks drop,
   providers time out, nodes restart. What we can guarantee is **no lost data, no duplicate sends, no cross-tenant
   leak, and every failure retried or shown honestly**. Those guarantees come from idempotency, durable queues and
   resumable sync, not from hoping nothing fails.

And a sense of scale. 200 agencies with 5 staff each is 1,000 users, roughly **20–60K requests/min** on a busy
day. Millions per minute means tens of thousands of concurrent users. So the plan is to **build for 10× today,
leave the seams for 100×, and build nothing for 1000× yet** (§7).

---

## 2. Principles for a one-person, part-time operation

| # | Principle | What it means in practice |
|---|---|---|
| P1 | **Postgres is the only source of truth** | Cloudflare holds connections, caches, blobs and ephemeral state. It never holds business state that exists nowhere else. |
| P2 | **Every edge component degrades to the origin** | If Cloudflare Workers break, the app on Vercel still works (slower). No single new vendor can take the business down. |
| P3 | **Usage-priced, scale-to-zero only** | No servers to patch, no instance sizes to tune, except the Supabase compute tier (one dial). |
| P4 | **Everything is code** | `wrangler.jsonc`, migrations, Vercel config and alert rules live in the repo. Nothing is configured only in a dashboard. |
| P5 | **Few alerts, all actionable** | Page on correctness (cross-tenant, duplicate send, data loss) and on queue age. Never page on raw volume. |
| P6 | **Spend caps on every metered service** | Budget alerts on Cloudflare, a Supabase spend cap, per-key OpenRouter credit limits, and AI Gateway rate limits. A bug costs a warning email, not a surprise bill. |
| P7 | **Push is best-effort; pull is the guarantee** | Same rule as the Inbox design. Real-time is an optimisation layered over a resumable cursor feed. |

---

## 3. Every product in the catalogue, judged against this CRM

Verdicts: **Use now** (stage 1, cheap and high value) · **Stage 2** (when a trigger in §7 fires) ·
**Evaluate** (promising, unverified) · **Skip** (wrong problem, enterprise-priced, or conflicts with a decision).

### 3.1 Compute

| Product | Verdict | Job in this CRM | Reason |
|---|---|---|---|
| **Workers** | **Use now** | Edge gateway: webhooks (`hooks.`), `/sync` and API reads (`api.`), media signer, public lead-form API, tenant routing | CPU-time billing, so time spent waiting on the DB or AI is free. $5/mo plan includes 10M requests (verify). The base for everything else. |
| **Durable Objects** | **Use now** | `AgencyHub` (sockets, presence, typing, fan-out), `ConversationRunner` (serial AI turns), per-tenant rate buckets, **write coalescing** (§4.3) | The one product that changes the DB math. A single-threaded object per tenant or conversation gives ordering and fan-out for free. Hibernating WebSockets cost nothing while idle. |
| **Containers** | **Stage 2 (optional)** | Host the existing Node worker (`worker/Dockerfile`): IMAP (`imapflow`), `mailparser`, `pdf-parse`, media processing | Runs the current code unchanged. Use it if you want one fewer vendor. Not urgent if the worker's current host is fine. |
| **Workflows** | **Skip** | n/a | Conflicts with R9 (Postgres sweep + `pg_cron`). Revisit only for long, human-in-the-loop flows such as multi-day departure operations. |
| **Browser Run** | **Skip (later maybe)** | Link previews; HTML→PDF if `@react-pdf` becomes limiting | Not needed today. Do not scrape supplier portals without permission. |
| **Sandboxes** | **Skip** | n/a | The CRM never runs untrusted code. |
| **Workers for Platforms** | **Skip** | n/a | Only useful if agencies upload their own scripts. |

### 3.2 Storage

| Product | Verdict | Job | Reason |
|---|---|---|---|
| **R2** | **Use now** | WhatsApp/IG media, voice notes, documents, quote and invoice PDFs, exports, **nightly off-site `pg_dump`** | Zero egress. Media egress is the bill that grows fastest in a messaging CRM. Private bucket with short signed URLs through a Worker. Passport scans encrypted and never public. |
| **Hyperdrive** | **Use now** | Every Worker→Supabase connection | Pools connections near the DB so thousands of Worker invocations don't each open a Postgres connection. Turn **query caching off** for any RLS or tenant-session path. |
| **KV** | **Use now** | Tenant routing map (`agency → cell`), `channel connection → agency` for webhooks, agency settings, feature flags, public package catalogue snapshot | Read-mostly config at the edge. **Up to ~60 s stale (verify)**, so never use it for auth revocation, balances or anything that must be current. |
| **Queues** | **Use now, narrowly** | (a) ingest buffer when Postgres is unavailable (per the Inbox design), (b) fire-and-forget side effects: analytics events, notification emails | **Not** the job queue. `channel_jobs` keeps fairness, priority and same-transaction enqueue. |
| **Basin** | **Evaluate** | Cold archive and analytics of messages older than N months, audit log, usage events, stored in R2 and queryable with SQL | Keeps Postgres small (which keeps it fast and cheap) without deleting history. Verify product details first. |
| **K2** | **Evaluate** | Possible transport for the change feed | Durable ordered streams match P7's change feed, but the feed must still be written in the same Postgres transaction. Don't adopt a new product as a source of truth. |
| **D1** | **Skip** | n/a | A second SQL database splits tenant isolation away from RLS. One source of truth (P1). |
| **Artifacts** | **Skip** | n/a | Git-native storage doesn't match any CRM need. |

### 3.3 AI

| Product | Verdict | Job | Reason |
|---|---|---|---|
| **AI Gateway** | **Use now** (highest value per hour of work) | Sits in front of OpenRouter: request logs, retries and fallback, response cache for repeated prompts, rate limits, **per-agency cost attribution** through metadata headers | One base-URL change in `lib/ai/*`. Turn **prompt/response logging off** or set short retention, because prompts contain customer PII. |
| **Agents (SDK)** | **Stage 2** | Implement `ConversationRunner` as an Agent: one stateful object per conversation that runs the WhatsApp assistant turn by turn | It's a Durable Object with AI ergonomics. Adopt it when the AI worker moves off the Node container. |
| **Workers AI** | **Evaluate** | Speech-to-text for `TRANSCRIBE_VOICE`, small spam/intent classifiers | Could cut OpenRouter spend on high-volume, low-difficulty tasks. Only adopt with an eval set showing quality parity. Changing the embedding model would mean re-indexing pgvector, so leave embeddings alone. |
| **Vectorize** | **Skip** | n/a | Knowledge retrieval stays in pgvector under RLS. Already rejected in the Inbox design. |
| **AI Search** | **Skip** | n/a | Same reason: tenant-scoped retrieval stays in Postgres. |

### 3.4 SASE / Zero Trust

| Product | Verdict | Job | Reason |
|---|---|---|---|
| **Access** | **Use now** | Put staging, Vercel preview URLs, internal operator/admin consoles and worker health endpoints behind SSO | Free up to 50 users (verify). Removes a whole class of "someone found our staging" incidents. |
| SASE platform, Gateway, CASB, DLP, Browser Isolation, WAN | **Skip** | n/a | These secure an organisation's own employees and networks, not a SaaS product. |
| Email Security | **Skip** | n/a | Enterprise-priced. Rely on your mail provider's protection. |

*Related, not in the image:* **Email Routing + Email Workers** (free) can receive inbound mail as a push event
for agencies that forward to a platform address. That would replace IMAP polling for those agencies. Agencies
connecting their own mailbox still need IMAP.

### 3.5 Security

| Product | Verdict | Job | Reason |
|---|---|---|---|
| **DDoS Protection** | **Use now** | Automatic on every proxied hostname | Free and unmetered. |
| **SSL** | **Use now** | Universal certificates; **Cloudflare for SaaS** later for agencies' custom domains (white-label portals) | Free; custom hostnames are per-hostname priced (verify). |
| **WAF** | **Use now** | Managed rules on `api.`, `hooks.`, `rt.`, `media.` | The Free plan's managed ruleset is enough to start. The Pro plan (~$25/mo, verify) adds the full managed rules and Super Bot Fight Mode. |
| **Rate Limiting** | **Use now** | WAF rules on webhooks, login and auth; **Workers Rate Limiting binding** for per-agency API limits | Two layers: per-IP abuse at the WAF, per-tenant fairness in code. |
| **Turnstile** | **Use now** | Login, signup, invite acceptance, public lead and enquiry forms | Free, invisible to users, and stops form spam that would otherwise become fake leads. |
| **Client-Side Security** | **Stage 2** | Script-change monitoring on payment and booking pages | Matters once card or payment flows run in-app. |
| **Bot Management** | **Skip** | n/a | Enterprise only. Turnstile plus Super Bot Fight Mode covers the need. |
| **Magic Transit** | **Skip** | n/a | Protects whole IP networks. Not our problem. |

### 3.6 Network and content delivery

| Product | Verdict | Job | Reason |
|---|---|---|---|
| **DNS** | **Use now** | Authoritative DNS for the product domain | Free, fast, and needed for everything above. |
| **CDN** | **Use now** | R2 media, public package and itinerary pages (cache with tag purge), Worker hostnames | **Do not** put the CDN in front of the Vercel app (§5.1). |
| **Analytics** | **Use now** | Web Analytics (free, no cookies), Workers Observability; **Workers Analytics Engine** for per-agency usage metering | Metering is what lets you price plans and spot a noisy tenant. |
| **Load Balancing** | **Stage 3** | Health-checked failover between origins; routing between cells | ~$5/mo (verify), but only useful once there's a second origin. |
| **TURN / SFU** | **Skip** | n/a | Only if in-browser voice/video calls with customers become a feature. |

**Net result: about 17 products used, 6 evaluated or deferred, about 20 skipped.** The skipped ones aren't bad
products. They solve problems this business doesn't have.

---

## 4. How the shared database survives millions of requests per minute

### 4.1 Request budget

Take a future peak of **2M requests/min (~33K/s)** across the platform and follow where each request ends up.

| Request class | Share | Served by | Reaches Postgres? |
|---|---:|---|---|
| Static assets, JS, images, media | ~55% | Vercel CDN / Cloudflare CDN + R2 | No |
| Real-time socket traffic (heartbeats, presence, typing, event fan-out) | ~25% | `AgencyHub` DO | No |
| Config, routing, flags, public catalogue | ~5% | KV / edge cache | No |
| Authenticated reads (lists, threads, dashboards) | ~12% | `/sync` Worker → Hyperdrive, or Server Components | Yes, ~4K/s worst case, fewer with projections |
| Writes (messages, status events, edits) | ~3% | Webhook Worker / Server Actions → RPC | Yes, ~1K/s, **batched down to ~200–400 tx/s** |

**Postgres sees ~3–5K simple statements per second at this peak.** That's well within a single Supabase XL–2XL
instance with correct indexes (verify the tier at load-test time). The edge absorbs the other 95%.

### 4.2 Reads: make them cheap, then make them rare

1. **Projections, not joins.** The conversation list reads one pre-computed projection row per conversation
   (already the direction in `scaling.md`). Dashboards read rollup tables refreshed by `pg_cron`, never live
   aggregates.
2. **Fast RLS.** Put `agency_id` first in every composite index. Wrap `auth.uid()` and claims in `(select …)`
   so they're evaluated once per query, not once per row. Hot paths use `security definer` RPCs that take an
   explicit agency id and check it against the caller, so the RLS expression isn't re-planned per row.
3. **Pull by cursor, not by refresh.** `/sync` returns only what changed since the client's cursor, in one round
   trip. A reconnect costs one query batch, not a page reload of eight queries.
4. **Read replicas only for stale-tolerant reads** (reports, analytics, exports). Never for threads, where
   replica lag breaks read-your-writes.
5. **Keep the hot tables small.** Monthly partitions on `conversation_messages` and job tables, drop-partition
   retention, and old history archived to R2/Basin.

### 4.3 Writes: coalesce at the edge, commit once

Write volume in a messaging CRM is dominated by noise: delivery and read receipts (~75% of webhook traffic),
typing indicators, "last seen", unread counters.

- **Ephemeral state never touches Postgres.** Typing, presence, viewing and composer locks live only in
  `AgencyHub` memory.
- **High-frequency, low-value updates are coalesced.** Status events for one conversation are buffered in its
  Durable Object and flushed as one `APPLY_STATUS` batch every 1–2 s. Unread counters are incremented in the DO
  and written back periodically. If a DO restarts, the counter is recomputed from Postgres, so it's
  self-healing.
- **The important write is one transaction.** An inbound message, its jobs and its change-feed row commit in
  the existing atomic ingest RPC. Idempotency is keyed on `(agency_id, external_message_id)` for inbound and
  `client_idempotency_key` for outbound, so any retry, from Meta, the Worker or the browser, is harmless.

### 4.4 When the database is unhappy

| Situation | Behaviour |
|---|---|
| Postgres slow (p95 above threshold) | Workers shed **low-priority** work first (enrichment, AI suggestions). Messages and human replies keep flowing. |
| Postgres unreachable | Webhooks go to the Queues ingest buffer and are acknowledged. Clients read from their local store and queue sends in the browser outbox. Everything drains in order when the DB returns. |
| Connection exhaustion | Hyperdrive pools Workers; Supavisor (transaction mode) pools the app. Per-role connection caps stop a Worker surge from starving the UI. |
| One agency floods | Per-agency token bucket at the edge, per-agency in-flight cap in `claim_channel_jobs`, and if it persists, move that agency to its own cell (§6). |

---

## 5. Target topology

```text
                                   Users (browser / PWA)
                  │ app.<domain>                       │ api. / rt. / media.<domain>
                  ▼  (DNS only, not proxied)           ▼  (proxied: WAF · DDoS · Turnstile · rate limits)
        ┌───────────────────────┐             ┌──────────────────────────────────────────────┐
        │ Vercel (sin1)         │             │ Cloudflare                                   │
        │ Next.js UI, Server    │  service    │  Worker: edge-gateway  (/sync, API, media)   │
        │ Components, Server    │◄──token────►│  DO: AgencyHub × agency  (sockets, fan-out)  │
        │ Actions, auth flows   │             │  DO: ConversationRunner × conversation (AI)  │
        └──────────┬────────────┘             │  KV: tenant map, config   R2: media, backups │
                   │ Supavisor                │  Queues: ingest buffer    AI Gateway ─► OpenRouter
                   │                          └───────────┬──────────────────────────────────┘
                   │                                      │ Hyperdrive
                   ▼                                      ▼
        ┌──────────────────────────────────────────────────────────────────────┐
        │ Supabase cell (Postgres + RLS + Auth + pg_cron)  single source of truth│
        └──────────────────────────────────────────────────────────────────────┘
                   ▲
   Meta / email ──►│ hooks.<domain> → Worker: webhook-edge (verify, dedupe, ingest RPC)
```

### 5.1 Why Vercel stays, and why the app isn't proxied through Cloudflare

- **Stay on Vercel for the Next.js app.** Preview deploys, zero-config Next 16 support and no adapter to maintain
  are worth more to a part-time operator than the saved fee. With Fluid compute you're billed for active CPU,
  so AI streaming isn't the cost it used to be.
- **Don't put Cloudflare in front of `app.`.** Vercel advises against reverse proxies in front of it: double
  CDN, broken cache semantics, wrong client IPs and conflicting firewalls. Use **separate hostnames** instead.
  Vercel serves the UI; Cloudflare serves the API, real-time, webhook and media hostnames. Each vendor does what
  it's best at, and neither proxies the other.
- **Revisit trigger:** if the Vercel bill passes about $300/mo, or OpenNext on Workers reaches proven Next 16
  parity, consider moving the app to Workers. The architecture doesn't change; only the host of the UI does.

### 5.2 Placement (latency)

Vercel is in `sin1`, so Supabase should be in the Singapore region too. Set Durable Object `locationHint`
to `apac`, use **Smart Placement** on Workers that mostly talk to the database, and keep Hyperdrive's origin
in the same region. A Worker running at the edge in Colombo still does its database work next to the database.

---

## 6. Multi-tenancy at scale: cells, designed now and built later

The one structural decision to make **now**, because it's cheap now and painful later:

- A **cell** is one Supabase project serving many agencies with the shared schema and RLS, exactly as today.
- **KV holds `agency_id → cell`.** Every Worker and the Next.js server resolve the cell from that map. Nothing
  hard-codes the Supabase URL. Today there is one cell and the map has one value.
- When a cell nears its ceiling, or one agency is large enough to deserve isolation, **new or heavy agencies go
  into a new cell**. Moving an agency is a scripted export/import plus a KV flip.
- Platform-level data (billing, agency directory, operator accounts) lives in the first cell, or a small
  "control" project, and is read through KV.

This gives horizontal scale, limits blast radius (one bad migration or noisy tenant affects one cell) and makes
data-residency deals possible later. Cross-cell queries are only needed for platform analytics, which go
through Basin/R2.

---

## 7. Scale stages, triggers and cost

Monthly infrastructure, **excluding AI token spend** (pass that through to agencies by plan). All prices are
(verify).

| Stage | Load | Cloudflare | Vercel | Supabase | Approx. total |
|---|---|---|---|---|---|
| **1 – now** | ≤ 300 agencies, ≤ 100K req/min | Workers Paid $5 + R2/KV/DO/Queues mostly within included usage ≈ **$5–20** (+$25 if you choose the Pro zone) | Pro ≈ $20 | Pro $25 + Medium compute ≈ $60 + PITR optional | **≈ $110–180** |
| **2** | ≤ 2K agencies, ≤ 500K req/min | ≈ $50–150 | ≈ $50–150 | Large/XL ≈ $110–210, PITR, one read replica for reports | **≈ $400–800** |
| **3** | millions req/min | ≈ $300–800 | ≈ $150–400 or moved to Workers | 2–4 cells at XL/2XL | **≈ $2–4K** |

**Move to the next stage only when a trigger fires**, never in advance:

- Postgres CPU above 60% sustained at peak, or p95 of a top-10 query above 50 ms → raise compute one tier.
- Connections above 70% of the cap → review Hyperdrive and Supavisor settings before raising the tier.
- Socket count, or Supabase Realtime cost, above the included quota → switch the Inbox to `AgencyHub` (CF3).
- One agency above 20% of total writes → give it its own cell.
- Compute at 2XL and still rising → open cell #2.

The money that matters: at stage 3 the platform has thousands of paying agencies, so infrastructure stays a
low single-digit percentage of revenue. The thing to protect is **your time**, which is why every stage uses
managed, usage-priced products.

---

## 8. Running it part-time

**Weekly (30 min):** open one dashboard (Sentry plus a Grafana or Cloudflare dashboard) and check:
error-budget burn, queue age per lane, DB CPU and top-5 slow queries (`pg_stat_statements`), spend vs budget
on every vendor, ingest buffer depth (should be 0).

**Monthly (1 h):** restore last night's `pg_dump` from R2 into a scratch project and run the smoke test. A
backup you've never restored isn't a backup. Rotate one secret. Apply dependency updates through CI.

**Alerts (no more than about 8, all pager-worthy):** cross-tenant violation, duplicate provider send, message
without job, REALTIME queue age > 60 s, outbox drain age > 2 min, ingest buffer age > 60 s, DB unreachable,
spend > 150% of forecast.

**Deploys:** GitHub Actions deploys Workers (`wrangler deploy`), migrations (`supabase db push`) and Vercel
from `main`, with preview environments behind Access. Rollback is the previous version: Workers versions,
Vercel instant rollback, and forward-only migrations with expand/contract.

**Runbooks:** reuse `docs/runbooks/` and add one per new component: hub, webhook-edge, ingest buffer and cell
move.

---

## 9. Rollout order

Each step is independently valuable and reversible. Steps 1–3 are about a weekend each and cost almost
nothing.

| Step | What | Value | Risk |
|---|---|---|---|
| 1 | Move DNS to Cloudflare (app hostname DNS-only). Turnstile on auth and forms. Access on staging and previews. Budget alerts. | Security baseline, no traffic change | Very low |
| 2 | **AI Gateway** in front of OpenRouter, with per-agency metadata and payload logging off | Cost visibility per tenant, retries, cache | Very low (one base URL) |
| 3 | **R2** for new media and documents; nightly `pg_dump` to R2 | Egress savings, independent backup | Low |
| 4 | KV tenant map + `edge-gateway` Worker + Hyperdrive with a restricted DB role | Seam for cells, edge reads | Low |
| 5 | Inbox CF1–CF2: change feed, `/sync`, offline-first client | Reconnect without refresh | Medium |
| 6 | Inbox CF3–CF4: `AgencyHub` DO, `webhook-edge`, ingest buffer | Real-time cost and control, DB-outage tolerance | Medium |
| 7 | Inbox CF5: `ConversationRunner` (Agents SDK), status coalescing | Serial AI turns, ~4× fewer status writes | Medium |
| 8 | Partitioning, retention, Basin archive; load-test proof (Inbox §12) | Proven headroom | Medium–high (unique constraint change) |
| 9 | Cell #2: only when a §7 trigger fires | Horizontal scale | Planned migration |

---

## 10. Decisions to take

1. **Real numbers.** How many agencies, staff and messages per day today, and the 12-month target? This sets
   the stage. Everything above stage 1 is a plan, not a purchase.
2. **Data processing.** Message bodies and media will transit and, for R2, rest on Cloudflare. Confirm this is
   acceptable under your privacy commitments and update the processor list.
3. **Domain.** Can the product domain's DNS move to Cloudflare?
4. **Cells.** Accept the "no hard-coded Supabase URL; resolve the cell from KV" rule now (step 4).
5. **Vercel stays** for the UI, with the §5.1 revisit trigger.
