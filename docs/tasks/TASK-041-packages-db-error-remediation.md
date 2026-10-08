# TASK-041 Packages DB error remediation

## What
Fix the "duplicate key value violates unique constraint
`packages_internal_code_agency_unique`" failure when creating a package, and
audit every other database rule around Packages so no raw Postgres error can
reach a user from this module again.

## Why
Creating a second package in an agency fails on publish with a raw constraint
error. Investigation (2026-10-08) found the cause is in the app, not in the
schema:

1. `INITIAL_PACKAGE_FORM_DATA.internalCode` is hard-coded to
   `"RF-PKG-2026-UM01"` (`app/(main)/packages/create-package/types.ts:415`).
   Every new wizard session starts with the same code.
2. The unique index `packages_internal_code_agency_unique`
   (`agency_id, lower(internal_code)`, blank codes excluded) is correct and is
   doing its job. Staging already holds one `Open for Sale` package with
   `rf-pkg-2026-um01`, so every later create collides.
3. The first autosave (`saveDraftAction`, insert) fails with 23505. The wizard
   only shows a small "Could not save" label, and `packageIdRef` stays `null`.
4. `handlePublish` (`components/create-package-dialog.tsx:250`) ignores the
   `ok` flag returned by `saveNow()` and calls `publishPackageAction` with
   `packageId: null`, which attempts a second insert and hits the same index.
5. Both actions return `error.message` verbatim, so the user sees the
   constraint name.

## Environment (corrected)
There is **no local database**. The localhost app (`.env.local`) talks
directly to the staging Supabase project **Manasik OS**
(`klognjpwmqwlgeibvanf`). The Docker containers seen earlier are not used by
the app and are ignored by this plan. Consequences:

- Every test, including "local" browser runs, writes to the staging database.
  There is no throwaway environment, so isolation is by test agency and
  cleanup, not by environment.
- Every migration is applied straight to staging. There is no local dry run,
  so each migration must be proven safe by read-only pre-flight queries and by
  a rolled-back transaction before it is committed.
- pgTAP files in `supabase/tests/database/` can not be run against a local DB.
  They are run on staging inside `begin; … rollback;`.
- Production (`bidmihfsljrurlnraqmf`) is out of scope and is never touched.

Current staging state (read-only queries, 2026-10-08):

| Item | Value |
| --- | --- |
| Migrations applied | 239, head `20270118090000` (matches the repo) |
| Agencies | `Royal Al-Fathima Travels` (`…0001`, the real working agency), `LR2 Fixture Agency A`, `LR2 Fixture Agency B`; none has `is_test = true` |
| Packages (all in agency `…0001`) | 1 `Open for Sale` `RF-PKG-2026-UM01`; 1 `Draft` with a blank code |
| `package_versions` | 1 row |
| Departure groups using a package template | 1 |

The `Royal Al-Fathima Travels` agency holds working data, so tests must not
create, edit or delete anything in it except where a step explicitly says so
and the owner has agreed.

## Plan

### Phase 0 — Safe test setup on staging
- Keep all test writes out of the real agency. Use a disposable test agency:
  create one named `E2E-packages-<date>` via the service role with
  `is_test = true` (only the service role can set it; the app then refuses
  provider sends for it). Add three staff users in it (ADMIN, OPERATIONS,
  MARKETING) and use the two `LR2 Fixture` agencies only as the "other agency"
  for tenant-isolation checks.
- Tag everything created by tests with the code prefix `ZZTEST-` so cleanup is
  a single, reviewable `where` clause.
- Write the cleanup first: a script that deletes packages, versions, activity
  rows and the test agency, run only against the test agency's id. Read it back
  before running. Run it at the end of every session.
- Take a read-only snapshot of the real agency's package rows (ids, codes,
  statuses, `updated_at`) before starting; compare after to prove nothing in it
  changed.
- Confirm the dev server's env really targets `klognjpwmqwlgeibvanf` and not
  production before the first write.
- Decision (owner, 2026-10-08): a disposable test agency on staging is
  approved. Tests run only inside it.

### Phase 1 — Reproduce
- In the test agency: create package A with the default code and publish
  (expect success), then create package B without changing the code (expect
  the reported toast and a failed `saveDraftAction` in the server log before
  the publish).
- Capture the sequence as a Vitest test before fixing anything.

