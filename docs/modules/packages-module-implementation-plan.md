# Packages Module — Implementation Plan

Rebuild of the **Packages list screen** and the **Create/Edit Package screen** so they use the
same UI system, access model, and data architecture as **Departure Groups**.

Status: plan only. Nothing in here is implemented yet.

---

## 1. What the Departure Groups module already gives us

These are the blocks the Packages screens must reuse rather than reinvent. Every one of them is
already written, styled, dark-mode-correct, and accessible.

### 1.1 Page composition

| Block                                 | File                                                                  | Notes                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Page shell + breadcrumb + action slot | `components/page-header.tsx`                                          | `PageHeader`                                                                                             |
| KPI row (4-up)                        | `app/(main)/departure-groups/components/departure-groups-kpi-cards/`  | `Card` + `text-4xl tabular-nums` + caption                                                               |
| Saved-view chip bar                   | `departure-groups-list.tsx:495-512`                                   | `bg-card/60 backdrop-blur-md border-border/40` pill group                                                |
| Filter chips (`FilterSelect`)         | `departure-groups-list.tsx:117-163`                                   | dropdown chip, active state `bg-primary/10 text-primary`                                                 |
| More/Fewer filters + `Clear N`        | `departure-groups-list.tsx:578-596`                                   |                                                                                                          |
| Table shell                           | `components/groups-table/groups-data-table.tsx`                       | search `InputGroup`, sticky header, rows-per-page, `startRow–endRow of N`, `resetPageToken`, `aria-sort` |
| Column builder + sortable headers     | `components/groups-table/groups-columns.tsx`                          | `sortableHeader()`, `GROUP_COLUMN_SORT_FIELDS`, capability-gated row menu                                |
| Badges / progress / chips / empty     | `components/status-badges.tsx`                                        | `ToneBadge`, `ProgressBar`, `PersonChip`, `EmptyState`, `PermissionDenied`                               |
| Tone tokens                           | `departure-groups/utils.ts` (`TONE_CLASS`, `TONE_BAR`, `percentTone`) | colour is never the only signal                                                                          |
| Create flow                           | `components/create-departure-group-sheet.tsx`                         | 2-step **Sheet**, not a 7-step wizard                                                                    |
| Confirm destructive                   | `components/confirm-action-dialog.tsx`                                |                                                                                                          |
| Secondary list in a sheet             | `components/archived-groups-sheet.tsx`                                |                                                                                                          |
| Import dialog                         | `components/import-groups-dialog.tsx`                                 |                                                                                                          |
| Export                                | `departure-groups/csv.ts`, `xlsx.ts`                                  | `groupsToCsv`, `matrixToXlsx`, `timestampedFilename`, `downloadTextFile/BinaryFile`                      |
| Detail shell                          | `[groupId]/components/departure-group-detail.tsx:540-551`             | animate-ui `Tabs`, **only the active tab is mounted**                                                    |

### 1.2 Non-UI patterns worth copying verbatim

- **Capabilities**: `lib/access/departure-groups-access.ts` — pure functions over a role string,
  usable from Server and Client Components; the role is resolved once per request
  (`getCurrentStaffRole`) and threaded as a prop. Capabilities decide what is **fetched**, not just
  what is rendered (supplier costs are nulled in the repository).
- **Server-side role filtering before serialization**: `departure-groups/page.tsx:22-34`.
- **URL as intent**: `[groupId]/page.tsx:53-61` reads `?tab=&add=&edit=&compare=` so list rows can
  deep-link into a specific state.
- **One validation source for both sides**: `lib/validations/departure-groups.ts` + a field-error
  mapper (`toDepartureGroupFieldErrors`) consumed by the client for instant feedback and by the
  Server Action as the real gate.
- **Action result convention**: `{ ok: true, ... } | { ok: false, error: string }`, never throws at
  the UI.

---

## 2. Findings — what is wrong with Packages today

### 2.1 Architecture / data

**F1 — The list fetches everything, filters nothing.**
`app/(main)/packages/page.tsx:33` calls `listPackages()` with no filter, sort, or pagination;
`lib/data/packages.ts:16-17` selects the whole `itinerary` JSONB and `description` for every row.
The itinerary is fetched **only to render `pkg.itinerary.length`** (`packages-list.tsx:297`). A
15-day itinerary is a few KB per package, serialized into the RSC payload for every card. Cost is
O(all packages × itinerary size) on every visit; filtering then happens in the browser
(`packages-list.tsx:56-65`).

**F2 — Rich objects across the server/client boundary.**
`toPackageCard` (`page.tsx:11-30`) builds `Date` objects for `createdAt`/`updatedAt` which the card
never renders — pure payload and serialization cost.

