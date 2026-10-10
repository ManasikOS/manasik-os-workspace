# Packages Screen — Test Plan

Manual + automated verification plan for the **Packages** module: the list
(`/packages`), the detail page (`/packages/[packageId]`), the create/edit
dialog, the lifecycle actions, and their hooks into Departure Groups and Leads.

Derived from the code as of branch `UI-update` (2026-10-08). Where a result is
inferred from code rather than seen running, it is marked **(verify)**.

Related: [`TASK-041`](../tasks/TASK-041-packages-db-error-remediation.md) ·
[`packages-production-readiness-plan.md`](../modules/packages-production-readiness-plan.md) ·
[`packages-module-implementation-plan.md`](../modules/packages-module-implementation-plan.md)

---

## 1. Scope

| Surface | Route / file | In scope |
| --- | --- | --- |
| List | `/packages` — `components/packages-list.tsx` | KPIs, saved views, search, filters, sort, paging, export, row + context menus |
| Detail | `/packages/[packageId]` | 8 tabs, header actions, badges, facts strip |
| Create / Edit editor page | `/packages/new`, `/packages/[packageId]/edit` — `components/package-editor/` | 7 steps + review, save draft, change review sheet, unsaved-changes prompt, publish (TASK-044) |
| Lifecycle | `use-package-lifecycle.ts`, `actions.ts` | publish, unpublish, reopen, feature, duplicate, archive (+force), restore, delete |
| Archived sheet | `components/archived-packages-sheet.tsx` | list, open, restore |
| Deep links | `/packages/new`, `/packages/[id]/edit`, `/packages/create-package?id=` | redirects |
| Cross-module | Departure Groups picker + `?create=1&template=`, Leads catalogue | status gating, revalidation |
| Data / security | RLS policies, lifecycle RPCs, `package_usage`, tenant isolation | pgTAP + role checks |

Out of scope: Departure Group internals, Leads quoting maths, production DB.

## 2. Environment and safety rules (read first)

From TASK-041: there is **no local database**. `localhost` talks to the
**staging** Supabase project (`klognjpwmqwlgeibvanf`).

1. Confirm `.env.local` points at staging, not production, before the first write.
2. Run every write test inside the disposable agency `E2E-packages-20261008`
   (`is_test = true`). **Never** create/edit/delete in `Royal Al-Fathima Travels`.
3. Prefix every test package code with `ZZTEST-` so cleanup is one `where` clause.
4. Snapshot the real agency's package rows (id, code, status, `updated_at`)
   before and after; they must be identical.
5. Run the cleanup script at the end of every session.
6. **Blocker:** no test staff accounts exist yet, and staging has no
   MARKETING / FINANCE / VISA / GUIDE users. Create ADMIN, OPERATIONS,
   MARKETING, FINANCE, CEO, VISA, GUIDE users inside the test agency first.
   Use `LR2 Fixture Agency A/B` only as the "other agency" for isolation tests.

## 3. Roles and expected capabilities

Source: `lib/access/packages-access.ts`. A custom role's overrides
(`role_permissions`) are merged on top — see PKG-ACC-08.

| Capability | ADMIN | CEO | OPERATIONS | FINANCE | MARKETING | VISA | GUIDE |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| viewModule | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| createPackage | ✓ | — | ✓ | — | — | — | — |
| editPackage | ✓ | — | ✓ | — | — | — | — |
| publishPackage | ✓ | — | ✓ | — | — | — | — |
| duplicatePackage | ✓ | — | ✓ | — | ✓ | — | — |
| archiveOrRestorePackage | ✓ | — | ✓ | — | — | — | — |
| deletePackage | ✓ | — | — | — | — | — | — |
| toggleFeatured | ✓ | — | ✓ | — | ✓ | — | — |
| exportCatalogue | ✓ | ✓ | ✓ | ✓ | — | ✓ | — |
| createGroupFromPackage | ✓ | — | ✓ | — | — | — | — |
| viewInternalFinance | ✓ | ✓ | — | ✓ | — | — | — |

Row visibility: MARKETING sees only `Open for Sale` packages **or packages it
owns**. Everyone else (except GUIDE) sees all.

## 4. Test data set

Create these in the test agency (all codes `ZZTEST-…`).

| ID | Description | Purpose |
| --- | --- | --- |
| P1 | Draft, all 6 steps complete (100%), owner = OPERATIONS user | publish from menu, My Drafts |
| P2 | Draft, only step 1 complete (~17%) | Needs Attention, publish refusal |
| P3 | Draft with blank code and blank title | `Untitled package` / id-prefix fallback |
| P4 | Open for Sale, complete, **0** groups | Needs Attention, delete allowed |
| P5 | Open for Sale, **2 live** groups with seats booked/capacity | KPIs, archive guard, delete blocked |
| P6 | Sales Closed | reopen |
| P7 | Archived (previously Open for Sale) | archived sheet, restore target |
| P8 | Open for Sale, featured, Hajj, Premium, branch "Kandy" | filters, featured view |
| P9 | Draft owned by MARKETING user | marketing visibility |
| P10 | Draft owned by OPERATIONS user | hidden from MARKETING |
| P11 | Open for Sale, only cancelled/archived groups | delete blocked, archive allowed |
| P12 | Title `=HYPERLINK("http://x","y")`; second with 200-char title; third with Arabic + emoji | export injection, truncation |
| P13 | Open for Sale, 1 completed group | live vs total counts |
| Bulk | 250 generated packages | performance, paging |

---

## 5. Test suites

Priority: **P0** must pass to ship · **P1** should pass · **P2** nice to have.

### A. Access and routing