### Phase 2 — Fix the reported bug (app layer)
1. **Default code.** Remove the hard-coded `internalCode` default. Start blank
   (the index already excludes blanks, so drafts never collide) and offer a
   suggested next free code in Step 1. Review the other sample values in
   `INITIAL_PACKAGE_FORM_DATA` (title, description) for the same "looks real,
   gets published by accident" problem.
2. **Normalise.** Trim `internalCode`. The index compares
   `lower(internal_code)` without trimming, so `"UM01"` and `"UM01 "` are
   currently distinct. `internalCode` is not named in `server-schema.ts` or
   `schemas.ts`, so confirm where (or whether) it is validated.
3. **Pre-check.** Add a server-side "is this code free in my agency" check used
   by Step 1 (inline message under the field) and by publish.
4. **Translate DB errors.** Add one packages error mapper (same idea as
   `mapLifecycleRpcError`) and route every `error.message` return in
   `actions.ts` through it (14 places). Minimum mappings: 23505 on
   `packages_internal_code_agency_unique` → "Package code X is already used by
   another package. Choose a different code." with `step: 1`; 23514 per check
   constraint; 23503; 42501 (RLS).
5. **Wizard honesty** in `create-package-dialog.tsx`:
   - `handlePublish`: stop when `saveNow()` returns `ok: false`; show the save
     error and jump to the offending step. Never publish with a null id after a
     failed save.
   - `handleSaveDraft`: currently always toasts "saved as Draft". Use the
     outcome.
   - `attemptClose`: currently closes without waiting; a failed save loses the
     draft silently. Await and warn.
   - `useDraftAutosave`: carry the server error text in the outcome so the
     label says why, not just "Could not save".

### Phase 3 — Audit every Packages DB rule (read-only on staging)
Entities in scope: `packages`, `package_versions`, `package_activity_logs`,
`package_usage` (view), `departure_group_package_snapshots`,
`agent_package_allocations`, and inbound FKs from `departure_groups`, `leads`,
`lead_quotes`, `campaigns`, `agent_booking_submissions`.

All checks here are `select`s against the catalog or rolled-back transactions
in the test agency; nothing is left behind.

| Rule | Risk to check |
| --- | --- |
| 6 enum checks on `packages` (`category`, `journey_type`, `package_category`, `visibility`, `status`, `finance_role_view`) | Zod enums and UI option lists must match the DB lists exactly. `finance_role_view` and `Early Registration` are the likely mismatches. |
| 8 numeric `>= 0` checks (`days`, `nights`, `makkah_nights`, `madinah_nights`, capacities, guide ratio) | Negative / NaN input from number fields. |
| `packages_archived_status_consistent` | `duplicatePackageAction` forces `status: "Draft"` and strips `archived_at`; confirm for an Archived source. Confirm no direct `.update()` can set status. |
| `packages_owner_id_fkey` ON DELETE RESTRICT | Removing a staff user who owns packages fails with a raw FK error (team module). |
| `departure_groups` / `departure_group_package_snapshots` → `packages` RESTRICT | `deletePackageAction` pre-checks `package_usage` only; a snapshot row without a group count would still raise 23503 (mapped; verify wording). |
| `package_versions (package_id, version_number)` unique | `package_versions_create` locks the package row first; prove with a concurrent test. Its failure is swallowed by `createPackageVersionBestEffort`, leaving `published_version_id` null: decide if acceptable. Check whether the existing `Open for Sale` package has a version. |
| `agent_package_allocations (sales_agent_id, package_id)` unique | Same class of bug as the reported one in the agent-portal allocation action. |
| RLS `staff insert packages` | `WITH CHECK` has no `agency_id` condition. Verify what stops an insert carrying another agency's id (column default, restrictive policy, or nothing). |
| RLS `staff update packages` | `USING` / `WITH CHECK` have no `agency_id` condition and no trigger makes `agency_id` immutable. Verify a row cannot be moved to another agency. If either RLS item is real it is a security fix and takes priority over everything else here. |
| `packages_enforce_marketing_scope` trigger | MARKETING edits to restricted columns raise from the trigger; confirm the message is user-readable. |
| Publish-new path | `publishPackageAction` insert and version creation are two calls, not one transaction. |
| Blank-code Draft in agency `…0001` | Find which path created it and whether it can be published with a blank code (`isStepValid(1)` should refuse). Do not delete it without the owner's decision. |

Also run the Supabase security and performance advisors on staging and
include anything that names a packages object.