**F3 — No access control at all.**
Packages has no equivalent of `lib/access/departure-groups-access.ts`. Every authenticated user —
including `GUIDE` and `MARKETING` — can open the wizard, edit pricing, publish, and **permanently
delete** a package. RLS is the only other gate and it is `using (true)` for update and delete
(`supabase/migrations/20260808090000_create_packages.sql:194-204`), so in practice there is no gate.

**F4 — Internal margins are shipped to everyone.**
`getPackage` selects `*` (`lib/data/packages.ts:41`), including `finance_estimate` (internal cost
and margin), and the row is handed to a Client Component. Departure Groups deliberately nulls
supplier costs in the repository for roles without `viewSupplierCosts`; Packages does not.

**F5 — Hard delete against a restricting foreign key.**
`deletePackageAction` (`packages/actions.ts:171`) deletes the row. `departure_groups.package_template_id`
is `references public.packages (id) on delete restrict`
(`20260809090000_create_departure_groups.sql:29-30`). Deleting a package that any group was built
from fails, and the raw Postgres error text is surfaced to the operator (`actions.ts:192`). There is
no archive, no restore, no undo, and no "used by N groups" signal anywhere in the UI.

**F6 — Layering inversion.** `lib/types/database.ts:9-19` imports domain types from
`app/(main)/packages/create-package/types.ts`. The data layer depends on a wizard component folder,
so the types cannot move without touching the database layer.

**F7 — Duplicated validation.** `create-package/schemas.ts` (client) and
`create-package/server-schema.ts` (server) are two independent definitions of the same shape and
will drift. Departure Groups keeps one copy in `lib/validations/`.

**F8 — No route boundaries.** Neither `/packages` nor `/packages/create-package` has `loading.tsx`
or `error.tsx`. A slow query gives a blank screen; a failed query escalates to the app-level error.

### 2.2 Wizard performance

**F9 — One monolithic state object.** `create-package-wizard.tsx:56` holds ~120 fields in a single
`useState`. Every keystroke in any field replaces the whole object, re-renders the wizard, the
`Stepper`, and re-creates all seven `<Step>` elements.

**F10 — Seven zod parses per keystroke.** `stepValidity` (`create-package-wizard.tsx:93-99`) runs
`isStepValid` for steps 1-6, and `isCurrentStepValid` (line 84) runs a seventh — each parsing the
whole form, including `step2Schema`'s `superRefine`. That is ~7 full-object validations per
character typed.

**F11 — ResizeObserver churn / forced reflow per render.**
`components/ui/stepper.tsx:271-273` passes `onHeightReady={(h) => setParentHeight(h)}` — a new
closure every render — and it is a dependency of the `useLayoutEffect` at line 295-315. The observer
is therefore disconnected, re-created, and `offsetHeight` read (a forced synchronous layout) on
**every render**, i.e. every keystroke, on top of the spring height animation.

**F12 — All seven steps in the first client chunk.**
`create-package-wizard.tsx:15-21` statically imports all steps (~168 KB of source: step-2 is 40 KB,
step-3 36 KB, step-4 32 KB) even though exactly one is visible. No `next/dynamic`.

**F13 — Autosave writes the entire row.** `use-draft-autosave.ts:127` flushes the whole form, and
`saveDraftAction` (`packages/actions.ts:76`) issues `update(row)` across ~120 columns and 5 JSONB
blobs every 2 s of typing and on every step change, regardless of what actually changed. The server
re-parses the entire form each time. There is also no optimistic-concurrency check, so two open tabs
silently clobber each other.

### 2.3 UX

**F14 — There is no way to _look_ at a package.** The card grid is the entire module. The only
"open" path is `openInWizard` (`packages-list.tsx:67`), which drops a user who wanted to check a
price into a 7-step editing wizard. The card even carries `hover:cursor-pointer`
(`packages-list.tsx:188`) with **no click handler** — a dead affordance.

**F15 — The list is far weaker than Departure Groups.** No search, no sort, no pagination, no KPI
row, no export, no archived view, no bulk actions, no density/table view, no "duplicate" — the
single most common catalogue action when a new season opens. Filters are 6 hard-coded chips
(`types.ts:30-37`) mixing category and status in one dimension.

**F16 — No URL state.** `activeFilter` is `useState` (`packages-list.tsx:46`) and the wizard's
`activeStep` is `useState` (`create-package-wizard.tsx:59`). Refreshing the wizard on step 6 returns
you to step 1; no view is shareable or bookmarkable; the back button does nothing useful.

**F17 — Three toast systems.** `packages-list.tsx:48-54,83-97` implements a bespoke toast that is
**dead code** (`showToast` is never called) while the same file also uses the shared
`@/components/ui/toast`; `create-package-wizard.tsx:60-63,205-221` implements a third with an
uncleaned `setTimeout`.

**F18 — Ad-hoc badge styling.** Category and status colours are hand-written per card
(`packages-list.tsx:196-233`) instead of the module-wide `ToneBadge` / `TONE_CLASS` system, so
Packages and Departure Groups already disagree visually on what "Draft" or "Sales Closed" looks
like.

