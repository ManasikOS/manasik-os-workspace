# Packages Module — Production Readiness Audit & Implementation Plan

**Scope:** Packages module (`app/(main)/packages/**`, `lib/data/packages-*.ts`,
`lib/validations/packages.ts`, `lib/access/packages-access.ts`, package migrations), its
contract with Departure Groups (`lib/data/departure-groups*.ts`,
`app/(main)/departure-groups/**`), and every other module that reads `packages`
(Leads / Sales Copilot, AI agents, Reports, Costing).

**Status:** Audit complete. **Phase 0 (security hotfix), Phase 1 (lifecycle & integrity), most
of Phase 2 (versioning & the group contract), Phase 3 (cross-module alignment), Phase 4 (UX
consolidation), and most of Phase 5 (quality, observability, scale) are implemented** — see
"Implementation log" at the end of this document for exactly what shipped, what was deliberately
deferred, and any place the implementation diverged from what this plan originally proposed.
Branch audited: `packages` @ `67d4833`.

**Baseline health:** `tsc --noEmit` passes (0 errors). ESLint on the module reports
**11 errors / 65 warnings** (10 × `no-explicit-any` in `packages-list.tsx:243-259`, 1 ×
"Cannot access refs during render" in `create-package-dialog.tsx:308`, plus dead imports and
unused handlers such as `step-7-review-publish.tsx:58,121`). There are **no automated tests**
anywhere in the repo.

---

## 1. Executive summary

The module looks finished in the UI but is not safe for production. Five problems matter
most:

1. **You can publish without the publish check.** The wizard's Step 1 has a Status picker,
   and autosave writes `status` straight to the row. Any role that can edit a package can set
   it to "Open for Sale". That skips `publishPackageAction`'s completeness check and the
   `publishPackage` capability. It can also set "Archived" without `archived_at`, which is a
   state nothing else in the module expects.
2. **The server trusts the client on package status when a group is created.**
   `allowDraftTemplate` comes from the browser, and `createDepartureGroup()` never reads the
   package's real status. A non-admin can build a selling group from a Draft, Sales Closed
   or Archived package by sending `allowDraftTemplate: false`.
3. **App checks and database rules don't match.** RLS lets FINANCE and MARKETING update any
   package, and lets CEO/VISA read the internal finance data, all through the Supabase
   client. The Roles & Permissions editor (`role_permissions`) is ignored by this module.
4. **Leads has quoted wrong prices since the pricing move.** Pricing moved from packages to
   `departure_group_pricing`, but Leads and "Find groups" still read the old
   `packages.*_price` columns and the always-empty `pricing_snapshot`. Quotes fall back to
   the baseline price.
5. **Editing a published package changes it live with no checks.** A package that is Open
   for Sale can be autosaved into an invalid state, for example with zero payment milestones,
   and stays on sale. There's no versioning, no audit trail and no review step.

---

## 2. Findings

Severity: **S1** = security, data loss or wrong money (fix before production). **S2** = wrong
behaviour or integrity gaps. **S3** = UX, performance or maintainability.

### 2.1 Authorization & security

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| A1 | S1 | **Autosave can publish, archive and feature a package.** `formDataToRow` writes `status` and `featured` from the form. Both `saveDraftAction` (update path) and `savePackagePatchAction` accept them. Step 1 renders a Status selector. This skips publish validation, the `publishPackage` capability and the `toggleFeatured` capability. Setting "Archived" this way leaves `archived_at` null, so the package shows up in the *active* list as Archived. | `create-package/mappers.ts:53-54`, `actions.ts:112-117`, `actions.ts:196-217`, `step-1-commercial-identity.tsx:310-326`, `lib/validations/packages.ts:113` |
| A2 | S1 | **Package-status gate for group creation is client-trusted.** `allowDraftTemplate` is a client flag. `createDepartureGroup()` never checks `template.status`, so Draft, Sales Closed and Archived packages can all be used. The comment says the result is "always a PLANNING group", but `salesStatus` also comes from input and can be `SELLING`. | `departure-groups/actions.ts:204-212`, `lib/data/departure-groups.ts:2241-2287`, `create-departure-group-sheet.tsx:439` |
| A3 | S1 | **RLS is looser than the app.** Update is allowed for `ADMIN, OPERATIONS, FINANCE, MARKETING` on *every* package. MARKETING's "own drafts or Open for Sale" rule and FINANCE's lack of `editPackage` exist only in server actions, so the Supabase REST API gets around both. | `20260822090000_rls_hardening.sql:86-90`, `lib/access/packages-access.ts:111-121` |
| A4 | S1 | **Dynamic roles are ignored.** Packages uses the hard-coded `capabilitiesForPackages(role)` everywhere and never calls `loadDynamicCapabilities`. Package permissions saved in Management → Roles have no effect. | `lib/access/packages-access.ts:106`, `lib/access/dynamic-capabilities.ts` (used only by Team) |
| A5 | S2 | **Missing object-level checks.** `publishPackageAction` (update path), `publishExistingPackageAction`, `unpublishPackageAction`, `setPackageFeaturedAction`, `archive/restore`, `duplicatePackageAction` and `getPackageForEditAction` don't call `canRoleViewPackage`. `getPackage()` used by `/packages/[id]/edit` does no role or visibility check. | `actions.ts:268-274, 297-333, 350-377, 379-563`, `packages-repository.ts:254-269`, `[packageId]/edit/page.tsx:22` |
| A6 | S2 | **Finance masking is incomplete and partly obsolete.** Only `getPackageDetail` masks `finance_estimate`. `getPackage` and `getPackageForEditAction` return it raw, and RLS exposes it to every reader. The column is deprecated but still seeds nothing, so the capability protects nothing useful. | `packages-repository.ts:235-248`, `20260914090000_package_template_field_realignment.sql:62` |
| A7 | S3 | **CSV/XLSX export has no formula-injection guard.** A title like `=HYPERLINK(...)` goes out as-is. | `lib/csv.ts`, `packages/csv.ts` |
| A8 | S3 | `listDepartureGroupsForPackage` and `getPackageUsage` skip `requireUser()` and swallow errors, so failures show as "0 groups". | `packages-repository.ts:153-215` |

### 2.2 Lifecycle & data integrity

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| B1 | S1 | **Published packages are edited in place with no validation.** Autosave writes to an Open-for-Sale row without re-running step validation, so a sellable package can become incomplete. There's no version history, no "changes pending re-publish" state and no audit log. | `use-draft-autosave.ts`, `actions.ts:157-229` |
| B2 | S2 | **No enforced state machine.** Unpublish works on Draft and Archived rows. `publishExistingPackageAction` publishes an *archived* package: status becomes Open for Sale while `archived_at` stays set, so it's sellable but hidden. Restore always forces `Draft` and drops the previous state. `publishPackageAction` keeps `form.status` when it isn't Draft, so "Save Package" on Sales Closed or Archived "publishes" into that status and overwrites `published_at` on every save. | `actions.ts:259-264, 324-327, 389-394, 449, 476` |
| B3 | S2 | **Archive ignores live groups.** A package can be archived while its groups are still selling. It then drops out of the group-creation picker and out of the Leads catalogue, and nobody is warned. | `actions.ts:434-459` |
| B4 | S2 | **`internal_code` has no uniqueness.** No per-agency unique constraint exists. Duplicating twice gives two identical `…-COPY` codes, and the code is what group snapshots and reports show. | `20260808090000_create_packages.sql:23`, `actions.ts:550` |
| B5 | S2 | **Validation rules disagree.** The server's publish gate (`step3Schema`) allows an empty itinerary, but the list's gap calculator marks step 3 incomplete when `itinerary_days = 0`. Step 1 requires `description`, but `computeListStepGaps` doesn't check it. So "100% complete" in the list and "publishable" can disagree in both directions. | `lib/validations/packages.ts:238-243` vs `:345-366` |
| B6 | S2 | **No cross-field rules.** Nothing enforces `makkah_nights + madinah_nights ≤ nights`, `days = nights + 1`, `min_group_size ≤ default_capacity ≤ max_pilgrims`, `default_group_capacity ≤ max_pilgrims`, milestone percentages summing to 100 with exactly one "Remaining Balance", itinerary `dayNumber` within `1..days`, non-negative milestone amounts, or text length limits. Payload size is unbounded, which is a DoS risk on the ~120-column JSON writes. | `lib/validations/packages.ts:27-180` |
| B7 | S2 | **`publishPackageAction` has no concurrency guard.** It writes the whole form without an `updated_at` check. If the preceding `saveNow()` hit STALE or errored, publish still overwrites the other tab's changes. | `actions.ts:266-274`, `create-package-wizard.tsx:251-280` |
| B8 | S3 | **Too many deprecated columns.** ~30 deprecated columns (prices, season, flight routing, `finance_estimate`, legacy flight JSONB) are still copied by `duplicatePackageAction`, still shown in the detail Overview tab (Season, "From" quad price), and still read by Leads (see D1). | `20260914090000_…realignment.sql`, `[packageId]/components/tabs/overview-tab.tsx:29,59` |
| B9 | S3 | **`package_usage` inflates seat totals.** `seats_booked` and `seats_capacity` sum *all* groups, including cancelled and archived ones. Only `live_group_count` is filtered, so the list KPIs and detail header overstate capacity. | `20260812090000_packages_module_v2.sql:49-58` |