### Phase 3 results (2026-10-08, read-only on staging)

Method: catalog queries against staging, the project's own
`gate_schema_fingerprint()` compared with `supabase/schema-fingerprint.json`
(a clean rebuild of the repo), the Supabase advisors, and rolled-back
transactions run as real staff users. Nothing was left behind. Correction to
earlier notes: my first schema inventory came from the local Docker database,
which is not staging; every finding below was re-checked on staging itself.

| # | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| F1 | **High** (production go-live) | The repo's own `staff insert packages` policy has no `agency_id` check, and `staff update packages` has none either. A database built from the migrations (which is how production will be built) lets an ADMIN/OPERATIONS user insert a package into **another agency**. Moving an existing row to another agency is refused. | Replayed the repo's policies inside a rolled-back transaction on staging, as the real ADMIN: insert with another agency's id → ALLOWED; update `agency_id` → blocked 42501. |
| F2 | **Medium** (staging only) | Staging's `packages` policies are the old, un-hardened ones (`agency_id = current_agency_id() AND true`): no role check on read, insert or delete. A read-only role can create and delete packages straight through the API. Updates and publish are still refused, by the marketing-scope trigger and the RPC. Staging's agency check on insert/update is what currently stops F1 there, by accident. | As the real CEO in a rolled-back transaction: INSERT allowed, DELETE removed 1 row, UPDATE blocked ("Your role cannot update packages."), `publish_package` blocked. Fingerprint: `policy:packages` is `c22abdbf6f` on staging vs `f2447385b7` in the baseline. Staging has no MARKETING/FINANCE/VISA/GUIDE staff today, so live exposure is the one CEO account. The same drift exists on `departure_group_package_snapshots` (`41c1eae6d3` vs `88604cfd25`). The 2026-10-03 clean-rebuild audit reported "no always-true policy"; `AND true` slipped past that check. |
| F3 | Medium | `publish_package()` is callable directly by any ADMIN/OPERATIONS user and checks neither content nor the code; a blank-code draft can be published that way. It also writes no `package_versions` row, and the app writes versions as a separate best-effort call, so a failure leaves an Open for Sale package with `published_version_id` null. None exist today. | Function body read. |
| F4 | Low | Every package table grants full table privileges to `anon` and `authenticated`; RLS is the only guard. `list_packages_with_usage` is executable by `anon` (security invoker, so it returns nothing). `package_versions_create` lets ADMIN/OPERATIONS write any snapshot JSON, so version history can be forged. | ACLs; advisor `authenticated_security_definer_function_executable` lists the 6 lifecycle RPCs (role-checked inside, intended). |
| F5 | Info (known) | Staging-only leftovers already documented in `docs/progress/2026-10-03-clean-rebuild-proof.md` §D: 40 deprecated `packages` columns (with their price/flight check constraints) and the tables `package_content`, `package_faqs`, `package_media`, `package_seo_analyses` (RLS on, no policies, no code uses them). Harmless to the app; they are why `constraint:packages`, `table:packages` and `index:packages` differ from the baseline. | Fingerprint diff. |
| F6 | Info | Data is clean: 0 untrimmed codes, 0 Open/Closed packages with a blank code or without a version, 0 snapshot/template mismatches, 0 cross-agency links, 0 status/`archived_at` inconsistencies, 0 owners outside their agency. Enum lists match across DB, Zod and UI (`finance_role_view`, `Early Registration` included). | Probe queries. |
| F7 | Info | Reviewed and fine: `package_versions` numbering (row lock in `package_versions_create`); `agent_package_allocations` writes use `upsert` on the unique key, so no 23505 risk; staff hard-deletion only applies to never-accepted invitees, who cannot own packages, so `owner_id ON DELETE RESTRICT` is not reachable; `duplicatePackageAction` already retries code collisions. | Code read. |
| F8 | Low (performance) | 6 foreign keys on package tables have no covering index (e.g. `packages.published_version_id`, `package_versions.published_by`); 17 unused indexes; 3 tables with two permissive SELECT policies. Tables are tiny. | Performance advisor. |
| F9 | Info | The real agency now holds 2 more blank-code Drafts (created 03:34 UTC today, not by this work): a result of the wizard now starting blank, which is allowed by design. | Row snapshot. |