**F19 — Misleading price.** `page.tsx:24` maps `amount` from `quad_price` alone and the card labels
it "Price per pilgrim" (`packages-list.tsx:305`). With `quad_price` null it renders `LKR 0`.

**F20 — Publish leaves the app.** `handleFinalSubmit` calls `router.back()`
(`create-package-wizard.tsx:171`). Opened from a bookmark or a fresh tab, that navigates out of the
CRM, and it never lands the user on the thing they just published.

**F21 — Validity is a boolean.** `isStepValid` returns only `.success` (`schemas.ts:158-184`), so the
UI can grey out "Next" but cannot say which field is wrong. Departure Groups maps zod issues to
field errors and renders them inline.

**F22 — Hydration risk in the seeded form.** `INITIAL_PACKAGE_FORM_DATA`
(`create-package/types.ts:534`) evaluates `format(new Date(), "MMMM yyyy")` at module scope, so the
server and client can produce different values; lines 556-557 hardcode `new Date("2026-11-30")`.

### 2.4 Dead code — 12 files, ~135 KB, never imported

`add-new-package/add-new-package.tsx`, and in `create-package/components/`:
`step-basic-info.tsx`, `step-accommodation.tsx`, `step-accommodation/components/group-transportation-input.tsx`,
`step-inclusions.tsx`, `step-itinerary.tsx`, `step-pricing.tsx`, `step-review.tsx`,
`step-basic-duration-picker.tsx`, `description-template-chooser-dialog.tsx`,
`package-mode-selector.tsx`, `package-name-input.tsx`.
(The last three are reachable only from other dead files.) Verified: no import of any of them exists
outside the dead set.

---

## 3. Target architecture

### 3.1 Principles

1. **The server decides what exists; the client decides what is emphasised.** Filtering, sorting and
   paging move into SQL and into `searchParams`. The client keeps only ephemeral UI state
   (open sheets, hovered rows).
2. **URL is the state container.** `?view=&q=&category=&status=&season=&sort=&dir=&page=&mode=` on
   the list; `?step=` on the wizard. Shareable, bookmarkable, back-button-correct.
3. **Capabilities gate the fetch, not just the render** — same posture as Departure Groups.
4. **One design system.** All new Packages UI is assembled from the blocks in §1, extracted into
   shared modules so both features import the same code.
5. **The wizard is a form, not a page tree.** Per-field subscriptions, per-slice validation,
   per-step code splitting, patch-based saves.
6. **No `cacheComponents` / `use cache` for now.** Every read is cookie-authenticated Supabase, so
   these routes are inherently dynamic; caching them would need a request-scoped key and buys
   nothing here. Speed comes from narrow projections + `loading.tsx`/Suspense streaming + the
   existing `React.cache` dedupe. Revisit only if a public catalogue is added.

### 3.2 New/changed file layout

```
lib/
  access/packages-access.ts               NEW  capability map + visibleTabsFor + gating helpers
  validations/packages.ts                 NEW  single source: per-step schemas, full schema, field-error mapper
  types/packages.ts                       NEW  domain types moved out of app/(main)/... (fixes F6)
  data/
    packages.ts                           EDIT thin re-export → repository
    packages-repository.ts                NEW  listPackages(query), getPackageDetail, getPackageUsage, listSeasons/branches
    packages-kpis.ts                      NEW  server-computed KPI aggregates
  ui/tone.ts                              NEW  TONE_CLASS/TONE_BAR/percentTone lifted out of departure-groups/utils.ts

components/
  data-table/
    data-table.tsx                        NEW  generic shell extracted from groups-data-table.tsx
    sortable-header.tsx                   NEW  extracted from groups-columns.tsx
    filter-select.tsx                     NEW  extracted from departure-groups-list.tsx
    saved-view-bar.tsx                    NEW
  ui/tone-badge.tsx                       NEW  ToneBadge/ProgressBar/PersonChip/EmptyState/PermissionDenied

app/(main)/packages/
  page.tsx                                EDIT server: parse searchParams → repository → list
  loading.tsx                             NEW  skeleton (KPI row + table)
  error.tsx                               NEW
  actions.ts                              EDIT + archive/restore/duplicate/publish/unpublish/feature; guarded delete
  components/
    packages-list.tsx                     REWRITE
    packages-kpi-cards/                   NEW  mirrors departure-groups-kpi-cards
    packages-table/{packages-data-table,packages-columns,package-table-sorting}.tsx  NEW
    package-card-grid.tsx                 NEW  card mode, restyled onto ToneBadge
    package-status-badges.tsx             NEW  thin wrappers over ToneBadge
    archived-packages-sheet.tsx           NEW
    duplicate-package-dialog.tsx          NEW
    confirm-package-action-dialog.tsx     NEW  archive/restore/unpublish/delete
    delete-package-dialog.tsx             EDIT usage-aware copy
  csv.ts                                  NEW  reuse departure-groups/xlsx.ts for the binary side
  [packageId]/
    page.tsx                              NEW  read-only detail, tabs from searchParams
    loading.tsx / error.tsx               NEW
    components/package-detail.tsx         NEW  shell, only active tab mounted
    components/tabs/*.tsx                 NEW  overview, pricing, journey, services, requirements, group-defaults, groups
    edit/page.tsx                         NEW  wizard in edit mode (replaces ?id=)
  new/page.tsx                            NEW  wizard in create mode
  create-package/                         REMOVE after redirect shim; keep wizard internals under create-package/components → move to packages/wizard/

app/(main)/packages/wizard/               NEW home for the wizard
  package-form-store.ts                   NEW  external store + selector hooks
  use-draft-autosave.ts                   EDIT patch-based, concurrency-checked
  mappers.ts                              EDIT + patch→column mapping
  steps/step-*.tsx                        MOVED from create-package/components, lazy-loaded

supabase/migrations/
  <ts>_packages_module_v2.sql             NEW  see §3.4
```

