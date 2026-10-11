# Packages Screen — Technical Reference

How the Packages screens are built **as they exist today**: routes, data flow,
access rules, the package lifecycle, the editor, the approval flow for changes
to live packages, and the gotchas an engineer needs before touching any of it.

- **Status:** as-built reference, verified against the code on branch
  `UI-update` (2026-10-11). Where something is inferred rather than read in the
  code it is marked **(verify)**.
- **Audience:** engineers and agents working on `app/(main)/packages/**`.
- **Not in this doc:** how staff use the screen — see
  [`../runbooks/packages-screen-user-guide.md`](../runbooks/packages-screen-user-guide.md).
  Test cases — see [`../runbooks/packages-screen-test-plan.md`](../runbooks/packages-screen-test-plan.md).
- **Design history:** [`packages-module-implementation-plan.md`](packages-module-implementation-plan.md)
  (original rebuild plan), [`packages-production-readiness-plan.md`](packages-production-readiness-plan.md)
  (audit findings A1–F4 referenced in code comments),
  [`../tasks/TASK-043-packages-security-and-flaw-remediation.md`](../tasks/TASK-043-packages-security-and-flaw-remediation.md),
  [`../tasks/TASK-044-package-editor-screen.md`](../tasks/TASK-044-package-editor-screen.md),
  and the domain model in
  [`../architecture/package-departure-architecture-master-plan.md`](../architecture/package-departure-architecture-master-plan.md).

---

## 1. What a package is

A **package** is a reusable commercial *template*: name, code, journey type,
length, payment **policy**, itinerary, service standards, traveller
requirements and defaults for new groups. It is **not** a priced, dated trip.

| Concern | Lives on the package | Lives on the Departure Group |
| --- | --- | --- |
| Name, code, journey, length, itinerary | ✓ | copied (snapshot) at creation |
| Payment schedule + policies | ✓ | copied (snapshot) at creation |
| Room-occupancy prices, internal cost | — | ✓ (`departure_group_pricing`) |
| Dates, flights, exact hotels, seats booked | — | ✓ |

Two consequences drive much of the code:

1. **Editing a package never rewrites existing groups.** A group snapshots the
   package when it is created (`departure_group_package_snapshots`). An edit
   only changes what the *next* group copies, what Leads can quote and what
   agents see. This is why edits to a live package are tiered and reviewed (§8).
2. **"Price from" is not a package column.** It is the cheapest quad price
   across the package's live groups, computed in `getPackageUsage`
   (`lib/data/packages-repository.ts`).

---

## 2. Routes

| Route | File | Who may open it | Notes |
| --- | --- | --- | --- |
| `/packages` | `app/(main)/packages/page.tsx` | `viewModule` | List. `?create=1` redirects to `/packages/new`. |
| `/packages/[packageId]` | `[packageId]/page.tsx` | `viewModule` **and** `canRoleViewPackage` | Read-only detail. `?tab=<id>`; `?edit=1` redirects to `/edit`. Non-UUID id → 404. |
| `/packages/new` | `new/page.tsx` | `createPackage` | Editor, create mode. Also the deep link other modules use. |
| `/packages/[packageId]/edit` | `[packageId]/edit/page.tsx` | `editPackage` **and** `canRoleViewPackage` | Editor, edit mode. Server loads the snapshot, so the form opens populated. |
| `/packages/create-package` (`?id=`) | `create-package/page.tsx` | — | Legacy redirect to `/new` or `/[id]/edit`. Only a real UUID is followed, otherwise 404. |

Every route has its own `loading.tsx` / `error.tsx` (list, detail, new, edit).
A role without access gets `notFound()` rather than a disabled screen — the
module hides what a role must not see, same posture as Departure Groups.

---

## 3. Architecture and layering

```
Browser (client components)
  packages-list.tsx ── filter/search/sort/page/KPIs in memory
  package-detail.tsx ── tabs, lifecycle menu
  package-editor/*   ── form state, stepper, save routing
        │  Server Actions only (no REST route handlers in this module)
        ▼
app/(main)/packages/actions.ts   ← requireUser() → capability → object check
        │                          → Zod parse → rate limit → Supabase
        ▼
Supabase (RLS on every table) + SECURITY DEFINER RPCs
  lifecycle:  publish_package · publish_package_with_content · close_package_sales
              reopen_package · archive_package · restore_package
  changes:    submit_package_change · decide_package_change · withdraw_package_change
  delete:     package_delete_impact · delete_package
  guards:     consume_package_rate_limit · authorise_package_export
  reads:      list_packages_with_usage
```

Key rules the code enforces:

