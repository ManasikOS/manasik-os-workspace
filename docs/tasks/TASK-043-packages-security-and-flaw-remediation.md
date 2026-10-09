# TASK-043 Packages — security and flaw remediation plan

Audit date: 2026-10-09. Branch: `UI-update`. **Revision 4 (2026-10-09): sensitivity is now defined by downstream impact; sensitive changes need a second person's approval, switchable in Settings.** This is a plan only. No code or migration has been written or changed.

## What

Fix the security, authorisation, integrity and robustness flaws found in a review of the Packages module, and make these product changes your decisions called for:

1. **Remove automatic draft saving.** Nothing is written to the database until the user presses a button.
2. **Live packages: basic fields edit freely; sensitive fields (anything that changes bookings, payments, finance or group behaviour) always show a GitHub-style before/after comparison, and by default need a second person's approval.** An ADMIN can switch the approval requirement on or off per tier in Settings; the comparison is always shown.
3. **Custom roles from `/management/teams` are enforced by the database**, not only by the app.
4. **Export** becomes a small, audited, offline-friendly action.
5. **Delete** becomes a controlled, recorded operation.

Reviewed: routes under `app/(main)/packages/**`, all 15 exports of `actions.ts` (line by line), `lib/validations/packages.ts`, `create-package/mappers.ts`, `package-write-errors.ts`, `csv.ts`, `lib/data/packages-repository.ts`, `packages-template.ts`, `lib/access/packages-access.ts`, `dynamic-capabilities.ts`, `requireUser()`, `getCurrentStaffRole()`, every migration touching `packages`, `package_usage`, `package_activity_logs`, `package_versions`, the lifecycle RPCs, the MARKETING trigger, `list_packages_with_usage`, the agent-portal policy, and the two pgTAP files.

### Scope and honesty about evidence

- **Source-code review only.** I did not run the app, call any action or query the live database. Items marked **VERIFY** depend on deployed database state and must be confirmed on staging (two agencies, one user per role, one agent-portal user) before being treated as exploitable or fixed.
- The wizard step components (`step-1` … `step-7`, about 3,900 lines) were checked by search for risky patterns, not read line by line.
- Findings already tracked in `docs/modules/packages-production-readiness-plan.md` (A1–A5, B2–B9, F1) are not repeated unless a gap remains.
- How custom roles work (confirmed in `20260924090000_dynamic_roles_permissions.sql`): each role declares a `base_role` tier that the database rules key off; `role_permissions` holds one JSON capability set per role and module. A custom role can be more restrictive than its tier in the app, but today the database only knows the tier.

### What is already done well (keep it)

- Every action calls `requirePackageCapability()` → `requireUser()` → role → merged capabilities. IDs use `z.uuid()`. The patch schema strips `status`/`featured`.
- Lifecycle moves (list publish, close sales, reopen, archive, restore) go through `SECURITY DEFINER` RPCs that lock the row, check agency, from-state and `updated_at`, and write `package_activity_logs`. The wrappers fail closed for callers with no profile/agency, and the internal step is not executable by `authenticated`.
- RLS on `packages` checks agency and role on all four commands; pgTAP covers cross-agency insert/update/delete.
- `internal_code` is unique per agency; write errors are translated without leaking constraint names.
- CSV export defuses formula-leading characters. No `dangerouslySetInnerHTML`, `eval`, `localStorage` or service-role client in the module; all free text goes through React escaping.

---

## Findings

Severity: **P1** authorisation, integrity or data-exposure gap a legitimate user can hit; **P2** hardening/robustness; **P3** process. Nothing reaches P0 from source alone.

### PKG-01 — P1: the wizard's publish path bypasses the lifecycle RPCs, so most publishes leave no audit trail
**Where:** `actions.ts:464-477`, `511-522`; UPDATE/INSERT policies in `20270119090000`; RPCs in `20261006090000`.
`publishPackageAction` writes `status = 'Open for Sale'`, `previous_status`, `published_at` with a plain update/insert. Only `publish_package()` writes the `PUBLISHED` log row, so the Activity tab misses the main publish path. Nothing in the database stops ADMIN/OPERATIONS from writing `status` directly (including inserting a row already Open for Sale) with no validation, history or actor.
**Fix:** Phase 1, step 1.

### PKG-02 — P1: a live package is edited in place with no re-validation, no review and no new version
**Where:** `actions.ts:217-284`, `298-381`; `use-draft-autosave.ts`; edit mode in `create-package-dialog.tsx`.
Both save paths accept any status. Autosave writes every keystroke of a live package's cancellation policy, payment milestones or capacity to the row that departure groups, leads, agents and the inbox treat as sellable. Re-publishing a live package is refused (`actions.ts:438`), so autosave is the only edit route, and it skips every publish check. Groups built later inherit the unreviewed change (`packages-template.ts:154-216` reads the live row, PKG-15).
**Fix:** Decision 1 is made: Phase 2, step 1 (explicit save + sensitive-change review) and Phase 1, step 2 (versioning).

### PKG-03 — P1: the MARKETING visibility rule is not enforced by the database
**Where:** `packages-access.ts:117-127`, `20261010090000` (`p_role`, `p_current_user_id` are caller-supplied), SELECT policy `20270119090000:277-283`.
MARKETING should see only Open for Sale packages and its own drafts. The database lets MARKETING read every package in the agency, and the list RPC trusts the arguments the caller passes. A MARKETING user running `supabase.from("packages").select("*")` gets every draft.
**Fix:** Phase 1, step 4. **VERIFY** first.

