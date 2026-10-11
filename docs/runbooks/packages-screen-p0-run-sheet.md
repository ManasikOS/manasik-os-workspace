# Packages Screen — P0 Run Sheet

The ship gate for the Packages module: every **P0** test from
[`packages-screen-test-plan.md`](packages-screen-test-plan.md), grouped into
sessions by who you sign in as, with a blank result column.

- **136 P0 tests.** IDs, steps and expected results are copied from the test plan, so a row here is the same test as there.
- The plan stays the reference for P1/P2 tests, the state-transition matrix and the observations list.
- Written against `UI-update` @ `421dd0ed` (2026-10-11). Where behaviour changed after the plan was written, the row carries a **Changed since the plan** note.

Related: [`packages-screen-test-plan.md`](packages-screen-test-plan.md) ·
[`packages-screen-user-guide.md`](packages-screen-user-guide.md) ·
[`../modules/packages-screen-technical-reference.md`](../modules/packages-screen-technical-reference.md) ·
[`../modules/packages-production-readiness-plan.md`](../modules/packages-production-readiness-plan.md)

## 1. Already proven (do not repeat by hand)

| Check | Result | Where |
| --- | --- | --- |
| Typecheck, lint (0 errors), 5,231 unit tests, production build | Pass on `UI-update` | local run, 2026-10-11 |
| Packages CI `packages-ci` and `database-tests` (pgTAP from the migrations) | Pass on `421dd0ed` | GitHub run 38153434273 |
| All 21 package migrations applied on staging | Yes | Supabase `list_migrations` |
| `npm audit --omit=dev` | 0 vulnerabilities (Next 16.4.0) | `7c7e5155` |
| Every Server Action gated by `requirePackageCapability` | Yes (18 of 18) | `app/(main)/packages/actions.ts` |

What has **not** been run is everything below: nobody has driven the screen as each role.

## 2. Before you start (pre-flight)

Tick every box before the first write. Stop if one fails.

- [ ] **Environment.** `.env.local` points at **staging** (`klognjpwmqwlgeibvanf`), never production.
- [ ] **Test agency exists** with `is_test = true` (the plan names it `E2E-packages-20261008`). TASK-041 recorded that no agency had `is_test = true`, so confirm it was created. Only the service role can set that flag.
- [ ] **Never write in** `Royal Al-Fathima Travels`. Take its snapshot now (see §6, PKG-SEC-17) and keep the output.
- [ ] **Test users exist in the test agency**, one per role: ADMIN, OPERATIONS, MARKETING, FINANCE, CEO, VISA, GUIDE. Staging had no MARKETING, FINANCE, VISA or GUIDE users when the plan was written. Also keep a second agency (`LR2 Fixture Agency A` / `B`) with one ADMIN for the isolation tests.
- [ ] **Approval policy.** Note the current value in Settings → Operations (sensitive package changes need approval: on or off). PKG-EDP-10 needs both.
- [ ] **Fixtures P1–P13** seeded (script below, table in §3). The seed prints the test agency id and the other agency id; keep both for §6.
- [ ] **Seed dry run read** before `--execute`: it lists every row it would create or reset.
- [ ] **Browser.** Chrome, a clean profile, devtools open on Network. A second browser profile (or private window) is ready for the two-tab tests.
- [ ] **Export limit.** Exports are limited to 10 an hour per person. Plan about 5 in S2.

> **Scripts.** Fixtures and cleanup are scripted (`scripts/e2e/`). Both are a dry run by default and write only with `--execute`; both refuse a production project.
>
> ```bash
> npx tsx scripts/e2e/seed-packages-p0-fixtures.ts                 # dry run
> npx tsx scripts/e2e/seed-packages-p0-fixtures.ts --execute
> npx tsx scripts/e2e/seed-packages-p0-fixtures.ts --execute --bulk 600   # adds the PKG-PRF-03 set
> npx tsx scripts/e2e/cleanup-packages-p0-fixtures.ts --execute   # after the run
> ```
>
> Set the `PACKAGES_E2E_*` variables from `.env.example` first. The users must already exist in Supabase Auth: the seeder creates their staff profiles, never the accounts. Re-running the seed resets every fixture to its starting state.

## 3. Fixtures

Create in the test agency. All codes start `ZZTEST-`.

| ID | State | Used for |
| --- | --- | --- |
| P1 | Draft, all steps complete, owner = OPERATIONS user | publish, My Drafts |
| P2 | Draft, step 1 only (~17%) | publish refusal, Needs Attention |
| P3 | Draft, blank code and title | `Untitled package` fallback, publish refusal |
| P4 | Open for Sale, complete, **0** groups | unpublish, archive, delete |
| P5 | Open for Sale, **2 live** groups with seats | KPIs, archive guard, delete blocked |
| P6 | Sales Closed | reopen |
| P7 | Archived (was Open for Sale) | restore target |
| P8 | Open for Sale, featured, Hajj, Premium, branch Kandy | filters, duplicate |
| P9 | Draft owned by the MARKETING user | marketing visibility |
| P10 | Draft owned by the OPERATIONS user | hidden from MARKETING |
| P11 | Open for Sale, only cancelled/archived groups | archive allowed, delete blocked |
| P12 | Titles `=HYPERLINK("http://x","y")`, a 200-character title, one with Arabic and an emoji | export injection |
| P13 | Open for Sale, 1 completed group | live vs total counts |