### 2.3 Package ↔ Departure Group relation

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| C1 | S1 | **Group creation is not atomic.** `persistStore` issues sequential PostgREST writes: group, then snapshot, pricing, cost, readiness, accommodations, transports, flights. A mid-way failure leaves a half-built group. `DeparturePartialWriteError` exists because this happens. | `lib/data/departure-groups.ts:2416`, `departure-groups-repository.ts:603-660` |
| C2 | S1 | **Status is not re-checked at creation.** See A2. There's also no re-check that the package is still complete, and the picker offers Drafts to every creator. | `lib/data/departure-groups.ts:2025` |
| C3 | S2 | **Picker shows the wrong journey type.** `listPackageTemplateOptions` maps `journeyType` from `row.category` (Umrah/Hajj), not `journey_type`. Early Registration packages show as Umrah, and the suggested group code uses the `UM-` prefix. Creation itself uses the correct type, so the code and the group type disagree. | `lib/data/departure-groups.ts:2043` |
| C4 | S2 | **"Create Departure Group" deep link does nothing.** The package list and detail pages push `/departure-groups?create=1&template=<id>`. Neither `departure-groups/page.tsx` nor the list reads those params, so the user lands on the list with nothing open. | `packages-list.tsx:248,273`, `package-detail.tsx:215`, `departure-groups/page.tsx` |
| C5 | S2 | **Snapshot leaves out contractual terms.** `buildPackageSnapshot` freezes itinerary, inclusions, requirements and payment schedule, but not `cancellation_policy`, `payment_terms`, `late_payment_policy`, `price_change_disclaimer`, `included_services`, `days/nights`, or the document `visibleInPortal` flag. Those are the terms a pilgrim bought under, and a later template edit changes what staff see for old bookings. | `lib/data/departure-groups-copy.ts:336-382` |
| C6 | S2 | **Several group defaults are collected but never used.** `default_group_status`, `seat_reservation_rule`, `selected_communication_templates`, `suggested_guide_ratio` and `finance_role_view` are authored and never consumed by group creation. Groups are always `PLANNING`. | grep: consumed only by `packages/**` |
| C7 | S2 | **Duration mismatches aren't flagged.** Group duration comes only from dates. There's no warning when the chosen dates don't match the package's `days/nights`, and accommodation blocks are laid out from `makkah/madinah_nights` regardless. So a 15-day group from an 11-day template gets hotel rows that end on day 11. | `lib/data/departure-groups.ts:2264-2291`, `departure-groups-copy.ts:613-655` |
| C8 | S2 | **"Compare with Package Template" compares the snapshot with itself.** `group.packageTemplateName` comes from the snapshot, so the "live" column is never the live package and drift is never detected. | `lib/data/departure-groups.ts:829,880`, `template-comparison-dialog.tsx:~150` |
| C9 | S3 | **Demo template library is still wired into production paths.** Non-UUID ids resolve to `TEMPLATE_LIBRARY` in `resolveTemplate`, and the AI sales model falls back to `findTemplate()` itineraries. That demo content can reach a customer through the AI. | `lib/data/departure-groups.ts:4105-4119`, `departure-groups-ai.ts:149,187-190` |
| C10 | S3 | **No group → package link.** The group detail page shows "From: <name>" as plain text. The package Groups tab mixes archived and cancelled groups with live ones and has no filter. | `departure-group-detail.tsx:381`, `tabs/groups-tab.tsx` |
| C11 | S3 | `createDepartureGroupAction` maps *every* failure, including "template not found", onto the `groupCode` field error. `isGroupCodeTaken` uses `ilike`, so `_` and `%` in a code act as wildcards. | `departure-groups/actions.ts:236`, `lib/data/departure-groups.ts:2176` |

### 2.4 Other relations

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| D1 | S1 | **Leads quotes the wrong price.** `loadLeadPackages` reads the deprecated `quad/triple/double/single_price`, which are null for every package made since the realignment, so it falls back to `BASELINE_PRICE_LKR`. `findAvailableGroups` reads `pricing_snapshot`, which is now always empty. Both should read `departure_group_pricing`. | `lib/data/leads-repository.ts:111-130`, `app/(main)/leads/actions.ts:399-420`, `departure-groups-copy.ts:322-333` |
| D2 | S2 | **The costing seed is dead.** The migration comment says costing is seeded from `packages.finance_estimate`, which the wizard no longer writes. Reports docs still describe it as the estimate source. Either give costing a template-level default cost model, or remove the capability, masking code and docs. | `20260909090000_departure_group_costing.sql:49-76`, `packages-access.ts:24-25` |
| D3 | S3 | Unused or misleading capabilities: `editPricing` is never checked. MARKETING can `duplicatePackage` but has no `editPackage`, so it creates drafts it can't edit. `createGroupFromPackage` gates only a menu item, while the server checks the Departure-Groups `createGroup`. | `packages-access.ts:45-104` |

### 2.5 UX & client bugs

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| E1 | S1 | **Edits are lost on the first autosave in `/packages/new`.** When the row is created, `router.replace` moves from `/packages/new` to `/packages/[id]/edit`. That's a different page segment, so the wizard remounts from DB state and drops anything typed during the round trip, plus the focused input. `handlePackageCreated` also captures a stale `activeStep`. | `create-package-wizard.tsx:139-144` |
| E2 | S1 | **The edit dialog on the detail page shows stale data and fails silently.** `editData` is never reset on close, and the body's key doesn't change when a re-fetch arrives. Reopening shows the first load's form and `updatedAt`, the first patch returns STALE, and the dialog's indicator has no "stale" state. The user keeps typing and nothing is saved. | `create-package-dialog.tsx:680-710, 456-463, 769`, `package-detail.tsx:152-157` |
| E3 | S2 | "Save Draft" always toasts success, even when the save failed or was stale. Publish toasts "Package created successfully" in edit mode. After closing the edit dialog, nothing calls `router.refresh()`, so the list and detail page show stale data. | `create-package-wizard.tsx:240-243,272`, `create-package-dialog.tsx:370-378,404` |
| E4 | S2 | **Two parallel wizard implementations** (route page and dialog, ~1,000 duplicated lines) with different step indexing, save indicators and behaviour. | `create-package-wizard.tsx`, `create-package-dialog.tsx` |
| E5 | S2 | **No way back to "Open for Sale".** After Unpublish (Sales Closed), neither the detail nor the list menu offers Re-open. Detail has no Archive, Restore or Delete. Row "Publish" is offered for incomplete drafts and only fails after the click. Publish and Unpublish from detail have no confirmation. | `package-detail.tsx:233-258`, `packages-action-menu-items.tsx:82-91` |
| E6 | S3 | The Status filter offers "Archived", which can never match because the list excludes archived rows. The "Archived" saved view is dead code. | `packages-list.tsx:429`, `utils.ts:133` |
| E7 | S3 | An invalid `packageId` (not a UUID) throws a Postgres error and shows the error boundary instead of a 404. The edit page does a server round trip on every step change (`router.replace` with `?step=`). | `[packageId]/page.tsx:32`, `create-package-wizard.tsx:159-167` |
| E8 | S3 | Stale copy: the detail tab is labelled "Journey & Flights" (flights moved to groups), and Step 1's generated description hard-codes "return air tickets from Colombo". | `package-detail.tsx:74`, `step-1-commercial-identity.tsx:131` |

### 2.6 Performance & operations

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| F1 | S2 | **Usage silently disappears on large catalogues.** `loadUsageMap` sends every package id in one `.in()` URL. With a few hundred packages the request goes over PostgREST's URL limit, the error is swallowed, and every row shows 0 groups. The Delete menu item is then enabled too; the server still blocks the delete. | `packages-repository.ts:78-106` |
| F2 | S3 | The list loads the whole catalogue, archived included, and filters it on the client. Fine for tens of rows; plan for server paging above ~500. | `packages-repository.ts:114-144` |
| F3 | S3 | `saveDraftAction` and publish do a full ~120-column write, and no action revalidates `/departure-groups` even though the picker depends on package status. | `actions.ts` |
| F4 | S3 | No audit or activity log for package lifecycle events. Departure groups have `departure_group_activity_logs`; packages have nothing. | — |

---

## 3. Target design

### 3.1 Package lifecycle (enforced in the database, not the UI)

```
            publish (complete + publishPackage)
  DRAFT ─────────────────────────────────────▶ OPEN_FOR_SALE
    ▲                                            │      ▲
    │ restore (→ previous_status)                │close │ reopen (complete)
    │                                            ▼      │
 ARCHIVED ◀──────── archive (no live groups ── SALES_CLOSED
            or explicit override + reason)
```