### PKG-04 — P1: custom-role restrictions are app-only, and the permission lookup fails open
**Where:** `dynamic-capabilities.ts:25-40`; RLS/RPCs use `staff_role_in(...)` on the base tier only.
(a) A custom role built on the ADMIN or OPERATIONS tier with `deletePackage`, `publishPackage` etc. switched off in the `/management/teams` sheet is blocked only in Server Actions; calling the REST API or an RPC directly works. (b) `loadDynamicCapabilities` returns the base defaults on any read error (`if (error || !data) return fallback`), so a transient error grants a restricted role its full tier. (c) The stored JSON is spread into the capability object without checking values are booleans.
**Fix:** Phase 1, step 3 (database-level capability check) and Phase 2, step 7. Decision 2 is made: enforce in the database.

### PKG-05 — P1: `package_versions_create()` trusts a caller-supplied snapshot and is not atomic with the publish
**Where:** `20261007090000:77-128`, `20270104090000:185-228`; `actions.ts:90-104, 493, 531, 585-588`.
Any ADMIN/OPERATIONS session can store any JSON as a version of any package in any status. In the app the call is a second request after the content write; failure is only logged, so a published package can have no version.
**Fix:** Phase 1, step 2.

### PKG-06 — P1 (VERIFY): agent-portal users can read whole package rows
**Where:** `20261030090000_agent_portal_auth.sql:58-66`.
Row-level only: an allocated agent (external user) can `select *`, including `itinerary[].internalNotes`, `transport_requirements[].internalNotes`, readiness checklist, payment terms, and rows in Draft or Archived status.
**Fix:** Phase 1, step 5.

### PKG-07 — P1: no size or shape limits on package input
**Where:** `lib/validations/packages.ts:35-182`.
Unbounded text, unbounded arrays, no numeric range or integer check (`numberOrEmpty`, `dayNumber`), free-string `dueDate`, unbounded `id`, not `.strict()` (the guidelines ask for it on pricing columns), `includedServices` and `selectedCommunicationTemplates` accept any string. Only Next's default body limit applies.
**Fix:** Phase 2, step 2.

### PKG-08 — P2: publish takes `featured`/`visibility` from the client and checks neither `createPackage` nor `editPackage`
**Where:** `actions.ts:391, 464-469, 511-516`; `mappers.ts:53-54`.
A role holding only `publishPackage` can rewrite every field, create a package already Open for Sale, and set `featured`.
**Fix:** Phase 2, step 3. Decision 3 is made: public visibility needs no separate capability; it follows edit rights (and the sensitive-field review when the package is live).

### PKG-09 — P2: edits accepted on Archived rows; concurrency protection is optional
**Where:** `actions.ts:234-250` (no status check, no `expectedUpdatedAt`), `322-331` (compare only if the client sent it), `358-364`, `453-462`.
**Fix:** Phase 2, step 4.

### PKG-10 — P2: hard delete destroys the audit trail and leaves no record
**Where:** `actions.ts:1072-1131`; `on delete cascade` to `package_activity_logs` and `package_versions`; delete policy `20270119090000:329-334`.
Any status can be deleted when no visible group uses it; the "has groups?" check reads a `security_invoker` view, so it counts only groups the caller can see (the foreign key is the real backstop). Other referencing tables (lead quotes, agent allocations, campaigns, inbox) were not traced — **VERIFY** their `on delete` behaviour.
**Fix:** Phase 3, step 1.

### PKG-11 — P2: friendly RPC errors are swallowed; some raw messages pass through
**Where:** `actions.ts:67-78`, `package-write-errors.ts:49-101`.
`22023`, `P0002`, `28000` fall through to "could not be saved"; non-RLS `42501` messages are returned raw.
**Fix:** Phase 2, step 5.

### PKG-12 — P2 (VERIFY): departure-group revenue shown on the package page without a finance capability
**Where:** `packages-repository.ts:175-231`, `groups-tab.tsx:164`. Also returns `[]` on any error.
**Fix:** Phase 2, step 6.

### PKG-13 — P2: no abuse controls on package endpoints
**Where:** `actions.ts` (all). Code lookups read up to 200/5,000 rows, duplicate loops up to 25 inserts, autosave flushes every 2 seconds. The only limiter in the repo is the Inbox one.
Removing autosave (below) removes the highest-volume caller; the rest still need limits.
**Fix:** Phase 3, step 3.

### PKG-14 — P2: action and data-layer hygiene
`saveDraftAction` parses input and builds the client before the auth gate (`actions.ts:217-231`); `getPackageUsage`, `listDepartureGroupsForPackage`, `getPackageActivity` skip `requireUser()`; `archivePackageAction` options, `setPackageFeaturedAction` `featured` and `getPackageForEditAction` id are not parsed as objects (a non-string `reason` throws at `actions.ts:909`); `create-package/page.tsx:14` builds a path from a raw query value; role names are hard-coded in five places.
**Fix:** Phase 2, step 8.

### PKG-15 — P2: groups are built from the live package row, not the published version
**Where:** `packages-template.ts:154-216`. **Fix:** Phase 2, step 9 (after versioning exists).

### PKG-16 — P2: database hygiene
`list_packages_with_usage` has no `revoke … from public, anon` (`20261010090000:254`); the MARKETING column-scope trigger was once missing on staging (**VERIFY** on each environment) and pgTAP does not cover "MARKETING cannot change title"; `package_activity_logs.reason` has no length cap.
**Fix:** Phase 1, step 6.

### PKG-17 — P3: export gate is cosmetic
`packages-list.tsx:277` only hides a button; every `viewModule` role already holds the whole list in the browser. **Fix:** Phase 3, step 2 (decision 4 made).