- **Status never changes through a plain `.update()`.** Only the lifecycle RPCs
  change `packages.status`; they are the authoritative state machine. The
  actions in `actions.ts` re-check what they can first purely to return a
  friendly message and to avoid a wasted round trip.
- **Every action starts with `requirePackageCapability()`**, which calls
  `requireUser()`, resolves the role (`getCurrentStaffRole`), and merges any
  saved custom-role overrides (`loadDynamicCapabilities(..., "packages", …)`)
  over the base role's default. Hiding a button is never the only gate.
- **Object-level check** (`canRoleViewPackage` via `requirePackageRow`): the
  module capability says "may this role touch packages"; this says "may it
  touch *this* one". Only MARKETING is restricted today (own drafts, or
  `Open for Sale`).
- **Optimistic concurrency everywhere.** Lifecycle actions read `updated_at`
  in the same request and pass it as `p_expected_updated_at`; the editor passes
  the `updated_at` it last saw. SQLSTATE `40001` is mapped to `code: "STALE"`.
- **Raw database text never reaches the user.** `package-write-errors.ts`
  (`describePackageWriteFailure`) translates constraint violations and passes
  through only an allow-list of messages raised on purpose by the RPCs
  (`SAFE_DATABASE_MESSAGES`). Anything else is logged and replaced by a generic
  line. Add a new `raise exception` message → add a matching pattern there.

---

## 4. Data model

| Object | Purpose |
| --- | --- |
| `packages` | The template row. ~50 content columns (`PACKAGE_CONTENT_COLUMNS` in `lib/access/package-field-tiers.ts`), lifecycle columns (`status`, `previous_status`, `archived_at`, `published_at`, `published_version_id`, `featured`, `owner_id`, `duplicated_from`) and generated count columns (`itinerary_days`, `payment_milestones_count`, `inclusions_count`, …). |
| `package_usage` (view) | Per package: `group_count`, `live_group_count`, `seats_booked`, `seats_capacity`. Source of the "Groups" column, KPIs and delete/archive guards. |
| `package_versions` | One row per publish; unique `(package_id, version_number)`. |
| `package_activity_logs` | Append-only lifecycle audit, written only by the lifecycle RPCs. Action types: `PUBLISHED`, `SALES_CLOSED`, `REOPENED`, `ARCHIVED`, `RESTORED`, `CHANGE_APPLIED`. |
| `package_change_requests` | Reviewed changes to a live package: `changes` JSON (`{column: {old, new, tier}}`), `reason`, `status`, `highest_tier`, requester, decider, `expires_at` (now + **14 days**). |
| `package_deletions` | Copy of a package and its history taken before a hard delete. |
| `package_rate_events` / `package_export_logs` | Backing tables for the hourly limits (§11). |
| `agency_settings.package_approval_money_contract`, `.package_approval_bookings_ops` | Per-agency switches: does each tier of change need approval (Settings → Operations). Default when unreadable: **approval required**. |

`PackageListItem` (`lib/types/packages.ts`) is the list's narrow projection.
**It never carries the JSONB bodies** (itinerary, milestones) — the list reads
only the generated count columns. The edit page and detail page select `*`.

### Statuses

`Draft` → `Open for Sale` ⇄ `Sales Closed` → `Archived`. `archived_at` is set
iff `status = Archived` (CHECK constraint). `previous_status` records where
restore goes back to.

---

## 5. Access control

Source: `lib/access/packages-access.ts`. Capabilities are pure functions of the
role, evaluated on the server and again in the database.

| Capability | ADMIN | CEO | OPERATIONS | FINANCE | MARKETING | VISA | GUIDE |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `viewModule` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `createPackage` | ✓ | — | ✓ | — | — | — | — |
| `editPackage` | ✓ | — | ✓ | — | — | — | — |
| `publishPackage` (publish / unpublish / reopen) | ✓ | — | ✓ | — | — | — | — |
| `duplicatePackage` | ✓ | — | ✓ | — | ✓ | — | — |
| `archiveOrRestorePackage` | ✓ | — | ✓ | — | — | — | — |
| `deletePackage` | ✓ | — | — | — | — | — | — |
| `toggleFeatured` | ✓ | — | ✓ | — | ✓ | — | — |
| `exportCatalogue` | ✓ | ✓ | ✓ | ✓ | — | ✓ | — |
| `createGroupFromPackage` | ✓ | — | ✓ | — | — | — | — |
| `viewInternalFinance` | ✓ | ✓ | — | ✓ | — | — | — |
| `editSensitiveTerms` | ✓ | — | ✓ | — | — | — | — |
| `approvePackageChanges` | ✓ | — | — | — | — | — | — |

