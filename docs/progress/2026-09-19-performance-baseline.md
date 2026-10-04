# Performance baseline — 2026-09-19

Snapshot for [TASK-004](../tasks/TASK-004-performance-and-perceived-speed.md)
Phase 0. Historical record — do not edit to match later reality.

## What could and could not be measured

| Source | Result |
|---|---|
| Vercel runtime logs, production, last 7 days (`hajj-umrah-crm`) | 65 requests total, **all cron routes, all HTTP 200**. No user page traffic in production yet. |
| Vercel Analytics page views, last 7 days | No data. |
| Speed Insights (LCP/INP/TTFB) | Not readable through the tools available; read it in the Vercel dashboard. |
| Live page timings | **Not measured.** Needs a signed-in browser session; follow the [runbook](../runbooks/performance-baseline-runbook.md). |

Consequence: there is no real-user baseline to compare against. The first
measurement round taken with the runbook, after these changes deploy, becomes
the baseline. Every timing row below is therefore blank on purpose.

## Measured today: first-load JS (gzip, production build)

From two real `next build` runs (Phase 5), before and after the Settings dialog
was made lazy:

| Route | Before | After |
|---|---|---|
| /leads | 649 KB | 406 KB |
| /dashboard | 604 KB | 459 KB |
| /pilgrims | 587 KB | 340 KB |
| /departure-groups | 593 KB | 347 KB |
| /inbox | 573 KB | 307 KB |

## Measured today: database (`pg_stat_statements`, since last stats reset)

- The app's own PostgREST traffic is cheap: `set_config(...)` per request
  averages **0.08 ms** over 92,039 requests.
- Biggest total-time entries are not user-facing: Supabase dashboard
  introspection (`pg_timezone_names`, extension/function listings — hundreds of
  ms each, run by the dashboard) and the `invoke_cron_route` cron
  (16,946 calls, 10 ms mean).
- `touch_own_activity` RPC: **9,508 calls (~10% of all requests)**, 2 ms mean.
  The function is correct and the newest `last_active_at` is recent, so this is
  most likely history from before the 15-minute throttle and the Phase 2 change
  that stopped re-reading the profile. **Re-check after deploy:** the count
  should grow far slower than page views.
- Consequence: the database is not the bottleneck at this data size. Time goes
  to round trips and rendering, which is why the timing labels below target the
  server-side request path.

## Timing baseline — to fill in (median of 5, Fast 4G + 4x CPU)

| Route | TTFB | LCP | Click to skeleton | Navigation (click to commit) | Server: getCurrentStaffRole | Server: page loader |
|---|---|---|---|---|---|---|
| Dashboard | | | | | | `dashboard.loadData` |
| Leads | | | | | | `leads.loadData` |
| Pilgrims | | | | | | `pilgrims.loadJourneys` |
| Packages | | | | | | |
| Departure Groups list | | | | | | |
| Departure Group detail | | | | | | |
| Inbox | | | | | | |
| Finance > Payments | | | | | | |

| Action | Click to result |
|---|---|
| Change a lead's stage | |
| Record a payment | |
| Mark a notification read | |