## 4. Capability matrix to expect

Source: `lib/access/packages-access.ts` at `421dd0ed`. The plan's §3 table is missing the last two rows.

| Capability | ADMIN | CEO | OPERATIONS | FINANCE | MARKETING | VISA | GUIDE |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| viewModule | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| createPackage / editPackage / publishPackage | ✓ | — | ✓ | — | — | — | — |
| duplicatePackage | ✓ | — | ✓ | — | ✓ | — | — |
| archiveOrRestorePackage | ✓ | — | ✓ | — | — | — | — |
| deletePackage | ✓ | — | — | — | — | — | — |
| toggleFeatured | ✓ | — | ✓ | — | ✓ | — | — |
| exportCatalogue | ✓ | ✓ | ✓ | ✓ | — | ✓ | — |
| createGroupFromPackage | ✓ | — | ✓ | — | — | — | — |
| viewInternalFinance | ✓ | ✓ | — | ✓ | — | — | — |
| **editSensitiveTerms** | ✓ | — | ✓ | — | — | — | — |
| **approvePackageChanges** | ✓ | — | — | — | — | — | — |

MARKETING sees only Open for Sale packages and its own drafts.

## 5. Sessions

How to record a result: **Pass**, **Fail** (add a defect reference), **Blocked** (say why) or **N/A** (superseded, naming the replacing ID).
A Fail on any row raises a defect. Severity follows the readiness plan: **S1** security, data loss or wrong money; **S2** wrong behaviour; **S3** UX.

### S2. ADMIN browser pass (108 tests)

Run first. This is the bulk of the work. Do the read-only list checks first, then the lifecycle actions, then the editor and detail page, then export.

