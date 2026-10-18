# Plan: cut Vercel Fluid Active CPU by moving background work to Supabase, the Node worker and Cloudflare

Status: **proposed. No code, SQL or configuration has been changed.** · Written: 2026-10-18 · Owner: Platform
Related: [`cloudflare-hybrid-architecture.md`](cloudflare-hybrid-architecture.md) (the wider vision; this plan is its first, smallest slice),
[`../runbooks/supabase-scheduling.md`](../runbooks/supabase-scheduling.md), [`../runbooks/inbox-worker.md`](../runbooks/inbox-worker.md),
[`../progress/2026-10-17-gate-first-run-staging.md`](../progress/2026-10-17-gate-first-run-staging.md) (the pause).

Per [`AGENTS.md`](../../AGENTS.md), the architecture is changed first. This document is that step. Slices are built only after it is approved.

> **Prices and limits are from memory and marked (verify).** Check each against the current Vercel, Cloudflare and Supabase pricing pages.

---

## 1. Why

On 17 Oct 2026 the Vercel team `ManasikOS` (Hobby) was paused for exceeding **Fluid Active CPU** (4h 20m used of 4h). Every other meter was far
below its limit: invocations 309K of 1M, CDN requests 193K of 1M, storage 1.8 GB of 10 GB, transfer 0.8 GB of 100 GB.

So the problem is **CPU per invocation**, not request count. Active CPU counts only time the CPU is executing, not time spent waiting on
Supabase or an AI provider. The goal is therefore to remove work that burns CPU on Vercel, not just to lower request counts.

Hobby is also non-commercial only. Moving to Pro is likely for licence reasons whatever this plan achieves, so the measurable goal is
**low usage on any plan**, which keeps Pro cheap and leaves headroom.

## 2. What the code shows (inventory)

Verified by reading the code; **not yet measured** (Hobby keeps 1 hour of runtime logs, so there is no history to query). Section 6 is the
measurement step that confirms or corrects this ranking before big work starts.

| # | Source of Vercel CPU | Evidence | Expected weight |
|---|---|---|---|
| S1 | **15 `pg_cron` jobs call Vercel routes on a timer.** Two run every minute (`inbox-lanes`, `agent-jobs`), two every 2 min (`inbox-sla`, `inbox-email-poll`), three every 5-10 min. About 3,900 calls a day, about 7,800 if staging and production both run them. Most find no work, yet each boots a function and loads the app's imports | `supabase/migrations/*cron*`, `runbooks/supabase-scheduling.md` | High |
| S2 | **Email polling inside a function.** `inbox-email-poll` opens an IMAP session per agency and parses mail with `mailparser` | `app/api/cron/inbox-email-poll/route.ts` | High |
| S3 | **AI turns run in webhook functions** through `after(() => processDueJobs({budgetMs: 25_000}))` and the realtime-lane drain, on every inbound message | `lib/whatsapp/webhook-handler.ts:230-238` | High at message volume |
| S4 | **Every navigation runs `proxy.ts` and the `(main)` layout** (`getClaims`, `getCurrentStaffRole`, `touchSessionActivity`). The sidebar has about 19 `<Link>`s and no `prefetch={false}` was found; with `force-dynamic` pages, viewport prefetch can multiply layout renders | `proxy.ts`, `app/(main)/layout.tsx`, `components/app-sidebar.tsx` | Medium (unmeasured) |
| S5 | **No data caching.** About 45 pages are `force-dynamic`; no `unstable_cache`, `use cache` or `revalidate` in `app/` or `lib/` | grep | Medium |
| S6 | **CPU-heavy libraries in request paths:** `@react-pdf/renderer`, `pdf-parse`, `recharts` SSR, large table renders | `package.json`, `next.config.ts` | Medium |
| S7 | **Sentry:** `tunnelRoute: "/monitoring"` sends every browser event through a function; trace sample rate comes from an env var | `next.config.ts`, `sentry.*.config.ts` | Low to medium |
| S8 | **`next/image` on signed Supabase URLs.** Each signed URL is unique, so the image cache misses (counts against image optimisation, not CPU) | `next.config.ts` `images` | Low |