| ID | Test | Steps | Expected | Pri |
| --- | --- | --- | --- | --- |
| PKG-ACC-01 | GUIDE blocked | Sign in as GUIDE, open `/packages` | 404 page. No Packages link usable. | P0 |
| PKG-ACC-02 | Each role's header buttons | Open `/packages` per role | "Create Package" only for ADMIN/OPERATIONS. Export submenu only for ADMIN/CEO/OPERATIONS/FINANCE/VISA. "View Archived Packages" always shown. | P0 |
| PKG-ACC-03 | Row menu per role | Open `⋯` on P4 per role | Items match section 3 and package status (see suite I). CEO/FINANCE/VISA see only "Open Package". | P0 |
| PKG-ACC-04 | MARKETING row scope | Sign in as MARKETING | Sees only Open for Sale packages (P4, P5, P8, P11, P13) plus its own draft (P9). P1, P2, P3, P6, P10 are hidden. | P0 |
| PKG-ACC-05 | MARKETING direct URL | MARKETING opens `/packages/<P10 id>` | 404. | P0 |
| PKG-ACC-06 | MARKETING action on foreign row | Call publish/feature/archive for P10 (via devtools/server action) | `{ok:false}` "You do not have permission to do that." No change. | P0 |
| PKG-ACC-07 | Capability enforced server-side | As FINANCE, call `archivePackageAction` / `deletePackageAction` directly | Refused with permission error; hiding the button is not the only gate. | P0 |
| PKG-ACC-08 | Custom role override | Management → Roles: grant a custom role `exportCatalogue`, revoke `createPackage` | Export appears, Create hidden, immediately after reload. | P1 |
| PKG-ACC-09 | Signed-out | Open `/packages` logged out | Redirect to login; actions return unauthenticated error. | P0 |
| PKG-ACC-10 | Invalid id | `/packages/not-a-uuid`, `/packages/<random uuid>` | Both show 404, never a Postgres/error-boundary screen. | P0 |
| PKG-ACC-11 | Other agency package | In agency A, open `/packages/<agency B package id>` | 404; row not in any list. | P0 |

### B. List page — load, header, empty/loading/error

| ID | Test | Steps | Expected | Pri |
| --- | --- | --- | --- | --- |
| PKG-LST-01 | Initial load | Open `/packages` as ADMIN | Header "Packages", subtitle "The commercial catalogue behind every departure group.", breadcrumb Home → Packages. KPI row, view chips, table. Archived packages **not** in table. | P0 |
| PKG-LST-02 | Default state | Observe on load | View = "All Packages", heading shows view name and "N Total", "Sorted by last updated · descending", 10 rows/page. | P0 |
| PKG-LST-03 | Blank-field fallbacks | Look at P3 | Title "Untitled package"; code = first 8 chars of id (upper-case). | P1 |
| PKG-LST-04 | Empty catalogue | New agency with no packages | Message "No packages yet. Create your first package template to start selling." KPIs all 0, "0%" occupancy. | P0 |
| PKG-LST-05 | Loading state | Throttle network, reload | `loading.tsx` skeleton, no blank screen. | P1 |
| PKG-LST-06 | Error state | Break `list_packages_with_usage` (rename in rolled-back env or block RPC) | `error.tsx` boundary with retry; no raw stack. | P1 |
| PKG-LST-07 | `?create=1` | Open `/packages?create=1` as ADMIN, then as FINANCE | ADMIN: redirects to `/packages/new` (the editor page). FINANCE: 404. | P0 |
| PKG-LST-08 | Data freshness after action | Publish P1, watch table | Row status flips without manual reload (`router.refresh`). | P0 |

### C. KPI cards

KPIs are computed from the **filtered** set (saved view + search + filters), archived excluded.

| ID | Test | Expected | Pri |
| --- | --- | --- | --- |
| PKG-KPI-01 | Open for sale | Count of `Open for Sale` rows in view; caption "of N packages in view" where N = rows in view. | P0 |
| PKG-KPI-02 | Drafts in progress | Count of `Draft` rows; caption "Not yet published". | P0 |
| PKG-KPI-03 | Live departure groups | Sum of `liveGroupCount`; P5 contributes 2, P11 contributes 0. | P0 |
| PKG-KPI-04 | Seats sold | `booked / capacity` across live groups only; caption "X% occupancy across live groups" (rounded; 0% when capacity 0). | P0 |
| PKG-KPI-05 | KPIs follow filters | Apply Journey = Hajj, then search "kandy" | All four cards recompute for the visible set. | P0 |
| PKG-KPI-06 | Cancelled/archived groups excluded from seats | P11 | Contributes 0 seats and 0 live groups. | P0 |
| PKG-KPI-07 | After archive | Archive P4 | Open-for-sale KPI drops by 1; Archived sheet count rises by 1. | P1 |

### D. Saved views

| ID | View | Expected membership | Pri |
| --- | --- | --- | --- |
| PKG-VW-01 | All Packages | Every non-archived visible package | P0 |
| PKG-VW-02 | Open for Sale | `status = Open for Sale` only | P0 |
| PKG-VW-03 | My Drafts | `Draft` **and** owner = current user. (If user id unknown: all drafts.) P9 appears for MARKETING, not ADMIN. | P0 |
| PKG-VW-04 | Featured | `featured = true` only (P8) | P0 |
| PKG-VW-05 | Needs Attention | completeness < 100% **or** (Open for Sale with 0 live groups). P2, P3, P4, P11, P13 appear; P5 does not (if complete). | P0 |
| PKG-VW-06 | No Archived/Selling Now chip | Only the 5 chips above exist | P2 |
| PKG-VW-07 | View switch resets page | Go to page 2, switch view | Back on page 1; heading and Total update. | P1 |
| PKG-VW-08 | View + filter combine | "Open for Sale" + Status filter "Draft" | Empty-state message `No results found.` (intersection is empty) — no crash. | P1 |

### E. Search

Searches title, code, branch and package category; case-insensitive; whitespace-trimmed. Placeholder: "Search title, code...".