* `status` is **never** writable through draft or patch saves. It changes only through
  dedicated lifecycle RPCs that validate the transition and write an audit row.
* `archived_at IS NOT NULL ⇔ status = 'Archived'`, enforced by a CHECK constraint.
  `previous_status` is kept so Restore can put the package back where it was.

### 3.2 Versioned publishing (fixes B1)

* Add `package_versions (package_id, version, published_at, published_by, body jsonb)`.
  Publishing freezes the validated body as an immutable version.
* The `packages` row becomes the **working copy**. Editing a published package sets
  `has_unpublished_changes = true`, and sales keep using the last published version.
* Departure groups record `package_version_id`. The snapshot is taken from the published
  version, never the working copy. That makes the "Compare with template" view (C8)
  meaningful: group version vs latest version.

### 3.3 Group creation contract (fixes C1–C7)

A single Postgres function, `create_departure_group_from_package(p_package_id, p_input jsonb)`,
declared `security invoker`, that:

1. Locks the package row. Requires `status = 'Open for Sale'`, or `Draft` only when the
   caller's *database* role is ADMIN, in which case sales_status is forced to closed or planning.
2. Resolves the latest published version and inserts the group, snapshot, pricing, cost,
   readiness, accommodations, transports and flights **in one transaction**.
3. Applies Step-6 defaults (`default_group_status`, capacity, waitlist, hold expiry)
   when the input omits them.
4. Returns warnings, such as a date span that doesn't match template `days`, instead of
   silently ignoring them.

---

## 4. Implementation plan

Each phase can ship on its own. Phase 0 is a hotfix and should go out before anything else.

### Phase 0 — Security hotfix (≈2–3 days) · A1, A2, A3, A5, D1-quick

| Task | Change | Files |
|------|--------|-------|
| 0.1 | Remove `status` and `featured` from `formDataToRow`'s draft path. Add a `formDataToDraftRow` that omits lifecycle columns, and use it in `saveDraftAction` and `savePackagePatchAction`. Server-side, strip `status`/`featured` from the patch schema (`packageFormPatchSchema.omit`). | `create-package/mappers.ts`, `actions.ts`, `lib/validations/packages.ts` |
| 0.2 | Make Step 1's Status control read-only (a badge plus a link to the lifecycle actions). Remove the "Archived" option. | `step-1-commercial-identity.tsx` |
| 0.3 | In `createDepartureGroup()`, reject templates whose *database* status is not Open for Sale, except for ADMIN on Draft, which also forces `sales_status` to `SALES_CLOSED` and `group_status` to `PLANNING`. Always reject Archived. Delete the `allowDraftTemplate` input. | `lib/data/departure-groups.ts:2241`, `departure-groups/actions.ts:204,395`, `lib/validations/departure-groups.ts`, sheet + CSV import |
| 0.4 | Tighten RLS with a migration. UPDATE only for roles with `editPackage` (ADMIN, OPERATIONS). MARKETING gets `owner_id = auth.uid() AND status = 'Draft'`. FINANCE loses write access. Add a trigger that blocks non-ADMIN/OPERATIONS changes to `status`, `published_at`, `archived_at` and `featured`, and allows MARKETING to change `featured` only. | new `supabase/migrations/2026100509_packages_rls_lifecycle.sql` |
| 0.5 | Add a `requirePackageAccess(id, capability)` helper that loads the row and runs `canRoleViewPackage`. Use it in every action and in `getPackage`. | `actions.ts`, `packages-repository.ts` |
| 0.6 | Stop-gap for D1: point Leads' price source at `departure_group_pricing` (min price across live groups per package), and point "Find groups" at `departure_group_pricing` via `getGroupPricingRow` or a join. | `lib/data/leads-repository.ts`, `app/(main)/leads/actions.ts` |

**Acceptance:** Scripted Server Action and REST calls, one per role, show that none of these
work: publishing via autosave, creating a group from a Draft, Sales Closed or Archived
package as a non-admin, MARKETING editing someone else's or a sellable package, FINANCE
writing packages. Leads quotes match the group's `departure_group_pricing`.

### Phase 1 — Lifecycle & integrity (≈1 week) · B2–B7, B9, A4, A6

1. **Lifecycle RPCs.** Add `publish_package`, `close_package_sales`, `reopen_package`,
   `archive_package(p_reason, p_force)` and `restore_package`. Each is a SQL function that
   validates the transition and writes `package_activity_logs`. Server actions become thin
   wrappers. Add `previous_status` and the `archived_at ⇔ Archived` CHECK. Backfill rows that
   break the rule (A1 may already have produced some).
2. **Archive guard.** Refuse when `live_group_count > 0` unless `force` and a reason are
   given. The UI shows the live groups and offers "Close sales instead".
3. **Uniqueness.** Add `unique (agency_id, lower(internal_code))`. Dedupe first: a migration
   suffixes existing collisions. Duplicate generates `CODE-COPY-2`, `-3` and so on, and the
   wizard validates the code as you type.
4. **One validation source.** Rewrite `computeListStepGaps` to call the same rule
   definitions as the step schemas. Better: persist `completeness` and `missing_steps` as
   columns computed on save by the server, so the list, the publish gate and the DB agree.
   Decide whether an empty itinerary is publishable (recommended: require ≥1 day).
5. **Cross-field rules** (B6) as `superRefine` on a `publishablePackageSchema`, mirrored by
   DB CHECKs where they're cheap: nights vs city nights, days = nights + 1, capacity ordering,
   milestone arithmetic (percentages sum to 100, exactly one Remaining Balance, amounts ≥ 0,
   days-before strictly decreasing), itinerary day bounds, and `.max()` on every text and array.
6. **Optimistic concurrency** on every write. Publish takes `expectedUpdatedAt`, and the
   wizard refuses to publish while the autosave status is `error` or `stale`.
7. **Fix `package_usage`.** Filter seat sums to live groups, and add `archived_group_count`
   and `cancelled_group_count` columns for the Groups tab.
8. **Dynamic capabilities.** Add `getPackageCapabilities(role, roleId)` that merges
   `role_permissions` through `loadDynamicCapabilities`, and use it on pages, in actions and
   in the sidebar. Where it's cheap, mirror the same flags in RLS via a
   `staff_has_capability('packages', 'editPackage')` SQL helper, so custom roles are enforced
   end to end.
9. **Finance estimate decision (A6/D2).** Either (a) bring back a template-level
   `default_cost_model` that seeds `departure_group_cost_estimates`, gated by
   `viewInternalFinance` and column-masked through a view, or (b) delete the capability, the
   masking and the doc references. Recommend (a): Finance wants a default cost sheet per
   template.

**Acceptance:** A state-transition test matrix (every status × every action × every role) runs
against the DB. No row breaks the archive CHECK. The list's completeness matches
`isPackageComplete` for 100% of fixture packages.

### Phase 2 — Versioning & the group contract (≈1.5 weeks) · B1, C1, C3, C5–C9

1. **`package_versions` table** plus a `published_version_id` and `has_unpublished_changes`
   pointer on `packages`. `publish_package` writes a version. The detail page shows version
   history and a diff between versions.
2. **Editing a published package** edits the working copy. The header shows an "Unpublished
   changes" banner with a "Publish v{n+1}" button. Sales, AI and Leads read only the published
   version.
3. **Atomic group creation RPC** (§3.3). `createDepartureGroup` calls it, and `persistStore` is
   no longer used for creation. Bulk import calls the same RPC per row, and is idempotent by
   `group_code`.
4. **Complete the snapshot.** Add `package_version_id`, `policy_snapshot` (cancellation,
   payment terms, late payment, price-change disclaimer), `included_services_snapshot`,
   `duration_snapshot` and the document `visible_in_portal` flag. Add a migration to backfill
   existing snapshots from the live package where possible, flagged `backfilled = true`.
5. **Apply Step-6 defaults**: `default_group_status`, `seat_reservation_rule` (turned into
   hold behaviour) and `selected_communication_templates` (turned into group comms
   schedule). Delete any field the business doesn't want implemented (see §6 Q2). A dead field
   is worse than a missing one.
6. **Date and duration check.** The create sheet pre-fills `return_date = departure + days − 1`
   and warns when they diverge. Accommodation blocks are scaled or flagged when the group span
   doesn't equal the template nights.
7. **Fix the picker.** Map `journeyType` from `journey_type` (C3). Offer only Open for Sale by
   default, with an "Include drafts (admin)" toggle. Show completeness and version.
8. **Deep link (C4).** `departure-groups/page.tsx` reads `searchParams.create` and `template`
   and opens `CreateDepartureGroupSheet` with that package preselected. Validate the id
   against the picker list.
9. **Real template comparison (C8).** Compare the snapshot's `package_version_id` with the
   package's current `published_version_id`, field by field.