Already in place and reused by this plan: the always-on Node worker (`worker/index.ts`, `lib/inbox/worker/`) that drains `channel_jobs`, the
outbox, `agent_jobs`, delivery status and raw events; the `INBOX_WORKER_ACTIVE=1` switch that stops webhooks draining after they respond;
idempotent, lease-based jobs, so overlapping runs are harmless.

## 3. Goals, non-goals, measures

**Goals**
- G1. Idle background ticks cost near-zero Vercel CPU.
- G2. No AI turn, IMAP session or PDF parse runs inside a Vercel function.
- G3. A normal page navigation renders once, not once plus prefetches.
- G4. Repeated reads of slow-changing data do not re-query on every visit.

**Non-goals**
- No feature or behaviour change for staff or customers. No change to the per-message path (Postgres queue, lanes, outbox, send gate).
- No move of the Next.js app off Vercel in this plan (revisit in §9).
- No new source of truth: Postgres stays the only one.

**Measures** (recorded before and after each phase in `docs/progress/`)
- Vercel Usage: Fluid Active CPU by route, invocations by route.
- Count of Vercel function invocations per day from `/api/cron/*` (target: under 5% of today's).
- p95 time for the oldest queued REALTIME job (`inbox_lane_health`); must not get worse.
- Cron success rate in `cron_route_calls`.

## 4. Target architecture

```
                         ┌────────────── Cloudflare ──────────────┐
 Meta webhooks ─────────►│ hooks.<domain> Worker: verify signature │──► Supabase (raw event + job row, return 200)
                         │ Cron Trigger Worker (every minute):     │
                         │   "any due work?" one cheap RPC         │──► wake Node worker / call Vercel route only if yes
                         └─────────────────────────────────────────┘
 Browser ─────────► Vercel: Next.js UI + server actions only (cached reads, no background work)
 Node worker (Fly / Railway / VPS / Cloudflare Containers): AI turns, IMAP, outbox, agent jobs, delivery status, reconciler, PDF/ticket parsing
 Supabase: Postgres (source of truth), pg_cron for SQL-only sweeps, Vault, Storage (R2 later for media)
```

Principles (same spirit as the Cloudflare hybrid doc):
1. **Postgres owns state.** Cloudflare and the worker hold no business state.
2. **One scheduler per job, at every step.** Cutover is always *new on, then old off*. A short overlap is safe because jobs are idempotent.
3. **Every new piece degrades to the old path.** If the Worker or Node worker is down, the `pg_cron` → Vercel route still works, only slower.
4. **Gate, don't poll.** A tick that has nothing to do must cost a single query, not a function boot.

## 5. Decisions needed (record the answer here before building)

| ID | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Where the Node worker runs | Fly.io / Railway / small VPS in Singapore / Cloudflare Containers | A small always-on host in Singapore, two instances (the runbook requires near-database and two replicas). Containers only if it proves simpler |
| D2 | Who fires the timers | Keep `pg_cron` → Vercel / `pg_cron` → worker HTTP / Cloudflare Cron Triggers with a gate | Cloudflare Cron Triggers with a gate for HTTP-style jobs; `pg_cron` direct SQL for DB-only sweeps |
| D3 | Staging schedule | Same as production / on demand / every 15 min | On demand or 15 min; staging does not need a 1-minute loop |
| D4 | Vercel plan | Stay on Hobby / Pro | Pro, for the licence reason, once usage is measured |
| D5 | Domain layout | Whole site behind Cloudflare / DNS-only app + proxied `hooks.` and `api.` | DNS-only for the app domain (Vercel advises against a second CDN in front), proxied subdomains for webhooks |
| D6 | Webhook host | Stay on Vercel / Cloudflare Worker | Stay on Vercel until phase 2 is stable, then move |

## 6. Phases

Each slice is one PR, reversible, with its own verification and rollback.

### Phase 0: Stop the bleeding and measure (days)

| Slice | Change | Verify | Rollback |
|---|---|---|---|
| 0.1 | Wait for the pause to end (16 Nov) or upgrade; **meanwhile pause staging crons** with `cron.alter_job(..., active := false)` | `cron.job` shows inactive; no calls in `cron_route_calls` | Re-enable the jobs |
| 0.2 | Set `SENTRY_TRACES_SAMPLE_RATE` and `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` to 0 or 0.01 in Vercel | Env diff; Sentry shows fewer transactions | Restore the old values |
| 0.3 | Add `prefetch={false}` on the sidebar and header links | Network tab on a fresh load: no RSC prefetch bursts; navigation still feels instant (the existing `loading.tsx` covers it) | Revert the prop |
| 0.4 | **Baseline.** Record Vercel Usage by route for 7 days once the team is unpaused; turn on `PERF_TIMING=1` (already in `lib/timing.ts`) on staging for a day. Write results to `docs/progress/` | A progress note with a top-10 routes by CPU table | n/a |

Exit: a measured top-10, which may reorder phases 1 to 4.

### Phase 1: Deploy the Node worker and stop in-request draining (S2, S3)

| Slice | Change | Verify | Rollback |
|---|---|---|---|
| 1.1 | Build and run the worker image once (`docker build -f worker/Dockerfile`, `worker:check`); the Dockerfile has never run on a daemon | `worker:check` exits 0 inside the image | n/a |
| 1.2 | Deploy two instances in Singapore per `runbooks/inbox-worker.md` §3-4 | `/healthz` ok; `lane_summary` shows `claimed` and `processed` rising; oldest REALTIME job is seconds old | Scale to zero; the minute drains take over |
| 1.3 | Set `INBOX_WORKER_ACTIVE=1` on Vercel | Webhook functions return immediately; no `after()` drain logs; reply latency unchanged | Unset the variable, redeploy |
| 1.4 | Move the **email poll** into the worker (a timer calling `pollAgencyMailbox`; consider IMAP IDLE later). Pause the `inbox-email-poll` cron | Mail still arrives within 2 min; no `/api/cron/inbox-email-poll` calls | Un-pause the cron, stop the worker timer |

### Phase 2: Gate the timers on Cloudflare (S1)

| Slice | Change | Verify | Rollback |
|---|---|---|---|
| 2.1 | Supabase RPC `cron_due_work()` (service role only, `security definer`, `search_path = ''`) returning counts: due `channel_jobs`, `agent_jobs`, SLA breaches, follow-ups, reply-window candidates | Unit and SQL tests; returns zero on an empty queue | Drop the function |
| 2.2 | `cloudflare/gate/` Worker with `wrangler.jsonc` in the repo: every minute calls the RPC and invokes the matching Vercel route **only if the count is above zero**. Secrets in Cloudflare, not the repo | In staging: idle minute makes no Vercel call; adding a queued job triggers one within a minute | Disable the Cron Trigger |
| 2.3 | Per job, in order `agent-jobs`, `inbox-lanes`, `inbox-sla`, `lead-followups`, `reply-window-sweep`: **pause the `pg_cron` entry as the Cloudflare trigger goes live** (never both) | `cron_route_calls` shows one caller per job; Vercel invocation count for `/api/cron/*` drops | Re-enable the `pg_cron` job, disable the trigger |
| 2.4 | Convert SQL-only sweeps (`inbox-retention`, `release-seat-holds`, `ai-usage-rollup`) to direct `pg_cron` SQL where the handler is only queries | Same rows changed as before | Revert to `invoke_cron_route` |

The allow-list in `invoke_cron_route` stays; the Worker adds its own bearer-secret check (`CRON_SECRET`) and no new public route.

### Phase 3: Cache reads and trim the request path (S4, S5)

| Slice | Change | Verify | Rollback |
|---|---|---|---|
| 3.1 | Cache `getCurrentStaffRole` inputs per user for about 60 s (`unstable_cache` keyed by user id, tagged), invalidated where roles change | Query count per navigation falls; a role change shows within the TTL | Remove the wrapper |
| 3.2 | Tagged per-tenant caching for slow-changing reads (settings, branches, branding, supplier and package lists) with `revalidateTag` in the existing server actions. **Cache data, never rendered HTML**, because RLS and role-based views make shared output unsafe | Cross-tenant test: agency A never sees agency B's cached data; edit then read shows new data | Remove the cache call |
| 3.3 | Dashboard aggregates: cache 30-60 s, or precompute with a `pg_cron` refreshed table | Dashboard CPU and query count drop; numbers match the live query within the TTL | Revert to live reads |
| 3.4 | Skip `proxy.ts` work for prefetch and for routes that need no session (extend `MACHINE_ROUTES` check ordering) | `proxy.getClaims` timing logs fall | Revert |

### Phase 4: Heavy work off Vercel (S6, S7, S8)

| Slice | Change | Verify | Rollback |
|---|---|---|---|
| 4.1 | Generate PDFs once, store in Supabase Storage, serve the stored file; regenerate only when inputs change | Second view does no render CPU | Re-enable on-demand render |
| 4.2 | Ticket PDF parsing and AI review become a `channel_jobs` job handled by the worker | The upload action returns at once; result appears when the job completes | Restore inline path |
| 4.3 | Remove `tunnelRoute: "/monitoring"` and send browser Sentry events directly (some ad-blocked loss is accepted) | `/monitoring` traffic is zero; events still arrive | Re-add the tunnel |
| 4.4 | `unoptimized` on `next/image` for signed Supabase URLs | Image-optimisation usage falls | Remove the prop |

### Phase 5: Optional edge (only if phases 0-4 are not enough)

Move webhooks to a Cloudflare Worker on `hooks.<domain>` (verify signature, insert the raw event, return 200), and media and generated PDFs
to R2 with short-lived signed URLs. This follows `cloudflare-hybrid-architecture.md` §3 and `inbox/architecture-10k-edge-realtime.md`.
Moving the Next.js app itself to Workers (OpenNext) is a separate project: this app uses `@react-pdf/renderer`, `pdf-parse`, the Sentry Node
integration and a Vercel-tuned CSP, so it needs its own plan.

## 7. Risks

| Risk | Mitigation |
|---|---|
| A job runs twice (two schedulers) | One-scheduler rule; every cutover is *new on, then old off*; jobs are already idempotent and lease-based |
| The worker is down and replies are late | `pg_cron` safety-net drains stay until the worker has soaked a week; scale-to-zero is a valid rollback |
| A cached value leaks across tenants | Key every cache entry by agency id; add a cross-tenant test per cached read; never cache rendered HTML |
| A stale role grants or hides access | Short TTL plus tag invalidation on role change; authorisation in server actions still uses `requireUser()` and RLS, never the cache |
| Cloudflare Worker holds secrets | Give it only the webhook and cron secrets it uses, as the Node worker runbook does; no Supabase service-role key unless the RPC needs it |
| Optimising the wrong thing | Phase 0.4 measures first and may reorder the phases |
| Extra vendors to run | Each piece falls back to the old path; budget alerts on Cloudflare and the worker host (principle P6 of the hybrid doc) |

## 8. Documentation to change when this is approved

| Doc | Change |
|---|---|
| `docs/architecture/README.md` | Link this plan; add Cloudflare and the Node worker to the stack list once built |
| `docs/runbooks/supabase-scheduling.md` | Mark each job's trigger (`pg_cron`, Cloudflare gate, worker) in the jobs table; keep "one scheduler per job" |
| `docs/runbooks/inbox-worker.md` | Update "not deployed anywhere yet" once phase 1 lands; record host and instance count |
| New `docs/runbooks/cloudflare-gate.md` | Setup, secrets, deploy, pause, roll back |
| `docs/progress/` | One dated note per phase with before/after measures |
| `.env.example` | New variables (`INBOX_WORKER_ACTIVE`, Cloudflare gate secret names, no values) |

## 9. Open questions

1. Is production live yet, or only staging? It sets how urgent phase 1 is.
2. Which host for the worker (D1), and is a second instance affordable?
3. Is moving to Vercel Pro already decided (D4)?
4. Does the team accept losing some browser Sentry events to ad-blockers (slice 4.3)?
5. After phase 4, should the Next.js app itself move off Vercel, or is Pro cheap enough?
