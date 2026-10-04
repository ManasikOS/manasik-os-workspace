# Performance baseline runbook

How to measure page-load and interaction speed before and after a change, so
performance work (see [TASK-004](../tasks/TASK-004-performance-and-perceived-speed.md))
is judged on numbers rather than feel. Run it on the same machine, network and
data each time; compare like with like.

## Turning the instrumentation on

Both switches are off by default and cost nothing when off.

| Variable | Where | What it logs |
|---|---|---|
| `PERF_TIMING=1` | server (`.env.local`, or the Vercel project's env vars) | `[perf] <label> <ms>ms` for: `proxy.getClaims`, `auth.getClaims`, `auth.getUser (verified)`, `getCurrentStaffRole`, `dashboard.loadData`, `leads.loadData`, `pilgrims.loadJourneys`, `documents.loadQueue`, `visa.loadQueue` |
| `NEXT_PUBLIC_PERF_TIMING=1` | browser (inlined at build/dev start) | `[perf] navigation <ms>ms -> <path>` in the browser console: click (or `router.push`) to the URL committing |

Restart the dev server after changing either. Remove them from Vercel after
measuring — `PERF_TIMING` adds a log line per call in production.

Add a `withTiming("label", () => yourLoader())` (from `lib/timing.ts`) around
any other loader you want to see.

## Routes to measure

Dashboard, Leads, Pilgrims, Packages, Departure Groups (list), one Departure
Group (detail), Inbox, Finance > Payments.

## Procedure (per route)

1. Use a production build for numbers you intend to compare (`next build &&
   next start`, or a Vercel preview) — `next dev` compiles on demand and is
   several times slower. Use `NEXT_DIST_DIR=.next-build` so a build does not
   overwrite a running dev server.
2. Sign in, open DevTools, set throttling to **Fast 4G** and CPU **4x slowdown**
   for a "typical laptop on a phone-ish network" run; also record one
   unthrottled run.
3. Hard-reload the route 5 times. Record **TTFB**, **LCP** and total transferred
   JS from the Network/Performance panels (or Lighthouse). Take the median.
4. From another page, click the sidebar link to the route 5 times (client
   navigation). Read the `[perf] navigation` lines; record the median, and note
   how long until the skeleton appears (should be <100 ms).
5. On the server side, read the `[perf]` lines for that request; record the
   median for each label.
6. Perform the route's most common action (e.g. change a lead's stage, record a
   payment). Record the time from click to the UI showing the result (INP in
   the Performance panel, or the `[perf]` lines plus a stopwatch).

Real-user data comes from Vercel Speed Insights (already installed): Project >
Speed Insights, filter by route, read the P75 of LCP/INP/TTFB.

## Reading production logs

`get_runtime_logs` (Vercel MCP) with `query: "[perf]"` and `environment:
production`, or the Runtime Logs tab filtered by `[perf]`.

## Targets

| Metric | Target |
|---|---|
| Click to skeleton | < 100 ms |
| TTFB, P75 | < 600 ms |
| INP, P75 | < 200 ms |
| First-load JS per route (gzip) | trending down from the Phase 5 numbers |

## Recording results

Copy the table in
[`docs/progress/2026-09-19-performance-baseline.md`](../progress/2026-09-19-performance-baseline.md)
into a new dated file in `docs/progress/` for each measurement round.