Notes:

- `editSensitiveTerms` and `approvePackageChanges` are **not** in the older
  matrix in `packages-screen-test-plan.md`; this table is the current truth.
- `editPricing` was removed (finding D3) — nothing checked it. Stale
  `role_permissions` rows carrying it are ignored.
- `viewInternalFinance` now only gates the **revenue** column on the detail
  page's Departure Groups tab (`listDepartureGroupsForPackage(id, includeRevenue)`).
  `getPackageDetail` ignores it: `finance_estimate` was dropped from the table.
- **Custom roles:** `loadDynamicCapabilities` merges saved overrides
  (Management → Roles & Permissions, module `"packages"`) over the base role.
  The server resolves `can` once per request and passes it down as a prop;
  client components must never re-derive it from `role` alone.
- **MARKETING visibility** is enforced in SQL (`list_packages_with_usage` takes
  `p_role` / `p_current_user_id`) *and* per object (`canRoleViewPackage`), so
  hidden rows are absent from the payload, the search index and exports.
- **Approval is never self-service.** `decide_package_change` refuses the
  requester's own request regardless of capability.

---

## 6. Lifecycle (state machine)

| From \ Action | Publish | Unpublish | Reopen | Archive | Restore | Delete | Edit fields |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Draft** | → Open for Sale (if complete) | ✗ | ✗ | → Archived | ✗ | ✓ if unused | ✓ |
| **Open for Sale** | ✗ | → Sales Closed | ✗ | → Archived (live groups: ADMIN + reason) | ✗ | ✗ archive first | ✓, tiered (§8) |
| **Sales Closed** | via editor only | ✗ | → Open for Sale (if complete) | → Archived | ✗ | ✗ archive first | ✓, tiered (§8) |
| **Archived** | ✗ | ✗ | ✗ | ✗ | → previous status | ✓ if unused | ✗ read-only |

Action → function map:

| UI action | Server Action | RPC | Capability |
| --- | --- | --- | --- |
| Publish (menu) | `publishExistingPackageAction` | `publish_package` | `publishPackage` |
| Publish (editor) | `publishPackageAction` | `publish_package_with_content` | `publishPackage` |
| Unpublish | `unpublishPackageAction` | `close_package_sales` | `publishPackage` |
| Reopen for Sale | `reopenPackageAction` | `reopen_package` | `publishPackage` |
| Feature / Unfeature | `setPackageFeaturedAction` | direct `update({featured})` | `toggleFeatured` |
| Archive | `archivePackageAction` | `archive_package` | `archiveOrRestorePackage` |
| Restore | `restorePackageAction` | `restore_package` | `archiveOrRestorePackage` |
| Duplicate | `duplicatePackageAction` | direct `insert` | `duplicatePackage` |
| Delete | `getPackageDeleteImpactAction` → `deletePackageAction` | `package_delete_impact`, `delete_package` | `deletePackage` |

Details worth knowing:

- **Publish re-validates everything server-side.** Steps 1–6 via `isStepValid`
  plus `crossFieldIssues` (§9). The first failing step is returned as
  `{ step }` so the editor can jump to it. Reopen runs the same checks —
  a Sales Closed package can still have been edited into an incomplete state.
- **Archive with live groups** returns `{ ok:false, code:"LIVE_GROUPS",
  liveGroupCount }` (not a toast). The UI then offers the force path:
  `{ force:true, reason }`, **ADMIN only**, reason mandatory, recorded in the
  activity log. `archive_package` re-checks the guard as the authoritative
  backstop against a group created in the gap.
- **Restore** returns the package to `previous_status` (Draft only if unknown).
- **Duplicate** copies every content column, then: `status = Draft`,
  `featured = false`, `owner_id = caller`, `duplicated_from = source`, title
  `"<title> (Copy)"`, code `"<code>-COPY"`, then `-COPY-2`…`-COPY-25` on a
  unique-index collision. Version and publish date are not copied. A
  duplicate of an archived package is a normal Draft.
- **Delete** is Draft or Archived only; the person must type the package code
  and give a reason; refused while departure groups, group snapshots, lead
  quotes or agent submissions refer to it (`lib/packages/delete-impact.ts`
  holds the wording). Unlinked/removed side effects (leads' preferred package,
  campaigns, agent allocations, website content, pending changes) are listed
  before confirming. A copy goes to `package_deletions` first.
- **Featured** is the one field MARKETING may change; a DB trigger rejects any
  other column change by MARKETING.

---

## 7. List screen (`/packages`)