Deleted in phase 0: the 12 dead files in §2.4.

### 3.3 Data contracts

```ts
// lib/data/packages-repository.ts
export interface PackageListQuery {
  view: PackageSavedView; // 'All' | 'Open for Sale' | 'My Drafts' | 'Featured' | 'Selling Now' | 'Needs Attention' | 'Archived'
  q?: string; // title / internal_code / season
  journeyType?: "Umrah" | "Hajj" | "Early Registration";
  category?: "Economy" | "Standard" | "Premium" | "VIP" | "Custom";
  status?: PackageStatusRow;
  season?: string;
  branch?: string;
  visibility?: string;
  featured?: boolean;
  sort: PackageSortField; // updatedAt | title | priceFrom | duration | groups | completeness | status
  dir: "asc" | "desc";
  page: number; // 1-based
  pageSize: number; // 10 | 20 | 50 | 100
}

export interface PackageListItem {
  id: string;
  code: string;
  title: string;
  journeyType: string;
  category: string;
  season: string;
  branch: string;
  status: PackageStatusRow;
  visibility: string;
  featured: boolean;
  durationDays: number;
  durationNights: number;
  durationLabel: string;
  itineraryDays: number; // from the generated column, not the JSONB
  currency: string;
  priceFrom: number | null;
  priceTo: number | null;
  completeness: number; // 0-100, steps 1-6 (see §3.5)
  missingSteps: number[]; // drives "Primary gap" column
  groupCount: number;
  liveGroupCount: number;
  seatsBooked: number;
  seatsCapacity: number;
  updatedAt: string;
  ownerName: string | null;
  // Null unless capabilities.viewInternalFinance
  estimatedMarginPct: number | null;
}

export interface PackageListResult {
  items: PackageListItem[];
  total: number;
  kpis: PackageListKpis;
  facets: PackageFacets;
}
```

`listPackages` issues **two** queries: the filtered/paged page of rows (joined against the usage
view), and one aggregate query for KPIs + facet option lists over the same filter minus the facet's
own dimension. `getPackageDetail(id, role)` selects explicit columns and nulls `finance_estimate`
unless `capabilitiesFor(role).viewInternalFinance`.

### 3.4 Migration `<ts>_packages_module_v2.sql`

```sql
-- 1. Cheap itinerary length without shipping the JSONB.
alter table public.packages
  add column if not exists itinerary_days integer
    generated always as (jsonb_array_length(coalesce(itinerary, '[]'::jsonb))) stored;

-- 2. Archive lifecycle metadata (status already carries 'Archived').
alter table public.packages
  add column if not exists archived_at    timestamptz,
  add column if not exists duplicated_from uuid references public.packages (id) on delete set null;

-- 3. Catalogue usage, so the list can show operational truth per package.
create or replace view public.package_usage as
  select package_template_id as package_id,
         count(*)                                            as group_count,
         count(*) filter (where archived = false
                            and group_status <> 'CANCELLED') as live_group_count,
         coalesce(sum(booked_seats), 0)                      as seats_booked,
         coalesce(sum(capacity), 0)                          as seats_capacity
    from public.departure_groups
   where package_template_id is not null
   group by package_template_id;

-- 4. Search + list ordering support.
create extension if not exists pg_trgm;
create index if not exists packages_title_trgm_idx on public.packages using gin (title gin_trgm_ops);
create index if not exists packages_code_trgm_idx  on public.packages using gin (internal_code gin_trgm_ops);
create index if not exists packages_season_idx     on public.packages (season);
create index if not exists packages_cat_status_idx on public.packages (category, status, updated_at desc);
```

Follow-up (separate migration, flagged as a decision for the owner): tighten the
`staff update/delete packages` policies from `using (true)` to a role check against
`auth.jwt() -> 'user_metadata' ->> 'staff_role'`, matching §3.6.

