# Production Readiness — Bug Audit & Implementation Plan

**Audited:** 2026-08-16 · branch `fixing-whole` · Next.js 16.2.12 / React 19.2.4 / Supabase
**Scope:** whole repository (598 tracked files, 14 migrations, 11 modules)

## Status (2026-08-16, same day)

Everything in P0 and P1, plus most of P2, has been implemented — see the git
history on this branch for the commits. Verified with a clean `tsc --noEmit`,
zero-error `eslint .`, and a successful `next build` after every change.

- **P0 (all 7 items):** done. RLS hardening migration
  (`supabase/migrations/20260822090000_rls_hardening.sql`) closes P0-1
  through P0-4 plus the P1-7 last-admin race, in one transaction; package and
  operations action gates fixed (P0-5/P0-6); security headers added (P0-7).
- **P1 (all 8 items):** done, including the full dashboard rewire (P1-1) —
  `/dashboard` is now a Server Component backed by
  `lib/data/dashboard-repository.ts`, reusing `buildOperationsSnapshot()`,
  `loadLeadStore()` and the Finance repository rather than a fresh query
  surface. One known gap: `NewLeadsChart`'s per-period bar values
  (`getChartData()` in `charts/leads/new-leads-chart.tsx`) are still
  synthetic — only the funnel/summary numbers feeding it are real. Not
  verified visually behind auth (no test credentials available this session);
  verified via build/typecheck/lint and prop-shape review instead.
- **P2:** the dead-code, boilerplate, `.env.example`, error/loading/not-found
  boundaries, and `LEAD_STAFF` → real `staff_profiles` items are done. Full
  ESLint-warning cleanup (P2-8, ~132 remaining) was not attempted — lower
  value than the rest and flagged as such below.

The rest of this document is the original audit, left as written.

## Method

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `npx next build` | ✅ compiles, 38 routes |
| `npx eslint .` | ❌ **14 errors, 147 warnings** |
| Server-action authz sweep (scripted, all `"use server"` files) | ❌ 3 real gaps |
| Migration / RLS review (14 files) | ❌ **systemic** |
| Anthropic SDK usage vs installed `0.116.0` types | ❌ 1 real bug |
| Tests | ❌ none exist |

## Verdict

The architecture is genuinely good — the `lib/access/*-access.ts` capability model, the
repository/validation split, and the Team + Settings modules are production-grade work.
**The blocker is that role enforcement lives almost entirely in application code while the
database says `using (true)`.** Anyone holding a valid session and the publishable key can
bypass every capability matrix by talking to PostgREST or the Storage API directly. That,
plus a fully-mocked dashboard on the landing route, is what stands between this and shipping.

Estimated effort to production: **~3 weeks**, front-loaded on P0.

---

# P0 — Blockers (must fix before any production deploy)

### P0-1 · RLS is `using (true)` on ~40 tables across 8 modules

Every table outside Team and Settings grants full read **and write** to any authenticated user:

| Migration | Pattern |
|---|---|
| `20260808090000_create_packages.sql:184-201` | `to authenticated using (true)` |
| `20260809090000_create_departure_groups.sql:556-565` | loop generating `using (true)` / `with check (true)` for every table |
| `20260812100000_create_leads.sql:203-206` | same loop |
| `20260813090000_create_pilgrims.sql:356-364` | same loop |
| `20260814090000_documents_operations.sql:131-144` | `using (true)` |
| `20260815090000_visa_operations.sql:104-149` | `using (true)` |
| `20260817090000_supplier_directory.sql:66-304` | `using (true)` on 6 tables |
| `20260818090000_finance_payments.sql:73-497` | `using (true)` on 7 tables incl. `payments`, `invoices`, `refund_requests`, `finance_adjustments` |

Contrast `20260820090000_team_access.sql:186-227` and `20260821090000_agency_settings.sql:395-445`,
which correctly use the `public.current_staff_role()` security-definer helper. That helper already
exists — the earlier migrations simply predate it.