`page.tsx` (Server Component) resolves `can`, then fetches **everything the
role may see in one go** — `listPackages(role, userId)` (RPC
`list_packages_with_usage`, archived included) and
`listPendingPackageChanges()`. It splits active vs. archived and renders
`PackagesList`.

### Everything after load happens in the browser

| Concern | Implementation | Behaviour |
| --- | --- | --- |
| Saved views | `PACKAGE_SAVED_VIEWS`, `applySavedView` (`utils.ts`) | **All Packages**; **Open for Sale** (`status`); **My Drafts** (Draft + `ownerId = me`; all drafts if user id unknown); **Featured**; **Needs Attention** (`completeness < 100` **or** Open for Sale with 0 live groups). |
| Search | `matchesSearch` | Case-insensitive substring over title, code, branch, package category. Trimmed. |
| Filters | `FilterMenu` | Journey (Umrah / Hajj / Early Registration), Category (Economy…Custom), Status (Draft / Open for Sale / Sales Closed — no Archived), Branch (options derived from data present). AND-combined with view + search. |
| Sort | `sortPackages` | Fields `updatedAt` (default, desc), `title`, `duration`, `groups` (live count), `completeness`, `status`. Ties broken by title. Header click flips direction; a new column adopts its default direction. |
| Pagination | `DataTable` | 10 rows/page by default, switchable; page resets when sort or view changes. |
| KPIs | `computeListKpis` over the **filtered** set | Open for sale · Drafts in progress · Live departure groups · Seats sold (`booked / capacity`, occupancy %). |
| Pending badge | `pendingPackageIds` | Rows with a change waiting show "Change awaiting approval". |

No filter, search, sort or page change costs a server round trip. After any
mutation, `router.refresh()` re-runs `page.tsx`.

### Completeness