### 3.5 Completeness score (the "readiness" analogue)

Reuse the readiness metaphor from Departure Groups: `completeness = round(validSteps / 6 * 100)`,
computed **server-side** with the shared per-step schemas in `lib/validations/packages.ts`, rendered
with the existing `ProgressBar` + tone. `missingSteps` drives a "Primary gap" column mirroring
`primaryBlocker` (`groups-columns.tsx:270-297`). This turns the list into a work queue — the single
biggest UX gain, because today a half-finished draft is indistinguishable from a finished one.

### 3.6 Capabilities (`lib/access/packages-access.ts`)

|                        | ADMIN | CEO | OPERATIONS | FINANCE | MARKETING    | VISA | GUIDE |
| ---------------------- | ----- | --- | ---------- | ------- | ------------ | ---- | ----- |
| viewModule             | ✓     | ✓   | ✓          | ✓       | ✓            | ✓    | —     |
| createPackage          | ✓     | —   | ✓          | —       | —            | —    | —     |
| editPackage            | ✓     | —   | ✓          | —       | —            | —    | —     |
| editPricing            | ✓     | —   | ✓          | ✓       | —            | —    | —     |
| publishPackage         | ✓     | —   | ✓          | —       | —            | —    | —     |
| duplicatePackage       | ✓     | —   | ✓          | —       | ✓ (as draft) | —    | —     |
| archiveOrRestore       | ✓     | —   | ✓          | —       | —            | —    | —     |
| deletePackage          | ✓     | —   | —          | —       | —            | —    | —     |
| toggleFeatured         | ✓     | —   | ✓          | —       | ✓            | —    | —     |
| viewInternalFinance    | ✓     | ✓   | —          | ✓       | —            | —    | —     |
| exportCatalogue        | ✓     | ✓   | ✓          | ✓       | —            | ✓    | —     |
| createGroupFromPackage | ✓     | —   | ✓          | —       | —            | —    | —     |

`GUIDE` gets `notFound()` on the module, matching how Departure Groups hides what a role must not
see instead of disabling it. Marketing sees only `Open for Sale` + its own drafts (enforced in the
repository, not the component).

---

## 4. Screen designs

### 4.1 `/packages` — list

Layout, top to bottom, all from §1 blocks:

1. **PageHeader** — title "Packages", subtitle "The commercial catalogue behind every departure
   group.", breadcrumb Home → Packages. Action slot: `Create Package` (secondary, capability-gated) +
   overflow `MoreVertical` menu with _Import Packages_, _Export ▸ Excel / CSV_, _View Archived
   Packages (n)_ — identical to `departure-groups-list.tsx:438-489`.
2. **KPI row** (`packages-kpi-cards/`, 4-up grid, server-computed over the filtered set):
   - _Open for sale_ — `n` · "of N packages in view"
   - _Drafts in progress_ — `n` · "oldest untouched for X days"
   - _Live departure groups_ — `n` · "running from these packages"
   - _Seats sold_ — `booked / capacity` · "`p`% occupancy across live groups"
3. **Saved views** chip bar: `All Packages · Open for Sale · My Drafts · Featured · Selling Now ·
Needs Attention · Archived`. "Needs Attention" = published with no live group, or price validity
   expired, or completeness < 100.
4. **Filter row**: Journey, Category, Status, Season, Price band, Duration — then _More Filters_ →
   Branch, Visibility, Featured, Owner. `Clear n` when any is set.
5. **Section line**: `<view name>` + `n Total` pill on the left, "Sorted by …" on the right.
6. **View toggle** (table ⇄ cards) in the table toolbar, persisted in `?mode=`. Cards stay for
   catalogue browsing but are restyled onto `ToneBadge` and get a real click target.
7. **Table** (`packages-data-table.tsx`, generic shell):

   | Column       | Content                                                    | Sortable |
   | ------------ | ---------------------------------------------------------- | -------- |
   | Package      | title + `internal_code` badge + season line                | ✓        |
   | Journey      | `ToneBadge` (Umrah / Hajj / Early Reg)                     | —        |
   | Duration     | `12D / 11N` + `n` itinerary days                           | ✓        |
   | Price from   | `priceFrom` + range hint (`quad → single`)                 | ✓        |
   | Status       | status `ToneBadge` + visibility chip + ★ featured          | ✓        |
   | Groups       | `liveGroupCount` + seats `ProgressBar` (`booked/capacity`) | ✓        |
   | Completeness | `%` + tone bar + "Primary gap: Pricing"                    | ✓        |
   | Updated      | relative + owner `PersonChip`                              | ✓        |
   | ⋯            | row menu                                                   | —        |

   Row menu (capability-gated): _Open Package_ · _Edit Details ▸ jump to step_ · _Duplicate_ ·
   _Create Departure Group from this package_ (deep-links `/departure-groups?create=1&template=<id>`) ·
   _Publish / Unpublish_ · _Feature / Unfeature_ · _Archive_ · _Delete_ (admin, only when
   `groupCount === 0`, otherwise shown disabled with the reason).

   Row click → `/packages/[packageId]`.