**Impact:** a `GUIDE` account can read the full payment ledger, every passport number, all supplier
costs and margins, and can `UPDATE` any row — with nothing but their own session token.

**Fix:** one new migration `20260822090000_rls_hardening.sql` that, per table, replaces the
permissive policies with role predicates derived from the matching `lib/access/*-access.ts` matrix.
Suggested shape:

```sql
create policy payments_select on public.payments
  for select to authenticated
  using (public.current_staff_role() in ('ADMIN','FINANCE','CEO'));

create policy payments_write on public.payments
  for all to authenticated
  using (public.current_staff_role() in ('ADMIN','FINANCE'))
  with check (public.current_staff_role() in ('ADMIN','FINANCE'));
```

Add a second helper for the common case so the policies stay readable:

```sql
create or replace function public.staff_role_in(variadic roles text[])
  returns boolean language sql stable as $$
  select public.current_staff_role() = any(roles)
$$;
```

**Do not** hand-derive the role lists — read each module's `CAPABILITIES` record and translate
`viewModule` → select, and the module's primary write capability → all. Where the app already
nulls columns per role (e.g. `finance-repository.ts` blanking amounts for `viewPaymentStatusOnly`),
RLS is row-grain only; column-grain stays in the repository layer. Note that in the app's own
gates. Index `staff_profiles(id)` is already the PK, so `current_staff_role()` stays cheap, but
mark it `stable` (it already is) so Postgres caches it per statement.

---

### P0-2 · All 22 SQL views bypass RLS entirely

None of the views declare `security_invoker = true`, so in Postgres ≥15 / Supabase they execute with
the **owner's** privileges and ignore RLS on their base tables:

`departure_group_payment_summaries`, `package_usage`, `pilgrim_journey_rows`, `document_queue_rows`,
`visa_application_rows`, `supplier_directory_rows`, `finance_receivable_rows`, `finance_payment_rows`,
`finance_invoice_rows`, `finance_supplier_payable_rows`, `report_*_facts` (8), `team_directory_rows`,
`audit_log_rows`, `branch_directory_rows`.

The worst case is `team_directory_rows` (`20260820090000_team_access.sql:143`): `staff_profiles`
*is* correctly locked to `id = auth.uid() or role in ('ADMIN','CEO')`, and the view hands the entire
staff directory to anyone. Same for `audit_log_rows` over an Admin-only base table.

**Fix:** in the same hardening migration, re-issue every view with
`create or replace view ... with (security_invoker = true) as ...`. This is a no-op for correctness
once P0-1 lands, and it is what makes P0-1 actually hold. Verify afterwards with the Supabase
linter (`security_definer_view` rule) — it should return zero.

---

### P0-3 · Storage policies leak every passport scan to every role

`20260811090000_departure_groups_documents_lifecycle.sql:231-247`:

```sql
create policy "staff read pilgrim documents" on storage.objects
  for select to authenticated using (bucket_id = 'pilgrim-documents')
```

The bucket is private and the app gates access behind `viewSensitiveTravellerData`
(`document-storage.ts:117-121`) — but the policy itself lets **any** authenticated user list and
sign every object in the bucket. Same shape for `supplier-evidence`
(`20260817090000:393-397`) and `payment-proofs` (`20260818090000`).

**Fix:** add the role predicate to each storage policy, e.g.

```sql
using (bucket_id = 'pilgrim-documents'
       and public.staff_role_in('ADMIN','OPERATIONS','VISA','CEO'))
```

Mirror `capabilitiesFor(role).viewSensitiveTravellerData` /
`capabilitiesForSuppliers(role).viewCosts` / `capabilitiesForFinance(role).viewLedger` respectively.

---

### P0-4 · `agency-assets` bucket is public **and** accepts `image/svg+xml`

`20260821090000_agency_settings.sql:498-500`. A stored SVG is served as `image/svg+xml` from
`*.supabase.co` and executes script when opened directly — stored XSS on the Supabase origin plus a
credible phishing vector, uploadable by any Admin and readable by the world.