Also noted: Zod's `numberOrEmpty` accepts negative numbers, so a negative
capacity reaches the database and fails the `>= 0` check; Phase 2's translator
now turns that into a readable message, so no further change is required.

### Phase 4 — Data model changes
Phase 3 proved the need: F1 (and F2 for staging) are policy fixes. The unique
index is already correct once the app trims the code (Phase 2), so it is **not**
rebuilt.
- One new migration re-asserting the intended `packages` policies in full:
  select/insert/update/delete each with `agency_id = current_agency_id()` **and**
  the role check the repo already intends (ADMIN/OPERATIONS write, MARKETING
  limited to drafts and `featured`, ADMIN-only delete, everyone except GUIDE
  reads). On a fresh build this adds the missing agency check; on staging it
  also removes the `AND true` drift. Decide separately whether to do the same
  for `departure_group_package_snapshots`.
- F3 (RPC validation and in-transaction versioning) is a larger behaviour
  change: raise it with the owner before including it.
- Prerequisite: bring up a clean local stack from the migrations
  (`scripts/local/rebuild-from-migrations.sh`; the Docker containers seen
  earlier are stopped) so the migration and its pgTAP test are proven on a
  fresh build as well as on staging.
- Regenerate `supabase/schema-fingerprint.json`
  (`scripts/local/write-schema-fingerprint.sh`): `policy:packages` will change
  in the baseline, and after applying, staging's hash must equal it.
- Write the rollback statements in the migration header.
- Because there is no local dry run: (a) run the pre-flight queries to show no
  existing row violates the new rule, (b) run the whole migration inside a
  transaction that is rolled back and inspect the result, (c) only then apply
  it for real. Write the rollback statements in the migration header.
- Regenerate `supabase/schema-fingerprint.json` afterwards (the go-live gate
  compares it).

### Phase 5 — Verification on staging with test data
- pgTAP file `supabase/tests/database/packages_integrity.test.sql`, run on
  staging inside `begin; … rollback;`: duplicate code same agency (rejected),
  same code other agency (allowed), case and whitespace variants, two blank
  drafts (allowed), every check constraint, cross-agency insert/update attempts
  per role, concurrent version creation.
- `npm run lint`, `npm run typecheck`, `npm run test` (these need no database).
- Browser pass on localhost against staging, signed in as the test agency's
  users: create → autosave → publish; a second package with a duplicate code
  (inline message, no raw error); edit; duplicate twice; archive / restore;
  delete with and without groups; MARKETING and second-agency sessions.
- Run the Phase 0 cleanup, then re-compare the real agency's snapshot; it must
  be byte-for-byte unchanged.

### Phase 6 — Rollout to staging (needs explicit go-ahead)
1. Pre-flight read-only queries: duplicates under any new normalisation,
   blank-code non-Draft rows, `Open for Sale` packages with a null
   `published_version_id`.
2. Apply the migration (if any) through the normal migration path so history
   stays aligned (see TASK-035). The app change is a normal code deploy and is
   independent of the migration, so it can ship first.
3. Ask the owner what to do with the existing blank-code Draft and the
   sample-named `RF-PKG-2026-UM01` package. No existing data is changed
   without that decision.
4. Re-run the Phase 5 browser pass, advisors and the fingerprint gate.
5. Production is not touched by this task.

## Data model changes
None for the reported bug. Possible, pending Phase 3: trimmed unique index on
`packages.internal_code`; `agency_id` condition on the `packages` insert and
update policies.

## Access control changes
None planned. The RLS item above would tighten, not widen, access.

## UI surfaces
- `app/(main)/packages/components/create-package-dialog.tsx`
- `app/(main)/packages/create-package/use-draft-autosave.ts`
- `app/(main)/packages/create-package/components/step-1-commercial-identity.tsx`
- `app/(main)/packages/create-package/types.ts`
- `app/(main)/packages/actions.ts`

## Test plan
Automated:
- Vitest: packages DB error mapper (each code and constraint name); publish
  refuses to run after a failed draft save; code normalisation.
- pgTAP: `packages_integrity.test.sql`, run on staging in a rolled-back
  transaction.

Manual: the Phase 5 browser pass on localhost against staging, in the test
agency only.

## Status
In progress. Updated 2026-10-08.

- Environment corrected: localhost app → staging DB, no local DB.
- **Phase 0 done (partly).** Disposable test agency `E2E-packages-20261008`
  (`3d8e21ae-8208-46e5-a53d-d174681ae624`, `is_test = true`) exists on staging.
  Real-agency snapshot taken and re-checked: unchanged. No test staff accounts
  were created (see below).