10. **Remove the demo library from runtime (C9).** Move `TEMPLATE_LIBRARY` to seed and eval
    fixtures only. `resolveTemplate` accepts UUIDs only. Delete the AI `findTemplate`
    fallback.

**Acceptance:** Killing the connection in the middle of group creation leaves zero rows.
Editing a published package doesn't change what Leads, AI or the picker see until the next
publish. Every group created after this phase has a non-null `package_version_id`.

### Phase 3 — Cross-module alignment (≈4 days) · D1–D3, C10

1. **Leads and Sales Copilot:** read the package's "from" price from live groups'
   `departure_group_pricing`, and label it "from LKR X across N departures". Remove every read
   of the deprecated `packages.*_price`, `season` and `currency` (grep-gate this in CI).
2. **Reports:** filter by package and version. Package performance (groups, seats, revenue,
   margin) comes from group facts, never from template estimates.
3. **Capabilities cleanup (D3):** delete `editPricing`, or wire it to Step 2. Give MARKETING
   `editPackage` scoped to its own drafts, or drop `duplicatePackage`. Make the group-creation
   server check require **both** `departure_groups.createGroup` and
   `packages.createGroupFromPackage`.
4. **Two-way navigation (C10):** make the group header link to `/packages/[id]?tab=groups`.
   The package Groups tab gets Live, Completed and Cancelled/Archived filters plus revenue
   per group.
5. **Drop deprecated columns (B8)** in two steps. First confirm zero readers (grep plus
   `pg_stat_statements`). Then a migration drops the ~30 columns. Update `PackageRow` and the
   duplicate action to match.

### Phase 4 — UX consolidation (≈1 week) · E1–E8

1. **One wizard.** Keep a single `PackageEditor` component (route-based). The list and detail
   "Edit" buttons navigate to `/packages/[id]/edit`, and the dialog version is deleted (E2, E4).
2. **Create flow without remount (E1).** Create the draft row server-side *before* the first
   render (`/packages/new` as a server action that inserts, then redirects to the edit page),
   or use `window.history.replaceState` so the segment doesn't change. Drop `?step=` server
   round trips: keep step state client-side and use a shallow URL update.
3. **Honest save feedback (E3).** `saveNow()` returns `{ ok, code }`. Save Draft, Leave and
   Publish all react to it. Handle "stale" everywhere and offer "Reload and keep my changes"
   (merge the local patch over the fresh row). Call `router.refresh()` after close.
4. **Lifecycle actions everywhere (E5).** One `usePackageLifecycle(pkg)` hook drives the list,
   context menu and detail menus: Publish (disabled with the reason when incomplete), Close
   sales, Re-open, Archive (live-group warning), Restore, Delete. Everything destructive or
   customer-visible gets a confirm dialog.
5. **Small fixes:** remove the dead "Archived" filter and view (E6). Validate the UUID and
   `notFound()` (E7). Rename the tab to "Journey" and remove the flight wording from generated
   copy (E8). Clear the 11 ESLint errors and remove the dead code in step 7.

### Phase 5 — Quality, observability, scale (≈1 week, runs alongside Phases 1–4)

1. **Tests** (none exist today). Add Vitest for pure logic: validation, mappers, completeness,
   the copy engine, milestone arithmetic. Add SQL tests (pgTAP or a Supabase test DB) for RLS,
   the per-role matrix and the lifecycle/creation RPCs. Add a Playwright smoke run: create,
   publish, create group, see it in Leads, archive-guard.
2. **CI gates:** `tsc`, `eslint --max-warnings=0` on `app/(main)/packages`, tests, and a grep
   that fails on deprecated column reads.
3. **Audit log:** `package_activity_logs` written by the lifecycle RPCs (who, what, before and
   after), shown as an Activity tab on the detail page.
4. **Scale (F1, F2):** move usage to a single joined query or an RPC (`list_packages_with_usage`)
   instead of `.in()` with every id. Add server-side paging and search (trigram indexes
   already exist) when the catalogue passes ~500 rows. Surface errors instead of swallowing
   them.
5. **Caching:** use Next 16's tag-based caching (`cacheTag('packages')` plus `updateTag`/
   `revalidateTag`; see `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/`).
   Lifecycle changes then also refresh the Departure Groups picker and the Leads catalogue
   (F3).
6. **Export safety (A7):** prefix cells that start with `= + - @` with `'` in `lib/csv.ts`, and
   check the XLSX path too.

---

## 5. Suggested sequencing

| Week | Work |
|------|------|
| 1 | Phase 0 (hotfix, ship on its own) · Phase 5.1 test scaffolding |
| 2 | Phase 1 |
| 3–4 | Phase 2 (largest; needs data migration rehearsal on a prod snapshot) |
| 4 | Phase 3 |
| 5 | Phase 4 · Phase 5.3–5.6 · UAT with Operations, Sales and Finance |

Migration rehearsal: run every new migration against a restored production snapshot. Check
the A1-induced status/`archived_at` inconsistencies, the `internal_code` duplicates, and the
snapshot backfill counts before the real rollout.

---

## 6. Open questions for the business