**Fix:** drop `image/svg+xml` from `allowed_mime_types` (PNG/WEBP is sufficient for a logo), or keep
it and serve logos through a route handler that re-encodes to raster. Prefer the former.

---

### P0-5 · Two package actions have no capability check

`app/(main)/packages/actions.ts:87` (`saveDraftAction`) and `:142` (`savePackagePatchAction`) call
only `requireUser()`. They never call `requirePackageCapability()` — the helper defined 27 lines
above at `:69` and used correctly by all nine other actions in the file. `saveDraftAction` also
updates by caller-supplied `packageId` with **no ownership or existence-scope check**, so any
authenticated user (including `GUIDE`, whose package capabilities are `{ ...NONE }`) can create
packages and overwrite anyone else's draft.

**Fix:** route both through `requirePackageCapability("createPackage", c => c.createPackage)` /
`("editPackage", c => c.editPackage)`, and re-check `canRoleViewPackage(...)`
(`packages-access.ts:111`) against the loaded row before writing.

---

### P0-6 · The whole Operations action surface skips `requireUser()`

All seven exported actions in `app/(main)/operations/actions.ts` (`:50, :78, :92, :109, :131, :153, :173`)
resolve capabilities via `currentCapabilities()` (`:41`) → `getCurrentStaffRole()`, which returns the
`DENIED_ROLE = "GUIDE"` floor when there is no user (`departure-groups.ts:265, 289`). But `GUIDE` is
**not** an empty matrix in Operations — `operations-access.ts:144-152` grants
`viewModule`, `completeTask`, `generateRunSheet`, `exportManifest`, `viewPilgrimContactDetails`.
An unauthenticated POST that gets past `proxy.ts` can therefore complete tasks and read pilgrim
contact details.

**Fix:** add `await requireUser()` at the top of each action (or inside `currentCapabilities()`),
matching the pattern in `finance/payments/actions.ts:53` and `management/team/actions.ts:56`.
Separately, consider splitting `DENIED_ROLE` into a real `NO_ACCESS` role with an all-false matrix
in every module, rather than reusing `GUIDE` — the two mean different things and this is exactly
the bug that conflation produces.

---

### P0-7 · No security headers

`next.config.ts` sets no `headers()`. Missing CSP, HSTS, `X-Frame-Options`,
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. A CRM holding passport data and
payment ledgers is clickjackable today.

**Fix:** add an `async headers()` block applying to `/(.*)`. Start CSP in `Content-Security-Policy-
Report-Only` for one release, then enforce. Also remove the unused
`{ hostname: "img.icons8.com" }` remote pattern (zero call sites) — it only widens the image
optimiser's fetch surface.

---

# P1 — High (correctness; fix before launch)

### P1-1 · `/dashboard` is entirely mock data — and it is the landing page

`next.config.ts` redirects `/` → `/dashboard`. That page (`app/(main)/dashboard/page.tsx`) is:

- `"use client"` — so it cannot reach Supabase at all;
- fed by `lib/data/admin-dashboard-data.ts`, **570 lines of hardcoded fixtures**;
- ungated — no `getCurrentStaffRole()`, no `capabilitiesFor…`, no `notFound()`. A `GUIDE` sees
  agency-wide revenue, margins and collections (fake today, real once wired);