8. **Empty states** via `EmptyState`, one message for "no packages yet" and one for "nothing matches
   this filter", exactly as `groups-data-table.tsx:188-192` does it.

### 4.2 `/packages/[packageId]` — detail (new)

Header block mirroring `departure-group-detail.tsx`: title, code badge, journey/status/visibility
badges, key facts strip (duration · price from · seats sold across groups · last published), and an
action cluster (Edit, Duplicate, Create Departure Group, ⋯).

Tabs (animate-ui `Tabs`, **only the active tab mounted**, tab in `?tab=`):
`Overview · Pricing & Payments · Journey & Flights · Services & Accommodation · Traveller
Requirements · Group Defaults · Departure Groups`.

- Every tab is read-only and has an "Edit this section" button → `/packages/[id]/edit?step=n`.
- _Pricing & Payments_ hides the internal finance card unless `viewInternalFinance`; the data is not
  fetched for other roles.
- _Departure Groups_ lists groups built from this package (from `package_usage` + a scoped query)
  with occupancy and readiness — this is the tab that makes the catalogue actually useful, and it
  reuses the departure-group badge set directly.

### 4.3 `/packages/new` and `/packages/[packageId]/edit` — wizard

Same 7 steps and the same visual shell (`PageHeader` + `Stepper` in a `Card` + sticky footer). What
changes is everything behind it:

- **Step in the URL** (`?step=3`), so refresh and share keep position; the server validates the step
  index against the saved draft's completeness before rendering.
- **Per-step lazy loading** with `next/dynamic`; the step the URL asks for is server-rendered, the
  neighbours are prefetched on idle and on step-indicator hover.
- **Per-field subscriptions** via the store in §5.1 — typing in "Quad price" re-renders that input
  and the derived summary, nothing else.
- **Incremental validation** — only the slice that changed is re-parsed; the stepper reads cached
  per-step validity.
- **Field-level errors** from `toPackageFieldErrors`, shown inline on blur and on a failed "Next",
  with the header of each step showing `n issues remaining` instead of just a dead "Next" button.
- **Patch autosave** with a save-state chip in the header (`Saved 14:32` / `Saving…` / `Retry`),
  keeping the existing single-flight queue (`use-draft-autosave.ts:57-95` is good and stays).
- **Review step** gains a completeness matrix per step with jump links (extends the existing
  `onGoToStep`).
- **Publish** → `revalidatePath('/packages')` + `redirect('/packages/[id]?published=1')`, replacing
  `router.back()`.
- **Leave-safety**: `beforeunload` only while a write is genuinely pending (already correct at
  `create-package-wizard.tsx:110-119`) plus a "You have unsaved changes" dialog on in-app navigation.

---

## 5. Key mechanisms

### 5.1 Wizard form store (fixes F9, F10)

A ~90-line dependency-free external store, no library:

```ts
// wizard/package-form-store.ts
export interface PackageFormStore {
  getState(): PackageFormData;
  getField<K extends keyof PackageFormData>(k: K): PackageFormData[K];
  setField<K extends keyof PackageFormData>(k: K, v: PackageFormData[K]): void;
  patch(p: Partial<PackageFormData>): void;
  subscribe(fn: () => void): () => void;
  subscribeField(k: keyof PackageFormData, fn: () => void): () => void;
  getStepValidity(step: number): StepValidity;   // memoised per slice version
  getDirtyKeys(): Set<keyof PackageFormData>;    // consumed by autosave
  markSaved(keys: Iterable<keyof PackageFormData>): void;
}
export const usePackageField = <K extends keyof PackageFormData>(k: K) => …  // useSyncExternalStore
export const useStepValidity = (step: number) => …
```

- Each key belongs to exactly one step slice (`FIELD_STEP: Record<keyof PackageFormData, number>`).
  `setField` bumps that slice's version; `getStepValidity` re-parses only when its version moved.
- Steps consume `usePackageField('quadPrice')` instead of `formData`/`setFormData` props, so the
  prop-drilled god object disappears.
- `getState()` still yields a plain `PackageFormData` for autosave, publish and the review step, so
  the mappers and schemas are untouched.
- Cross-field rules that currently live in step components (e.g. `journeyType → category/season` at
  `step-1-commercial-identity.tsx:100-119`) move into a `derive()` step inside `setField`, so they
  apply no matter which surface writes the field.

_Alternative considered:_ enabling React Compiler (`reactCompiler` in `next.config.ts`). It reduces
re-render cost but does not fix a single mutable object being the subscription unit, nor the 7
parses per keystroke. It can be turned on later as an independent win.

### 5.2 Patch-based autosave (fixes F13)

