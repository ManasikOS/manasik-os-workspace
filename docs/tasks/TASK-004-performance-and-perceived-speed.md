# TASK-004 Performance & Perceived Speed

## What
A phased plan to make page navigation, first load and button/mutation
responses feel fast, on Next.js 16 + Supabase (ap-southeast-1) + Vercel
(`sin1`). Replaces the full-screen route-loading overlay with real
per-route skeletons, per-link pending feedback and optimistic mutations, and
removes the server-side waterfalls and over-fetching that cause the actual
slowness.

## Why
Reported symptoms: pages take long to open, buttons give no response for a
while, and the loading overlay only fires for sidebar links.

Findings from reading the code (2026-09-19):

### F1. Navigation blocks on a serial chain in the layout
`app/(main)/layout.tsx` awaits, **before rendering anything**:
`requireUser()` → `getCurrentStaffRole()` (2 queries) → notifications
(2 queries). Nothing streams until all of it is done, and every
`loading.tsx` below it is irrelevant until then.

### F2. Auth is verified over the network 2–3× per navigation
- `proxy.ts` calls `supabase.auth.getUser()` (round trip to Supabase Auth,
  roughly 230–500 ms per external measurements).
- `lib/dal.ts#getUser` calls `getUser()` again (React `cache` only dedupes
  inside one render, not against the proxy).
- `getClaims()` (local JWT verification against cached JWKS, ~0 ms warm) is
  used only in `app/(auth)/actions.ts`.

### F3. Every page is `force-dynamic` and fetches whole tables
- 46 `export const dynamic = "force-dynamic"` usages; zero `unstable_cache` /
  `use cache`; `cacheComponents` is off.
- `loadLeadStore()` (`lib/data/leads-repository.ts`) runs 9 parallel
  `select("*")` **with no limit or pagination** on `leads`, `lead_activity`,
  `lead_notes`, `lead_quotes`, etc., then serialises the whole store to the
  client. Cost grows linearly with data and it is the shape of most modules
  ("store → pure mutator → diff" pattern).
- `loadDashboardData()` fans out ~10 loaders, including
  `loadLeadStore` and full receivables/payments lists, on every visit.
- 199 `select("*")` call sites.
- Reference data that rarely changes (packages, sources, staff options,
  agency settings, role permissions) is re-read on every request.

### F4. The overlay is the wrong tool
`components/navigation-process.tsx` listens for clicks on `<a>` and shows a
blurred full-screen overlay until `pathname` changes. It:
- hides the (already-good) `loading.tsx` skeletons behind a blur,
- does nothing for `router.push`, buttons, dialogs, form actions or
  search-param changes,
- has a 12 s timeout fallback and text keyed to a hand-maintained route list,
- makes fast navigations feel slower (fade-in + blur paint cost).
Only 15 of 99 pages have a `loading.tsx`. A Suspense boundary is set in the
layout but `NavigationProgress` uses `useSearchParams()` inside it.

### F5. Client-side weight
7 `next/font/google` families loaded in the root layout (Geist, Geist Mono,
Inter, Roboto Mono, Playfair, Plus Jakarta, Noto Kufi Arabic) — every one
adds preload bytes and layout cost. `lenis` smooth-scroll runs an rAF loop
for the whole session (and adds scroll latency). 447 client components;
`recharts`, `@tanstack/react-table`, `motion` are imported eagerly.

### F6. Database (Supabase advisors, performance, project `klognjpwmqwlgeibvanf`)
- **168 unindexed foreign keys** (INFO) — slow joins/deletes, and most
  tenant/parent filters in `.eq(...)` are unindexed.
- **11 `auth_rls_initplan`** (WARN) policies call `auth.uid()` per row.
  Migrations show 50 raw `auth.uid()` vs 19 `(select auth.uid())`.
- **136 `multiple_permissive_policies`** (WARN) — several policies evaluated
  per query per action (e.g. `agencies_platform_write` + `agencies_select`).
- 1 duplicate index (`staff_profiles_agency_id_idx` = `staff_profiles_agency_idx`).
- 261 unused indexes (INFO) — write overhead; review only after a
  representative traffic window.