- carrying three dead handlers (`:24, :28, :32` — *"can connect to SWR/React Query/API when live
  backend is ready"*);
- rendering with `<AdminHeaderFilters>`, `<OperationalAlerts>`, `<UpcomingDepartures>` and
  `<LeadAttention>` commented out mid-JSX (`:55-73`).

Every other module in the app is properly wired to Supabase. The dashboard is the one that is not.

**Fix (largest single work item, ~1 week):**
1. Convert to a Server Component with `export const dynamic = "force-dynamic"`, following
   `app/(main)/documents/page.tsx:23-48` as the template.
2. Gate on role; decide per-KPI visibility from the existing matrices (finance KPIs behind
   `capabilitiesForFinance(role).viewLedger`, etc.).
3. Replace `getAdminDashboardData()` with a `lib/data/dashboard-repository.ts` that reuses the
   existing fact views (`report_booking_facts`, `report_payment_facts`, `report_group_facts`,
   `report_lead_facts`, `report_task_facts`) — the aggregation SQL already exists in
   `20260819090000_reports.sql`; do not write it twice.
4. Delete `lib/data/admin-dashboard-data.ts`; keep only the interfaces, moved to `lib/types/dashboard.ts`.
5. Either wire the branch/season/period filters to `searchParams` or delete the filter bar.
   Do not ship dead handlers.

### P1-2 · `<Tabs>` with no default value renders no panel

`app/(main)/dashboard/components/business-health/business-health.tsx:18` — `<Tabs>` with five
`<TabsTrigger>`s and no `defaultValue`/`value`. Nothing is selected on first paint.
**Fix:** `<Tabs defaultValue="revenue">`. Sweep the other `<Tabs>` usages for the same omission.

### P1-3 · HEIC uploads always fail AI analysis

`lib/data/documents-ai.ts:165` returns `"image/heic"`, then casts it to
`"image/jpeg" | "image/png" | "image/webp"` at `:230`. The installed SDK (`0.116.0`,
`resources/messages/messages.d.ts:97`) only accepts `image/jpeg | image/png | image/gif | image/webp`
— the API rejects the request with a 400, which the `catch` at `:283` records as a generic FAILED
analysis with an opaque message. HEIC is accepted by all four upload dialogs
(`pilgrim-documents-drawer.tsx:574`, `upload-document-dialog.tsx:137`,
`record-payment-dialog.tsx:355`, `record-issue-dialog.tsx:182`) and by the bucket's
`allowed_mime_types` — so this fires for every iPhone photo, which in this market is most of them.

Secondary: any unrecognised extension falls through to `image/jpeg` (`:169`), so a mislabelled file
is sent as a corrupt JPEG rather than refused.

**Fix:** transcode HEIC → JPEG server-side before the model call (`sharp` with libheif, or a
Supabase Edge Function), or refuse HEIC at upload time with a clear message. Change the fallback at
`:169` to `return null` and fail fast with "Unsupported file type" instead of guessing.

### P1-4 · "Today" is computed in UTC for a UTC+5:30 business

Nine sites use `new Date().toISOString().slice(0, 10)`:

| Site | Consequence |
|---|---|
| `lib/data/departure-groups.ts:308` | seasonal access expires 5½ h early/late — **staff locked out or left in** |
| `lib/data/team-repository.ts:766` | same, on the extend-access path |
| `lib/data/departure-groups.ts:637` | wrong day bucket for readiness |
| `lib/data/departure-groups-copy.ts:253` | wrong display date |
| `finance/payments/…/record-payment-dialog.tsx:71,85` | payment posts to the wrong day for 5½ h nightly |
| `operations/suppliers/…/record-payment-dialog.tsx:30,38` | same |

Meanwhile `colomboDayKey()` exists (`lib/data/leads-seed.ts:26`) and is used by **only** Leads and
Settings. Two calendars in one app.

**Fix:** promote `colomboDayKey` / `COLOMBO_TZ` out of `leads-seed.ts` into `lib/date.ts`, replace
all nine call sites, and add an ESLint `no-restricted-syntax` rule banning
`toISOString().slice(0, 10)` so it cannot come back.

### P1-5 · CSV formula injection in every export

`lib/csv.ts:15` quotes fields containing `" , \r \n` but does not neutralise a leading
`=`, `+`, `-`, `@`, tab or CR. Lead names, notes, supplier names and pilgrim names are free text and
are exported to CSV by eight modules. A lead named `=cmd|'/c calc'!A1` executes on the accountant's
machine when the export is opened in Excel.

**Fix:** prefix any field matching `/^[=+\-@\t\r]/` with `'` before quoting. Apply to **both** CSV
implementations (see P2-4).

### P1-6 · 14 ESLint errors, including a component created during render

```
components/animate-ui/primitives/animate/slot.tsx:86   react-hooks/static-components
components/animate-ui/primitives/animate/tabs.tsx:281  react-hooks/set-state-in-effect
components/animate-ui/primitives/effects/highlight.tsx:231  react-hooks/set-state-in-effect
components/ui/stepper.tsx:81                           react-hooks/set-state-in-effect
components/ui/stepper.tsx:436                          no-empty-object-type
components/ui/theme-switch.tsx:83                      react-hooks/set-state-in-effect
hooks/use-mobile.ts:14                                 react-hooks/set-state-in-effect
packages/create-package/…/step-2…tsx:309, 961          no-explicit-any
packages/create-package/…/step-3…tsx:776 (×2), 922     no-unescaped-entities, no-explicit-any
packages/create-package/…/step-7…tsx:517 (×2)          no-unescaped-entities
```

`static-components` in `slot.tsx:86` is the substantive one: a component defined inside render gets
a new identity every pass, so React unmounts and remounts its subtree — losing local state and
re-running effects. `slot.tsx` is a primitive under most animated UI in the app.

`stepper.tsx:81` already carries an `eslint-disable` for the rule it violates
(`// eslint-disable-line react-hooks/exhaustive-deps react-hooks/set-state-in-effect`) — the
suppression is on the wrong line, so it doesn't take. Fix the effect (derive direction during
render from a ref) rather than moving the comment.