| ID | Test | Do | Expected | Role | Result | Evidence / defect |
| --- | --- | --- | --- | --- | --- | --- |
| PKG-ACC-10 | Invalid id | `/packages/not-a-uuid`, `/packages/<random uuid>` | Both show 404, never a Postgres/error-boundary screen. | ADMIN |  |  |
| PKG-LST-01 | Initial load | Open `/packages` as ADMIN | Header "Packages", subtitle "The commercial catalogue behind every departure group.", breadcrumb Home → Packages. KPI row, view chips, table. Archived packages **not** in table. | ADMIN |  |  |
| PKG-LST-02 | Default state | Observe on load | View = "All Packages", heading shows view name and "N Total", "Sorted by last updated · descending", 10 rows/page. | ADMIN |  |  |
| PKG-LST-04 | Empty catalogue | New agency with no packages | Message "No packages yet. Create your first package template to start selling." KPIs all 0, "0%" occupancy. | ADMIN |  |  |
| PKG-LST-07 | `?create=1` | Open `/packages?create=1` as ADMIN, then as FINANCE | ADMIN: redirects to `/packages/new` (the editor page). FINANCE: 404. **Changed since the plan:** Create now lives on the editor page (/packages/new), not a dialog. | ADMIN |  |  |
| PKG-LST-08 | Data freshness after action | Publish P1, watch table | Row status flips without manual reload (`router.refresh`). | ADMIN |  |  |
| PKG-KPI-01 | Open for sale | — | Count of `Open for Sale` rows in view; caption "of N packages in view" where N = rows in view. | ADMIN |  |  |
| PKG-KPI-02 | Drafts in progress | — | Count of `Draft` rows; caption "Not yet published". | ADMIN |  |  |
| PKG-KPI-03 | Live departure groups | — | Sum of `liveGroupCount`; P5 contributes 2, P11 contributes 0. | ADMIN |  |  |
| PKG-KPI-04 | Seats sold | — | `booked / capacity` across live groups only; caption "X% occupancy across live groups" (rounded; 0% when capacity 0). | ADMIN |  |  |
| PKG-KPI-05 | KPIs follow filters | Apply Journey = Hajj, then search "kandy" | All four cards recompute for the visible set. | ADMIN |  |  |
| PKG-KPI-06 | Cancelled/archived groups excluded from seats | P11 | Contributes 0 seats and 0 live groups. | ADMIN |  |  |
| PKG-VW-01 | All Packages | — | Every non-archived visible package | ADMIN |  |  |
| PKG-VW-02 | Open for Sale | — | `status = Open for Sale` only | ADMIN |  |  |
| PKG-VW-03 | My Drafts | — | `Draft` **and** owner = current user. (If user id unknown: all drafts.) P9 appears for MARKETING, not ADMIN. | ADMIN |  |  |
| PKG-VW-04 | Featured | — | `featured = true` only (P8) | ADMIN |  |  |
| PKG-VW-05 | Needs Attention | — | completeness < 100% **or** (Open for Sale with 0 live groups). P2, P3, P4, P11, P13 appear; P5 does not (if complete). | ADMIN |  |  |
| PKG-SRC-01 | Title match | Type part of a title in lower case | Matching rows only; Total + KPIs update. | ADMIN |  |  |
| PKG-SRC-02 | Code match | Type `ZZTEST-004` | Row P4 only. | ADMIN |  |  |
| PKG-SRC-05 | No match | `zzzzqqq` | Text `No results matching "zzzzqqq"`; clearing restores list. | ADMIN |  |  |
| PKG-SRC-07 | Special characters | `%`, `_`, `"`, `<script>`, `\` | Treated as literal text; no error, no injected markup. | ADMIN |  |  |
| PKG-FLT-01 | Journey | — | Options Umrah, Hajj, Early Registration; selecting filters rows. | ADMIN |  |  |
| PKG-FLT-02 | Category | — | Economy, Standard, Premium, VIP, Custom (matches `package_category`). | ADMIN |  |  |
| PKG-FLT-03 | Status | — | Draft, Open for Sale, Sales Closed only (no Archived option). | ADMIN |  |  |
| PKG-FLT-05 | Multiple filters | — | Journey + Category + Status combine with AND. | ADMIN |  |  |
| PKG-FLT-06 | Clear | — | "Clear" resets all four to ALL and restores rows. | ADMIN |  |  |
| PKG-SRT-01 | Title | — | Asc is case-insensitive A→Z; click again → Z→A; `aria-sort` updates. | ADMIN |  |  |
| PKG-PAG-01 | Default 10/page | — | 25 rows → 3 pages; counter `1–10 of 25`. | ADMIN |  |  |
| PKG-ROW-01 | Row click | — | Navigates to `/packages/<id>` (progress bar shown). | ADMIN |  |  |
| PKG-ROW-02 | `⋯` click does not navigate | — | Opening the menu does **not** trigger row navigation. | ADMIN |  |  |
| PKG-ROW-04 | Menu by status | — | **Draft:** Open, Edit, Duplicate, Publish, Feature, Archive, Delete. **Open for Sale:** + Create Departure Group, Unpublish (no Publish). **Sales Closed:** Reopen for Sale (no Create Group). Each subject to role. | ADMIN, then OPERATIONS in S3 |  |  |
| PKG-ROW-05 | Delete disabled when used | P5 | Item reads `Delete (used by N)` and is disabled. N = **all** groups (live + cancelled + archived), e.g. P11 shows used by 1+. | ADMIN |  |  |
| PKG-LIF-01 | Publish complete draft | Menu → Publish on P1 | Status → Open for Sale, `published_at` set, version row created, activity "publish" logged. Toast "Publish package succeeded". Appears in Departure Groups picker and Leads catalogue. **Changed since the plan:** Publish is rate limited to 30 an hour per person. | ADMIN |  |  |
| PKG-LIF-02 | Publish incomplete draft | Publish P2 | Refused: `Cannot publish — step N (<title>) is incomplete.` Status unchanged. | ADMIN |  |  |
| PKG-LIF-03 | Publish cross-field violation | Draft with nights ≠ days−1, or Makkah+Madinah nights > nights | Refused with the first cross-field message. | ADMIN |  |  |
| PKG-LIF-04 | Publish blank code | P3 | Refused (step 1 incomplete). | ADMIN |  |  |
| PKG-LIF-05 | Unpublish | Menu → Unpublish on P4 | Confirm dialog "Unpublish this package?"; Cancel does nothing; Confirm → Sales Closed; vanishes from picker/Leads; existing groups unaffected. | ADMIN |  |  |
| PKG-LIF-06 | Reopen | P6 → Reopen for Sale | Back to Open for Sale (re-validates completeness; incomplete → refusal). | ADMIN |  |  |
| PKG-LIF-08 | Duplicate | Duplicate P8 | New **Draft** titled `<title> (Copy)`, code `<code>-COPY`, not featured, owner = acting user, no published date/version. Second duplicate → `-COPY-2`, third `-COPY-3`. Original unchanged. **Changed since the plan:** Duplicate is rate limited to 20 an hour per person. Three duplicates are fine; do not loop. | ADMIN |  |  |
| PKG-LIF-10 | Archive, no live groups | P4 → Archive → confirm | Moves to Archived sheet; gone from picker/Leads. | ADMIN |  |  |
| PKG-LIF-11 | Archive with live groups (ADMIN) | P5 → Archive → confirm | Blocked with `LIVE_GROUPS`; "Archive despite live departure groups?" dialog. Force Archive disabled until reason typed. Confirm → archived, reason on Activity tab, groups untouched. **Changed since the plan:** Confirm text now says the groups are untouched and only an administrator can finish (fix 35278c4c). The reason is kept on the Activity tab. | ADMIN |  |  |
| PKG-LIF-14 | Restore | Archived sheet → Restore P7 | Returns to its **previous status** (Open for Sale). Row leaves the sheet and reappears in the table. See O1 re: toast wording. **Changed since the plan:** The toast must read 'with the status it had before it was archived', not 'as a draft' (fix 35278c4c, was O1). P7 must come back Open for Sale. | ADMIN |  |  |
| PKG-LIF-15 | Delete unused | ADMIN deletes P4-like unused package | Confirm "Delete this package?"; row gone permanently; toast "Deleted". **Changed since the plan:** Delete is now a typed-code dialog: it shows what the delete touches, you type the package code and give a reason (max 500 characters). ADMIN only, and only with 0 groups. | ADMIN |  |  |
| PKG-LIF-16 | Delete used | P5 via direct action call | Message names the blocker: "cannot be deleted — 2 departure groups use it. Archive it instead…". No raw FK error. | ADMIN |  |  |
| PKG-LIF-18 | Two-tab conflict | Tab A and B open on P1; A publishes, B archives | B gets an error ("changed elsewhere"/transition not allowed), no silent overwrite. | ADMIN |  |  |
| PKG-LIF-19 | Illegal transitions | Via direct calls: publish Archived; reopen Draft; unpublish Draft; restore Open | Each refused with a readable message; status unchanged. | ADMIN (spot-check one cell as OPERATIONS) |  |  |
| PKG-LIF-21 | Cross-module refresh | After publish/archive, open `/departure-groups` and `/leads` | Picker/catalogue reflect the new status without a manual cache clear. | ADMIN |  |  |
| PKG-EXP-01 | CSV | — | File `packages-<timestamp>.csv`; header: Code, Title, Journey Type, Category, Branch, Status, Visibility, Featured, Duration, Completeness %, Live Groups, Seats Booked, Seats Capacity, Updated. Toast "Export ready — N packages exported to CSV". **Changed since the plan:** Each export is authorised first (authorise_package_export): 10 exports an hour per person, and one row in package_export_logs. Check that the row exists (ADMIN can read it). Pace the export tests. | ADMIN |  |  |
| PKG-EXP-02 | Excel | — | Opens in Excel with sheet "Packages", same columns/rows. **Changed since the plan:** Counts toward the 10-an-hour export limit. | ADMIN |  |  |
| PKG-EXP-03 | Respects filters/sort | Filter to Hajj, sort by title | Only those rows, in that order, across all pages. **Changed since the plan:** Counts toward the 10-an-hour export limit. | ADMIN |  |  |
| PKG-EXP-04 | Nothing to export | Filter to zero rows | Toast "Nothing to export — No packages match the current filters." No file. **Changed since the plan:** No file, and check that no package_export_logs row is written (a row count of 0 is not authorised). | ADMIN |  |  |
| PKG-EXP-05 | Formula injection | Export P12 (`=HYPERLINK…`) to CSV | Cell is prefixed so Excel shows literal text, never executes. XLSX stores as plain text. **Changed since the plan:** Counts toward the 10-an-hour export limit. | ADMIN |  |  |
| PKG-WIZ-01 | Open create | Create Package | Editor page opens on step 1 with **blank** internal code (no hard-coded `RF-PKG-2026-UM01`). | ADMIN |  |  |
| PKG-WIZ-02 | Open edit | Row menu → Edit Details / detail → Edit | Page loads saved values (server-loaded, no skeleton flash); `/packages/<id>?edit=1` redirects to `/packages/<id>/edit` (only with editPackage). | ADMIN |  |  |
| PKG-WIZ-03 | Step 1 required | Leave title/code/overview/capacity/min size empty | Cannot proceed / publish; errors name each field ("Package name is required", "Internal code is required", "Package overview is required", "Planned capacity must be greater than 0", "Minimum group size must be greater than 0", "Days must be at least 1"). | ADMIN |  |  |
| PKG-WIZ-04 | Autosave creates draft | Type a title, wait ~2 s | Sidebar label "Saving…" then "Saved"; a Draft row appears (after refresh) in the list. **Changed since the plan:** SUPERSEDED. Autosave was removed in TASK-043. Run PKG-EDP-09 instead and mark this row N/A. | ADMIN |  |  |
| PKG-WIZ-05 | Duplicate code, inline | Enter a code already used | Message "Another package already uses this code" with one-click `CODE-2` suggestion; accepting fills it. No raw DB text. | ADMIN |  |  |
| PKG-WIZ-06 | Duplicate code, case/space | `zztest-001 ` vs existing `ZZTEST-001` | Treated as duplicate; trailing space is trimmed on save. | ADMIN |  |  |
| PKG-WIZ-08 | Two blank codes | Two drafts with blank code | Both save (blank excluded from uniqueness). Publishing either is refused until a code is set. | ADMIN |  |  |
| PKG-WIZ-09 | Step 2 | Remove all payment milestones; blank cancellation policy | Step invalid: "At least one payment milestone is required", "Cancellation policy is required". No price fields exist (pricing is per departure group). | ADMIN |  |  |
| PKG-WIZ-10 | Milestone rules | Two "Remaining Balance"; percentages > 100; negative amount | Publish blocked with: "Only one payment milestone can be 'Remaining Balance'", "…add up to more than 100%", "…has a negative amount". | ADMIN |  |  |
| PKG-WIZ-11 | Step 3 | Empty itinerary; day number 0 or > days | "At least one itinerary day is required"; "Itinerary day N is outside the package's D-day length". | ADMIN |  |  |
| PKG-WIZ-12 | Days/nights | days 10, nights 5 | "Nights must be exactly one less than Days." Max 365; non-integers rejected. | ADMIN |  |  |
| PKG-WIZ-13 | City nights | Makkah 8 + Madinah 6 on 11 nights | "Makkah + Madinah nights cannot exceed the package's total nights." | ADMIN |  |  |
| PKG-WIZ-14 | Step 4 | Clear services/accommodation/transport/inclusions/exclusions | One message per rule ("At least one service inclusion…", "Makkah accommodation standard is required", etc.). | ADMIN |  |  |
| PKG-WIZ-15 | Step 5 | No document requirements / no seat rule | "At least one document requirement is required", "Seat reservation rule is required". | ADMIN |  |  |
| PKG-WIZ-16 | Step 6 | Capacity 0; empty readiness checklist | "Group capacity must be greater than 0", "At least one group readiness requirement is required". | ADMIN |  |  |
| PKG-WIZ-17 | Capacity ordering | min size 40 > capacity 30; capacity 50 > max pilgrims 45 | Cross-field messages block publish; draft saving still works. | ADMIN |  |  |
| PKG-WIZ-18 | Negative / NaN numbers | Type `-5`, `abc`, `1e9` into number fields | Draft never crashes; negative capacity → readable "…value that is not allowed" naming the field and jumping to its step. | ADMIN |  |  |
| PKG-WIZ-19 | Status field | Look at step 1 | Status is **not** editable; cannot be set to Open for Sale/Archived through autosave. Featured cannot be flipped by autosave either. | ADMIN |  |  |
| PKG-WIZ-20 | Save Draft | Click Save Draft with valid data | Success toast only if save actually succeeded; on failure an error toast with reason. **Changed since the plan:** Save draft is the only save now (no autosave). | ADMIN |  |  |
| PKG-WIZ-21 | Close with unsaved failure | Force a save failure, then close | First close warns; second close leaves. Changes not silently lost. **Changed since the plan:** SUPERSEDED by PKG-EDP-03 and PKG-EDP-05 (leave prompt). Mark N/A. | ADMIN |  |  |
| PKG-WIZ-22 | Close with clean state | Close after "Saved" | Closes immediately; list refreshes with the new draft. **Changed since the plan:** SUPERSEDED by PKG-EDP-02 (Cancel with nothing changed). Mark N/A. | ADMIN |  |  |
| PKG-WIZ-23 | Publish all valid | Complete all steps → Publish | Package becomes Open for Sale; success feedback; list shows it without reload. | ADMIN |  |  |
| PKG-WIZ-24 | Publish after failed save | Make the first autosave fail, click Publish | Publish refused with the save error (never a second insert with null id); jumps to the offending step. **Changed since the plan:** Re-derive: with the Save draft request failing (block it in devtools), Publish must be refused with the save error and no second row. There is no autosave to fail now. | ADMIN |  |  |
| PKG-WIZ-25 | Publish incomplete | Click Publish with step 4 empty | Message "Step 4 (Service Standards) is incomplete."; wizard jumps to step 4. | ADMIN |  |  |
| PKG-WIZ-26 | Publish duplicate code | Race: another user takes the code first | Friendly "package code X is already used…", `step: 1`. | ADMIN |  |  |
| PKG-WIZ-27 | Stale edit | Edit same package in two tabs | Second writer sees "This draft changed in another tab/elsewhere"; no silent overwrite. **Changed since the plan:** Re-derive for Save draft / Save changes: the second writer must get a changed-elsewhere message, with no silent overwrite. | ADMIN |  |  |
| PKG-DET-01 | Header | — | Title (or "Untitled package"), breadcrumb Home → Packages → title, badges (code, journey, status, visibility, Featured if set). | ADMIN |  |  |
| PKG-DET-03 | Tabs | — | Overview, Pricing & Payments, Journey, Services & Accommodation, Traveller Requirements, Group Defaults, Departure Groups, Activity. | ADMIN |  |  |
| PKG-DET-04 | `?tab=` | — | `/packages/<id>?tab=groups` opens that tab; an unknown tab falls back to Overview. | ADMIN |  |  |
| PKG-DET-07 | Pricing tab | — | Shows payment milestones and policies; **no** room prices or internal cost figures. | ADMIN |  |  |
| PKG-DET-09 | Departure Groups tab | — | Lists groups built from this package with status, seats, revenue; filter pills Live / Completed / Cancelled / Archived; each group falls in exactly one bucket (archived wins). Links go to the group. | ADMIN |  |  |
| PKG-DET-10 | Activity tab | — | Publish / unpublish / reopen / archive / restore rows with actor, `before → after`, reason (force-archive); newest first; max 100. | ADMIN |  |  |
| PKG-DET-11 | Header menu by role/status | — | Duplicate, Create Departure Group (Open for Sale only), Feature, Publish/Unpublish/Reopen, Archive/Restore, Delete (disabled `used by N`). Gated like the list. **Changed since the plan:** Also confirm the Delete item is disabled with 'used by N' when groups exist. | ADMIN |  |  |
| PKG-DET-13 | After lifecycle action | — | Action on detail page → badges, menu and Activity update. | ADMIN |  |  |
| PKG-LNK-01 | `/packages/new` | — | Renders the create editor page; 404 without createPackage. `/packages?create=1` redirects here. | ADMIN |  |  |
| PKG-LNK-02 | `/packages/<id>/edit` | — | Renders the edit editor page; 404 without editPackage or if MARKETING can't view it. `/packages/<id>?edit=1` redirects here. | ADMIN |  |  |
| PKG-LNK-04 | Create Departure Group | From an Open for Sale package → `/departure-groups?create=1&template=<id>` | Create sheet opens with that package preselected; an id the role cannot see is ignored. | ADMIN |  |  |
| PKG-LNK-05 | Picker status gating | Departure Groups create sheet | Offers only Open for Sale by default; ADMIN-only "Include drafts" toggle shows drafts with completeness %; Archived/Sales Closed never selectable. | ADMIN |  |  |
| PKG-LNK-09 | Snapshot immutability | Edit/republish a package after a group exists | The group's snapshot (itinerary, policies, duration) does not change. | ADMIN |  |  |
| PKG-SEC-14 | XSS | Title/description `<img src=x onerror=alert(1)>` | Rendered as text on list, detail, export, archived sheet, toasts. | ADMIN |  |  |
| PKG-SEC-15 | Export injection | See PKG-EXP-05 | — | ADMIN (same check as PKG-EXP-05) |  |  |
| PKG-PRF-03 | 600+ packages | — | Usage counts still shown (no silent "0 groups" from URL overflow). **Changed since the plan:** The agency holds at most 500 Drafts and UI creation is limited to 30 an hour. Seed the 600+ rows with SQL as the service role in the test agency, and make most of them Open for Sale. | ADMIN (bulk data seeded first) |  |  |
| PKG-EDP-01 | Page layout | Open `/packages/new` at 320 / 768 / 1024 / 1440 px, light and dark | Horizontal stepper across the top (compact "Step N of 7" bar below 768 px); open step at full width under it; action bar stays at the bottom; nothing clipped; no inner scrollbars. | ADMIN |  |  |
| PKG-EDP-02 | Cancel with nothing changed | Open create, press Cancel | Leaves at once to `/packages`; no prompt. | ADMIN |  |  |
| PKG-EDP-03 | Cancel with edits | Type a title, press Cancel | Prompt "You have unsaved changes" with Keep editing / Discard changes / Save draft and leave. | ADMIN |  |  |
| PKG-EDP-04 | Prompt dismissal | With the prompt open, press Esc, then click outside | Both mean Keep editing; the form is unchanged. | ADMIN |  |  |
| PKG-EDP-05 | Link click while dirty | Edit a field, click a sidebar link or the Packages breadcrumb | Prompt appears; Discard continues to the clicked page; Save draft and leave saves, then continues there. | ADMIN |  |  |
| PKG-EDP-07 | Back button while dirty | Edit a field, press the browser Back | Prompt appears and the address bar still shows the editor URL; Keep editing stays; Discard goes back one page. | ADMIN |  |  |
| PKG-EDP-09 | First draft save | In create, fill step 1, Save draft, then refresh | URL became `/packages/<id>/edit`; refresh reopens that draft; the Packages list shows one new draft, not two. | ADMIN |  |  |
| PKG-EDP-10 | Change review sheet | Edit a price on an Open for Sale package, Save changes | A right-side sheet lists before/after, needs a reason, and does not stack on another modal; Keep editing closes it. **Changed since the plan:** On a package on sale, a payment/terms change is Tier 1 and a seat/booking change is Tier 2: check both. Whether it needs a second person's approval is the agency setting in Settings > Operations. Run once with approval ON (a change request appears, the package is unchanged until an ADMIN approves, and you cannot approve your own) and once OFF (it applies). | ADMIN |  |  |
| PKG-EDP-11 | Publish | Complete all steps, Publish | Lands on the package detail page; one navigation, no flash of the list. | ADMIN |  |  |
| PKG-EDP-13 | Stepper | Click a finished step, then a locked one | Finished step opens; locked step shows a lock and a tooltip and does not open; Continue is disabled while the step has problems and names the first one. | ADMIN |  |  |
| PKG-EDP-14 | Step change | Press Continue on a tall step | The next step appears at full width; the page returns to its top; focus is on the step heading. | ADMIN |  |  |
| PKG-EDP-15 | Last step | Reach step 7 on a draft; then on a package on sale | Draft: Publish package. On sale: Save changes only (no duplicate Save button). | ADMIN |  |  |
| PKG-EDP-16 | Continue on an incomplete step | Leave a required field empty on step 1, press Continue | Continue is not disabled; the step shows each field message, scrolls to the first problem and focuses it if it is a field; the step does not change. | ADMIN |  |  |
| PKG-EDP-17 | Publish with an earlier step incomplete | In edit mode, clear a required field on step 2, go to step 7, press Publish | Nothing is sent; the page opens step 2 with its messages showing and scrolls to the first one. | ADMIN |  |  |

### S3. OPERATIONS (3 tests)

Sign in as OPERATIONS. Also repeat PKG-ROW-04 here with the OPERATIONS menu.

| ID | Test | Do | Expected | Role | Result | Evidence / defect |
| --- | --- | --- | --- | --- | --- | --- |
| PKG-LIF-12 | Archive with live groups (OPERATIONS) | Same | Dialog opens, but server refuses: "Only an administrator can archive…". Package unchanged. **Changed since the plan:** Confirm text now tells OPERATIONS up front that only an administrator can finish (fix 35278c4c). The refusal after the reason box is still expected. Record whether the wording is clear enough. | OPERATIONS |  |  |
| PKG-LIF-17 | Delete not ADMIN | OPERATIONS | No Delete item; direct call refused. | OPERATIONS |  |  |
| PKG-LNK-06 | Server re-check | OPERATIONS posts group creation with a Draft/Sales Closed/Archived package id | Rejected server-side. | OPERATIONS |  |  |

### S4. MARKETING (5 tests)

Sign in as MARKETING. Its own draft is P9; P10 belongs to OPERATIONS and must stay invisible.

| ID | Test | Do | Expected | Role | Result | Evidence / defect |
| --- | --- | --- | --- | --- | --- | --- |
| PKG-ACC-04 | MARKETING row scope | Sign in as MARKETING | Sees only Open for Sale packages (P4, P5, P8, P11, P13) plus its own draft (P9). P1, P2, P3, P6, P10 are hidden. | MARKETING |  |  |
| PKG-ACC-05 | MARKETING direct URL | MARKETING opens `/packages/<P10 id>` | 404. | MARKETING |  |  |
| PKG-ACC-06 | MARKETING action on foreign row | Call publish/feature/archive for P10 (via devtools/server action) | `{ok:false}` "You do not have permission to do that." No change. | MARKETING |  |  |
| PKG-SRC-08 | Search cannot see hidden rows | MARKETING searches P10's title | No result (server already removed it). | MARKETING |  |  |
| PKG-EXP-08 | Role gate | — | MARKETING/GUIDE cannot see Export. | MARKETING (GUIDE cannot reach the page) |  |  |

### S5. FINANCE, CEO, VISA and GUIDE (6 tests)

Read-only roles. Run each row once per listed role and write the role in the evidence column.

| ID | Test | Do | Expected | Role | Result | Evidence / defect |
| --- | --- | --- | --- | --- | --- | --- |
| PKG-ACC-01 | GUIDE blocked | Sign in as GUIDE, open `/packages` | 404 page. No Packages link usable. | GUIDE |  |  |
| PKG-ACC-02 | Each role's header buttons | Open `/packages` per role | "Create Package" only for ADMIN/OPERATIONS. Export submenu only for ADMIN/CEO/OPERATIONS/FINANCE/VISA. "View Archived Packages" always shown. | CEO, FINANCE, VISA (ADMIN in S2, OPERATIONS in S3, MARKETING in S4) |  |  |
| PKG-ACC-03 | Row menu per role | Open `⋯` on P4 per role | Items match section 3 and package status (see suite I). CEO/FINANCE/VISA see only "Open Package". | CEO, FINANCE, VISA (ADMIN in S2, OPERATIONS in S3, MARKETING in S4) |  |  |
| PKG-ACC-07 | Capability enforced server-side | As FINANCE, call `archivePackageAction` / `deletePackageAction` directly | Refused with permission error; hiding the button is not the only gate. | FINANCE (repeat once as CEO) |  |  |
| PKG-ARC-05 | Restore visibility | — | Restore button only for roles with archive/restore. | MARKETING, FINANCE, CEO, VISA must not see Restore (ADMIN does) |  |  |
| PKG-WIZ-31 | Edit as FINANCE/CEO/VISA | Visit `/packages/<id>/edit` | 404 (needs editPackage). Detail page has no Edit button. | FINANCE, CEO, VISA, MARKETING |  |  |

### S6. Signed out and other agency (2 tests)

Needs a second agency (LR2 Fixture Agency A / B) and a browser with no session.

| ID | Test | Do | Expected | Role | Result | Evidence / defect |
| --- | --- | --- | --- | --- | --- | --- |
| PKG-ACC-09 | Signed-out | Open `/packages` logged out | Redirect to login; actions return unauthenticated error. | Signed out |  |  |
| PKG-ACC-11 | Other agency package | In agency A, open `/packages/<agency B package id>` | 404; row not in any list. | ADMIN of agency A, package from agency B |  |  |

### S7. Database and security (12 tests)

REST or SQL checks. CI database-tests already runs the pgTAP file for most of these and is green on 421dd0ed; this session proves it against staging with real role tokens, inside rolled-back transactions or the test agency.

| ID | Test | Do | Expected | Role | Result | Evidence / defect |
| --- | --- | --- | --- | --- | --- | --- |
| PKG-SEC-01 | Cross-agency insert | ADMIN inserts a package with another agency's `agency_id` via REST | Blocked (42501). | REST / SQL, per role |  |  |
| PKG-SEC-02 | Cross-agency update/move | Update `agency_id` | Blocked. | REST / SQL, per role |  |  |
| PKG-SEC-03 | Cross-agency read | Agency A queries agency B's packages | 0 rows. | REST / SQL, per role |  |  |
| PKG-SEC-04 | Role write policies | CEO/FINANCE/VISA/GUIDE direct insert/update/delete via REST | Blocked; GUIDE cannot read. | REST / SQL, per role |  |  |
| PKG-SEC-05 | MARKETING scope trigger | MARKETING updates `status`, `published_at`, `archived_at` | Readable error from trigger; only own drafts and `featured` allowed. | REST / SQL, per role |  |  |
| PKG-SEC-06 | Status only via RPC | Direct `update packages set status=…` | Refused; only the five lifecycle RPCs change status. | REST / SQL, per role |  |  |
| PKG-SEC-07 | `archived_at ⇔ Archived` | Attempt inconsistent combination | CHECK constraint rejects. | REST / SQL, per role |  |  |
| PKG-SEC-08 | Unique code | pgTAP: same code/same agency (reject), case variant (reject), other agency (allow), 2 blanks (allow) | As listed. **Changed since the plan:** Covered by CI database-tests (green on 421dd0ed). Re-run only if a migration changed since. | REST / SQL, per role |  |  |
| PKG-SEC-09 | Check constraints | Out-of-range days, nights, capacities, guide ratio, bad enum values | Each rejected by DB; app shows a mapped message. | REST / SQL, per role |  |  |
| PKG-SEC-10 | FK protection | Delete a package referenced by a group/snapshot | 23503 → "Another record still refers to this package…". | REST / SQL, per role |  |  |
| PKG-SEC-11 | Error translation | Trigger 23505, 23514, 23502, 23503, 42501, unknown error | User sees only translated text; unknown errors show the generic line and are logged server-side. | REST / SQL, per role |  |  |
| PKG-SEC-17 | Real agency untouched | Compare snapshot from section 2 | Byte-identical. | REST / SQL, per role |  |  |

## 6. PKG-SEC-17 — real agency untouched

Fingerprint the real agency before S2 and again after cleanup. The three printed lines must be identical. It is read only.

```bash
npx tsx scripts/e2e/cleanup-packages-p0-fixtures.ts --snapshot <Royal Al-Fathima Travels agency id>
```

Take the agency id from the environment table in [TASK-041](../tasks/TASK-041-packages-db-error-remediation.md) and check it against `agencies` before relying on it.

## 7. Exit criteria

From the test plan §10. The module ships when **all** of these hold:

- [ ] Every one of the 136 rows above is Pass or N/A (each N/A names its replacement). No Blocked rows.
- [ ] No open S1 or S2 defect. Every S3 has a ticket and an owner.
- [ ] No raw database text was visible to any user in any test.
- [ ] PKG-SEC-17 fingerprints are identical before and after (no change to the real agency).
- [ ] The test plan's observations O3–O10 are each marked fixed, accepted or ticketed. O1 and O2 were fixed in `35278c4c`; confirm that in PKG-LIF-11, 12 and 14.
- [ ] Cleanup has run (`cleanup-packages-p0-fixtures.ts --execute`) and reports 0 packages left in the test agency.

## 8. Results

| Run date | Tester | Build / commit | Env | P0 pass / 136 | N/A | Fail | Blocked | Defects raised | Sign-off |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  | `421dd0ed` | staging / test agency |  |  |  |  |  |  |

### Defects

| Ref | Test ID | Severity (S1/S2/S3) | What happened | Owner | Status |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

## 9. If it fails: rollback

| Layer | Rollback | Caveat |
| --- | --- | --- |
| App (Next.js) | Vercel instant rollback to the previous production deployment | None |
| Dependency bump | Revert `7c7e5155` | Re-opens the Next 16.3.6 advisories |
| Migrations | Forward-fix only | `20261008090000_packages_drop_deprecated_columns.sql` was written to drop about 40 columns permanently. Staging's `packages` table still lists some of them (for example `airline`, `flight_routes`), so confirm what the migration really did before relying on this row. |