| ID | Test | Expected | Pri |
| --- | --- | --- | --- |
| PKG-SRC-01 | Title match | Type part of a title in lower case | Matching rows only; Total + KPIs update. | P0 |
| PKG-SRC-02 | Code match | Type `ZZTEST-004` | Row P4 only. | P0 |
| PKG-SRC-03 | Branch / category match | "Kandy", "Premium" | Matching rows. | P1 |
| PKG-SRC-04 | Leading/trailing spaces | `"  hajj  "` | Same as `hajj`. | P1 |
| PKG-SRC-05 | No match | `zzzzqqq` | Text `No results matching "zzzzqqq"`; clearing restores list. | P0 |
| PKG-SRC-06 | Resets to page 1 | Page 3, then search | Page 1 of results. | P1 |
| PKG-SRC-07 | Special characters | `%`, `_`, `"`, `<script>`, `\` | Treated as literal text; no error, no injected markup. | P0 |
| PKG-SRC-08 | Search cannot see hidden rows | MARKETING searches P10's title | No result (server already removed it). | P0 |

### F. Filters (Journey, Category, Status, Branch)

| ID | Test | Expected | Pri |
| --- | --- | --- | --- |
| PKG-FLT-01 | Journey | Options Umrah, Hajj, Early Registration; selecting filters rows. | P0 |
| PKG-FLT-02 | Category | Economy, Standard, Premium, VIP, Custom (matches `package_category`). | P0 |
| PKG-FLT-03 | Status | Draft, Open for Sale, Sales Closed only (no Archived option). | P0 |
| PKG-FLT-04 | Branch options | Derived from data actually present; a branch with no packages never appears. | P1 |
| PKG-FLT-05 | Multiple filters | Journey + Category + Status combine with AND. | P0 |
| PKG-FLT-06 | Clear | "Clear" resets all four to ALL and restores rows. | P0 |
| PKG-FLT-07 | Filters + saved view + search | All three together | Correct intersection; Total and KPIs agree with visible rows. | P1 |
| PKG-FLT-08 | Page clamp | On page 3, apply a filter leaving 1 page | Lands on last valid page, never a blank page. | P1 |

### G. Sorting

Sortable columns: Package (title), Duration, Status, Groups (live count), Completeness. Default `updatedAt desc`, ties broken by title A→Z.

| ID | Test | Expected | Pri |
| --- | --- | --- | --- |
| PKG-SRT-01 | Title | Asc is case-insensitive A→Z; click again → Z→A; `aria-sort` updates. | P0 |
| PKG-SRT-02 | Duration | Sorted by `days`; first click ascending. | P1 |
| PKG-SRT-03 | Groups | Sorted by **live** groups; first click descending. | P1 |
| PKG-SRT-04 | Completeness | First click ascending (least complete first). | P1 |
| PKG-SRT-05 | Status | Alphabetical: Draft < Open for Sale < Sales Closed. | P2 |
| PKG-SRT-06 | Tiebreak | Equal primary keys | Ordered by title. | P1 |
| PKG-SRT-07 | "Sorted by" label | Updates ("Title · ascending"). | P1 |
| PKG-SRT-08 | Sort resets page | Page 2 → change sort | Page 1. | P1 |
| PKG-SRT-09 | Return to default | After sorting by title, try to get back to "Last updated" | **Observe**: there is no Updated column header (see section 8, O3). | P2 |

### H. Pagination

| ID | Test | Expected | Pri |
| --- | --- | --- | --- |
| PKG-PAG-01 | Default 10/page | 25 rows → 3 pages; counter `1–10 of 25`. | P0 |
| PKG-PAG-02 | Rows-per-page | Changing size returns to page 1; counter correct. | P1 |
| PKG-PAG-03 | Boundaries | First/Prev disabled on page 1; Next/Last disabled on last page. | P1 |
| PKG-PAG-04 | Exactly N rows | 10 rows → 1 page. 11 → 2 pages. | P2 |
| PKG-PAG-05 | 250-row catalogue | Pages render without lag; counter `1–10 of 250`. | P1 |

### I. Row interactions and menus

| ID | Test | Expected | Pri |
| --- | --- | --- | --- |
| PKG-ROW-01 | Row click | Navigates to `/packages/<id>` (progress bar shown). | P0 |
| PKG-ROW-02 | `⋯` click does not navigate | Opening the menu does **not** trigger row navigation. | P0 |
| PKG-ROW-03 | Right-click | Context menu shows the same items as `⋯` with the code as label. | P1 |
| PKG-ROW-04 | Menu by status | **Draft:** Open, Edit, Duplicate, Publish, Feature, Archive, Delete. **Open for Sale:** + Create Departure Group, Unpublish (no Publish). **Sales Closed:** Reopen for Sale (no Create Group). Each subject to role. | P0 |
| PKG-ROW-05 | Delete disabled when used | P5 | Item reads `Delete (used by N)` and is disabled. N = **all** groups (live + cancelled + archived), e.g. P11 shows used by 1+. | P0 |
| PKG-ROW-06 | Keyboard | Tab to `⋯`, Enter opens menu, arrows move, Esc closes, focus returns. | P1 |
| PKG-ROW-07 | Featured star | P8 shows star beside title. | P2 |
| PKG-ROW-08 | Columns | Journey badge colours (Umrah info, Hajj brand, Early Reg neutral); Duration `12D / 11N` + `n itinerary days` (singular for 1); Status badge + visibility badge; Groups `n live · booked/cap seats` + bar; Completeness `%` + bar. | P1 |

### J. Lifecycle actions

Toast format: success `"<Action> succeeded"`, failure `"Could not <action>"` + reason. All use `router.refresh()`.

| ID | Test | Steps | Expected | Pri |
| --- | --- | --- | --- | --- |
| PKG-LIF-01 | Publish complete draft | Menu → Publish on P1 | Status → Open for Sale, `published_at` set, version row created, activity "publish" logged. Toast "Publish package succeeded". Appears in Departure Groups picker and Leads catalogue. | P0 |
| PKG-LIF-02 | Publish incomplete draft | Publish P2 | Refused: `Cannot publish — step N (<title>) is incomplete.` Status unchanged. | P0 |
| PKG-LIF-03 | Publish cross-field violation | Draft with nights ≠ days−1, or Makkah+Madinah nights > nights | Refused with the first cross-field message. | P0 |
| PKG-LIF-04 | Publish blank code | P3 | Refused (step 1 incomplete). | P0 |
| PKG-LIF-05 | Unpublish | Menu → Unpublish on P4 | Confirm dialog "Unpublish this package?"; Cancel does nothing; Confirm → Sales Closed; vanishes from picker/Leads; existing groups unaffected. | P0 |
| PKG-LIF-06 | Reopen | P6 → Reopen for Sale | Back to Open for Sale (re-validates completeness; incomplete → refusal). | P0 |
| PKG-LIF-07 | Feature / Unfeature | Toggle on P4 | Star appears/disappears, Featured view updates. MARKETING allowed on visible rows only. | P1 |
| PKG-LIF-08 | Duplicate | Duplicate P8 | New **Draft** titled `<title> (Copy)`, code `<code>-COPY`, not featured, owner = acting user, no published date/version. Second duplicate → `-COPY-2`, third `-COPY-3`. Original unchanged. | P0 |
| PKG-LIF-09 | Duplicate archived | Duplicate P7 via detail page | Copy is Draft, `archived_at` empty, no constraint error. | P1 |
| PKG-LIF-10 | Archive, no live groups | P4 → Archive → confirm | Moves to Archived sheet; gone from picker/Leads. | P0 |
| PKG-LIF-11 | Archive with live groups (ADMIN) | P5 → Archive → confirm | Blocked with `LIVE_GROUPS`; "Archive despite live departure groups?" dialog. Force Archive disabled until reason typed. Confirm → archived, reason on Activity tab, groups untouched. | P0 |
| PKG-LIF-12 | Archive with live groups (OPERATIONS) | Same | Dialog opens, but server refuses: "Only an administrator can archive…". Package unchanged. | P0 |
| PKG-LIF-13 | Archive with only cancelled/archived groups | P11 | Allowed without force. | P1 |
| PKG-LIF-14 | Restore | Archived sheet → Restore P7 | Returns to its **previous status** (Open for Sale). Row leaves the sheet and reappears in the table. See O1 re: toast wording. | P0 |
| PKG-LIF-15 | Delete unused | ADMIN deletes P4-like unused package | Confirm "Delete this package?"; row gone permanently; toast "Deleted". | P0 |
| PKG-LIF-16 | Delete used | P5 via direct action call | Message names the blocker: "cannot be deleted — 2 departure groups use it. Archive it instead…". No raw FK error. | P0 |
| PKG-LIF-17 | Delete not ADMIN | OPERATIONS | No Delete item; direct call refused. | P0 |
| PKG-LIF-18 | Two-tab conflict | Tab A and B open on P1; A publishes, B archives | B gets an error ("changed elsewhere"/transition not allowed), no silent overwrite. | P0 |
| PKG-LIF-19 | Illegal transitions | Via direct calls: publish Archived; reopen Draft; unpublish Draft; restore Open | Each refused with a readable message; status unchanged. | P0 |
| PKG-LIF-20 | Double click | Double-click Publish quickly | One version row, one activity row. | P1 |
| PKG-LIF-21 | Cross-module refresh | After publish/archive, open `/departure-groups` and `/leads` | Picker/catalogue reflect the new status without a manual cache clear. | P0 |

### K. Archived packages sheet

| ID | Test | Expected | Pri |
| --- | --- | --- | --- |
| PKG-ARC-01 | Open | "View Archived Packages" shows the sheet; count pill shows number when > 0. | P1 |
| PKG-ARC-02 | Empty | "No archived packages" with helper text. | P2 |
| PKG-ARC-03 | Card content | Title, code badge, journey badge, status badge. | P2 |
| PKG-ARC-04 | Open | "Open" navigates to the detail page; archived detail page loads. | P1 |
| PKG-ARC-05 | Restore visibility | Restore button only for roles with archive/restore. | P0 |
| PKG-ARC-06 | Restore spinner | Button shows spinner and disables only for the row being restored. | P2 |
| PKG-ARC-07 | Last item restored | Sheet closes when the final archived package is restored. | P2 |

### L. Export

Exports the **current view** (saved view + search + filters + sort), **all pages**, not only the visible page.

| ID | Test | Expected | Pri |
| --- | --- | --- | --- |
| PKG-EXP-01 | CSV | File `packages-<timestamp>.csv`; header: Code, Title, Journey Type, Category, Branch, Status, Visibility, Featured, Duration, Completeness %, Live Groups, Seats Booked, Seats Capacity, Updated. Toast "Export ready — N packages exported to CSV". | P0 |
| PKG-EXP-02 | Excel | Opens in Excel with sheet "Packages", same columns/rows. | P0 |
| PKG-EXP-03 | Respects filters/sort | Filter to Hajj, sort by title | Only those rows, in that order, across all pages. | P0 |
| PKG-EXP-04 | Nothing to export | Filter to zero rows | Toast "Nothing to export — No packages match the current filters." No file. | P0 |
| PKG-EXP-05 | Formula injection | Export P12 (`=HYPERLINK…`) to CSV | Cell is prefixed so Excel shows literal text, never executes. XLSX stores as plain text. | P0 |
| PKG-EXP-06 | Encoding | Arabic/emoji/commas/quotes in title | Round-trips intact (UTF-8 BOM, quotes doubled). | P1 |
| PKG-EXP-07 | No archived rows | Export contains no archived packages. | P1 |
| PKG-EXP-08 | Role gate | MARKETING/GUIDE cannot see Export. | P0 |
| PKG-EXP-09 | Values | Featured "Yes/No"; Updated is ISO-8601; counts match the table. | P1 |

### M. Create / Edit editor page (wizard)

> Create and Edit are a full page since TASK-044 (they were a dialog). Rows below that mention "dialog" mean the editor page.
> Rows that describe autosave (PKG-WIZ-04, 20, 21, 22, 24, 27, 28, 29) predate TASK-043, which removed autosave: nothing saves until
> Save draft / Save changes / Publish. Re-derive their expected results from the TASK-043 behaviour before running them.

Steps: 1 Commercial Identity · 2 Pricing · 3 Journey · 4 Services · 5 Requirements · 6 Group Defaults · 7 Review & Publish.

| ID | Test | Steps | Expected | Pri |
| --- | --- | --- | --- | --- |
| PKG-WIZ-01 | Open create | Create Package | Editor page opens on step 1 with **blank** internal code (no hard-coded `RF-PKG-2026-UM01`). | P0 |
| PKG-WIZ-02 | Open edit | Row menu → Edit Details / detail → Edit | Page loads saved values (server-loaded, no skeleton flash); `/packages/<id>?edit=1` redirects to `/packages/<id>/edit` (only with editPackage). | P0 |
| PKG-WIZ-03 | Step 1 required | Leave title/code/overview/capacity/min size empty | Cannot proceed / publish; errors name each field ("Package name is required", "Internal code is required", "Package overview is required", "Planned capacity must be greater than 0", "Minimum group size must be greater than 0", "Days must be at least 1"). | P0 |
| PKG-WIZ-04 | Autosave creates draft | Type a title, wait ~2 s | Sidebar label "Saving…" then "Saved"; a Draft row appears (after refresh) in the list. | P0 |
| PKG-WIZ-05 | Duplicate code, inline | Enter a code already used | Message "Another package already uses this code" with one-click `CODE-2` suggestion; accepting fills it. No raw DB text. | P0 |
| PKG-WIZ-06 | Duplicate code, case/space | `zztest-001 ` vs existing `ZZTEST-001` | Treated as duplicate; trailing space is trimmed on save. | P0 |
| PKG-WIZ-07 | Same code, other agency | Use agency A's code in agency B | Allowed. | P1 |
| PKG-WIZ-08 | Two blank codes | Two drafts with blank code | Both save (blank excluded from uniqueness). Publishing either is refused until a code is set. | P0 |
| PKG-WIZ-09 | Step 2 | Remove all payment milestones; blank cancellation policy | Step invalid: "At least one payment milestone is required", "Cancellation policy is required". No price fields exist (pricing is per departure group). | P0 |
| PKG-WIZ-10 | Milestone rules | Two "Remaining Balance"; percentages > 100; negative amount | Publish blocked with: "Only one payment milestone can be 'Remaining Balance'", "…add up to more than 100%", "…has a negative amount". | P0 |
| PKG-WIZ-11 | Step 3 | Empty itinerary; day number 0 or > days | "At least one itinerary day is required"; "Itinerary day N is outside the package's D-day length". | P0 |
| PKG-WIZ-12 | Days/nights | days 10, nights 5 | "Nights must be exactly one less than Days." Max 365; non-integers rejected. | P0 |
| PKG-WIZ-13 | City nights | Makkah 8 + Madinah 6 on 11 nights | "Makkah + Madinah nights cannot exceed the package's total nights." | P0 |
| PKG-WIZ-14 | Step 4 | Clear services/accommodation/transport/inclusions/exclusions | One message per rule ("At least one service inclusion…", "Makkah accommodation standard is required", etc.). | P0 |
| PKG-WIZ-15 | Step 5 | No document requirements / no seat rule | "At least one document requirement is required", "Seat reservation rule is required". | P0 |
| PKG-WIZ-16 | Step 6 | Capacity 0; empty readiness checklist | "Group capacity must be greater than 0", "At least one group readiness requirement is required". | P0 |
| PKG-WIZ-17 | Capacity ordering | min size 40 > capacity 30; capacity 50 > max pilgrims 45 | Cross-field messages block publish; draft saving still works. | P0 |
| PKG-WIZ-18 | Negative / NaN numbers | Type `-5`, `abc`, `1e9` into number fields | Draft never crashes; negative capacity → readable "…value that is not allowed" naming the field and jumping to its step. | P0 |
| PKG-WIZ-19 | Status field | Look at step 1 | Status is **not** editable; cannot be set to Open for Sale/Archived through autosave. Featured cannot be flipped by autosave either. | P0 |
| PKG-WIZ-20 | Save Draft | Click Save Draft with valid data | Success toast only if save actually succeeded; on failure an error toast with reason. | P0 |
| PKG-WIZ-21 | Close with unsaved failure | Force a save failure, then close | First close warns; second close leaves. Changes not silently lost. | P0 |
| PKG-WIZ-22 | Close with clean state | Close after "Saved" | Closes immediately; list refreshes with the new draft. | P0 |
| PKG-WIZ-23 | Publish all valid | Complete all steps → Publish | Package becomes Open for Sale; success feedback; list shows it without reload. | P0 |
| PKG-WIZ-24 | Publish after failed save | Make the first autosave fail, click Publish | Publish refused with the save error (never a second insert with null id); jumps to the offending step. | P0 |
| PKG-WIZ-25 | Publish incomplete | Click Publish with step 4 empty | Message "Step 4 (Service Standards) is incomplete."; wizard jumps to step 4. | P0 |
| PKG-WIZ-26 | Publish duplicate code | Race: another user takes the code first | Friendly "package code X is already used…", `step: 1`. | P0 |
| PKG-WIZ-27 | Stale edit | Edit same package in two tabs | Second writer sees "This draft changed in another tab/elsewhere"; no silent overwrite. | P0 |
| PKG-WIZ-28 | Edit published package | Edit an Open for Sale package and autosave | Edits go live immediately (no working copy yet — known gap). Confirm the data persists and **record** that behaviour. | P1 |
| PKG-WIZ-29 | Browser refresh mid-edit | Refresh during editing | Beforeunload prompt only while a write is pending; reopened draft has all autosaved fields. | P1 |
| PKG-WIZ-30 | Large payload | Paste 100 KB into overview; 300 itinerary days | Handled or rejected with a clear message; app stays responsive. | P2 |
| PKG-WIZ-31 | Edit as FINANCE/CEO/VISA | Visit `/packages/<id>/edit` | 404 (needs editPackage). Detail page has no Edit button. | P0 |
| PKG-WIZ-32 | Keyboard & focus | Tab order, Esc, focus trap, labels on every input | Focus is trapped in the leave prompt and the review sheet and returns to the Cancel button when they close; every input has a visible label. | P1 |

### N. Detail page

| ID | Test | Expected | Pri |
| --- | --- | --- | --- |
| PKG-DET-01 | Header | Title (or "Untitled package"), breadcrumb Home → Packages → title, badges (code, journey, status, visibility, Featured if set). | P0 |
| PKG-DET-02 | Facts strip | Duration, `n live group(s) · booked/capacity seats`, "Published <date>" only when published. | P1 |
| PKG-DET-03 | Tabs | Overview, Pricing & Payments, Journey, Services & Accommodation, Traveller Requirements, Group Defaults, Departure Groups, Activity. | P0 |
| PKG-DET-04 | `?tab=` | `/packages/<id>?tab=groups` opens that tab; an unknown tab falls back to Overview. | P0 |
| PKG-DET-05 | Tab switch | Click tabs | URL updates with **no** network request / server refetch; only active tab mounted; browser Back leaves the page (shallow replace). | P1 |
| PKG-DET-06 | Overview | "Price from" = cheapest quad price across **live** groups (— when none); no "Season" tile. | P1 |
| PKG-DET-07 | Pricing tab | Shows payment milestones and policies; **no** room prices or internal cost figures. | P0 |
| PKG-DET-08 | Journey / Services / Requirements / Group Defaults | Content matches what was entered in the wizard; empty sections show sensible empty text. | P1 |
| PKG-DET-09 | Departure Groups tab | Lists groups built from this package with status, seats, revenue; filter pills Live / Completed / Cancelled / Archived; each group falls in exactly one bucket (archived wins). Links go to the group. | P0 |
| PKG-DET-10 | Activity tab | Publish / unpublish / reopen / archive / restore rows with actor, `before → after`, reason (force-archive); newest first; max 100. | P0 |
| PKG-DET-11 | Header menu by role/status | Duplicate, Create Departure Group (Open for Sale only), Feature, Publish/Unpublish/Reopen, Archive/Restore, Delete (disabled `used by N`). Gated like the list. | P0 |
| PKG-DET-12 | Archived package | Opens read-only with "Archived" badge and Restore available to authorised roles. | P1 |
| PKG-DET-13 | After lifecycle action | Action on detail page → badges, menu and Activity update. | P0 |
| PKG-DET-14 | Back button | "Back to Packages" returns to `/packages`. | P2 |
| PKG-DET-15 | Error/loading | `loading.tsx` skeleton; `error.tsx` boundary on failure. | P1 |

### O. Deep links and cross-module

| ID | Test | Expected | Pri |
| --- | --- | --- | --- |
| PKG-LNK-01 | `/packages/new` | Renders the create editor page; 404 without createPackage. `/packages?create=1` redirects here. | P0 |
| PKG-LNK-02 | `/packages/<id>/edit` | Renders the edit editor page; 404 without editPackage or if MARKETING can't view it. `/packages/<id>?edit=1` redirects here. | P0 |
| PKG-LNK-03 | Legacy `/packages/create-package` and `?id=<id>` | Redirect to `/packages/new` and `/packages/<id>/edit` respectively. | P1 |
| PKG-LNK-04 | Create Departure Group | From an Open for Sale package → `/departure-groups?create=1&template=<id>` | Create sheet opens with that package preselected; an id the role cannot see is ignored. | P0 |
| PKG-LNK-05 | Picker status gating | Departure Groups create sheet | Offers only Open for Sale by default; ADMIN-only "Include drafts" toggle shows drafts with completeness %; Archived/Sales Closed never selectable. | P0 |
| PKG-LNK-06 | Server re-check | OPERATIONS posts group creation with a Draft/Sales Closed/Archived package id | Rejected server-side. | P0 |
| PKG-LNK-07 | Journey type in picker | Early Registration package | Shown as Early Registration, not Umrah. | P1 |
| PKG-LNK-08 | Group → package link | Group detail "From: <package>" | Links to `/packages/<id>?tab=groups`. | P1 |
| PKG-LNK-09 | Snapshot immutability | Edit/republish a package after a group exists | The group's snapshot (itinerary, policies, duration) does not change. | P0 |
| PKG-LNK-10 | Leads pricing | Package with live groups priced | Leads "from" price = cheapest live group quad price, not a baseline. | P1 |

### P. Security and data integrity

Run these on staging inside rolled-back transactions or the test agency.

| ID | Test | Expected | Pri |
| --- | --- | --- | --- |
| PKG-SEC-01 | Cross-agency insert | ADMIN inserts a package with another agency's `agency_id` via REST | Blocked (42501). | P0 |
| PKG-SEC-02 | Cross-agency update/move | Update `agency_id` | Blocked. | P0 |
| PKG-SEC-03 | Cross-agency read | Agency A queries agency B's packages | 0 rows. | P0 |
| PKG-SEC-04 | Role write policies | CEO/FINANCE/VISA/GUIDE direct insert/update/delete via REST | Blocked; GUIDE cannot read. | P0 |
| PKG-SEC-05 | MARKETING scope trigger | MARKETING updates `status`, `published_at`, `archived_at` | Readable error from trigger; only own drafts and `featured` allowed. | P0 |
| PKG-SEC-06 | Status only via RPC | Direct `update packages set status=…` | Refused; only the five lifecycle RPCs change status. | P0 |
| PKG-SEC-07 | `archived_at ⇔ Archived` | Attempt inconsistent combination | CHECK constraint rejects. | P0 |
| PKG-SEC-08 | Unique code | pgTAP: same code/same agency (reject), case variant (reject), other agency (allow), 2 blanks (allow) | As listed. | P0 |
| PKG-SEC-09 | Check constraints | Out-of-range days, nights, capacities, guide ratio, bad enum values | Each rejected by DB; app shows a mapped message. | P0 |
| PKG-SEC-10 | FK protection | Delete a package referenced by a group/snapshot | 23503 → "Another record still refers to this package…". | P0 |
| PKG-SEC-11 | Error translation | Trigger 23505, 23514, 23502, 23503, 42501, unknown error | User sees only translated text; unknown errors show the generic line and are logged server-side. | P0 |
| PKG-SEC-12 | Concurrent versions | Two publishes at once | Unique `(package_id, version_number)` holds; numbering sequential. | P1 |
| PKG-SEC-13 | Open-for-Sale integrity | Query Open/Closed packages | None with blank code, none without a version (watch `createPackageVersionBestEffort` failures). | P1 |
| PKG-SEC-14 | XSS | Title/description `<img src=x onerror=alert(1)>` | Rendered as text on list, detail, export, archived sheet, toasts. | P0 |
| PKG-SEC-15 | Export injection | See PKG-EXP-05 | — | P0 |
| PKG-SEC-16 | Advisors | Run Supabase security + performance advisors | No new finding naming a packages object beyond the documented F4/F8 items. | P1 |
| PKG-SEC-17 | Real agency untouched | Compare snapshot from section 2 | Byte-identical. | P0 |

### Q. Responsive, accessibility, visual

| ID | Test | Expected | Pri |
| --- | --- | --- | --- |
| PKG-UX-01 | Widths 375 / 768 / 1280 / 1920 | No horizontal page scroll; table scrolls inside its container; header actions wrap. | P1 |
| PKG-UX-02 | Dark mode | All badges, progress bars, dialogs readable; contrast OK. | P1 |
| PKG-UX-03 | Keyboard only | Complete create → publish → archive → restore without a mouse. | P1 |
| PKG-UX-04 | Screen reader | Icon buttons have names ("More actions", "Package actions"); sortable headers announce sort; toasts announced. | P1 |
| PKG-UX-05 | Colour not sole signal | Status/completeness shown with text as well as colour. | P2 |
| PKG-UX-06 | axe scan | `@axe-core/playwright` on list, detail, editor page, review sheet, leave prompt | No serious/critical violations. | P1 |
| PKG-UX-07 | Copy clarity | Every message is understandable to a non-technical user (AGENTS UI rule); no jargon or raw codes. | P1 |

### R. Performance

| ID | Test | Target | Pri |
| --- | --- | --- | --- |
| PKG-PRF-01 | List RSC payload, 250 packages | No `itinerary`/JSONB bodies in the payload; record size. | P1 |
| PKG-PRF-02 | List query | Single RPC call (`list_packages_with_usage`), no per-row queries. | P1 |
| PKG-PRF-03 | 600+ packages | Usage counts still shown (no silent "0 groups" from URL overflow). | P0 |
| PKG-PRF-04 | Filter/sort/search | Local, no network request; feels instant. | P1 |
| PKG-PRF-05 | Wizard typing | No visible lag when typing in large text fields; autosave sends one write per pause. | P1 |
| PKG-PRF-06 | Detail tab switch | No server round trip. | P1 |

---

## 6. State-transition matrix

Rows = current status. Cells = result of the action when the caller has the capability and no other blocker.

| From \ Action | Publish | Unpublish | Reopen | Archive | Restore | Delete | Edit fields |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Draft | → Open for Sale (if complete) | ✗ | ✗ | → Archived | ✗ | ✓ if 0 groups | ✓ |
| Open for Sale | ✗ | → Sales Closed | ✗ | → Archived (live groups: ADMIN force + reason) | ✗ | ✓ if 0 groups | ✓ (live) |
| Sales Closed | (wizard publish allowed) | ✗ | → Open for Sale (if complete) | → Archived | ✗ | ✓ if 0 groups | ✓ |
| Archived | ✗ | ✗ | ✗ | ✗ | → previous status | via detail only, if 0 groups | read-only |

Every ✗ must return a readable refusal and leave the row untouched (PKG-LIF-19).
Run the full matrix for ADMIN and OPERATIONS; spot-check one cell per other role.

## 7. Automated coverage

Existing (run with `npm run test`, `npm run typecheck`, `npm run lint`):

| File | Covers |
| --- | --- |
| `app/(main)/packages/utils.test.ts` | saved views, search, sort, KPIs |
| `lib/validations/packages.test.ts` | step gaps, completeness |
| `app/(main)/packages/package-write-errors.test.ts` | DB error translation |
| `app/(main)/packages/create-package/publish-guard.test.ts` | publish-after-failed-save rule |
| `app/(main)/packages/actions.code-collision.test.ts` | duplicate-code regression |
| `lib/security/packages-policies-migration.test.ts`, `package-wrapper-guards-migration.test.ts` | migration static checks |
| `supabase/tests/database/packages_policies_agency_and_role.test.sql` (22 assertions), `package_wrapper_guards.test.sql` | RLS + wrapper guards (run on staging in `begin; … rollback;`) |
| `.github/workflows/packages-ci.yml` | tsc, Vitest, eslint ratchet, deprecated-column grep |

Gaps worth adding (suggested order):

1. Vitest: `crossFieldRulesSchema` boundary cases (PKG-WIZ-10…17), `packagesToMatrix`/CSV injection for package rows, `canRoleViewPackage` per role, `capabilitiesForPackages` snapshot of section 3.
2. Vitest for `archivePackageAction` branching (LIVE_GROUPS, non-ADMIN force, missing reason) with a mocked Supabase client.
3. pgTAP: lifecycle RPC transition matrix (section 6), `archived_at` CHECK, concurrent `package_versions_create`, `list_packages_with_usage` MARKETING scope.
4. Playwright (`npm run test:e2e`; there are Inbox specs but **none for Packages**): list smoke, create → publish, archive guard, per-role menu visibility, axe scan, two-agency isolation.

## 8. Observations to confirm (possible defects spotted while reading code)

| # | Observation | What to check |
| --- | --- | --- |
| O1 | Restore copy says the package returns "as a draft" (archived sheet toast) but `restorePackageAction` restores the **previous status**. | PKG-LIF-14: if P7 returns as Open for Sale, the toast wording is wrong. |
| O2 | Archive confirm text for a package with live groups says archiving "does not affect them", but confirming then triggers the `LIVE_GROUPS` block and the force-archive dialog. | PKG-LIF-11/12: messaging is contradictory; OPERATIONS reaches the reason box, types a reason, then is refused. |
| O3 | Default sort is `updatedAt`, but the table has no "Updated" column; `PACKAGE_COLUMN_SORT_FIELDS.updated` has no matching column. | PKG-SRT-09: no way to return to the default order through a header. |
| O4 | MARKETING can duplicate (gets a Draft it owns) but has no `editPackage`, so it cannot edit its own copy (open question Q4). | Duplicate as MARKETING, try Edit. |
| O5 | Delete is offered only from active rows and the detail page; the Archived sheet has no Delete. | Intended? Confirm with owner. |
| O6 | Editing a published package changes it live immediately (no working copy / "unpublished changes" state). | PKG-WIZ-28: record behaviour; product decision pending. |
| O7 | `createPackageVersionBestEffort` swallows failures, so a package can be Open for Sale with no version. | PKG-SEC-13. |
| O8 | `listDepartureGroupsForPackage` returns `[]` on error, so a failure looks like "0 groups". | Simulate query failure on the Groups tab. |
| O9 | Staging policies on `departure_group_package_snapshots` and 45 policies on other tables still carry the `AND true` pattern (TASK-041 follow-up). | Out of scope here; track separately. |
| O10 | Row-menu code is duplicated between `packages-columns.tsx` and `packages-action-menu-items.tsx`. | Ensure both menus stay identical in PKG-ROW-03/04. |

## 9. Execution order

1. Environment checks and fixtures (section 2, 4).
2. Automated suite: `npm run lint`, `npm run typecheck`, `npm run test`.
3. pgTAP on staging (rolled back): policies, wrapper guards, new lifecycle tests.
4. Manual browser pass as **ADMIN**: suites B → N.
5. Repeat the capability-sensitive tests (A, I, J, N) for OPERATIONS, MARKETING, FINANCE, CEO, VISA, GUIDE.
6. Cross-module (O), security (P), responsive/a11y (Q), performance (R).
7. Cleanup script, then compare the real-agency snapshot.

## 10. Exit criteria

- All **P0** tests pass; no open S1/S2 defect.
- Every P1 failure has a ticket and an owner.
- No raw database text visible to any user in any test.
- No data changed in `Royal Al-Fathima Travels` agency.
- Section 8 items each marked *fixed*, *accepted* or *ticketed*.

## 11. Results log (copy per run)

| Run date | Tester | Build / commit | Env | P0 pass / total | P1 pass / total | Defects raised | Sign-off |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  | staging / test agency |  |  |  |  |

| Test ID | Role | Result (Pass / Fail / Blocked) | Actual result / evidence | Defect ref |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

### M2. Editor page behaviour added by TASK-044

| ID | Test | Steps | Expected | Pri |
| --- | --- | --- | --- | --- |
| PKG-EDP-01 | Page layout | Open `/packages/new` at 320 / 768 / 1024 / 1440 px, light and dark | Horizontal stepper across the top (compact "Step N of 7" bar below 768 px); open step at full width under it; action bar stays at the bottom; nothing clipped; no inner scrollbars. | P0 |
| PKG-EDP-02 | Cancel with nothing changed | Open create, press Cancel | Leaves at once to `/packages`; no prompt. | P0 |
| PKG-EDP-03 | Cancel with edits | Type a title, press Cancel | Prompt "You have unsaved changes" with Keep editing / Discard changes / Save draft and leave. | P0 |
| PKG-EDP-04 | Prompt dismissal | With the prompt open, press Esc, then click outside | Both mean Keep editing; the form is unchanged. | P0 |
| PKG-EDP-05 | Link click while dirty | Edit a field, click a sidebar link or the Packages breadcrumb | Prompt appears; Discard continues to the clicked page; Save draft and leave saves, then continues there. | P0 |
| PKG-EDP-06 | Modified link click | Edit a field, ctrl/cmd-click a sidebar link | Opens in a new tab with no prompt; the form is untouched. | P1 |
| PKG-EDP-07 | Back button while dirty | Edit a field, press the browser Back | Prompt appears and the address bar still shows the editor URL; Keep editing stays; Discard goes back one page. | P0 |
| PKG-EDP-08 | Tab close while dirty | Edit a field, close the tab | Browser's own "Leave site?" prompt. | P1 |
| PKG-EDP-09 | First draft save | In create, fill step 1, Save draft, then refresh | URL became `/packages/<id>/edit`; refresh reopens that draft; the Packages list shows one new draft, not two. | P0 |
| PKG-EDP-10 | Change review sheet | Edit a price on an Open for Sale package, Save changes | A right-side sheet lists before/after, needs a reason, and does not stack on another modal; Keep editing closes it. | P0 |
| PKG-EDP-11 | Publish | Complete all steps, Publish | Lands on the package detail page; one navigation, no flash of the list. | P0 |
| PKG-EDP-12 | Unknown id | Open `/packages/not-a-uuid/edit` and `/packages/<random-uuid>/edit` | Both 404. | P1 |
| PKG-EDP-13 | Stepper | Click a finished step, then a locked one | Finished step opens; locked step shows a lock and a tooltip and does not open; Continue is disabled while the step has problems and names the first one. | P0 |
| PKG-EDP-14 | Step change | Press Continue on a tall step | The next step appears at full width; the page returns to its top; focus is on the step heading. | P0 |
| PKG-EDP-15 | Last step | Reach step 7 on a draft; then on a package on sale | Draft: Publish package. On sale: Save changes only (no duplicate Save button). | P0 |