`completeness = round(validSteps / 6 × 100)` where a step is "valid" per
`computeListStepGaps` — an **approximation** over array-length columns ("is the
array non-empty?"), not full Zod validation of every item. It exists so the
list does not need the JSONB bodies. The editor and publish use the strict
`stepNSchema` rules, so a package can read 100% in the list yet still be
refused at publish by a cross-field rule (§9).

### Columns

Package (title, featured star, code, pending badge) · Journey · Duration
(`12D / 11N`, itinerary day count) · Status (+ visibility) · Groups
(`n live · booked/capacity seats` + bar) · Completeness (`%` + bar) · row menu.
Row click → detail; the `⋯` trigger stops propagation. Right-click opens the
same menu (`PackagesActionMenuItems` with `CONTEXT_MENU_SLOTS`).

### Row menu (capability- and status-gated)

Open · Edit Details · Duplicate · Create Departure Group (Open for Sale only) ·
Publish (Draft) / Unpublish (Open for Sale) / Reopen for Sale (Sales Closed) ·
Feature/Unfeature · Archive / Restore · Delete (disabled with the reason:
`Delete (used by N)` or `Delete (archive it first)`).

### Export

`exportPackages(format)` exports the **current view, all pages**. Flow: if the
set is empty → toast, stop. Else call `authorisePackageExportAction`
(capability check, **10 exports/hour/person**, one `package_export_logs` row
with the filters used). Only if that succeeds is the file built in the browser
from the already-loaded array (`csv.ts`: CSV with UTF-8 BOM, or XLSX sheet
"Packages", reusing the Departure Groups encoders, which guard against formula
injection). Columns: Code, Title, Journey Type, Category, Branch, Status,
Visibility, Featured, Duration, Completeness %, Live Groups, Seats Booked,
Seats Capacity, Updated (ISO-8601).

### Other list surfaces

- **Awaiting approval** button (only when any exist) → `PackageChangeQueueSheet`
  (all pending changes the person can read).
- **View Archived Packages** → `ArchivedPackagesSheet` (Open / Restore).

---

## 8. Detail screen (`/packages/[packageId]`)

Server component loads in parallel: `getPackageUsage`,
`listDepartureGroupsForPackage`, `getPackageActivity` (max 100),
`listPendingPackageChanges(id)`, `listPackageChangeHistory(id)` (max 50).

- **Header:** title, breadcrumb, Back, Edit (`editPackage`), `⋯` menu
  (Duplicate, Create Departure Group, Feature, Publish/Unpublish/Reopen,
  Archive/Restore, Delete). All lifecycle actions go through the same
  `usePackageLifecycle()` hook as the list.
- **Badges:** code, journey, status, visibility, Featured.
- **Facts strip:** duration · `n live groups · booked/capacity seats` ·
  "Published <date>".
- **Pending change cards** (`PackageChangeRequestsPanel`) sit above the tabs.
- **Tabs** (`?tab=`; unknown value → `overview`; only the active tab mounts;
  switching uses `history.replaceState`, no refetch):

| Tab id | Label | Content |
| --- | --- | --- |
| `overview` | Overview | Identity facts, overview text, **Price from**, groups count, duration. |
| `pricing` | Pricing & Payments | Payment milestones and the four policies. **No prices** by design. |
| `journey` | Journey | Day-by-day itinerary template. No flights. |
| `services` | Services & Accommodation | Services, Makkah/Madinah standards, transport, inclusions/exclusions. |
| `requirements` | Traveller Requirements | Document rules, seat reservation rule, message templates. |
| `group-defaults` | Group Defaults | Capacity, minimum size, readiness checklist. |
| `groups` | Departure Groups | Groups built from this package; pills All / Live / Completed / Cancelled / Archived (each group in exactly one bucket, archived wins); revenue only with `viewInternalFinance`. |
| `activity` | Activity | Lifecycle log (before → after, actor, reason) + reviewed-change history. |

---

## 9. Editor (`/packages/new`, `/packages/[id]/edit`)

### Composition

```
PackageEditorScreen            page header + breadcrumb, wires onClose/onPublished
 └ PackageEditorWorkspace      owns the hooks below
    ├ usePackageEditorForm     formData, savedForm, changes[], isDirty
    ├ usePackageEditorStepper  activeStep, validity, which messages to show
    ├ usePackageEditorSave     persist / save / publish / saveAndLeave
    ├ useUnsavedChangesGuard   beforeunload + link click + popstate
    ├ PackageEditorNotices     pending change · live groups · role limits
    ├ HorizontalStepper + step content (next/dynamic per step)
    ├ PackageEditorFooter      Cancel · save status · Back · Continue/Publish/Save
    ├ PackageChangeReviewSheet before/after + reason (live packages)
    └ PackageLeaveConfirmDialog
```

### Steps

| # | Id | Label | Required to complete (`lib/validations/packages.ts`) |
| - | --- | --- | --- |
| 1 | `commercial` | Commercial Identity | title, code, overview, journey type, package class, planned capacity > 0, minimum group size > 0, days ≥ 1, nights ≥ 0 |
| 2 | `pricing` | Sales Pricing Policy | ≥ 1 payment milestone, cancellation policy |
| 3 | `journey` | Journey Template | duration label, ≥ 1 itinerary day (days/nights also re-checked) |
| 4 | `service` | Service Standards | ≥ 1 included service, Makkah + Madinah standard, ≥ 1 transport route, ≥ 1 inclusion, ≥ 1 exclusion |
| 5 | `traveller` | Traveller Requirements | ≥ 1 document requirement, seat reservation rule |
| 6 | `groups` | Group Creation Defaults | default group capacity > 0, ≥ 1 readiness item |
| 7 | `review` | Review & Publish | no schema; summarises 1–6 and jumps back |

**Cross-field rules** (`crossFieldRulesSchema`, checked at publish/reopen and by
the review step, deliberately *not* folded into steps 1–6 so an early step is
not blocked by a value on a later one):

- `days = nights + 1`
- `minGroupSize ≤ defaultCapacity`
- `defaultCapacity ≤ maxPilgrims` and `defaultGroupCapacity ≤ maxPilgrims`
  (when `maxPilgrims > 0`)
- `makkahNights + madinahNights ≤ nights`
- no negative milestone amount; at most one "Remaining Balance"; percentage
  milestones total ≤ 100
- every itinerary `dayNumber` within `1..days`

**Wire schema** (`packageFormSchema`, `.strict()`) is lenient about empties but
bounds everything (`PACKAGE_LIMITS`: title 200, code 64, long text 5000,
itinerary days 60, milestones 20, transport 30, documents 40, readiness 40,
list items 100, max count 100 000, max amount 1 000 000 000, max days 365).
A form that hits one is "almost certainly a mistake or an attack".

### Form behaviour

- **Nothing autosaves** (TASK-043 removed it). The form lives in the browser
  until Save draft / Save changes / Publish. `isDirty` is
  `computePackageChanges(savedForm, formData).length > 0`.
- A new package is seeded from `INITIAL_PACKAGE_FORM_DATA` — **sample Umrah
  content** (title, overview, three itinerary days, services, milestones…),
  with a blank code. The code is then filled by `getNextPackageCodeAction`
  (`PKG-<year>-NNNN`, next unused in the agency) into a **read-only** field.
- The code is re-checked 500 ms after it changes (`checkPackageCodeAction`);
  a clash shows a one-click `CODE-2` suggestion. The unique index
  (`packages_internal_code_agency_unique`, case-insensitive per agency) stays
  the authority.
- Entering Days sets Nights = Days − 1 and the duration label; changing
  planned capacity also sets default group capacity and max pilgrims.
- Journey type drives `category` (`Hajj` → Hajj, otherwise Umrah).
- **Fields with no editor UI** (they take the seeded defaults and cannot be
  changed here today): branch (`All Branches`), visibility (`Pilgrim Portal`),
  waitlist (enabled), seat hold expiry (`24 hours`, shown read-only),
  `financeRoleView`. `status` and `featured` are never part of a save.

### Stepper rules

- A step opens if it is behind you, or every step up to it is valid
  (`canOpenPackageEditorStep`). Locked steps show the first unfinished step's
  name.
- **Continue and Publish are never disabled for an incomplete step.** Pressing
  them reveals that step's messages, scrolls to and focuses the first problem
  (`revealCurrentStepErrors`). Messages for a step otherwise appear only after
  it has been left, so a first visit never opens with a wall of red.
- Publish from the review step with an earlier step incomplete opens that step.
- The next step's chunk is preloaded when the browser is idle.

### Save routing — `decidePackageSaveRoute`

| Package state | Edits | Route | What happens |
| --- | --- | --- | --- |
| Draft / unsaved | any | `save-draft` | Create (rate-limited) or compare-and-swap `update` of only the changed columns. |
| Open for Sale / Sales Closed | display-only (tier 0) | `save-directly` | Same direct update. |
| Open for Sale / Sales Closed | any tier 1–2 | `review-first` | Review sheet → reason → `submit_package_change` RPC. |

`savePackageAction` returns one of `SAVED`, `APPLIED`, `PENDING`, or
`{ ok:false, code: "STALE" | "PENDING_EXISTS", step? }`. It never sets
`status` or `featured`, and refuses Archived packages.

### Change tiers (`lib/access/package-field-tiers.ts`)

| Tier | Name | Which fields | Review? |
| --- | --- | --- | --- |
| 0 | Basic | title, description, branch, package class, duration label, itinerary *wording*, customer wording and hotel display names | No — saved at once |
| 1 | Money & contract | payment milestones, payment terms, cancellation / late-payment policy, price-change disclaimer | Reason required; approval per agency switch |
| 2 | Bookings & operations | everything else — capacities, nights, services, transport, documents, seat rule, checklist, **itinerary structure** (day ids/numbers/categories), journey type, code, visibility… | Reason required; approval per agency switch |

An unlisted column is Tier 2 (fail safe). The same table exists in the database
(`package_field_tier`, `package_content_columns`); a migration test fails if
they diverge — **change both together**.

### Review → approval flow

1. Editor computes `changes` and groups them by tier; sheet shows before/after,
   a mandatory reason (≤ 500 chars), and what *will* happen (a preview — the
   database decides).
2. `submit_package_change`:
   - Tier-0 columns apply immediately.
   - Tier 1/2: if the agency switch for that tier is **off** → applied now and
     logged with name + reason (`APPLIED`); if **on** → a `PENDING` request is
     stored and the package is unchanged until decided.
3. One pending request per package. A second returns `PENDING_EXISTS`; the
   sheet offers "replace it" (`supersedePending` → old one `SUPERSEDED`).
4. An approver (`approvePackageChanges`, not the requester) calls
   `decidePackageChangeAction` → `APPROVED` (applies) or `REJECTED` (note
   required). The database refuses an expired request, one already decided, and
   one made against a package that has since changed.
5. The requester (or an approver) can `withdrawPackageChangeAction`.
6. Pending requests expire after **14 days**; expiry is evaluated lazily when a
   request is read or decided (no cron).

### Leaving safely (`useUnsavedChangesGuard`)

| Attempt | Behaviour |
| --- | --- |
| Close tab / reload | Browser's own prompt (`beforeunload`) |
| Click an in-app link | Stopped; prompt; Discard continues there, Save continues after save |
| Browser Back | Stopped, address bar restored, prompt (capture-phase `popstate`) |
| Ctrl/Cmd-click, new tab, download | Not intercepted |
| `router.push` from code | Not intercepted — caller's responsibility |
| Cancel button | Straight out if clean, else prompt |

Esc / click-outside on the prompt means **Keep editing**, never Discard. The
Next.js App Router has no route-change event, so Back interception relies on
capture-phase ordering; if that stops holding, Back leaves without asking.

---

## 10. Server Action reference

All in `app/(main)/packages/actions.ts` (`"use server"`; only async functions
may be exported — helper types/functions live in sibling files).

| Action | Input | Result | Notes |
| --- | --- | --- | --- |
| `savePackageAction` | `{packageId?, form, expectedUpdatedAt?, reason?, supersedePending?}` | `SavePackageResult` | Rate limit `create_draft` on create. |
| `publishPackageAction` | `{packageId?, form, expectedUpdatedAt?}` | `PublishResult` | Validates 1–6 + cross-field first, then rate limit `publish`. |
| `publishExistingPackageAction` | `packageId` | `PackageActionResult` | Re-reads the row, validates, `publish_package`. |
| `unpublishPackageAction` | `packageId` | `PackageActionResult` | |
| `reopenPackageAction` | `packageId` | `PackageActionResult` | Re-validates content. |
| `setPackageFeaturedAction` | `packageId, featured` | `PackageActionResult` | |
| `archivePackageAction` | `packageId, {reason?, force?}` | `ArchivePackageResult` | `LIVE_GROUPS` branch. |
| `restorePackageAction` | `packageId` | `PackageActionResult` | |
| `duplicatePackageAction` | `packageId` | `PackageActionResult` | Rate limit `duplicate`. |
| `getPackageDeleteImpactAction` | `packageId` | impact + code + `updatedAt` | ADMIN. |
| `deletePackageAction` | `{packageId, expectedUpdatedAt?, confirmCode, reason}` | `{ok}` | ADMIN. |
| `checkPackageCodeAction` | `{code, packageId?}` | availability / suggestion | Rate limit `code_lookup`. |
| `getNextPackageCodeAction` | — | next `PKG-YYYY-NNNN` | Rate limit `code_lookup`. |
| `getPackageForEditAction` | `packageId` | `PackageEditSnapshot` | Shares `loadPackageEditSnapshot` with the edit page. |
| `authorisePackageExportAction` | `{format, rowCount, filters}` | `{ok, remaining}` | 10/hour. |
| `decidePackageChangeAction` | `{requestId, approve, note?}` | status | `approvePackageChanges`. |
| `withdrawPackageChangeAction` | `{requestId, note?}` | status | Requester or approver. |
| `getPackageApprovalPolicyAction` | — | two booleans | Defaults to "needs approval". |

Conventions: result is `{ ok: true, … } | { ok: false, error, code?, step? }`,
never a thrown error at the UI. The UI wraps every wait in
`runWithLoadingToast` (project UI rule) — lifecycle toasts live in
`use-package-lifecycle.ts`.

---

## 11. Limits and abuse protection

| Control | Value | Where |
| --- | --- | --- |
| Create draft | 30 / hour / person | `consume_package_rate_limit` |
| Duplicate | 20 / hour / person | same |
| Publish | 30 / hour / person | same (counted *after* form validation passes) |
| Package-code lookups | 200 / hour / person | same |
| Catalogue export | 10 / hour / person | `authorise_package_export` |
| Change-request lifetime | 14 days | `package_change_requests.expires_at` |
| Reason / note length | 500 chars | schemas + DB |
| Activity log read | newest 100 | `getPackageActivity` |
| Change history read | newest 50 | `listPackageChangeHistory` |
| Pending changes read | newest 100 | `listPendingPackageChanges` |

If the rate-limit check itself cannot run, the action is **refused**
("a limit that silently switches off when the database is slow is not a limit").

---

## 12. Cross-module effects

Mutations call `revalidatePath` so dependents never serve stale data:

| Action | Revalidates |
| --- | --- |
| Publish, unpublish, reopen, archive, restore, delete, decide change, live-package save | `/packages`, `/packages/[id]`, `/departure-groups`, `/leads` |
| Save draft, duplicate, feature | `/packages` (+ `/packages/[id]` for save) |

Consumers:

- **Departure Groups** create sheet offers only `Open for Sale` packages
  (admin-only "include drafts" toggle); the server re-checks status. Deep link:
  `/departure-groups?create=1&template=<id>` (an id the role cannot see is
  ignored). Group detail links back to `/packages/<id>?tab=groups`.
- **Leads** quoting catalogue lists only `Open for Sale`; its "from" price is
  the cheapest live group quad price.
- **Group snapshots are immutable** with respect to later package edits.

---

## 13. Testing

| Layer | File(s) |
| --- | --- |
| Unit | `utils.test.ts` (views, search, sort, KPIs), `package-write-errors.test.ts`, `lib/validations/packages.test.ts`, `decide-package-save-route.test.ts`, `unsaved-changes-link-click.test.ts` |
| Action behaviour | `actions.save-package.test.ts`, `actions.delete-package.test.ts`, `actions.code-collision.test.ts`, `actions.authorise-export.test.ts`, `actions.rate-limit.test.ts` |
| Migration / policy | `lib/security/packages-*-migration.test.ts`, `supabase/tests/database/packages_*.test.sql` (pgTAP) |
| Manual | [`packages-screen-test-plan.md`](../runbooks/packages-screen-test-plan.md) |

Run `npm run lint`, `npm run typecheck`, `npm run test` before a PR
(`docs/standards/testing-standards.md`). Note: there is a staging-only
database — see TASK-041 and the test plan's safety rules before any write test.

---

## 14. Known gaps and gotchas

Verified in the code on 2026-10-11 unless marked **(verify)**.

| # | What | Where | Effect |
| - | --- | --- | --- |
| G1 | Archived sheet toast says the package returns "as a draft", but restore returns the **previous status**. | `archived-packages-sheet.tsx:59` vs `restorePackageAction` | Misleading copy. |
| G2 | Archive confirm text says live groups are "not affected" and that archiving is allowed, but the server then returns `LIVE_GROUPS` and the force dialog opens; OPERATIONS reaches the reason box and is then refused. | `confirm-package-action-dialog.tsx`, `archivePackageAction` | Contradictory messaging for non-admins. |
| G3 | Default sort is `updatedAt` but no "Updated" column exists, so the default order cannot be restored via a header. `PACKAGE_COLUMN_SORT_FIELDS.updated` has no column. | `packages-columns.tsx` | Minor UX. |
| G4 | Step 7 contains a "Package Published Successfully" dialog that is never opened (`successDialogOpen` is never set true). Real success navigates to the detail page. | `step-7-review-publish.tsx` | Dead code. |
| G5 | Branch, visibility and waitlist have **no editor UI**; every new package gets `All Branches` / `Pilgrim Portal` / waitlist on. The list's Branch filter is therefore only as useful as the data seeded elsewhere. | step components | Cannot set per-package. |
| G6 | New-package form opens pre-filled with sample content. A user who only changes the title can publish sample itinerary/services. | `INITIAL_PACKAGE_FORM_DATA` | Process risk; consider blanking. |
| G7 | MARKETING can duplicate (becomes owner of a Draft) but has no `editPackage`, so cannot edit its copy. | access matrix | Open product question. |
| G8 | Delete appears only on active rows and the detail page, not in the Archived sheet, although Archived packages are deletable. | `archived-packages-sheet.tsx` | Open the package first. |
| G9 | `listDepartureGroupsForPackage`, `getPackageActivity`, `listPendingPackageChanges`, `listPackageChangeHistory` return `[]` on error, so a failure reads as "none". | `packages-repository.ts` | Silent degradation. |
| G10 | The list approximates completeness from counts; strict rules can still refuse publish. | `computeListStepGaps` | 100% ≠ guaranteed publishable. |
| G11 | Whole catalogue is loaded once and filtered client-side. Fine for hundreds of packages; revisit if the catalogue reaches thousands. | `listPackages` | Payload size. |
| G12 | Row-menu markup is duplicated between `packages-columns.tsx` and `packages-action-menu-items.tsx`; they must be edited together. | both files | Drift risk. |

---

## 15. File map

```
app/(main)/packages/
  page.tsx · loading.tsx · error.tsx
  actions.ts                      all Server Actions
  use-package-lifecycle.ts        shared mutation hook (list + detail)
  utils.ts · csv.ts               client list helpers · export
  package-write-errors.ts         DB error → human message
  package-edit-snapshot.ts        server loader shared by edit page + action
  new/ · create-package/ (redirect + wizard steps/schemas/mappers/types)
  [packageId]/ page.tsx · edit/ · components/package-detail.tsx · tabs/*
  components/
    packages-list.tsx · packages-kpi.tsx · packages-table/packages-columns.tsx
    packages-action-menu-items.tsx · package-status-badges.tsx
    archived-packages-sheet.tsx · confirm-package-action-dialog.tsx
    force-archive-package-dialog.tsx · delete-package-dialog.tsx
    package-change-{queue-sheet,requests-panel,review-sheet,diff-view,history-list}.tsx
    package-editor/  screen · workspace · footer · notices · steps
                     use-package-editor-{form,save,stepper}.ts
                     decide-package-save-route.ts · use-unsaved-changes-guard.ts
lib/access/  packages-access.ts · package-field-tiers.ts · dynamic-capabilities.ts
lib/data/    packages-repository.ts
lib/packages/ change-diff.ts · delete-impact.ts
lib/types/   packages.ts (list/activity types) · database.ts (row types)
lib/validations/packages.ts       single validation source
supabase/migrations/              *packages* (lifecycle, change requests,
                                  controlled delete, audited export, abuse limits)
```