- **Phase 1 done.** DB-level repro (rolled-back block, nothing left behind):
  same code + same agency → 23505 with the exact toast text; case variant →
  23505; same code in another agency → allowed; two blank codes → allowed;
  `"UM01 "` with a trailing space → **accepted** (index does not trim).
  App-level repro: `app/(main)/packages/actions.code-collision.test.ts`, 3
  tests, all failing until Phase 2 (hard-coded default code; raw constraint
  text returned by `saveDraftAction` and `publishPackageAction`).
- **Phase 2 done in code (2026-10-08), not yet verified in a browser.**
  - Default `internalCode` is now blank (`create-package/types.ts`). The
    built-in sample template in `lib/data/departure-groups-copy.ts` no longer
    borrows it; it keeps its own fixed `RF-PKG-2026-UM01`.
  - `packageFormSchema.internalCode` trims on every write (save, patch,
    publish), so `"UM01 "` and `"UM01"` can no longer both be stored.
  - `package-write-errors.ts` translates DB errors; every raw `error.message`
    return in `actions.ts` goes through it. Duplicate code → names the code,
    `step: 1`. Check constraints → field name and step. RLS wording hidden;
    messages raised on purpose by DB functions/triggers pass through; unknown
    errors are logged and replaced by a generic line.
  - `checkPackageCodeAction` + Step 1 shows "Another package already uses this
    code" with a one-click `CODE-2` suggestion. Deviation from the plan: no
    separate pre-check inside publish; the translated 23505 is authoritative
    there and cannot race.
  - Wizard: `publish-guard.ts` stops publish when the draft flush failed;
    Save Draft no longer toasts success on failure; first close with an unsaved
    failure warns, second close leaves; the sidebar label shows the reason.
  - Checks: `npm run typecheck` clean; `npm run test` 472 files / 5,037 tests
    pass; eslint reports no errors (warnings are existing unused imports).
- **Phase 3 done (2026-10-08).** Findings F1–F9 above. Nothing was changed on
  staging; every experiment ran in a rolled-back transaction. Note for Phase 5:
  the real agency now has 4 packages (2 new blank-code Drafts from manual
  testing), so its "unchanged" snapshot must be re-taken first.
- **Phase 4 done in the repo (2026-10-08); NOT yet applied to staging.**
  Scope: F1 and F2 only (not F3, not `departure_group_package_snapshots`).
  - `supabase/migrations/20270119090000_packages_policies_agency_and_role.sql`
    re-states all four staff policies on `packages`, each with the agency check
    and the role check. Policy-only, idempotent.
  - `supabase/tests/database/packages_policies_agency_and_role.test.sql`
    (22 assertions) and `lib/security/packages-policies-migration.test.ts`
    (13 static checks).
  - `supabase/schema-fingerprint.json` regenerated from the clean local build:
    exactly 3 lines changed (`lastMigration`, `migrationCount` 239 → 240,
    `policy:packages` `f2447385b7` → `37411296e1`).
  - Evidence. Local build first matched the old baseline with 0 differences
    (so it is a faithful clean build). The new pgTAP test run BEFORE the
    migration failed exactly 4 of 22 (cross-agency inserts, F1); AFTER it,
    22 of 22 pass. On staging, in rolled-back transactions: applying the
    migration moves `policy:packages` from `c22abdbf6f` to `37411296e1` (equal
    to the new baseline) and changes no other object; the same pgTAP file
    passes 22 of 22 there. Staging was re-checked afterwards: unchanged.
  - Local clean-build database now has the migration applied (240); its
    container was started for this and stopped again.
  - Checks: typecheck clean; `npm run test` 473 files / 5,050 tests pass.
  - Known side effect on staging once applied: CEO/VISA/GUIDE lose direct
    package insert/delete and GUIDE loses package reads; the app already denies
    all of these, and a clean build already behaved this way for GUIDE reads.
- Not covered by a test: `handlePublish` publishing with a null id after a
  failed save. It lives in a React component and the suite has no jsdom
  environment; Phase 2 should extract that decision into a plain function so
  it can be tested.
- Cleanup script (not committed): scratchpad
  `cleanup-e2e-packages-20261008.sql`, refuses to run unless the target is the
  `is_test` agency.