### PKG-18 — P3: test and CI gaps
One action test file (code collision); no authorisation tests; Packages CI runs neither pgTAP nor a dependency audit, uses Node 20 while the repo pins 22, and misses two path filters. **Fix:** Phase 4.

### Checked and found sound
Cross-tenant isolation on `packages`; `ilike` input escaping; no string-built SQL; `owner_id` stamped from the session and enforced by policy; `status`/`featured` blocked from autosave; all text rendered through React; no pilgrim PII stored on packages.

---

## Your decisions, as applied

| # | Decision | How the plan applies it |
|---|---|---|
| 1 | Sensitive = anything that harshly affects departure-group bookings, payments, finance or operations. A package name is only a name; a payment plan is not. | Three tiers by downstream impact, Phase 2, step 1. Reflects what the code actually reads (see "What a package edit really affects"). |
| 2 | Editing a public package is allowed, but with the comparison from 1 | No extra capability for public packages. The comparison (and approval, if enabled) applies to any live package regardless of visibility. |
| 3 | Sensitive edits need approval; Settings decides whether approval is required | Approval workflow (Phase 1 step 2, Phase 2 step 1); switches in Settings → Operations (Phase 2 step 1b). |
| 2a | Custom roles are made in a sheet under `/management/teams` | Enforced in the database by a capability check, new capability keys appear in that sheet automatically. Phase 1, step 3. |
| 4 | Export: more secure, faster, works on poor connections | Phase 3, step 2. |
| 5 | Delete with security | Phase 3, step 1. |
| Main | Remove automatic draft saving | Phase 2, step 0 (first change; it simplifies everything else). |

---

## Fix plan

Order: Phase 0 confirms, Phase 1 builds the database floor, Phase 2 changes the app on top of it, Phase 3 adds the product controls, Phase 4 tests alongside each phase. Each phase is one or two reviewable PRs.

### Phase 0 — confirm before changing (no code)
Run on staging with a test user per role in two agencies plus an agent-portal user; record in `docs/progress/`.
1. PKG-03: MARKETING `select * from packages` returns others' drafts?
2. PKG-01: ADMIN/OPERATIONS direct `update … set status` succeeds with no log row?
3. PKG-05: forged `package_versions_create` snapshot accepted?
4. PKG-06: agent reads `internalNotes` of an allocated draft?
5. PKG-12: MARKETING/VISA/CEO can read `departure_group_payment_summaries`?
6. PKG-10: list foreign keys pointing at `packages(id)` and their `on delete`.
7. PKG-04: with a custom ADMIN-tier role that has `deletePackage` off, direct `delete` succeeds?
8. PKG-16: MARKETING trigger present everywhere; run `get_advisors` (security).

### Phase 1 — database (new migrations, each with pgTAP in the same PR)
1. **One path for status and one for publish.** A trigger refuses any change to `status`, `previous_status`, `archived_at`, `published_at`, `published_version_id` except from inside the lifecycle functions, and refuses an INSERT whose `status` is not `Draft`. A new RPC (working name `publish_package_with_content`) does, in one transaction: capability check, row lock, `updated_at` compare, validated content write, status change, activity log, version. Both publish actions call it. Fixes PKG-01.
2. **Versions, change requests and change history inside the transaction.** `package_versions_create` stops accepting a caller snapshot: the snapshot is built from the locked row and the function is no longer callable by `authenticated`. Add `package_change_requests` (package, requester, status PENDING / APPROVED / REJECTED / WITHDRAWN / EXPIRED / SUPERSEDED, tier, per changed field the base value and proposed value, reason, approver, decision note, timestamps, expiry) and a `package_change_records` history (version before/after, fields, old/new values, requester, approver or "approval not required", time). New functions, all security definer with pinned `search_path`: `submit_package_change` (checks `editSensitiveTerms`, classifies the fields using one shared tier table, applies Basic fields, stores Tier 1/2 as a request or applies them directly when the agency setting says approval is off), `decide_package_change` (checks `approvePackageChanges`, approver ≠ requester, request still pending and unexpired, every base value still equal to the current row, then applies, versions and records), and `withdraw_package_change`. The function itself reads the agency's approval switches at that moment. Fixes PKG-05 and PKG-02's audit gap.
3. **Custom roles enforced in SQL.** Add a stable `security definer`, pinned-`search_path` helper `has_package_capability(key text)` that reads the caller's `staff_profiles.role_id` → `role_permissions` (module `packages`) and returns false if there is no row, the key is missing or the value is not boolean `true`. Use it in the RLS policies' role checks (together with the base tier — a custom role can only narrow the tier, never widen it) and inside every package RPC. Revoke from `public, anon`. Add the new capability keys (below) to `module-capability-keys.ts` so they appear in the `/management/teams` sheet and are seeded for the seven system roles with the current behaviour. Fixes PKG-04(a).
4. **MARKETING visibility in RLS.** SELECT policy limits MARKETING to `status = 'Open for Sale'` or `owner_id = auth.uid()`. `list_packages_with_usage` derives both values from the session and ignores its arguments (keep the signature one release, then drop). Fixes PKG-03.
5. **Agent portal.** Replace the agent's direct table policy with a `security_invoker` view or RPC returning only agent-safe columns for `Open for Sale` packages the agent is allocated; not granted to `anon`. Update the agent-portal readers. Fixes PKG-06.
6. **Hygiene.** Revoke the list RPC from `public, anon`; length check on `package_activity_logs.reason` (≤ 500); array-length backstops on the large JSON columns as a second line behind Zod; pgTAP for every item, including MARKETING-cannot-change-title and direct status write refused.

### Phase 2 — application