- Client sends `{ packageId, patch, expectedUpdatedAt }` where `patch` is built from
  `getDirtyKeys()`.
- Server validates the patch against a **partial** of the shared schema, maps keys → columns via a
  static `FIELD_COLUMN` map (derived from the existing `formDataToRow`), and issues
  `update(columns).eq('id', …).eq('updated_at', expectedUpdatedAt)`.
- A zero-row result means another tab wrote first → `{ ok: false, code: 'STALE' }`, and the wizard
  shows "This draft changed in another tab — reload to continue" instead of silently overwriting.
- The response returns the new `updated_at`, which becomes the next `expectedUpdatedAt`.
- `markSaved(keys)` clears exactly the keys that were persisted, so edits made during the flight stay
  dirty (this preserves the current correct behaviour at `use-draft-autosave.ts:61-64`).

### 5.3 Stepper fix (fixes F11)

In `components/ui/stepper.tsx`:

- Wrap the height callback in `useCallback` (or keep the setter identity by passing `setParentHeight`
  directly) and drop `children` from the `useLayoutEffect` deps — the ResizeObserver already reports
  content changes, so it should be created **once per mounted step**.
- Skip the height spring while `prefers-reduced-motion` is set.
- These are shared-component changes; regression-check the other `Stepper` consumers before landing
  (currently only the package wizard imports it — confirm at implementation time).

### 5.4 URL state

The list page is a Server Component that parses `searchParams` into `PackageListQuery` (with a
`parsePackageListQuery` helper that clamps and defaults everything), calls the repository, and passes
`{ items, total, kpis, facets, query, can }` down. The client component writes state back with
`router.replace(?…, { scroll: false })` and `useTransition`, so filter changes stream in without a
spinner and the table keeps the old rows until the new page arrives.

---

## 6. Phased delivery

Each phase is independently shippable and leaves `main` green.

### Phase 0 — Cleanup & shared foundation _(no user-visible change)_

1. Delete the 12 dead files (§2.4); run `npm run lint` and `npx tsc --noEmit`.
2. Move domain types → `lib/types/packages.ts`; re-point `lib/types/database.ts` (F6). Keep
   `create-package/types.ts` as a re-export for one release to avoid a wide diff.
3. Extract shared UI: `components/ui/tone-badge.tsx`, `lib/ui/tone.ts`,
   `components/data-table/{data-table,sortable-header,filter-select,saved-view-bar}.tsx` — generic
   over `TData`, lifted from the Departure Groups files with no behaviour change.
4. Re-point Departure Groups at the extracted modules (its own files become thin wrappers). This is
   the step that guarantees the two modules cannot drift.
5. Unify toasts: delete the bespoke ones (F17), keep `@/components/ui/toast`.
   **Exit:** zero behaviour change in Departure Groups, verified by walking the list + detail tabs.

### Phase 1 — Data layer, access, migration

6. `supabase/migrations/<ts>_packages_module_v2.sql` (§3.4).
7. `lib/access/packages-access.ts` (§3.6) + `lib/validations/packages.ts` (merging `schemas.ts` and
   `server-schema.ts`, F7) + `toPackageFieldErrors`.
8. `lib/data/packages-repository.ts`: `listPackages(query, role)`, `getPackageDetail(id, role)` with
   finance nulling (F4), `getPackageUsage(id)`, `listPackageFacets()`. Narrow projections; no
   `itinerary` in list queries (F1).
9. `lib/data/packages-kpis.ts`.
   **Exit:** repository unit-checked against a seeded database; old list page still renders through a
   compatibility adapter.

### Phase 2 — List screen

10. `page.tsx` → searchParams-driven Server Component; add `loading.tsx` (KPI + table skeleton) and
    `error.tsx` (F8).
11. `packages-kpi-cards/`, `packages-table/*`, `package-status-badges.tsx`, rewritten
    `packages-list.tsx` with saved views, filters, search, sort, pagination, table/card toggle.
12. `csv.ts` + reuse `xlsx.ts`; export honours the current view exactly as
    `departure-groups-list.tsx:304-332` does.
13. `archived-packages-sheet.tsx`.
    **Exit:** parity checklist against Departure Groups (search, sort, page, export, archive, empty
    states, keyboard + `aria-sort`), and no `itinerary` in the RSC payload.

### Phase 3 — Lifecycle actions

14. `actions.ts`: `archivePackageAction`, `restorePackageAction`, `duplicatePackageAction`,
    `publishPackageAction` (kept, plus redirect target), `unpublishPackageAction`,
    `setFeaturedAction`, and `deletePackageAction` rewritten to check `package_usage` first and
    return a human message naming the blocking groups (F5).
15. Every action: `requireUser()` → capability check → zod parse → `revalidatePath`. Confirmations go
    through one `confirm-package-action-dialog.tsx` modelled on `confirm-action-dialog.tsx`.
    **Exit:** deleting a used package explains itself; archive/restore round-trips.