`use-mobile.ts:14` causes a guaranteed double render on every mount for every consumer.

**Fix:** all 14. Then set `"lint": "eslint --max-warnings=0"` so the count cannot regress.

### P1-7 · Last-admin guard is a TOCTOU race

`lib/data/team-repository.ts:405-415` counts active Admins, then updates. Two concurrent demotions
both read `count = 2` and both proceed → zero Admins, agency locked out with no recovery path short
of the service key.

**Fix:** move the invariant into the database — a `constraint trigger` on `staff_profiles` that
raises when the update would leave `count(*) filter (where role = 'ADMIN' and status = 'ACTIVE') = 0`.
Keep the application check for the friendly message. Apply the same reasoning to `deactivateStaff`.

### P1-8 · Password change requires no reauthentication

`app/(auth)/actions.ts:168` `updatePasswordAction` accepts **any** live session — it is a public
server action, not restricted to the recovery flow. An unlocked laptop is a full account takeover
with no knowledge of the current password.

**Fix:** require `supabase.auth.reauthenticate()` (or a current-password `signInWithPassword`
round-trip) unless the session was minted by a recovery link — check the AAL/AMR claim rather than
trusting the caller.

---

# P2 — Mismatches & stale scaffolding

### P2-1 · Hardcoded staff directory still drives Leads

`lib/data/leads-seed.ts:31` — six names in an array — feeds owner pickers, table columns, CSV export
and `leads/actions.ts` across **nine files**. Its header comment states *"there is no staff/roles
table anywhere in this codebase yet"*, which stopped being true at migration `20260820090000`
(`staff_profiles`). Assigning a lead to a real staff member is currently impossible; assigning it to
a departed one is trivial.

**Fix:** replace `LEAD_STAFF` with a `loadAssignableStaff()` read off `staff_profiles`
(filter `status = 'ACTIVE'`, role in `ADMIN|MARKETING`), pass it down from the page, and store
`owner_id` alongside the existing name snapshot. Same treatment for the free-text guide/owner fields
in Departure Groups and for `resolveStaffIdByName()` (`operations/actions.ts:60`), which currently
resolves ownership by **string match on a display name**.

### P2-2 · 1,199-line seed dataset with zero call sites

`lib/data/departure-groups-seed.ts` — `createSeedStore()` at `:1036` is exported and never called
anywhere in the repo. Only the `DepartureGroupStore` *type* is imported (by 10 modules).
**Fix:** move the interface to `lib/types/departure-groups.ts` and delete the file.

### P2-3 · Dead Supabase middleware client