**Step 0 — remove automatic draft saving (do this first).**
- Delete `create-package/use-draft-autosave.ts` and every use of it in `create-package-dialog.tsx`: the 2-second debounce, the save on step change, the save on close, the `pagehide`/`visibilitychange` save, the "Draft saved / Saving…" indicator, the stale status.
- The wizard holds its state only in the browser until the user acts. Buttons: **Save draft** (on every step and in the footer), **Save changes** (editing an existing package), **Publish** (final step). The first Save draft creates the row; later ones update it.
- Replace `saveDraftAction` + `savePackagePatchAction` with one explicit action, `savePackageAction`, which: authenticates first, parses with the strict schema, requires `expectedUpdatedAt` for an existing row, refuses Archived rows, writes only what changed, and returns the new `updated_at`. This removes the id branch that had no concurrency check and the optional compare (PKG-09), and the 2-second write storm (PKG-13).
- Protect against lost work now that nothing saves silently: a dirty-state flag; closing the dialog or leaving the page with unsaved changes asks "Save draft, discard, or keep editing?"; `beforeunload` warning for tab close; a clear "Unsaved changes" label in the sidebar instead of the old save indicator. No browser storage of form content (keeps with the security rules).
- Publishing no longer needs a pre-publish flush; it sends the form and `expectedUpdatedAt` in one call. `publish-guard.ts` and its test are removed or reduced accordingly.

**Step 1 — live-package edits: tiered comparison and approval (PKG-02).**

*What a package edit really affects (from the code, so the tiers are honest).* A departure group copies the package into a frozen snapshot when the group is created (`packages-template.ts`: payment schedule, policies, itinerary, inclusions/exclusions, accommodation, transport, traveller and readiness requirements, capacity defaults, seat hold, waitlist, duration). So an edit does **not** rewrite groups that already exist; it changes every group created **after** the edit, what leads can quote (`leads-repository.ts` reads title and journey type), what agents see in the portal, and what "compare with template" shows. Fields that existing groups read **live** are the package title and code (shown as `livePackageTitle`, reports, the CSV import matches on package code) and `status`. That is why a name is harmless and a payment plan is not.

- **Draft packages:** every field is editable, saved only with **Save draft**; no comparison, no approval (nothing downstream uses a draft except the Admin-only "include drafts" picker).
- **Open for Sale / Sales Closed packages:** **Save changes** computes a field-by-field difference against the real row and splits it by tier:

  | Tier | What it covers | Why | Handling |
  |---|---|---|---|
  | **1 — Money & contract** | Payment milestones, payment terms, cancellation policy, late-payment policy, price-change disclaimer | Becomes the payment schedule and contractual terms every new group, booking and finance record inherits | Comparison always; approval by default |
  | **2 — Bookings & operations** | Default capacity, minimum group size, max pilgrims, default group capacity and status, seat hold expiry, waitlist, seat reservation rule; days, nights, Makkah/Madinah nights, itinerary day structure; accommodation standards, exact-hotel guarantee flags, meal plan, transport requirements; included services, inclusions, exclusions; document requirements, readiness checklist, selected communication templates; journey type, category, internal code, visibility, finance role view | Drives seat counts, waitlists, what is promised to pilgrims, what staff must prepare, what is visible in portals, and the code that imports/reports match on | Comparison always; approval by default |
  | **Basic** | Package name, description, branch, season, package class label, featured flag (own capability), itinerary titles/descriptions/locations (wording only), customer-wording fields, hotel display names, internal notes | Display text only; no number, rule or reference changes | Saves directly, no dialog |

  Edge rule: a change to the *number* of itinerary days, or to a day's category, is Tier 2; editing its wording is Basic. Anything unclassified defaults to Tier 2 (fail safe) until classified. The classification lives in one shared table in code so the UI, the server action and the database function read the same list. **Please review this table; it is the most important decision in the plan.**

- **Comparison (always for Tier 1 and 2, regardless of approval setting, and regardless of whether the package is public):** a review dialog opens before anything is written. Per field: removed text in red, added text in green, word-level highlight for long policy text; payment milestones as a table of added / removed / changed rows; numbers as "old → new"; a one-line "what this affects" hint per tier (for example "Applies to groups created after approval; existing groups keep their frozen terms"). Required "reason for change" note.
- **Approval, when required (default ON for both tiers):**
  1. The editor presses *Send for approval*. Basic changes in the same save apply immediately; Tier 1/2 changes become a **change request** (status PENDING). The live package is untouched, and the dialog says exactly which parts saved and which are waiting.
  2. A person with the approve capability (not the requester) sees it in a "Changes awaiting approval" list (badge on the Packages list and on the package page), opens the same comparison, and approves or rejects with a note.
  3. On approval the database applies the change, creates the next version, and records who requested and who approved. Rejected requests stay on record with the note; the requester can withdraw or revise a pending request.
  4. Safeguards: a requester cannot approve their own request; if any changed field has been modified since the request was made (field-level base value no longer matches), approval is blocked and the requester must rebase; requests expire after 14 days; one open request per package at a time (a newer one supersedes after confirmation).
- **Approval switched off for a tier:** the editor still sees the comparison and must confirm, the change applies immediately through the same database function, and the change record is written exactly as for an approved one (without an approver). Nothing is skipped silently.
- **Server enforcement, not UI:** the action and the database function recompute the difference from the real row and the current settings. A request that changes a Tier 1/2 field without a comparison confirmation, or when approval is required without an approved request, is refused. Direct REST or RPC calls hit the same function (Phase 1), so the dialog cannot be bypassed.
- The same diff component is reused in the Activity tab ("what changed in version N, who asked, who approved") and in the departure-group "compare with template" dialog.