### Phase 4 — Detail screen

16. `/packages/[packageId]` route, `package-detail.tsx` shell, seven read-only tabs, `?tab=` handling,
    loading/error boundaries.
17. "Departure Groups" tab; "Create Departure Group from this package" deep-link into the existing
    create sheet with the template preselected.
    **Exit:** a user can answer "what does this package cost and who is selling it" without opening
    the wizard (F14).

### Phase 5 — Wizard rebuild

18. Move `create-package/components/step-*` → `packages/wizard/steps/`; add `/packages/new` and
    `/packages/[packageId]/edit`; keep `/packages/create-package(?id=)` as a redirect for one release
    (F16, F20).
19. Land `package-form-store.ts`; convert steps one at a time from
    `{formData, setFormData}` props to selector hooks. Steps 2, 3, 4 first — they are the largest and
    hold the heaviest inputs.
20. Incremental validation + inline field errors + per-step issue counts (F10, F21).
21. `next/dynamic` per step + idle/hover prefetch (F12).
22. Patch autosave + stale-write detection (F13, §5.2).
23. Stepper ResizeObserver + reduced-motion fix (F11, §5.3).
24. Fix seeded defaults to be computed on first render rather than at module scope (F22).
    **Exit:** perf budget in §7 met.

### Phase 6 — Polish & verification

25. Dark-mode and responsive pass on every new surface (the KPI grid, filter row and table already
    have the right breakpoints — inherit, don't re-invent).
26. Keyboard: row menus, sheet focus traps, `aria-sort`, `aria-live` on the save chip.
27. Update `AGENTS.md`/module docs with the new layout.

**Suggested branch/PR split:** phase 0 · phase 1+2 · phase 3 · phase 4 · phase 5 (further split at
step 19 if the diff is large) · phase 6.

---

## 7. Acceptance criteria

**Correctness**

- No package data leaves the server that the acting role may not see; verified by fetching
  `/packages` as `FINANCE`, `MARKETING`, `VISA`, `GUIDE` and searching the RSC payload for
  `finance_estimate`.
- Deleting a package used by any departure group is impossible from the UI and returns a named,
  actionable message from the action.
- A wizard draft edited in two tabs never silently loses a field; the second writer is told.
- Refreshing `/packages/new?step=5` stays on step 5; refreshing a filtered list keeps the filters.

**Performance** (measured with the React Profiler and the Network panel on a seeded database of 200
packages / 400 groups)

- `/packages` RSC payload: **< 60 KB** for a 20-row page (today it is the full table including every
  itinerary).
- `/packages` server query time: **< 120 ms** p95, two queries per request.
- Wizard keystroke: **≤ 2 component renders** and **≤ 1 zod parse** (today: whole tree + 7 parses).
- Wizard route first-load JS: **≤ 40%** of today's, with only the active step's chunk.
- Autosave request body: only changed keys (typically < 1 KB vs the full row today).
- No ResizeObserver disconnect/reconnect during typing.

**Consistency**

- Every colour, badge, table, filter chip, sheet and dialog on the Packages screens resolves to a
  block in `components/` shared with Departure Groups — no bespoke Tailwind status colours remain in
  the packages folder.
- Departure Groups renders identically before and after the extraction in phase 0.

---

## 8. Risks and decisions needed

| Risk                                                                                   | Mitigation                                                                                                                          |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 extraction touches Departure Groups, the module that was just stabilised       | Pure moves with no behaviour change; land alone; walk the full DG flow before merging                                               |
| Route rename `create-package` → `new` / `[id]/edit` breaks bookmarks and any deep link | Keep the old route as a redirect for one release; grep for `/packages/create-package` (currently `packages-list.tsx:68,117,174`)    |
| `package_usage` view + generated column need a migration on a live database            | Both are additive and non-blocking; `itinerary_days` is `stored` and `jsonb_array_length` is immutable, so the rewrite is a one-off |
| Wizard store conversion is 7 large files                                               | Convert one step per PR behind the same public props shape; the store exposes `getState()` so a half-converted wizard still works   |
| RLS remains `using (true)`                                                             | Capability checks in Server Actions close the app-level hole now; tightening RLS is a separate, explicitly flagged migration        |

**Decisions for you before phase 1:**

1. **Guides and Packages** — plan assumes `GUIDE` has no access to the module at all. Confirm.
2. **Marketing** — read-only on published packages + duplicate-to-draft, or no create at all?
3. **Delete** — keep a hard delete for admins on unused packages, or make Archive the only terminal
   state (my recommendation: archive-only, matching the "never erase a group" posture in
   `departure-groups-access.ts:36-41`)?
4. **Route rename** — proceed with `/packages/new` + `/packages/[id]/edit`, or keep
   `create-package?id=`?
5. **Card view** — keep the catalogue card grid as a toggle (my recommendation) or go table-only like
   Departure Groups?