`utils/supabase/middleware.ts` constructs a client at `:15` and discards it — a superseded copy of
the logic now in `proxy.ts`. It has no importers. **Fix:** delete.

### P2-4 · Two CSV implementations

`lib/csv.ts` vs `app/(main)/departure-groups/csv.ts`. The header of the former already says the
latter *"should be pointed here when it is next touched."* It is now being touched (P1-5).
**Fix:** delete the duplicate, import from `lib/csv.ts`.

### P2-5 · create-next-app boilerplate still shipped

| File | Issue |
|---|---|
| `app/page.tsx` | untouched template page with Vercel/Next.js marketing links; statically prerendered as `○ /`, unreachable only because of the redirect |
| `app/layout.tsx:36-39` | `title: "Create Next App"`, `description: "Generated by create next app"` — the browser tab of a live CRM |
| `README.md` | boilerplate, plus a corrupted trailing line (`h a j j _ u m r a h _ c r m`) |

**Fix:** delete `app/page.tsx` (the redirect makes it dead); real metadata with a `title.template`;
rewrite the README as setup + environment + migration instructions.

### P2-6 · Environment is under-configured and undocumented

Referenced across the code: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SITE_URL`, `NODE_ENV`.
Present in `.env.local`: the **first two only**.

Silently non-functional as a result:
- **Team invitations, admin-initiated password resets, session revocation** — `createAdminClient()`
  throws (`utils/supabase/admin.ts:24`); `hasAdminClient()` hides the UI, so it fails quietly.
- **The entire AI Document Agent** — `isAiConfigured()` returns false (`documents-ai.ts:38`).
- **Email link origins in production** — `getSiteUrl()` falls back to the `Host` header
  (`lib/site-url.ts:19`), which is attacker-controlled behind a misconfigured proxy and would send
  password-reset links to another origin.

**Fix:** add `.env.example` documenting all six; set `NEXT_PUBLIC_SITE_URL` in production and make
`getSiteUrl()` **throw** in production rather than trusting a header; add a boot-time env validation
module (zod) that fails the build on missing required vars.

### P2-7 · Error and loading boundaries cover 4 of 14 route groups

Present only under `management/settings`, `management/team`, `packages`, `reports`. Absent for
Departure Groups, Documents, Finance, Leads, Operations, Suppliers, Visa, Pilgrims, Dashboard —
all of which call `notFound()` and can throw from Supabase. There is no `app/global-error.tsx` and
no `app/not-found.tsx`.
**Fix:** add `error.tsx` + `loading.tsx` per route group (a shared component, one thin wrapper each),
plus `global-error.tsx` and `not-found.tsx` at the root.

### P2-8 · 147 ESLint warnings

Overwhelmingly unused imports and variables — `components/header-bar.tsx` alone has ~12, including
an unused `useRouter`, `Image` and five unused icons. Each is a shipped-bytes cost and a signal that
a component was half-refactored.
**Fix:** clear all of them, then enforce with `--max-warnings=0`.

---

# P3 — Engineering hygiene

- **Zero tests.** No runner, no fixtures, no CI. The pure functions in `lib/access/*` and
  `lib/data/departure-groups-{rooming,money,readiness}.ts` are ideal unit-test targets and encode
  the rules the business actually depends on. Start there: Vitest + a
  `capabilitiesFor*` table test per module asserting the matrix matches the RLS policies from P0-1.
- **No CI.** Add `.github/workflows/ci.yml`: `tsc --noEmit`, `eslint --max-warnings=0`,
  `next build`, `vitest run` on every PR.
- **Missing scripts.** No `typecheck`, no `format`, no `test`. Add them; add Prettier.
- **No observability.** Four `console.*` statements in the entire app; no Sentry/equivalent, no
  structured logging, no request ids. `documents-ai.ts:283` swallows every AI failure into a DB
  column nobody monitors.
- **No rate limiting** on server actions beyond Supabase's auth limits. `MAX_BULK_SCAN = 25`
  (`documents-ai.ts:35`) is the only guard on AI spend; there is no per-user or per-day cap, and
  each call sends a full base64 document with `thinking: adaptive` + `effort: medium`.
- **`tsconfig.json` targets ES2017** — outdated for Next 16 / React 19; raise to ES2022.

---

# Execution plan

### Phase 1 — Security (week 1, blocking)
1. `supabase/migrations/20260822090000_rls_hardening.sql` — P0-1, P0-2, P0-3, P0-4 in one
   transaction. Add `staff_role_in()`.
2. Verify with the Supabase linter (zero `security_definer_view`, zero `rls_disabled_in_public`)
   **and** with a manual probe: sign in as a seeded `GUIDE`, then attempt `select * from payments`,
   `select * from team_directory_rows`, and a Storage `list` on `pilgrim-documents`. All three must
   return empty or 403.
3. P0-5, P0-6 — package and operations action gates.
4. P0-7 — security headers (CSP in report-only).
5. P1-8 — reauthentication on password change.

**Gate:** no capability assertion in any `lib/access/*.ts` may be satisfiable by a direct PostgREST
or Storage call from a role that lacks it.

### Phase 2 — Correctness (week 2)
6. P1-4 timezone unification + lint rule.
7. P1-5 CSV injection, on the unified module (do P2-4 first).
8. P1-3 HEIC handling.
9. P1-6 all 14 ESLint errors; P1-2 tabs default.
10. P1-7 last-admin DB trigger.

### Phase 3 — The dashboard (week 2–3)
11. P1-1, in the five steps listed. This is the single largest item and the most visible.

### Phase 4 — Cleanup & hygiene (week 3, parallelisable)
12. P2-1 staff directory; P2-2/P2-3/P2-4 dead code; P2-5 boilerplate; P2-6 env; P2-7 boundaries;
    P2-8 warnings.
13. P3: Vitest on `lib/access/*` and the pure mutators, CI workflow, scripts, Sentry, env validation.

### Definition of done
- [ ] `tsc --noEmit`, `eslint --max-warnings=0`, `next build`, `vitest run` all green in CI
- [ ] Supabase linter clean; the three manual `GUIDE` probes above all denied
- [ ] Zero references to `admin-dashboard-data.ts`, `departure-groups-seed.ts`, `LEAD_STAFF`,
      `utils/supabase/middleware.ts`
- [ ] All six env vars documented in `.env.example` and validated at boot
- [ ] `error.tsx` + `loading.tsx` on every route group; `global-error.tsx` and `not-found.tsx` present
- [ ] No page renders hardcoded business data

---

## Deliberately **not** flagged

These looked suspect and checked out — recorded so nobody re-audits them:

- `proxy.ts` — correct Supabase SSR pattern; cookies carried onto redirects (`withAuthCookies`),
  no logic between client creation and `getUser()`, and the `mode=reset` carve-out is right.
- `lib/site-url.ts:34` `safeRedirectPath` — correctly rejects `//evil.com` and protocol-relative paths.
- `app/auth/confirm/route.ts` and `callback/route.ts` — both shapes handled, errors mapped, no open redirect.
- `sendMagicLinkAction` (`actions.ts:108`) — deliberately reports success on `otp_disabled` to prevent
  staff-email enumeration. Correct and well commented.
- Money columns are `numeric(14,2)` throughout with `check` constraints; allocation logic is in SQL,
  not JS floats.
- Storage buckets all declare `file_size_limit` and `allowed_mime_types`; object keys are composed
  server-side from validated ids, never from the uploaded filename (`document-storage.ts:85-92`).
- `capabilitiesForTeam` / `describeRoleAccess` (`team-access.ts:150`) — the permissions panel renders
  from the real enforcement code, so it cannot drift from behaviour. Keep this pattern.
- Sidebar navigation is role-gated (`components/app-sidebar.tsx:104-169`).
- The Anthropic call in `documents-ai.ts:230` uses `thinking: adaptive` + `output_config.format`
  correctly for SDK `0.116.0`, and `claude-opus-5` is a current model id.