**Step 1b — the approval switches in Settings.**
- New card **"Package change approval"** under *Settings → Operations* (`app/(main)/management/settings/operations/`), stored with the agency's other settings. Two switches: *Require approval for money & contract changes* and *Require approval for bookings & operations changes* (both ON by default for new and existing agencies, so turning the feature on never silently loosens anything).
- Changing a switch needs its own settings capability (proposed `managePackageApprovalPolicy`, ADMIN only by default, shown in the role sheet), is written to the settings activity log (who, old → new), and shows a warning when turning a switch off ("changes to payment plans will apply without a second person") and when fewer than two people hold the approve capability ("nobody else could approve a request").
- The database function reads the setting itself at the moment of the change; the app never decides this alone.
- Because the switches themselves weaken a control, they are not bypassable by a package editor and are covered by pgTAP.

**Capabilities (new, proposed names; they appear in the `/management/teams` role sheet and are seeded to today's behaviour for system roles):**
- `editSensitiveTerms` — may submit or directly apply Tier 1/2 changes to a live package. ADMIN, OPERATIONS yes; others no.
- `approvePackageChanges` — may approve or reject other people's requests. ADMIN yes by default; OPERATIONS no (editors and approvers should differ); adjustable per role.
- `editPackage` stays the gate for drafts and Basic fields.

**Step 2 — validation (PKG-07).** In `lib/validations/packages.ts`: `.max()` on every text (title 200, description 5,000, policies 5,000, labels 200); `.max()` on every array (itinerary ≤ 60, milestones ≤ 20, lists ≤ 100); `.int()`, `.min()`, `.max()` on every number including `dayNumber`; amounts ≥ 0 and percentages 0–100 at save time, not only at publish; a real date check on `dueDate`; `.strict()` on the schemas; allowlist for `includedServices`; check that `selectedCommunicationTemplates` ids belong to the caller's agency. Empty values stay legal for drafts.

**Step 3 — publish scope (PKG-08).** `publishPackageAction` never writes `featured`; requires `createPackage` for a new row and `editPackage` for a body; follows the Phase 1 RPC.

**Step 4 — concurrency (PKG-09).** Covered in Step 0 (required `expectedUpdatedAt`, Archived refused); the lifecycle menu keeps its read-then-write compare.

**Step 5 — errors (PKG-11).** Map `22023`, `P0002`, `28000` and RPC-raised `42501` to specific safe messages; never return raw `42501` text.

**Step 6 — finance (PKG-12).** `listDepartureGroupsForPackage` returns revenue only when `viewInternalFinance` is true and returns an error state instead of `[]` on failure.

**Step 7 — capabilities (PKG-04).** `loadDynamicCapabilities`: distinguish "no row" (use the tier default) from "read error" (deny and log). Parse the stored JSON with a schema (known keys, booleans only) before merging. Application of the same helper to other modules is a follow-up.

**Step 8 — hygiene (PKG-14).** `requireUser()` first in every action; Zod objects for every argument (archive options with `reason` ≤ 500, boolean `featured`); `requireUser()` in the three readers; `isUuid` check in `create-package/page.tsx`; one source of role names.

**Step 9 — groups use the approved version (PKG-15).** Departure-group creation reads the published version, not the live row.

### Phase 3 — product controls

**Step 1 — delete with security (decision 5).**
- Allowed only for Draft and Archived packages (a live package must be closed and archived first), only with the `deletePackage` capability (checked in the app and in the RPC through the Phase 1 helper), and only when no departure group, lead quote, agent allocation or campaign references it (checked in the RPC under the row lock, not just from the visible view).
- UI: a confirm dialog that shows what will be removed and requires typing the package code; loading → success/error toast as the repo standard.
- Server: one `delete_package` RPC that, in one transaction, copies the full row, its activity log and its versions into a `package_deletions` record (who, when, why, full snapshot; readable by ADMIN only, no update/delete policy), then deletes. The cascade no longer destroys history because it is kept in the record.
- Optional later: a 30-day "recently deleted" restore for ADMIN.

**Step 2 — export: secure and fast on a poor connection (decision 4).**
- Reality check: the list is already in the browser for every role that can open the module, so a button hide protects nothing. Real protection comes from three things: a server-side capability check that leaves an audit entry, sending only what each role may see, and rate limiting.
- Design: a tiny `authoriseExportAction` (checks `exportCatalogue`, writes an audit row with who/when/how many rows/filters used, returns only `{ ok }`, a few hundred bytes) → the file is then built **in the browser from the list already loaded**, so there is no second large download and it works on a slow or flaky link. CSV is the default (small, opens everywhere); XLSX stays an option, generated locally. The list payload itself is trimmed per role (finance-only columns omitted server-side), which is also the main speed win for the screen.
- If the connection drops, the authorise call fails fast with a clear message and nothing is exported unaudited.
- Rate limit: a handful of exports per user per hour.

**Step 3 — abuse limits (PKG-13).** Per-user limiter on create, duplicate, publish and the two code-lookup actions (shared store; follow the shape in `lib/inbox/rate-limit`); a per-agency cap on draft rows. The code lookups run on explicit blur/click rather than on every keystroke.

### Phase 4 — tests and CI (with each phase)
- **Vitest:** each action refuses a role without its capability; MARKETING cannot touch another's draft or an Archived package; publish cannot set `featured`; missing/stale `expectedUpdatedAt` refused; **Tier 1/2 change refused without a comparison confirmation; with approval required, refused unless an approved request exists; requester cannot approve own request; approval refused when a base value changed since the request; expired and withdrawn requests cannot be applied; Basic-only edits need no dialog; unclassified fields default to Tier 2**; the diff function (text, milestone table, numbers); validation limits; error mapping; capability loader denies on error and ignores non-boolean values; **no code path writes to the database without a user action** (the old hook is gone).
- **pgTAP:** approval switches read inside the function (turning one off changes behaviour, a package editor cannot change it); decide function checks capability, requester≠approver and base values; direct status write refused; INSERT as Open for Sale refused; custom role with a capability off is refused through REST and RPC; MARKETING cannot read another's draft; forged snapshot impossible; agent sees only the narrow view; delete writes the record and refuses live/referenced packages; cross-agency checks on every new function.
- **CI:** run pgTAP and `npm audit --omit=dev` (triage by reachability, no forced fixes) in the Packages workflow; Node 22; add `lib/data/packages-template.ts` and `lib/access/dynamic-capabilities.ts` to path filters.
- **Manual in the browser:** build a package, close the dialog with unsaved changes (prompt appears); edit a live package name (saves directly), then its payment plan (comparison, send for approval, approve as a different user, see Activity entry with both names); reject one; flip the Settings switch off and repeat (comparison still shown, applies at once); a role without `editSensitiveTerms` (refused); two tabs (stale refusal); delete a draft and an archived package; export on a throttled connection.

## Data model changes
New migrations (names chosen when written): status-change guard trigger; `publish_package_with_content` RPC; reworked `package_versions_create`; `package_change_requests`, `package_change_records` and the submit / decide / withdraw functions; agency setting columns for the two approval switches (on the existing agency settings table, default ON) with an audit entry on change; `has_package_capability` helper and policy updates; tightened SELECT policy and list RPC; agent-safe view and removal of the agent's direct policy; `package_deletions` and `delete_package` RPC; export audit table (or a generic audit table); length/array-size checks; revokes. Each is idempotent, ends with `notify pgrst, 'reload schema'`, has a rollback note, and nothing is dropped.

## Access control changes
- New package capabilities: `editSensitiveTerms`, `approvePackageChanges`. New settings capability: `managePackageApprovalPolicy` (ADMIN by default). `exportCatalogue` becomes audited rather than cosmetic. All appear in the `/management/teams` role sheet via `module-capability-keys.ts`; system roles are seeded to today's behaviour (nobody loses an ability they use today except that live Tier 1/2 edits now follow the approval rules).
- Custom roles now narrow access at the database, not only in the app; a read failure denies.
- MARKETING loses direct database read of others' drafts; agents read a narrow view instead of the table.
- `publishPackage` no longer implies edit or feature rights.

## UI surfaces
`create-package-dialog.tsx` (no autosave; Save draft / Save changes / Publish; unsaved-changes prompts), a new change-comparison dialog with the diff view and reason box, a "Changes awaiting approval" list with badges on the Packages list and detail page and an approve/reject view, the Activity tab (change history with diffs, requester and approver), Settings → Operations (new "Package change approval" card), `packages-action-menu-items.tsx` and `package-detail.tsx` (delete only for Draft/Archived, typed confirmation), `packages-list.tsx` (export), `groups-tab.tsx` (revenue by capability), the role sheet in `/management/teams` (new keys), and the agent-portal package list. All use shadcn components, `InputGroup` for inputs and `runWithLoadingToast` for waits, per the repo rules.

## Decisions confirmed
- Tier table in Phase 2, step 1 is approved as written (branch Basic; internal code and visibility Tier 2).
- Only ADMIN approves (`approvePackageChanges` is seeded to ADMIN only; OPERATIONS can request but never approve). A custom role can be given it in the `/management/teams` sheet.
- One approval switch per tier (Tier 1 money & contract, Tier 2 bookings & operations), both ON by default.

## Open items (defaults apply unless you say otherwise)
1. Requests expire after 14 days, one open request per package.
2. Approvers are told by a badge and a "Changes awaiting approval" list only; a notification/email can be added later by reusing the app's existing channel.

## Test plan
See Phase 4. Done when every Phase 0 VERIFY item has a recorded result; every finding has a merged fix with its test or a written acceptance; `npm run lint`, `npm run typecheck`, `npm run test` pass; pgTAP passes on a clean rebuild and on staging; and `get_advisors` shows no new security warning on the changed tables and functions.

## Status
Draft (revision 4) — all product decisions made; ready to start Phase 0 (verification on staging) on your go-ahead. No code or migration has been changed.

## Phase 0 results (2026-10-09)
See [`docs/progress/2026-10-09-packages-phase0-verification.md`](../progress/2026-10-09-packages-phase0-verification.md). Catalog checks on staging confirm PKG-01, PKG-03, PKG-04, PKG-05 (callable), PKG-06 (policy text) and PKG-16 (anon/PUBLIC can execute the list RPC) at policy level. Behavioural tests were not run (blocked by the permission classifier) and are in that file as a rollback-only script.

Plan changes from Phase 0:
- **Phase 1 step 6 adds:** pin `search_path` on `staff_role_in` (advisor WARN; every package policy and the new capability helper depend on it).
- **Phase 3 step 1 (delete) must also handle:** cascade to `agent_package_allocations` and to the server-only `package_content`, `package_faqs`, `package_media`, `package_seo_analyses`; silent unlinking (`set null`) of `leads`, `lead_quotes`, `campaigns`, `agent_booking_submissions`. Refuse or list them in the confirm dialog, and keep them in the `package_deletions` record.
- **New scope note:** the four website/SEO tables have RLS on and no policies (server-only today). Give them tenant-scoped, capability-checked policies before any feature reads them.
- Package changes also bump the inbox knowledge version (`packages_bump_inbox_version`); the approval flow should be the only path that does that for Tier 1/2 fields on live packages.

### Phase 0 behavioural results (user-run, staging)
PKG-01, PKG-03, PKG-04, PKG-05 and PKG-12 are now **confirmed by test**, not only by reading policy text. T6/T6b show the MARKETING update policy and trigger work as designed. PKG-12 is stronger than first written: MARKETING can read group payment summaries directly. Only T2a (direct insert as Open for Sale) and the agent-portal behavioural check remain open; neither changes the plan. Status: Phase 0 complete; ready for Phase 1 on your go-ahead.

## Phase 1 progress

### Slice 1 (built on branch `UI-update`, not yet applied to any database)
- `20270120090000_packages_phase1_hardening_basics.sql` — pins `staff_role_in`'s `search_path`; revokes the list function from PUBLIC/anon; caps `package_activity_logs.reason` at 500 (NOT VALID).
- `20270120090100_packages_lifecycle_single_path.sql` — trigger `packages_guard_lifecycle_columns` (direct API callers cannot insert a non-Draft package or change status, previous_status, archived_at, published_at, published_version_id); internal `packages_record_version` (version built from the row); `packages_apply_status_transition` records the version in the same transaction; `package_versions_create` ignores the caller's snapshot and is closed to signed-in users; new `publish_package_with_content` (role + agency + lock + stale compare + allow-listed columns + transition + log + version in one transaction).
- App: `publishPackageAction` and `publishExistingPackageAction` use the database functions; the best-effort version helper is gone; publish no longer writes `featured`. `package-write-errors.ts` now shows the lifecycle functions' own messages (22023/P0002/28000) and only an allow-list of 42501 messages.
- Tests added/updated: `lib/security/packages-lifecycle-single-path-migration.test.ts` (15), `supabase/tests/database/packages_lifecycle_single_path.test.sql` (27 assertions), `package_wrapper_guards.test.sql` (version-create assertions now expect a permission error), `package-write-errors.test.ts`, `actions.code-collision.test.ts`.

**Not done / not proven yet**
- The SQL has not been executed anywhere: Docker is not running here, and I did not apply anything to staging. The pgTAP files have not been run. Run `scripts/local/rebuild-from-migrations.sh` then the pgTAP suite before merging.
- `supabase/schema-fingerprint.json` is stale (240 migrations recorded, 242 present) so `lib/ops/gate/schema-baseline.test.ts` fails until `scripts/local/write-schema-fingerprint.sh` is run against that rebuilt local database.
- Two unrelated tests in `lib/inbox/no-inngest.test.ts` fail by timeout with or without these changes.
- Deploy order: apply both migrations and the app change together; the new guard makes the old direct-status publish path fail.
- `staff_role_in` now has a `SET` clause so it can no longer be inlined into policies; expected to be negligible (its body already calls a non-inlinable definer function) but check the plan of the package list query on staging after applying.

### Remaining Phase 1
Step 2 remainder (change requests, change records, the submit/decide/withdraw functions, the two approval switches in agency settings), step 3 (`has_package_capability` and the policy/RPC changes), step 4 (MARKETING-only-live-or-own SELECT policy, list function ignoring its arguments, and closing MARKETING's read of `departure_group_payment_summaries`), step 5 (agent-safe view).

### Slice 2 (built on branch `UI-update`, not yet applied to any database)
- `20270120090200_packages_marketing_visibility_and_group_revenue.sql` — (1) "staff read packages": MARKETING reads only Open for Sale packages and its own; other roles unchanged; (2) `package_versions` and `package_activity_logs` read policies also require that the caller can read the package; (3) `list_packages_with_usage` ignores `p_role`/`p_current_user_id`; (4) `departure_group_payment_summaries` returns rows only to ADMIN, CEO and FINANCE (its only consumer is the package page's Departure Groups tab).
- App: `listDepartureGroupsForPackage(packageId, includeRevenue)` fetches revenue only when `can.viewInternalFinance`; the tab hides the revenue column when it is `null`.
- Tests: `lib/security/packages-marketing-visibility-migration.test.ts` (7, passing), `supabase/tests/database/packages_marketing_visibility.test.sql` (17 assertions, **not run**).
- Known effects to check on staging: a MARKETING user loses sight of other people's drafts everywhere (group-creation picker, global search) — intended; a custom role built on a tier other than ADMIN/CEO/FINANCE sees no group revenue even with `viewInternalFinance` switched on (the capability check in step 3 will refine this).
- The fingerprint file now needs regenerating for 243 migrations.

### Slice 3 — custom roles at the database (built on `UI-update`, not applied anywhere)
- `20270120090050_packages_capability_helpers.sql` — `package_tier_default_capability(role, key)` (mirrors `CAPABILITIES` in `packages-access.ts`; a Vitest test fails on drift) and `has_package_capability(key)`: the caller's saved role value if the key is present (only boolean `true` grants), otherwise the base-tier default; no profile means no capability.
- `20270120090300_packages_capability_enforcement.sql` — INSERT/UPDATE/DELETE policies, the column-scope trigger and the five lifecycle functions now also require the capability (`createPackage`/`duplicatePackage`, `editPackage`/`toggleFeatured`, `deletePackage`, `publishPackage`, `archiveOrRestorePackage`). The column-scope trigger is now SECURITY INVOKER (as a definer function its `current_user` bypass would have let everyone through). `publish_package_with_content` (slice 1) requires `publishPackage`, plus `createPackage` for a new package or `editPackage` for an existing one. The SELECT policy (slice 2) requires `viewModule`; the group-revenue view requires `viewInternalFinance`.
- Because slices 1 and 2 were not yet applied anywhere, their files were edited in place to use the helpers; the helpers file is numbered `…090050` so it runs first.
- Tests: `lib/security/packages-capability-helpers-migration.test.ts` (21, passing), `supabase/tests/database/packages_capability_enforcement.test.sql` (15 assertions reproducing Phase 0 test T5; **not run**).
- Behaviour change to expect: a custom role without `editPackage` can now only toggle `featured`; a custom role without `publishPackage` cannot close sales or reopen. The application already enforced both; the database now agrees.
- Fingerprint: 245 migrations present vs 240 recorded.
- Not yet covered: the new `editSensitiveTerms` / `approvePackageChanges` keys and the Settings approval switches (next slice), step 5 (agent-safe view).

### Slice 4 — change requests, approval switches, tier table (built on `UI-update`, not applied anywhere)
- `20270120090060_packages_content_columns_and_tiers.sql` — `package_content_columns()` (the one allow-list; `publish_package_with_content` now reads it), `package_field_tier(column)` (0 Basic, 1 Money & contract, 2 Bookings & operations, unlisted = 2), `package_itinerary_structure_changed(before, after)`, and the internal `packages_apply_content(id, content)` that is now the only place content columns are written.
- `20270120090400_packages_change_requests.sql` —
  - **Switches:** `agency_settings.package_approval_money_contract` and `package_approval_bookings_ops`, both default ON, guarded so only an administrator whose saved settings do not withhold `managePackageApprovalPolicy` can change them, each change written to `settings_activity_logs`; a missing settings row means approval required.
  - **Table:** `package_change_requests` (PENDING / APPROVED / APPLIED / REJECTED / WITHDRAWN / EXPIRED / SUPERSEDED; per-column old, new and tier; reason 1–500; 14-day expiry; one pending request per package; readable by the requester or ADMIN/CEO/OPERATIONS; no write policy or privilege).
  - **Functions:** `submit_package_change` (Open for Sale / Sales Closed packages only; basic changes save at once; tier 1/2 need `editSensitiveTerms` and a reason, then wait for approval or, if that tier's switch is OFF, apply at once and are recorded APPLIED; refuses a second pending request unless told to supersede), `decide_package_change` (needs `approvePackageChanges`, never your own request, still pending and unexpired, every changed column must still hold the value the request was made against; approval applies, versions an Open for Sale package, logs `CHANGE_APPLIED`), `withdraw_package_change`.
  - **Bypass closed:** trigger `packages_guard_live_terms` — a direct API write cannot change a Tier 1/2 column of a package on sale, nor any content column of an archived package.
- App/TS: new `lib/access/package-field-tiers.ts` (same table as SQL, used by the Phase 2 comparison dialog); capabilities `editSensitiveTerms` (ADMIN, OPERATIONS) and `approvePackageChanges` (ADMIN only) added to `packages-access.ts`, `module-capability-keys.ts` (so they appear in the role sheet) and the SQL tier defaults; `CHANGE_APPLIED` added to the activity-log type and tab; `package-write-errors.ts` shows the new functions' messages.
- Tests: `lib/security/packages-change-requests-migration.test.ts` (26, passing, includes TS-vs-SQL tier and column drift checks); `supabase/tests/database/packages_change_requests.test.sql` (38 assertions covering basic save, reason required, pending, one-at-a-time, direct-write bypass, approve/reject/withdraw, own-request refusal, double approval, itinerary wording vs structure, stale base value, switch off → applied, non-admin cannot flip a switch, CEO refused, settings log; **not run**).

**Deployment warning:** the live-terms guard makes the current autosave (`saveDraftAction` with an id, `savePackagePatchAction`) fail with "Changes to payment or booking terms … must go through the review" when it tries to write a Tier 1/2 column of a package that is on sale. That is intended, but the Phase 2 work (explicit Save, comparison dialog calling `submit_package_change`, approval list, Settings card) must ship together with these migrations, or live packages cannot be edited in the UI until it does.

**Phase 1 status:** only step 5 (agent-safe view replacing the agent's direct read of `packages`) remains. The Settings key `managePackageApprovalPolicy` is read by the database but is not yet in `SettingsCapabilities` / the role sheet; Phase 2 adds it with the Settings card. Fingerprint: 247 migrations present vs 240 recorded.

### Slice 5 — agent portal no longer reads package rows (built on `UI-update`, not applied anywhere) — Phase 1 complete
- `20270120090500_agent_portal_package_titles.sql` — new `agent_allocated_package_titles()` (returns `package_id` and `title` for the calling agent's own allocations, nothing else; security definer, pinned `search_path`, not executable by anon/PUBLIC) and **drops** the policy "agent read allocated packages". Staff policies untouched; an agent still reads their own allocation rows; foreign-key checks do not need a SELECT policy.
- App: `listPortalAllocations()` in `lib/data/agent-portal-repository.ts` reads allocations and calls the function instead of embedding `packages:package_id ( title )` (the only agent-side use of a package; checked: nothing else in `app/(agent-portal)` queries `packages`). It throws if the function errors rather than showing blank titles.
- Tests: `lib/security/agent-portal-package-titles-migration.test.ts` (6, passing, includes repository behaviour with a stubbed client); `supabase/tests/database/agent_portal_package_titles.test.sql` (9 assertions: an agent reads 0 package rows, gets only their own title, cannot see another agent's; staff unaffected; **not run**).
- Deploy together with the repository change; applying the migration alone would make the agent dashboard error on the embed.
- Fingerprint: 248 migrations present vs 240 recorded.

**Phase 1 is complete in source** (8 migrations: `…090000`, `…090050`, `…090060`, `…090100`, `…090200`, `…090300`, `…090400`, `…090500`). Nothing has been applied or executed against a database; pgTAP files (about 130 assertions across 7 files) are unrun.