1. Should an **empty itinerary** block publishing? (The server allows it today; the list says
   it doesn't.)
2. Which dead Step-6/Step-5 fields should be **implemented and which deleted**:
   `default_group_status`, `seat_reservation_rule`, `selected_communication_templates`,
   `suggested_guide_ratio`, `finance_role_view`?
3. Should a template carry a **default cost model** for Finance (Phase 1.9 option a), or is
   costing purely per departure?
4. Can **MARKETING** edit its own drafts, or only duplicate packages for Operations to finish?
5. When a published package gets a new version, should **open groups be notified** that the
   template changed? (They're never rewritten; this is only a notification.)

---

## 7. Implementation log

### Phase 0 (security hotfix) — shipped

All six tasks (0.1–0.6) landed as planned: `status`/`featured` are no longer writable through
draft autosave; the wizard's Status field is read-only; `createDepartureGroup()` re-derives the
package's real status server-side instead of trusting `allowDraftTemplate`; RLS was tightened
(`supabase/migrations/20261005090000_packages_lifecycle_rls_hardening.sql`) and, in the same
pass, the INSERT policy's dropped `owner_id = auth.uid()` check was restored (found while
implementing 0.4 — see that migration's header); every mutation gained an object-level
`canRoleViewPackage` check; Leads' pricing now reads `departure_group_pricing` instead of the
deprecated, always-null template price columns.

### Phase 1 (lifecycle & integrity) — shipped

`supabase/migrations/20261006090000_packages_lifecycle_phase1.sql` adds `previous_status`, the
`archived_at ⇔ status='Archived'` CHECK, `package_activity_logs`, five SECURITY DEFINER RPCs
(`publish_package`, `close_package_sales`, `reopen_package`, `archive_package`,
`restore_package`) that are now the *only* way `packages.status` changes, a corrected
`package_usage` view (seat totals scoped to live groups only, plus
`archived_group_count`/`cancelled_group_count`), and a per-agency unique index on
`lower(internal_code)` with a one-time dedupe of any existing collisions.
`app/(main)/packages/actions.ts` was rewritten to call these RPCs instead of writing `status`
directly, gained `reopenPackageAction` (the missing Sales-Closed → Open-for-Sale path, finding
E5), and `archivePackageAction` now supports the force-archive-with-a-reason flow (new
`ForceArchivePackageDialog`, wired into `packages-list.tsx`). Every lifecycle write now carries
optimistic-concurrency protection (`p_expected_updated_at`), either sourced from a fresh
server-side read (list-menu actions) or threaded from the wizard's own last-saved value
(`publishPackageAction`, via `useDraftAutosave`'s `saveNow()` now returning `{ packageId,
updatedAt }`). Cross-field validation (finding B6) landed as `crossFieldRulesSchema` /
`crossFieldIssues()` in `lib/validations/packages.ts`, checked at the final "is this package
complete" checkpoint (`isPackageComplete`, and server-side before every publish/reopen) rather
than per individual step. The itinerary-empty / description-check disagreement between the
server's step schemas and the list's `computeListStepGaps` (finding B5) was resolved in favour
of the stricter rule in both directions. Dynamic role-permission overrides
(`role_permissions`, finding A4) are now honoured everywhere the module previously called the
hardcoded `capabilitiesForPackages(role)` directly — every Server Action, every page-level
route guard, and `getPackageDetail`'s finance-estimate masking.

**Deliberately deferred, not forgotten:**

- **B1 (versioned publishing), B7 (concurrency for the full RPC decomposition), C1/C2/C5–C9
  (the atomic group-creation RPC and a complete snapshot)** stay Phase 2 work, as originally
  scoped — Phase 1 only added compare-and-swap protection to the *existing* write shapes, not
  the versioning/atomicity redesign those findings actually call for.
- **A6/D2 (the finance-estimate/cost-model decision)** — left alone. This depends on Q3 above,
  which only the business can answer; implementing either option (bring back a template cost
  model, or delete the dead capability) pre-empts that decision rather than waiting for it.
- **Sidebar dynamic-capability-awareness** — `components/app-sidebar.tsx` still calls
  `capabilitiesForPackages(role)` directly for the nav link's visibility. Every other module's
  sidebar entry has the same limitation; fixing it for Packages alone would be inconsistent
  with the rest of the sidebar, and the actual enforcement (page-level `notFound()`, every
  Server Action's gate) is already dynamic — a custom role denied `viewModule` still can't
  reach the module even if its nav link briefly shows.
- **`lib/access/team-access.ts`'s own `capabilitiesForPackages(role)` call** — intentionally
  left static. It powers the Roles & Permissions editor's own capability-matrix *preview* for a
  role in the abstract, not a specific signed-in user's merged capabilities, so the static
  default is the correct input there.
- **Step 7 (Review & Publish) has no inline per-field cross-field error display** — the server
  correctly refuses to publish an inconsistent package (and reports the first violated rule in
  the error toast), but the wizard doesn't yet surface all of `crossFieldIssues()` inline the
  way per-step field errors are shown. Left for Phase 4's UX pass, consistent with how granular
  per-step error messaging was already out of scope there.

**Verification performed:** `tsc --noEmit` clean after every edit; ESLint diffed against each
file's pre-change baseline after every edit to confirm zero newly-introduced warnings/errors
(one pre-existing `no-explicit-any` pattern in `packages-list.tsx` picked up one additional
occurrence from the new `onReopen` handler, matching the file's existing, unfixed style — not a
new category of issue). No database was available to actually run the new migrations against,
so the SQL was reviewed line-by-line instead (transition tables, RLS/trigger interaction with
the Phase 0 migration, `CREATE OR REPLACE VIEW`'s append-only column constraint, tenancy
scoping in every SECURITY DEFINER function) rather than exercised — **run both new migrations
against a staging database and the acceptance checks in Phase 0/1 above before this reaches
production.**

### Phase 2 (versioning & the group contract) — mostly shipped, deliberately re-scoped

Six of Phase 2's ten items landed close to plan; the other four were re-scoped or deferred for
reasons explained below rather than attempted blind. New migration:
`supabase/migrations/20261007090000_packages_versioning_and_snapshot.sql`.

**Shipped as planned:**

- **Item 6 (date/duration mismatch).** The create-group sheet now pre-fills
  `returnDate = departureDate + (template.durationDays − 1)` the moment a template is chosen,
  and shows a warning banner when the dates actually picked diverge from the template's own
  length, naming that the accommodation blocks copied in are laid out for the template's
  length and will need manual adjustment.
- **Item 7 (fix the picker).** `journeyType` is now mapped from `journey_type` (Umrah / Hajj /
  Early Registration), not `category` (Umrah / Hajj only) — an Early Registration package could
  previously never be offered as anything but "UMRAH", which also fed the wrong prefix into
  `generateGroupCode()`. The picker now offers only Open for Sale packages by default, with an
  ADMIN-only "Include drafts" toggle (each draft shown with its completeness percentage), and
  `listPackageTemplateOptions()` takes an explicit `{ includeDrafts }` option instead of always
  returning every Draft to every role.
- **Item 8 (deep link).** `/departure-groups?create=1&template=<id>` now actually opens the
  create sheet with that package preselected — the id is checked against the templates this
  role can see before being trusted. Previously this link silently did nothing.
- **Item 10 (remove the demo library from runtime paths).** `resolveTemplate()` (used by
  `createDepartureGroup()`) now refuses any non-uuid id outright instead of falling back to
  `TEMPLATE_LIBRARY` — a real Departure Group can only ever be built from a real `packages` row.
  The AI sales read model's `findTemplate()` itinerary fallback was removed for the same reason
  (it was already a no-op for every real, uuid-keyed group; the only case it did anything was a
  genuinely empty snapshot, where showing the AI a demo itinerary was actively wrong).
  `TEMPLATE_LIBRARY`'s own comment was corrected — it never was consulted by the live picker,
  contrary to what it used to claim.

**Item 3 (atomic group creation), re-scoped:** the plan called for moving group creation into a
single Postgres transaction via an RPC. `DeparturePartialWriteError`'s own existing class
comment in `lib/data/departure-groups-repository.ts` already says this "needs a live database
to build and verify against, not a blind rewrite" — and that class is shared by every
departure-group mutator, not just creation, so a mistake there has a far larger blast radius
than this finding. Shipped instead: `createDepartureGroup()` now catches
`DeparturePartialWriteError` specifically and deletes the `departure_groups` row it was
building. This is a complete, safe undo *only* because group creation is pure inserts from an
empty store (nothing pre-existing is ever touched) and every child table's `departure_group_id`
foreign key is `on delete cascade` — deleting the parent row cleans up everything a partial
write left behind in one statement. The general `mutate()` path (every other departure-group
action) is untouched and still needs the real fix this finding describes.

**Items 1, 4 and 9 (versioning, complete snapshot, real comparison), re-scoped narrower than
written:**

- Shipped: `package_versions` (append-only, one row per publish, written by the new
  `package_versions_create()` RPC) and `packages.published_version_id`. Both
  `publishPackageAction` and `publishExistingPackageAction` now record a version on every
  successful publish (best-effort — a version-recording failure is logged, not surfaced as a
  publish failure, since the actual publish already succeeded by that point).
- Shipped: the group snapshot (`departure_group_package_snapshots`) now also freezes
  `policy_snapshot` (cancellation policy, payment terms, late-payment policy, price-change
  disclaimer), `included_services_snapshot`, the template's own `duration_days_snapshot` /
  `duration_nights_snapshot`, `seat_reservation_rule_snapshot` and
  `communication_templates_snapshot` — previously none of these were frozen at all, so a later
  template edit silently changed what an already-selling group's terms appeared to be (finding
  C5). `PackageTemplateDefinition` gained the matching fields, sourced from the real package row
  (`loadTemplateDefinition()`) and given real Hajj-appropriate placeholder text for the seeded
  demo templates (`TEMPLATE_LIBRARY`).
- Shipped, narrower than "real diff, field by field" (item 9): "Compare with Package Template"
  now fetches the package's *current* title and `published_version_id` fresh (not off the
  snapshot, which is what `group.packageTemplateName` itself was always sourced from — the
  reason the old comparison could never show real drift, since it was comparing the snapshot to
  itself). It shows real name drift and a "template has been republished since this group was
  created" banner when the snapshot's `package_version_id` no longer matches the package's
  current one. It does **not** do a full per-field diff against the old version's stored
  content — that needs its own diff-rendering UI, a separate and sizeable piece of work.
- **Not shipped: item 2's "editing a published package edits a separate working copy, with a
  `has_unpublished_changes` banner and a `Publish v{n+1}` button."** This changes the runtime
  behaviour of every content-edit path (draft autosave, patch autosave, the wizard's Save
  Draft/Publish flow) in a way that genuinely needs a live database and a real editing session
  to get right — publishing today still edits `packages` directly, exactly as it did before
  this pass; the only new thing is that publishing now *also* durably records what was
  published. A package edited after publishing still goes live immediately, same as before.
  This is the one Phase 2 item that still needs its original scope done, not a smaller version
  of it.

**Item 5 (apply Step-6 defaults), partially not applicable:** `seatReservationRule` and
`selectedCommunicationTemplates` are now real, frozen content on every group's snapshot (via
the snapshot-completion work above) rather than silently dropped — but neither was turned into
new live *behaviour* (an actual seat-hold rule enforcement, or an actual scheduled-communication
dispatcher), because no such subsystem exists anywhere in this codebase yet; building one is a
new feature, not "wiring a dead field." `default_group_status` was investigated and left alone
entirely: the wizard's own Step 6 UI renders it as a **read-only** field always showing
"Planning" — there is no way for anyone to ever set it to anything else, so wiring it into group
creation would not change any observable behaviour today. This remains open question Q2 for the
business: decide what (if anything) `default_group_status` should let an author actually choose
before spending effort implementing it.

**Verification performed:** same posture as Phase 0/1 — `tsc --noEmit` clean after every edit;
ESLint diffed against this scope's pre-change baseline (120 problems, 11 errors / 109 warnings)
after all Phase 2 edits, landing at 120 problems, 12 errors / 108 warnings: the one extra error
is the same pre-existing `no-explicit-any` pattern in `packages-list.tsx` picking up one more
occurrence (the new `onReopen` handler, matching the file's own existing, unfixed style — not a
new category of issue), and the one fewer warning is the pre-existing unused `TEMPLATE_LIBRARY`
import this pass's own item 10 work happened to clean up. Two new `set-state-in-effect` lint
errors were introduced and fixed during this pass (one via lazy `useState` initializers instead
of a mount effect, one via React's documented "adjust state during render" pattern instead of a
`useEffect`) rather than suppressed. As with Phase 0/1, no database was available to actually
run the new migration against — the SQL was reviewed line-by-line (the version-numbering race
guarded by `for update`, the `on delete cascade` chain the compensating cleanup relies on being
genuinely complete across all nine group child tables, the new snapshot columns' backward
compatibility for groups created before they existed) rather than exercised. **Run the new
migration against a staging database, then create a departure group, publish and republish a
package, and open "Compare with Package Template" before this reaches production.**

### Phase 3 (cross-module alignment) — shipped

New migration: `supabase/migrations/20261008090000_packages_drop_deprecated_columns.sql`. All
five items landed; item 2 turned out to already be satisfied by existing code.

- **Item 1 (Leads/Copilot pricing)** was already fixed in Phase 0 (finding D1). The one
  remaining deprecated read found this pass was the package detail page's own Overview tab,
  which displayed `pkg.season` and `pkg.quad_price`/`pkg.currency` directly — both null for
  every package created since the pricing-to-departure-group move, so the tile always showed
  "—". `getPackageUsage()` now also computes `fromPrice` (the cheapest live departure's quad
  price, via `departure_group_pricing`) using the exact same "cheapest live group wins" rule
  `loadLeadPackages()` already uses, and the Overview tab reads that instead. The "Season"
  field was removed from the Overview tab entirely — nothing to show once the column is gone.
- **Item 2 (Reports from group facts, not template estimates)** — already true. Re-checked
  `lib/data/reports-finance.ts`'s `buildPackageProfitability()` and the reports SQL migration:
  neither reads `packages.finance_estimate` or any other package-template column; package
  profitability was already built entirely from `ReportGroupFact[]` (group-level facts). No
  code changed for this item. The "filter by package **and version**" half of this item was
  not implemented — comparing report data by a specific `package_versions` row isn't a
  well-specified feature without more product input on what that view should actually show
  (aggregates naturally span many groups and publishes; a single-version filter needs a
  reason to exist before it's built).
- **Item 3 (capabilities cleanup, finding D3):**
  - `editPricing` deleted from `PackageCapabilities` (and the Roles & Permissions editor's
    toggle list, `lib/access/module-capability-keys.ts`) — it gated nothing; Step 2 has always
    been checked through `editPackage`. Existing `role_permissions` rows that still carry an
    `editPricing` key are harmless, simply ignored now.
  - **Not decided: MARKETING's `editPackage`/`duplicatePackage` split.** This is explicitly
    open question Q4 — MARKETING can currently duplicate a package into a Draft it then has no
    capability to edit, a real dead end, but resolving it correctly needs a row-scoped edit
    check (own-drafts-only, distinct from the existing view-scoped `canRoleViewPackage`, which
    also allows editing any Open for Sale package — not what granting `editPackage` naively
    would mean) that I was not willing to guess at without a product answer to Q4.
  - **Shipped:** `createDepartureGroupAction`/`importDepartureGroupsAction` now also check
    `packages.createGroupFromPackage` (merged through dynamic capabilities, same as every
    other Packages check) in addition to the Departure Groups module's own `createGroup`. For
    every built-in role these have always agreed (both true only for ADMIN/OPERATIONS), so
    this was invisible until dynamic capabilities existed — a custom role granted
    `departure_groups.createGroup` without also being granted
    `packages.createGroupFromPackage` could previously still create groups regardless. The
    Departure Groups module's own capabilities are not otherwise wired to `role_permissions`
    yet — that is that module's own production-readiness work, out of scope here.
- **Item 4 (two-way navigation, finding C10):** the group detail header's "From: {template}"
  is now a real link to `/packages/[id]?tab=groups` when the group was built from a real
  package (`PageHeader`'s `subTitle` prop widened from `string` to `ReactNode` to allow it,
  backward compatible with every other caller). The package detail's Groups tab gained Live /
  Completed / Cancelled / Archived filter pills (every group falls into exactly one bucket,
  archived taking priority over status) and a revenue-per-group column, sourced from
  `departure_group_payment_summaries.expected_revenue` — the same figure
  `buildPackageProfitability()` in Reports already uses, not a separately-invented price ×
  seats estimate that could disagree with it.
- **Item 5 (drop deprecated columns, finding B8):** all ~40 columns dropped — the 13 columns
  `20260914090000_package_template_field_realignment.sql` deprecated (per-departure pricing,
  the internal cost estimate), the 9 flight-routing-intent columns from that same migration,
  and the 18 Bucket-C columns (`docs/bucket-c-dead-fields-removal-plan.md`) that were never
  collected by the wizard at all. "Confirm zero readers" was done properly this time, not just
  a keyword grep — every `.from("packages")` call site in the repository was checked
  individually (a plain keyword grep for names like `currency`, `airline` or `season` is far
  too noisy, since those words are legitimately reused for unrelated departure-group/flight/
  supplier concepts elsewhere). The one real reader found (the Overview tab, above) was fixed
  in the same pass before the column drop. `getPackageDetail()`'s now-pointless
  `finance_estimate` masking was removed — but the `viewInternalFinance` capability and its
  now-unused parameter were deliberately left in place rather than deleted, since a template
  cost model coming back in some form is still open question Q3; deleting the capability ahead
  of that answer would presume it. `PackageRow` in `lib/types/database.ts` had all corresponding
  fields removed; `duplicatePackageAction` needed no changes — it never referenced these columns
  by name, they simply stop appearing in `...copyable` now that they don't exist.

**A note on the column drop specifically:** this is the one genuinely irreversible change in
this entire implementation pass — `DROP COLUMN` discards whatever historical values these
columns still held, for every package row, permanently. It was carried out only after
confirming (not assuming) zero live readers across the whole repository, and only for columns
an earlier migration had already marked deprecated/dead weeks prior — not a surprise removal.
If any of these columns' historical values turn out to matter for some reporting or audit
purpose not caught by this pass's grep, they are gone; there is no migration that gets them
back.

**Verification performed:** same posture as every phase before it — `tsc --noEmit` clean after
every edit; ESLint diffed against this scope's pre-change baseline (121 problems, 12 errors /
109 warnings) after all Phase 3 edits, landing at exactly 121 (12/109) — zero net new issues,
including a `no-explicit-any`-adjacent unused-parameter warning introduced and then fixed with
the same `void param;` idiom already used elsewhere in this codebase for intentionally-unused
destructured bindings, rather than left in place or suppressed. As with every prior phase, no
database was available to run the new migration against — the SQL was reviewed by hand (the
Bucket-C and per-departure-realignment migrations' own deprecation comments cross-checked
against the actual drop list; the one live view (`departure_group_costing`) and one historical
backfill statement (also in that same migration) that reference `finance_estimate` confirmed to
be a one-time `INSERT ... ON CONFLICT DO NOTHING` already executed, not a live view definition,
so dropping the column afterward does not break it) rather than exercised. **Run the new
migration against a staging database and confirm the packages list, detail page, wizard, and
Leads pricing still render correctly with the columns actually gone — not just reviewed —
before this reaches production.**

### Phase 4 (UX consolidation) — shipped

No new migration — this phase was entirely application-layer. All eight items landed.

- **E1 (remount-free navigation):** the create-wizard's post-create URL update
  (`handlePackageCreated`, switching the route from `/packages/new` to
  `/packages/[id]/edit`-shaped state without losing wizard state) and its step-change URL sync
  both switched from `router.replace(...)` to `window.history.replaceState(null, "", ...)` — the
  former was forcing a full client-side remount of the wizard on every create and step change,
  discarding in-memory form state that had nothing wrong with it. The package detail page's tab
  switcher (`goToTab()`) got the same fix, for the same reason: a tab click is a same-segment,
  query-param-only URL change and doesn't need a server round trip at all.
- **E2 / E4 (one wizard) — corrected after this shipped:** this originally deleted
  `create-package-dialog.tsx` (~780 lines) and rewired the list/detail screens to the
  route-based wizard (`/packages/new`, `/packages/[id]/edit`) instead, on the assumption that
  consolidating the audit's flagged duplication meant picking the route-based shell. That was
  the wrong call to make unilaterally — the dialog was the deliberately-built creation UX, not
  an accidental duplicate — and was reverted immediately after: `create-package-dialog.tsx` is
  restored (plus a genuine pre-existing bug fixed while touching it — it read a ref's `.current`
  during render, which `react-hooks` flags as unsafe under concurrent rendering; the step-slide
  direction is now tracked as state instead), the list and detail screens open it again for
  Create/Edit, and `create-package-wizard.tsx` — now truly unreachable from any route — was
  deleted instead. `/packages/new` and `/packages/[id]/edit` still work as deep links (used by
  Departure Groups' "create a package first" flow); they redirect into the dialog via `?create=1`
  / `?edit=1` rather than rendering a second wizard shell. The `usePackageLifecycle()`
  consolidation from E5 was kept — it never depended on which UI shell handles creation.
  **Superseded by TASK-044:** creation and editing are now a full page at `/packages/new` and
  `/packages/[id]/edit`, and the dialog is gone — see the section at the end of this document.
- **E3 (honest save feedback):** `use-draft-autosave.ts`'s `flush()`/`saveNow()` previously threw
  away whether a save actually succeeded. Added a `FlushOutcome` type
  (`{ok: true} | {ok: false; code?: "STALE"}`) that every branch of `flush()` now returns —
  create success/failure, patch success/stale/failure, and the catch block — and `saveNow()`
  merges it into its return value. The wizard's `handleSaveDraft`/`handleLeave` now check this
  and show a real error toast (including a distinct message for a stale/conflicting save) instead
  of silently reporting success regardless of what happened.
- **E5 (consolidated lifecycle actions):** new `use-package-lifecycle.ts` hook
  (`usePackageLifecycle()`) consolidating publish/unpublish/reopen/toggle-featured/duplicate/
  archive(+force)/restore/delete — previously implemented once, fully, in `packages-list.tsx`,
  and partially (missing Archive/Restore/Delete entirely) in `package-detail.tsx`. Both screens
  now share the one hook; the detail page's actions menu gained the previously-missing Archive/
  Restore/Delete items, gated behind the same `can.archiveOrRestorePackage`/`can.deletePackage`
  capability checks the list already used, with Delete disabled whenever `usage.groupCount > 0`
  (same guard the list enforces). The hook is typed against a narrower `PackageLifecycleTarget`
  interface rather than either screen's own richer row type, so it works unmodified from both;
  this relies on TypeScript's contravariant function-parameter typing to stay compatible with the
  list's existing `PackageRowActions` shape, confirmed by a clean `tsc` pass after the rewrite.
- **E6 (dead saved view removed):** `"Archived"` removed from `PACKAGE_SAVED_VIEWS`
  (`lib/types/packages.ts`) and its dead filter branch removed from `applySavedView()`
  (`app/(main)/packages/utils.ts`) — this saved view was never reachable, since the list only
  ever shows active packages (archived rows live in the separate `ArchivedPackagesSheet`), so
  `savedView` could never actually be set to it.
- **E7 (clean 404 for malformed ids):** added `isUuid()` to `lib/utils.ts` and call it at the top
  of both `app/(main)/packages/[packageId]/page.tsx` and `.../edit/page.tsx` — `if
  (!isUuid(packageId)) notFound();` before any query runs. Previously a malformed id in the URL
  (e.g. `/packages/not-a-real-id`) hit Postgres's `.eq("id", value)` directly and surfaced as a
  raw "invalid input syntax for type uuid" error through the route's error boundary instead of a
  normal 404.
- **E8 (copy cleanup):** the package detail page's "Journey & Flights" tab renamed to "Journey"
  (flight content was folded into it earlier and the old two-part name no longer described what
  was there); the AI-description generator's hardcoded "return air tickets from Colombo," phrase
  (in `step-1-commercial-identity.tsx`, wrong for packages that don't include flights at all)
  removed from the generated string.
- **Two unplanned dead-code removals found during this pass, not called out in the original
  audit:**
  - `step-7-review-publish.tsx` had a complete second publish path — `handleFinalPublishClick`
    plus a ~50-line "Package Published Successfully!" dialog offering "Create Departure Group
    from Package" / "View Packages List" — that no button in the component's own JSX ever
    called. The wizard's real publish flow runs entirely through its own sticky footer
    (`handleFinalSubmit` in `create-package-wizard.tsx`), bypassing this component completely.
    Removed the dead handler, the dialog JSX, the `onSaveDraft`/`onPublish` props from
    `StepReviewPublishProps` (neither was ever consumed), and the now-unused imports and state
    that only that dead code needed.
  - Removing those two props from `StepReviewPublishProps` orphaned `handleSaveDraft` in the
    wizard (it had no caller left). Rather than delete a function whose save-then-toast logic was
    correct, it was wired to a new "Save Draft" button placed in the wizard's `PageHeader`
    action area, next to "Back to Packages" — restoring a manual-save affordance the wizard
    otherwise lacked (it previously relied entirely on autosave).
- Left untouched, deliberately: `step-1-commercial-identity.tsx`'s commented-out "Use Template" /
  "Generate with AI" buttons and their supporting dead code (template chooser dialog, confirm
  replace dialog). Whether to finish or remove that feature is a product decision, not a cleanup
  call.

**Verification performed:** same posture as every phase before it — `tsc --noEmit` clean after
every edit. ESLint diffed against this scope's pre-change baseline (via `git stash`/`git stash
pop`): baseline was 120 problems (12 errors, 108 warnings); after Phase 4, 94 problems (0 errors,
94 warnings) — every pre-existing error eliminated (mostly the `no-explicit-any` handlers in the
old `packages-list.tsx` lifecycle logic, gone now that `usePackageLifecycle()` is properly typed
throughout), 14 fewer warnings, and zero net-new issues. No database changes this phase, so
nothing new to run against staging — but E7's `notFound()` behavior and E1's URL-update fix are
both client/route-level and worth a manual pass in a real browser (bad id → 404; create a
package → confirm no remount/state loss; switch detail tabs → confirm no network request) before
this ships.

### Phase 5 (quality, observability, scale) — mostly shipped, two items deliberately deferred

New migration: `supabase/migrations/20261010090000_packages_list_with_usage_rpc.sql`. Four of
the six items landed as scoped; caching and full server-side paging were deliberately not
attempted — see their own write-ups below for why.

- **Item 1 (tests) — narrower than originally scoped, and honestly so.** The plan called for
  Vitest on pure logic, pgTAP or a Supabase test DB for RLS/RPCs, and a Playwright smoke run.
  Only the first is actually achievable in this environment — pgTAP needs a real Postgres
  instance and Playwright needs a running app plus real Supabase auth, neither of which exists
  here (same limitation every migration in every prior phase has had: written and reviewed by
  hand, never executed). Added Vitest (`vitest.config.mts`, `npm test` / `npm test:watch`) and
  52 tests across five suites, all currently green:
  - `lib/validations/packages.test.ts` — `computeListStepGaps()`'s per-step logic (including the
    "column not selected vs. selected-but-blank" distinction for `description`) and
    `listCompletenessPercent()`.
  - `app/(main)/packages/utils.test.ts` — every saved view, search matching, sort (including the
    title tiebreak), `toggleSort()`'s direction-flip-vs-adopt-default behaviour, and
    `computeListKpis()`.
  - `lib/csv.test.ts` — the formula-injection prefix (`= + - @` and tab/CR) for the finding-A7
    export-safety fix, quote-doubling, the BOM, and a full `toCsv`/`parseCsv` round trip.
  - `lib/utils.test.ts` — `isUuid()`'s accept/reject cases for finding E7's `notFound()` guard.
  - `lib/data/departure-groups-copy.test.ts` — the plan's own "copy engine, milestone arithmetic"
    ask, covering the Package → Departure Group copy engine's pure functions:
    `resolveDueAt()`/`addDays()`/`daysBetween()` (readiness due-date arithmetic, including that
    `BEFORE_GROUP_OPENS`/`BEFORE_FIRST_BOOKING` correctly resolve to `null` — they're gates, not
    dates), `toPaymentMilestoneSnapshot()` (including the empty-string-vs-0-vs-null distinction
    for `amount`/`daysBeforeDeparture`), and `buildGroupPricing()`/`buildGroupCostEstimate()`.
    This file turned out to carry its own `isUuid()` — identical regex to the one added to
    `lib/utils.ts` in Phase 3 (finding E7), pre-existing and not introduced by this phase. Left
    un-deduplicated: it's imported by `lib/data/departure-groups.ts`, outside this phase's actual
    scope, and merging it isn't a testing task — flagging it here rather than fixing it
    unilaterally, same principle as every other out-of-scope observation in this plan.

  Not attempted: RLS/RPC tests (needs pgTAP or a disposable Supabase project) and a Playwright
  smoke run (needs a running app against real auth) — both stay open until this reaches an
  environment with the infrastructure for them, same caveat as every migration's own "review by
  hand, not executed" note throughout this plan.
- **Item 2 (CI gates):** `.github/workflows/packages-ci.yml`, scoped to PRs touching the
  Packages/Departure-Groups modules (path-filtered, plus `workflow_dispatch`). Runs `tsc
  --noEmit`, the new Vitest suite, and ESLint on `app/(main)/packages` — **at `--max-warnings=61`,
  not the plan's original 0.** The module carries 61 pre-existing warnings today (mostly leftover
  unused imports in the wizard step forms, plus two real "does this need wiring up or deleting"
  judgment calls in `step-7-review-publish.tsx` — `onSaveDraft` is accepted as a prop but never
  called in that component's own body, and `handleFinalPublishClick` is defined but never
  attached to any button, so the "Package Published Successfully!" dialog it would show can
  never actually appear; both predate this phase and neither was touched, since fixing them
  means either deleting a prop `CreatePackageDialog` still needs to pass or adding a publish
  button to this step, and both are product calls, not lint cleanup). Gating at 0 today would
  make this workflow fail on its first run for reasons unrelated to whatever PR triggered it; 61
  is a ratchet against new warnings, not the goal. The "grep that fails on deprecated column
  reads" step is deliberately narrower than "every column
  `20261008090000_packages_drop_deprecated_columns.sql` dropped" — checked, and most of those
  names (`currency`, `airline`, `season`, `quad_price` and the other per-occupancy price columns)
  are legitimately reused today for `departure_group_pricing` and per-departure flight-leg data,
  so a bare keyword grep on them is nothing but false positives — exactly the reason Phase 3's own
  column-drop review needed a real per-call-site read instead of a grep. The CI step greps only
  the ~23 dropped names distinctive enough to have zero legitimate hits anywhere in `app/`/`lib/`
  today (`makkah_hotel_rating`, `flight_routes`, `transit_airport`, and similar) — real signal on
  the unambiguous case, not full coverage of the deprecation surface.
- **Item 3 (audit log UI, finding F4):** the `package_activity_logs` table and the five lifecycle
  RPCs that write it shipped back in Phase 1 — nothing had ever read it. Added
  `getPackageActivity()` to the repository and a new Activity tab
  (`[packageId]/components/tabs/activity-tab.tsx`) on the detail page, listing publish/close
  sales/reopen/archive/restore events with actor, before → after status, and the reason text an
  ADMIN force-archive supplies. Capped at 100 rows with no "load more" — unlike Departure Groups'
  activity log (which records every field edit and can run to thousands of rows), a package
  changes lifecycle state at most a handful of times a month, so pagination isn't a real need
  here yet.
- **Item 4 (scale, finding F1) — the real bug, fixed for real.** `listPackages()` ran one query
  for the package rows, then a second `package_usage` query with `.in("package_id", <every id
  from the first query>)`. PostgREST puts that id list straight into the request URL; past a few
  hundred packages the URL exceeds the server's length limit, the query errors, and
  `loadUsageMap()` silently swallowed the error and returned an empty map — every row then showed
  0 groups, which also mis-enabled the Delete menu item (blocked server-side, but visibly wrong).
  Replaced with `list_packages_with_usage()`, a single `security invoker` SQL function that LEFT
  JOINs `packages` to `package_usage` in one query — there is no id list to overflow a URL with
  in the first place. It reproduces the MARKETING-only visibility rule
  (`status.eq.Open for Sale OR owner_id.eq.<user>`) as a SQL predicate, same as the query it
  replaces. `listPackages()` now calls it via `.rpc()` and the old `loadUsageMap()`/two-query path
  is gone. Also dropped `min_group_size` and `default_group_capacity` from the columns actually
  fetched — they were in the old query string but never in `PackageListRow`'s own type, so the
  list was paying to transfer two columns it never used.
- **Item 4, second half (finding F2, server-side paging) — deliberately deferred.** The plan
  itself frames this as "plan for server paging above ~500 rows", not a present bug — the F1 fix
  above removes the actual failure mode at that scale (the URL-length crash); pure client-side
  filter/sort/search performance on a few hundred rows in the browser is not something this pass
  found evidence of being a real problem yet. Rearchitecting the list from "fetch everything,
  filter in the browser" to real server-side paging is a substantial UI change (search-as-you-type
  debouncing, cursor state, saved-view/filter combinations all becoming server round trips instead
  of instant client recomputation) that no agency using this system today has a catalogue large
  enough to need. Left as future work, gated on the catalogue actually approaching that size.
- **Item 5 (caching) — deliberately not attempted.** The plan calls for Next 16's tag-based
  caching (`cacheTag`/`updateTag`/`revalidateTag`). Checked `node_modules/next/dist/docs/`
  (per this repo's own "read the docs before writing code" rule) before ruling it out:
  `cacheTag`/`"use cache"` require the `cacheComponents` experimental flag in `next.config.ts`,
  which is **not currently enabled anywhere in this app**. That flag doesn't scope to one
  module — it changes the caching/rendering model for every route in the app, and adopting it
  properly means auditing every page for the right `"use cache"`/Suspense boundaries, not just
  the Packages screens this phase touched. Flipping on an app-wide experimental rendering flag as
  a side effect of a Packages-scoped cleanup pass is exactly the kind of unrequested, high-blast-
  radius architectural change this plan's own execution should not make unilaterally. What *was*
  in scope and low-risk — Server Actions actually revalidating the routes whose data they change
  — is covered by item 6 below instead.
- **Item 6 (revalidation gap, finding F3):** the six lifecycle-status-changing actions
  (`publishPackageAction`, `publishExistingPackageAction`, `unpublishPackageAction`,
  `reopenPackageAction`, `archivePackageAction`, `restorePackageAction`) now also call
  `revalidatePath("/departure-groups")` **and** `revalidatePath("/leads")` alongside their
  existing `/packages` revalidation — the plan's own item 5 names both routes ("refresh the
  Departure Groups picker and the Leads catalogue"), and the first pass through this item only
  did the first. Both routes gate on the exact same predicate: the Departure Groups create
  flow's template picker (`PackageTemplateOption.isOpenForSale`, sourced from `packages.status`
  in `lib/data/departure-groups.ts`) and `loadLeadPackages()` in `lib/data/leads-repository.ts`
  (`.eq("status", "Open for Sale")`, backing the sales-copilot quoting flow) both only offer
  Open for Sale packages. Without revalidating `/leads` too, a package published or archived
  from the Packages module kept quoting off a stale package list on that route specifically,
  even though `/departure-groups` was already correct. `setPackageFeaturedAction`,
  `duplicatePackageAction` and `deletePackageAction` were left alone — none of them change
  `status`, so none of them affect what either catalogue offers.
- **Export safety (finding A7) — verified, not changed.** The CSV path already had the
  formula-injection prefix (`FORMULA_INJECTION_PREFIX` in `lib/csv.ts`, predating this phase,
  now covered by `lib/csv.test.ts`). Checked the XLSX path specifically, as the finding asked:
  `matrixToXlsx()` (`lib/xlsx.ts`) writes every cell with `t="inlineStr"` — an explicit inline-
  string type, never a formula cell (`t="str"` + `<f>`). Excel only evaluates a cell as a formula
  when the file itself declares it as one; an inline string starting with `=` loads and displays
  as literal text regardless of its content, on open, without needing the same quote-prefix
  defense CSV needs (CSV carries no type information at all, so Excel's importer guesses purely
  from a cell's leading character). No code change was needed here — the risk this finding asked
  about was already absent by construction.

**Verification performed:** `tsc --noEmit` clean throughout. `npx eslint
"app/(main)/packages/**/*.{ts,tsx}"` unchanged at 61 warnings / 0 errors (this phase touched
`actions.ts`, `packages-repository.ts` and added new files, none of which introduced a new
warning). `npm test` — 52/52 passing. As with every migration in this plan, `20261010090000_...`
was reviewed by hand — its `security invoker` scoping was checked against
`package_usage`'s own `security_invoker = true` setting and the existing MARKETING `.or()` filter
it replaces — but never executed against a real database; **run it on staging and confirm the
packages list still renders identically (same rows, same counts) before and after switching
`listPackages()` over to the RPC**, the same "reviewed, not exercised" caveat every prior phase's
migration has carried.

---

## Packages create / edit is a page (TASK-044)

Creating and editing a package is a full-page editor, not a dialog. This reverses the
"restore the dialog" correction under Phase 4 (E2 / E4); the reasons are in
`docs/tasks/TASK-044-package-editor-screen.md` (long multi-step forms belong on pages, a
modal over a modal is a poor layering, and the dialog was already full-viewport).

- **Routes:** `/packages/new` and `/packages/[packageId]/edit` render `PackageEditorScreen`.
  `/packages?create=1` and `/packages/[id]?edit=1` redirect to them. The edit page loads the
  package on the server with `loadPackageEditSnapshot` (`packages/package-edit-snapshot.ts`),
  which also runs the object-level `canRoleViewPackage` check (finding A5).
- **Code:** `app/(main)/packages/components/package-editor/` holds the editor. The form,
  step-navigation and save hooks are separate; `decidePackageSaveRoute` is the single rule for
  what Save does (draft / review first / save directly).
- **Unsaved changes:** one prompt (`PackageLeaveConfirmDialog`) for Cancel, link clicks and the
  Back button, driven by `useUnsavedChangesGuard`. The Back-button part relies on a
  capture-phase `popstate` listener running before Next's own handler; if that stops working,
  Back leaves without asking. Navigation started from code is not intercepted.
- **Change review:** `PackageChangeReviewSheet` (a side sheet) replaces the review dialog.
- **Shared UI fix:** the Dialog overlay is `z-50`, level with its popup, so a dialog opened over
  another dialog dims and blurs it.
- **Not done:** the current step is not in the URL.