- `current_staff_role()` (security definer) runs a `staff_profiles` lookup
  inside RLS policies; without `(select ...)` wrapping it re-runs per row.
- Region is fine: Supabase `ap-southeast-1` ↔ Vercel `sin1`.

### F7. Mutations revalidate broadly
`revalidatePath("/departure-groups")` ×32, `(/departure-groups/[id])` ×60+,
`revalidatePath("/", "layout")` ×4. Each mutation triggers a full dynamic
re-render of the affected route. Only ~104 files use pending-state hooks
(`useTransition`/`useOptimistic`/`useFormStatus`), so many buttons show
nothing until the round trip returns.

## Approach (research summary)
- **Local JWT verification** (`getClaims`) instead of `getUser()` for page
  gating; keep `getUser()` for sensitive writes. Supabase's own docs
  recommend this when instant revocation is not required
  ([docs](https://supabase.com/docs/reference/javascript/auth-getclaims)).
- **Cache Components / `use cache`** + Suspense holes so shells and
  reference data are served instantly and only per-user data streams
  ([Next.js guide, bundled: `node_modules/next/dist/docs/01-app/02-guides/instant-navigation.md`]).
- **`loading.tsx` + prefetch**: for dynamic routes only the tree down to the
  nearest `loading.tsx` is prefetched, so every route needs one; add
  `useLinkStatus` for immediate per-link feedback
  ([Next.js prefetching](https://nextjs.org/docs/app/guides/prefetching)).
- **`useTransition` / `useOptimistic`** for every mutation so the UI reacts
  in the same frame.
- **RLS**: wrap `auth.*()` and helper functions in `(select ...)`, index
  policy columns, merge permissive policies
  ([Supabase RLS performance](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv)).
  Reported gains: 179 ms → 9 ms for wrapped `auth.uid()`.

## Plan

Each phase is independently shippable. Measure before and after (see
Phase 0). Order is by impact per unit of risk.

### Phase 0 — Measure (½ day)
- Confirm baseline with Vercel Speed Insights (already installed) and
  Server-Timing: add a tiny `withTiming()` helper logging duration of
  `requireUser`, `getCurrentStaffRole`, and each dashboard/leads loader.
- Record for 8 key routes (dashboard, leads, pilgrims, packages,
  departure-groups list + detail, inbox, finance/payments): TTFB, LCP,
  INP, and click-to-skeleton time. Save to `docs/progress/`.
- Pull Vercel runtime logs for slowest functions (Vercel MCP
  `get_runtime_logs`) and Supabase `pg_stat_statements` top 20 by total time.
- **Exit:** a baseline table; targets: click→skeleton < 100 ms, TTFB p75
  < 600 ms, INP < 200 ms.

### Phase 1 — Perceived speed (1–2 days, no data changes)
1. **Delete the overlay.** Remove `NavigationProgress`, `.route-loader-*`
   CSS, and `ROUTE_LABELS`.
2. **Thin top progress bar** (`nprogress` is already a dependency and
   unused for this) driven by `useLinkStatus` inside the shared sidebar /
   link component, plus a `useRouter` wrapper for `router.push` — shows for
   *every* navigation source, not only sidebar anchors.
3. **`loading.tsx` on all 99 routes' segments** (start with the 84 missing),
   using shape-matched skeletons rather than the single generic one. Keep
   layout chrome (sidebar/header) interactive during load.
4. **Instant control feedback:** shared `PendingActionButton` wrapper
   (shadcn `Button` + `Spinner`, `useTransition`) that disables and shows a
   spinner within one frame; adopt in every Server Action trigger.
   `useOptimistic` for cheap wins first: notification read, lead status /
   assignment, task complete, pilgrim/lead notes, inbox send (already
   partly done in TASK-001).
5. Prefetch: set `prefetch` deliberately on sidebar links; verify
   production prefetch is happening (dev does not prefetch).
6. **Fonts:** keep at most 2 families (body + mono/Arabic as needed);
   load the others only on the routes that use them; `display: "swap"`.
7. Drop `SmoothScroll` (Lenis) or restrict to marketing/portal pages.
- **Exit:** every click shows a response ≤100 ms; no blank/frozen route.

### Phase 2 — Kill the auth/layout waterfall (1–2 days)
1. `proxy.ts`: switch to `getClaims()` for the gate (verify project uses
   asymmetric JWT signing keys; if legacy HS256, migrate signing keys in the
   Supabase dashboard first — a prerequisite, not optional). Keep session
   refresh behaviour and cookie handling as is.
2. `lib/dal.ts#getUser`: derive the user id from claims; keep a separate
   `requireVerifiedUser()` (uses `getUser()`) for destructive/sensitive
   actions (role changes, deletes, payments, agency switch).
3. Restructure `app/(main)/layout.tsx`:
   - resolve `getCurrentStaffRole()` once (already `cache`d) and pass it to
     children through context instead of re-querying;
   - render the shell immediately; stream notifications/badge counts behind
     `<Suspense>` inside `HeaderBar`;
   - move `touchLastActive()` off the render path into `after()`-style
     fire-and-forget (already fire-and-forget; drop the extra
     `staff_profiles` select by using the RPC result / throttle cookie).
4. Fold the two `getCurrentStaffRole` queries into one RPC
   (`get_session_context()` returning profile + agency status + memberships)
   — 1 round trip instead of 2, and one place to cache.
5. Cache per-user context for 30–60 s with `use cache: private` /
   tag `staff:{id}`; `revalidateTag` on role/agency/permission changes.
- **Exit:** layout time-to-first-byte of shell < 150 ms server time; auth
  round trips per navigation: 0 network calls warm.

### Phase 3 — Data loading (3–5 days, module by module)
Order: dashboard → leads → pilgrims → departure-groups list → packages →
inbox → finance.
1. **Never `select("*")` unbounded.** For list pages: explicit columns,
   server-side pagination (`range`) + filters + search in SQL, page size
   25–50; counts via `count: "estimated"/"exact"` only where needed.
   Fetch child tables (activity, notes, quotes) only on the detail
   view/sheet, on demand.
2. **Split the "store" pattern** for reads: keep the mutator/diff path for
   writes, add narrow read functions (`listLeadsPage`, `getLeadDetail`).
3. **Dashboard:** one Suspense boundary per panel (each panel loads its
   own data) instead of one `loadDashboardData()` gate; heavy aggregates
   (revenue trend, aging, seat pace, team performance) move to SQL views /
   RPCs returning aggregates rather than rows; cache them 60–300 s with a
   tag.
4. **Reference data cache** (`use cache` + `cacheLife("minutes")`, tagged):
   packages options, lead sources, staff options, agency settings, role
   permissions, campaign options. Invalidate with `revalidateTag` in the
   existing write actions.
5. Enable `cacheComponents: true` (route by route; it replaces
   `export const dynamic`). Migrate a pilot route first (dashboard), follow
   the "blocking-route" errors, add `unstable_instant` to validate shells.
   This is the largest change; gate on Phase 0 numbers showing it is still
   needed after 1–2.
6. Replace broad `revalidatePath` with `revalidateTag` / narrower paths;
   drop the four `revalidatePath("/", "layout")` except agency switch.
7. Server Actions return the updated row so the client patches state
   (paired with `useOptimistic`) instead of relying on a full re-render.
8. Parallelise: audit for sequential `await`s that can be `Promise.all`,
   and start promises early in pages before awaiting the role.

### Phase 4 — Database (1–2 days; migrations, RLS unchanged in semantics)
One migration per item, each verified with `get_advisors` after.
1. Index the **hot** foreign keys first (those used in `.eq()` filters or
   RLS: `agency_id`, `departure_group_id`, `lead_id`, `pilgrim_id`,
   `booking_id`, `conversation_id`, `staff_id`, `created_at` sort keys),
   using `create index concurrently`-equivalent practice; do **not** blindly
   index all 168 (write cost). Drop the duplicate `staff_profiles` index.
2. Rewrite the 11 `auth_rls_initplan` policies with `(select auth.uid())`
   and wrap `current_staff_role()` / agency helpers as
   `(select public.current_staff_role())`. Mark helpers `stable` (already)
   and confirm `parallel safe`.
3. Merge the 136 duplicate permissive policies per (table, role, action)
   into one policy each, preserving exact semantics; add a test that
   a non-member cannot read another agency's rows (multi-tenancy rules stay
   intact — RLS must not regress).
4. Add composite indexes for the main list sorts
   (`(agency_id, created_at desc)` etc.) after reading `pg_stat_statements`.
5. Revisit unused indexes only after a month of production traffic.
6. Use the Supabase pooler (transaction mode) URL for any direct Postgres
   client; PostgREST via supabase-js needs nothing.

### Phase 5 — Bundle & runtime (1–2 days)
- `next build` analyzer pass; dynamic-import `recharts`, PDF/XLSX/QR libs,
  and heavy sheets/dialogs (`next/dynamic`, load on open).
- `optimizePackageImports` for `lucide-react`, `date-fns`, `motion`,
  `recharts` in `next.config.ts`.
- Confirm Vercel Fluid compute is on and function region stays `sin1`.
- Add `Cache-Control` for public static assets already handled by Next;
  images via `next/image` with sized props.

## Data model changes
Phase 4 only: index creation, RLS policy rewrites (same semantics), one
new RPC (`get_session_context`) and optional aggregate views/RPCs for the
dashboard. Each ships as its own migration with RLS in the same file per
the security rules.

## Access control changes
None to capabilities. Caching rules: cached data is keyed by
`agency_id` (and role/user where the payload differs by user) — a cache
entry must never be shared across agencies. Permission/role changes
invalidate the `staff:{id}` and `agency:{id}` tags. Page gating via
`getClaims()` keeps `requireUser`-style checks; sensitive mutations still
use a verified `getUser()`.

## UI surfaces
Sidebar/link component, header, `app/(main)/layout.tsx`, all `loading.tsx`
files, dashboard, leads, pilgrims, departure-groups, packages, inbox,
finance lists; a shared `PendingActionButton`. UI built with shadcn
components only (`Progress`/`Skeleton`/`Spinner`/`Button`) using existing
design tokens; no colour changes.

## Test plan
Automated (Vitest): pagination/filter query builders, cache-key and
invalidation helpers (agency isolation), the claims→user mapping, the
optimistic reducers. Manual/browser: per route — click → skeleton time,
back/forward, router.push, search-param filters, mutation buttons with
throttled network (DevTools "Slow 4G"), permission-denied and suspended
states, multi-agency switch shows fresh data. DB: re-run
`get_advisors(performance)` and `EXPLAIN ANALYZE` on the top queries
before/after; RLS regression check across two agencies.

## Risks
- `cacheComponents` can surface latent request-time access errors across
  99 pages — migrate incrementally, pilot first.
- Stale cache after writes if a tag is missed — keep TTLs short (≤5 min)
  and centralise tag names in one module.
- `getClaims()` won't notice a revoked/banned user until the JWT expires
  (default 1 h): shorten JWT expiry or keep `getUser()` on sensitive
  writes.
- RLS/index migrations on production: apply on a Supabase branch first.

## Status
In progress. Phase 1 implemented 2026-09-19 (typecheck, lint: 0 errors, and
429 tests pass; **not yet verified in a browser** — needs a signed-in check
with throttled network):
- Overlay (`navigation-process.tsx`) and its CSS removed; replaced by
  `components/route-progress-bar.tsx` + `lib/route-progress.ts` (nprogress,
  thin top bar). Link clicks and back/forward start it automatically.
- `hooks/use-progress-router.ts`: 183 `useRouter()` call sites now start the
  bar on `push`/`replace`/`back`/`forward` (imported as
  `useProgressRouter as useRouter`; `refresh` untouched).
- Sidebar links show a spinner in place of the icon while pending
  (`useLinkStatus`).
- `app/(main)/loading.tsx` (covers every route without its own), plus
  detail-shaped `loading.tsx` on 14 record routes and one for the Inbox.
- `components/pending-action-button.tsx` created; **not yet adopted** at
  call sites (Phase 1 step 4 remains).
- Removed 5 unused `next/font` families (Geist, Geist Mono, Inter, Roboto
  Mono, Playfair — none were wired to a CSS variable in use) and the unused
  Lenis `SmoothScroll` component and dependency.
- Remaining in Phase 1: adopt `PendingActionButton` / `useOptimistic` at
  hot spots, decide sidebar `prefetch`, verify in production build.
Phases 0, 2–5 not started.

### Phase 2 status (2026-09-19)
Implemented; typecheck, lint (0 errors) and 433 tests pass. **Not verified in
a browser or on a Vercel deploy.**
- Project signs JWTs with ES256 (JWKS published), so `getClaims()` verifies
  locally with no Auth round trip.
- `proxy.ts` gates on `getClaims()` instead of `getUser()`.
- `lib/dal.ts`: new `getSessionUser()` (claims-based, cached) and
  `requireSessionUser()` (same INVITED→ACTIVE / last-active side effect).
  `requireUser()` / `getUser()` are unchanged and still do the verified
  lookup — Server Actions keep using them.
- `getCurrentStaffRole()`, `currentActor()` and the 3 packages pages now use
  `getSessionUser()` (read/render path only).
- `app/(main)/layout.tsx`: session check and role lookup run in parallel;
  the notification bell streams behind its own `<Suspense>`
  (`components/header-notification-bell.tsx`) instead of blocking the shell.
- Test: `lib/dal.test.ts` (claims → user mapping).
- Trade-off accepted: a session revoked server-side is honoured for reads
  until its access token expires (Supabase default 1 h). Consider shortening
  JWT expiry in the Supabase dashboard.
- **Not done yet:** merging the two role queries into one RPC, per-user
  context caching (`use cache: private`), and removing
  `touchLastActive()`'s extra `staff_profiles` select per navigation.

### Phase 1 & 2 completion (2026-09-19)
- **Phase 1:** `PendingActionButton` adopted on the Leads drawer's
  "Complete" follow-up. The Leads store no longer calls `router.refresh()`
  after each action — every Leads action already calls
  `revalidatePath("/leads")`, whose fresh page comes back in the action's
  own response, so the extra refresh re-ran the whole page (9 unbounded
  reads) a second time. Single-lead stage change and reassignment now
  update instantly (optimistic, reverted on failure; the override is tied to
  the server store object it was made against, so it can never outlive the
  fresh data). Prefetch: keeping Next's default (viewport prefetch in
  production, which now yields a real `loading.tsx` shell for every route).
- **Phase 2:** `getCurrentStaffRole()` also returns `activity`
  (status + last_active_at) and the layout passes it to
  `touchSessionActivity()`, removing the extra `staff_profiles` select per
  navigation (INVITED accounts still flip to ACTIVE — covered by tests).
- **Decided not to do:** the "merge role queries into one RPC" item — the two
  queries already run in parallel (one round-trip of latency), so an RPC
  saves a request but almost no time and adds a migration plus a
  missing-function fallback. Per-user context caching moves to Phase 3
  (needs `cacheComponents`).
- **New Phase 3 item — redundant `router.refresh()`:** 245 call sites in
  `app/` follow the same "Server Action, then `router.refresh()`" pattern.
  Where the action already calls `revalidatePath`, the refresh is a second
  full render. Audit per module (departure-groups first), removing it only
  where the action's revalidation covers the page.

### Phase 4 status — migrations APPLIED (2026-09-19)
Findings from the live database (2026-09-19): the largest table missing an
FK index has 59 rows and most have 0–17, so FK indexes are preparation for
growth, not a fix for today's slowness. Real cost today is round trips and
whole-table reads in the app (Phase 3).
- `supabase/migrations/20261128090000_perf_rls_initplan_and_duplicate_index.sql`
  — rewrites the 11 flagged policies with `(select auth.uid())` /
  `(select current_agency_id())` / `(select current_staff_role())` (same
  logic, via `ALTER POLICY`) and drops duplicate
  `staff_profiles_agency_idx`.
- `supabase/migrations/20261128090100_perf_foreign_key_indexes.sql` — 54
  indexes for parent/child FKs on tables that will grow (Inbox, finance,
  bookings, leads). Audit columns pointing at `auth.users` deliberately
  skipped (write cost, never queried).
- Both were dry-run against the live schema inside a rolled-back
  transaction: valid, and the schema was verified unchanged afterwards.
  **Applied to project `klognjpwmqwlgeibvanf` on 2026-09-19 with the
  owner's go-ahead** (via `apply_migration`, so the remote migration history
  carries its own timestamps for these two, not the `20261128…` prefixes of
  the local files).
- Verified after applying: performance advisor `auth_rls_initplan` 11 → 0,
  `duplicate_index` 1 → 0, `unindexed_foreign_keys` 168 → 114;
  `unused_index` rose 261 → 314 only because the 53 new indexes have not been
  used yet (re-check after a month of traffic). Security advisor shows no
  new findings; every public table still has RLS enabled; the rewritten
  policies read back as intended. **Still to do:** a two-agency RLS check
  from the app (a user in agency A must not read agency B rows).
- **Not done — 136 multiple-permissive-policies:** merging them safely needs
  a per-table semantic review (an `ALL` policy also grants SELECT, so simply
  narrowing it can change access). Low value at current data size; do table
  by table with tests, not in bulk.

### Phase 3 status (2026-09-19) — partly done
Typecheck, lint (0 errors) and 437 tests pass. **Not verified in a browser.**

**Done**
- **Redundant `router.refresh()` audit.** Confirmed in Next's source
  (`action-handler.js`: `skipPageRendering` is false whenever an action
  revalidated anything) that a Server Action which calls
  `revalidatePath`/`revalidateTag` already returns the freshly rendered
  current page, so a following `router.refresh()` is a second full render.
  Removed 185 of 245 call sites in 106 files, each only where the *nearest
  preceding awaited action* in the same handler revalidates (checked by
  script over every `"use server"` export; helpers named `revalidate*`
  count). Left alone on purpose: 61 sites where the action does not
  revalidate itself, the call sits in a file that also uses `fetch`,
  Supabase clients, realtime or intervals, or the refresh is combined with a
  `push`/`replace`/`back`. Unused `router` variables/imports and stale hook
  dependencies from the removal were cleaned up.
  **Watch for:** any screen that stays stale after saving — that means its
  action revalidates only on some paths; add the missing revalidation to the
  action rather than restoring the refresh.
- **Speculative loading.** Leads, Pilgrims, Documents and Visa pages start
  their queries before the role lookup resolves (RLS still scopes rows; a
  denied user costs one wasted query) instead of after it — one serial round
  trip less per visit.
- **Dashboard lead read.** `loadLeadDashboardFacts()` selects 5 columns
  instead of every column of every lead.

**Deliberately not done (and why)**
- **List pagination.** Every list (leads, pilgrims, packages, groups…)
  filters, sorts and searches client-side across the full array, so
  paginating means redesigning each list's state and URL model, and current
  tables are tiny (largest with an unindexed FK: 59 rows). Trigger to do it:
  a list page taking noticeable server time with >~2,000 rows; start with
  Leads (9 table reads) using server-side filters + `range`.
- **Dashboard per-panel streaming.** `loadDashboardData()` shares loaders
  across panels (finance, leads, reports), so splitting needs a shared cached
  fetch per request first. Do together with the Cache Components pilot.
- **`cacheComponents` pilot and reference-data caching (`use cache`).**
  Enabling the flag is global and changes rendering rules for all 99 pages;
  it needs browser-verified, route-by-route migration. Caching per-agency
  reference data outside a request would need a service-role client, which
  bypasses RLS — not acceptable without a dedicated design.
- **`revalidatePath` → `revalidateTag`** and the four
  `revalidatePath("/", "layout")` calls: no measured benefit yet; revisit
  with the cache pilot.

### Phase 5 status (2026-09-19) — done for what measured as worthwhile
**Method.** `next experimental-analyze` to find heavy packages, then two real
production builds (`NEXT_DIST_DIR=.next-build`, added as an optional
`distDir` override in `next.config.ts` so a build cannot clobber a running
`next dev`) and gzip size of each route's first-load JS from its
`page_client-reference-manifest.js`.

**Root cause found.** The sidebar (on every page) statically imported the
Settings dialog, which imports ~20 settings forms — including `recharts`
(billing dashboard) and the `zod` form schemas. So every route shipped charts
and validation code it never used.

**Fix.** `components/app-sidebar.tsx` loads the dialog with `next/dynamic`
(`ssr: false`), mounts it only after the first open, and warms the chunk on
hover/focus so the click still feels instant.

**Measured first-load JS, gzip (before -> after):**

| Route | Before | After | Change |
|---|---|---|---|
| /leads | 649 KB | 406 KB | -37% |
| /dashboard | 604 KB | 459 KB | -24% |
| /pilgrims | 587 KB | 340 KB | -42% |
| /departure-groups | 593 KB | 347 KB | -41% |
| /inbox | 573 KB | 307 KB | -46% |

`recharts` (~150 KB) and `zod` (~86 KB) no longer appear in the Leads first
load. Dashboard still carries `recharts` (~130 KB) because it really draws
charts.

**Deliberately not done**
- `optimizePackageImports` for `reicon-react`/`motion`/`@base-ui/react`:
  none of them showed as a top cost in the analysis and Turbopack already
  tree-shakes ESM; adding config with no measured gain is noise.
- Lazy-loading the dashboard charts: the page is server-rendered, so a
  `next/dynamic` split still downloads the chunk at hydration; it would only
  help with `ssr: false` behind a client wrapper and below-the-fold
  placement. Revisit with the dashboard streaming work.
- `motion` (~70 KB gz, used by the header theme switch and the tabs
  primitive with 57 importers): removing it is a visual/animation redesign,
  not an optimisation. Candidate for later.
- Unused `components/ui/circle-progress-bar.tsx` (imports `recharts`, zero
  importers) is dead code; safe to delete in a cleanup.
- **Vercel Fluid compute:** the Vercel API did not expose this setting.
  Check in the dashboard (Project -> Settings -> Functions). Function region
  is pinned to `sin1` by `vercel.json`, matching Supabase `ap-southeast-1`.
  The CRM appears to be Vercel project `hajj-umrah-crm`
  (`workspace.manasikos.com`).
- `next/image`: agency logo already goes through it (see `next.config.ts`);
  no other large raster images were found in the analysis.

### Phase 0 status (2026-09-19) — tooling built; live baseline still to take
- **Finding:** production has almost no user traffic (65 requests in 7 days,
  all cron, all 200; no Analytics page views), so there is no real-user
  baseline to read. The first runbook measurement after these changes deploy
  becomes the baseline.
- **Added (opt-in, off by default):** `lib/timing.ts` `withTiming()`;
  `PERF_TIMING=1` logs `[perf] <label> <ms>ms` for the proxy claims check, the
  session/user reads, `getCurrentStaffRole`, and the dashboard/leads/pilgrims/
  documents/visa loaders; `NEXT_PUBLIC_PERF_TIMING=1` logs click-to-commit
  navigation time in the browser. Tests: `lib/timing.test.ts`.
- **Runbook:** `docs/runbooks/performance-baseline-runbook.md`.
  **Snapshot:** `docs/progress/2026-09-19-performance-baseline.md` (measured
  first-load JS and database stats; timing table left blank on purpose).
- **Database finding:** app queries are cheap (0.08 ms mean over 92k
  requests); the DB is not the bottleneck at this size. `touch_own_activity`
  was 10% of requests historically — re-check the call count after deploy.
- **Still to do (needs a signed-in browser):** fill the timing table, read
  Speed Insights P75 in the Vercel dashboard, then compare after Phase 3–5
  changes are live.
