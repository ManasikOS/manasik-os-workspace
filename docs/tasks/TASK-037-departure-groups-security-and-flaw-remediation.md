# TASK-037 Departure Groups — security and flaw remediation

Audit date: 2026-10-06. Branch: `UI-update`.

## What

Fix the security, authorisation, input-validation and robustness flaws found in
a review of the Departure Groups module: the list page, the group detail page
and its tabs, the booking detail routes, the ID-card route, the server actions
in `app/(main)/departure-groups/**`, the data layer in `lib/data/departure-groups*.ts`,
access rules in `lib/access/departure-groups-access.ts`, the Zod schemas in
`lib/validations/departure-groups.ts`, and the supporting migrations and cron routes.

### Scope and honesty about evidence

- This is a **source-code review**. I did not run the app, exercise any flow in a
  browser, or query the live database. Findings marked **VERIFY** depend on
  deployed database state (RLS policies, grants, bucket settings) and must be
  confirmed against the real project with two tenants before being treated as fixed
  or as exploitable.
- I read the full action list in `actions.ts` and the files named in each finding.
  I did not read every line of the roughly 60,000 lines in the module (the large
  UI dialogs were only sampled), so "no finding" for a file is not a clean bill of health.
- This doc is **additive**. Two earlier audits already cover money and calculation
  correctness: [`departure-groups-audit-and-fix-plan.md`](../modules/departure-groups-audit-and-fix-plan.md) (DG-01 to DG-23)
  and [`departure-groups-coherence-fixes-plan.md`](../modules/departure-groups-coherence-fixes-plan.md).
  Those are not repeated here. Migrations dated after them (`20261120…capacity_guard`,
  `20261122…store_atomic_rpc`) suggest part of DG-05 has been addressed; their status
  has not been re-verified here (see section F).

### What is already done well (keep it)

- Every server action in `actions.ts` begins with `requireUser()`, re-resolves the
  role server-side and re-checks a capability, then validates with Zod. The
  stated rule "UI gating is not a security boundary" is followed consistently,
  with the exceptions listed below.
- Finer gates exist where the risk is obvious: capacity, price and cost estimate
  need `overrideCapacityAndPrice`; refunds need `recordPayments`; cancelling a
  group needs `cancelOrArchiveGroup`; Nusuk fields need `manageDocumentsAndVisa`.
- Page routes call `notFound()` for guides not assigned to the group and for
  roles without module access (group page, booking page, ID-card page).
- Document storage is private, uses short-lived signed URLs (120 s), derives the
  object key and extension server-side, and enforces a MIME allowlist and 10 MB cap.
- Cron routes use a constant-time bearer-secret check and refuse to run when
  `CRON_SECRET` is unset.
- Tenant isolation migrations exist (`20260824…tenancy`, `20260827…tenant_storage_isolation`,
  `20261231…fix_child_table_tenant_isolation`) and guide row-scoping is in RLS
  (`20260903…`, `20260905…`).

---

## Findings

Severity: **P0** exploitable by a legitimate low-privilege user to change money
or data they should not; **P1** authorisation or integrity gap; **P2** hardening
or robustness; **P3** maintainability.

### SEC-01 — P0: a Marketing user can set the price, mark a booking paid and confirm it

**Where:** `actions.ts:543` (`createGroupBookingAction`), `actions.ts:629`
(`importGroupPilgrimsAction`), schema `groupBookingSchema` (`validations/departure-groups.ts:546`),
`departure-groups-bookings.ts:318-336`.

**What happens:** The only capability checked is `addBookings`, which Marketing
has. The payload accepts these fields from the client and the data layer uses
them as given:

- `packagePricePerPerson` (any value from 0) and per-traveller `pricePerPerson`;
- `amountPaid` (anything up to the total, clamped only by `min(max(…,0), totalValue)`);
- `bookingStatus` (`CONFIRMED` is allowed);
- `seatHoldExpiresAt`.

Nothing compares the price to the group's own pricing table, and nothing requires
`recordPayments` for a non-zero `amountPaid` or `overrideCapacityAndPrice` for a
non-standard price. The code comments describe repricing and payments as gated,
but those gates only exist on the edit/move/payment actions. Booking creation is
the unguarded door.

**Failure scenario:** A Marketing user calls the action directly (Server Actions
are public POST endpoints) with `packagePricePerPerson: 0`, `amountPaid: 0`,
`bookingStatus: "CONFIRMED"`. A free confirmed booking now holds seats. Or they
send a full price with `amountPaid` equal to the total and the booking is
recorded as paid in full with no ledger entry (this compounds DG-01).

**Fix:**
1. In both actions, derive the price server-side from `departure_group_pricing`
   and the room tier. Accept a client price only if it equals the derived price
   or the caller has `overrideCapacityAndPrice`.
2. Reject `amountPaid > 0` unless the caller has `recordPayments`. Better: remove
   `amountPaid` from the create payload and record any deposit through the single
   payment command planned in DG-01.
3. Restrict `bookingStatus` on create to `HELD`, `DEPOSIT_PENDING` or `WAITLIST`
   for roles without `recordPayments`. `CONFIRMED` should be reached through payment.
4. Apply the same rules to every row in the import action.

**Tests (Vitest):** a Marketing-role call with a lowered price, with `amountPaid > 0`
and with `CONFIRMED` is each refused; the same calls succeed for Admin with
override; import rows are checked row by row.

### SEC-02 — P1: cancelling and editing a paid booking needs only `addBookings`

**Where:** `actions.ts:976` (`cancelGroupBookingAction`), `1046` (`updateBookingContactAction`),
`1096` (`setBookingPayerAction`), `1141`/`1177` (relationships).

**What happens:** `cancelGroupBookingAction` gates only on `addBookings`. The one extra
check blocks a non-zero `refundAmount` for roles without `recordPayments`, but cancelling
with no refund still succeeds. That releases seats and rooming and zeroes the booking
balance (DG-08 documents the financial effect). Marketing can do this to a booking
with money collected.

**Fix:** Introduce `cancelBookings` (or reuse `editGroupDetails`) as a separate
capability. Require `recordPayments` or an Admin/Finance approval when
`amount_paid > 0`. Add the capability to `module-capability-keys.ts` and the
defaults in `departure-groups-access.ts`.

### SEC-03 — P1: server actions do not apply the group-scope rule that the pages apply

**Where:** `canRoleOpenGroup()` is called only in the three page routes. No action in
`actions.ts` calls it. Actions take `departureGroupId` from the client and pass it to
the data layer.

**What happens:**
- **Guides** (`manageTasks`) can call `createGroupTaskAction` / `updateGroupTaskStatusAction`
  for any group id. The only barrier is the RLS guide-scoping migration, which covers
  the 10 core tables. Child tables keyed through a parent (`flight_legs`, `rooms`,
  `room_assignments`) were added in a follow-up migration. **VERIFY** on the live
  database that a guide cannot write to a group they are not assigned to, through
  every table the action touches (tasks, activity logs, readiness items).
- **Marketing** is limited on the page to sellable groups (`canRoleOpenGroup`), but the
  booking actions accept any group id, including closed or cancelled groups.

**Fix:** Add one helper, for example `assertCanActOnGroup(groupId)`, that resolves the
role, assigned group ids and the group's sales status, and call it at the top of every
action that takes a group id. Keep RLS as the second layer. Add a test per role.

**VERIFY:** two-account test (guide A on group 1, group 2 not assigned) against the
real project, covering reads and writes.

### SEC-04 — P1: custom role permissions have no effect on this module

**Where:** `departure-groups-access.ts` (static `CAPABILITIES` map) and the comment in
`actions.ts:179-195` that says module capabilities are "not yet wired to `role_permissions`".
`module-capability-keys.ts:42` already lists `departure_groups` keys, so the permission
editor suggests these are configurable.

**What happens:** An admin can edit or grant departure-group permissions for a custom
role and see them saved, but the module ignores them. The behaviour differs from what
the settings screen implies, in both directions (a permission removed in the editor is
still granted by the built-in role map).

**Fix:** Resolve capabilities through `loadDynamicCapabilities(supabase, roleId, "departure_groups", capabilitiesFor(role))`,
as `packages` already does, in one shared `requireDepartureCapability(key)` helper used
by all actions and pages. Until that ships, hide the `departure_groups` keys from the
permission editor so it does not promise something it does not do.

### SEC-05 — P1: uploaded-file references are not bound to the group and traveller

**Where:** `submitDocumentSchema` / `uploadVisaSchema` / `uploadTicketSchema`
(`validations/departure-groups.ts:427-517`); `departure-groups-documents.ts:500`
and `:1194`; `document-storage.ts`.

**What happens:**
- The client sends `filePath` back after uploading. The schema only checks characters
  and `..`. The data layer stores the value as given. (The staged-ticket path does
  check the prefix, at `departure-groups.ts:3714`; the document and visa paths do not.)
  A user can attach any object path in the bucket, including another traveller's
  passport scan in the same agency, to a document record.
- Upload URLs are created with `upsert: true`, so a second upload silently overwrites
  a verified document in storage while the record can still read `VERIFIED`.
- `createDocumentDownloadUrl(path)` signs any path that does not contain `..`. It does not
  check that the path starts with the caller's agency id, or that the traveller belongs
  to a group the caller may open. Cross-agency access depends entirely on storage RLS.
- Content type and size are taken from the client's declaration. The bucket's own limits
  help, but the file content is never checked (no magic-byte check; HEIC and PDF are
  accepted by extension and header only).
- `createDocumentUploadUrl` validates id format but not that `pilgrimId` belongs to
  `departureGroupId` in the caller's agency.
- Opening a passport scan is not recorded anywhere.

**Fix:**
1. In each submit path, require `filePath.startsWith(`${agencyId}/${groupId}/${pilgrimId}/`)`
   and that the object exists (server-side `list`/`info`).
2. Use `upsert: false`, or version file names, and reset status to `SUBMITTED` when a
   verified document is replaced.
3. In `createDocumentDownloadUrl`, require the agency prefix, look up the traveller's
   group, call the group-scope helper from SEC-03, and write an access-log row
   (who, which traveller, when).
4. After upload, verify the real size and sniff the first bytes against the declared type.
5. Confirm the pilgrim row belongs to the group and agency before issuing an upload URL.

**VERIFY:** the storage policies in `20260827…tenant_storage_isolation.sql` are live and
restrict by agency prefix. The original policies (`20260811…`) were `bucket_id = '…'` only.

### SEC-06 — P1: the agent mute action has no capability check and no input validation

**Where:** `agent-proposal-actions.ts:107` (`setGroupAgentSuppressionAction`).

**What happens:** Any signed-in staff user, including a guide, can mute the operations agent
for any group id. `days` is not validated: `NaN`, a negative number or a very large value
reaches `new Date(...).toISOString()`, which throws a `RangeError` (an unhandled 500) for
out-of-range values. `reason` has no length limit. `groupId` is not checked for format or
agency (it relies on RLS).

`approveAgentProposalAction` and `rejectAgentProposalAction` accept `proposalId`,
`editedPayload` and `decisionNote` with no validation here. The service layer does role
checks (`highRiskRoles`) — **VERIFY** that `editedPayload` is re-validated against the
proposal's own schema and cannot widen scope, since it carries data into a mutation
executed under the approver's identity.

**Fix:** Zod-validate all three actions (`z.uuid()` ids, `days` as an integer from 1 to
90 or null, `reason` max 300, `decisionNote` max 500). Gate muting behind `manageReadiness`
or a dedicated capability. Wrap the date maths in the validation, not after it.

### SEC-07 — P1: `analyzeBookingAction` skips authentication and trusts client data in an LLM call

**Where:** `[bookingId]/analysis-actions.ts:29`.

**What happens:**
- It does not call `requireUser()`, contrary to the repo rule. It relies on
  `getCurrentStaffRole()` returning a denied role when there is no session, which is
  implicit and easy to break.
- Input is typed but not validated at runtime: `blockers` (arbitrary array),
  `bookingTotal` and `bookingTravellerCount` come from the client and go into the
  analysis and the model prompt. The blockers' text becomes model input, which is a
  prompt-injection and cost surface, and an arbitrarily large array is not capped.
- The booking id is never checked to belong to the caller's agency or to a group the
  role may open; it is only used in two RLS-filtered queries.
- No rate limit or usage cap on a call that costs money.

**Fix:** Add `requireUser()`. Validate with Zod (uuid, bounded array length and string
lengths). Recompute blockers, totals and traveller counts on the server from the booking
row instead of accepting them. Check group access (SEC-03). Route the call through the
existing AI usage/budget gate used by other surfaces, with a per-user rate limit.

### SEC-08 — P2: input validation is thinner than the rest of the codebase

**Where:** `lib/validations/departure-groups.ts`.

- Almost every id is `z.string().trim().min(1)`, not `z.uuid()`. Malformed ids reach the
  database layer and surface as generic persistence errors.
- Missing upper bounds in `groupBookingSchema`: `primaryContactName`, `primaryContactPhone`,
  `bookingReference`, `travellers[].fullName`, `phone`, `passportNumber` have `min` but no `max`.
  `travellers` is an unbounded array and is not required to equal `travellerCount`.
  `packagePricePerPerson`, `amountPaid` and per-traveller price have no `max`, unlike
  `recordPaymentSchema` (which caps at 1,000,000,000).
- `createGroupTaskSchema.ownerName` has no max. The owner is resolved by display name
  (`resolveStaffIdByName`), which is not a stable key and can match the wrong person
  when two staff share a name. Use `ownerId`.
- Phone and passport formats are not checked.
- `bookingReminderSchema` takes `message`, `recipientName` and `recipientPhone` from the
  client; the comment says a role without finance access gets a draft "that names no
  amounts", but that redaction happens in the browser. The server stores whatever is sent,
  and `recipientPhone` is not tied to the booking's own contact.

**Fix:** Shared `idSchema = z.uuid()`, `phoneSchema`, `moneySchema(max)` and
`shortText(max)` helpers; apply them everywhere; refine `travellers.length === travellerCount`
when travellers are supplied; take reminder recipient from the booking server-side and build
(or re-redact) the message server-side for roles without `viewFinance`.

### SEC-09 — P2: bulk import is not idempotent and holds a request open

**Where:** `actions.ts:405` and `629` (up to 200 rows each, processed in a sequential loop,
each row doing a full store load and write).

**What happens:**
- A double-click or retry creates duplicates: for bookings the store "re-numbers a reference
  that was already taken", so a second submit silently creates a second copy under a new
  reference instead of failing.
- 200 sequential store loads and writes inside one Server Action risks hitting the platform
  time limit and leaves a partly imported file. There is no per-user rate limit.
- Import rows inherit SEC-01 (price, paid amount, status).

**Fix:** Add a client-generated import batch id stored on each created row with a unique
constraint (one import per batch id); reject a reference collision on import rather than
renumbering; process in chunks of about 25 with progress returned to the UI, or move large
imports to a background job; add a per-user rate limit.

### SEC-10 — P2: tenant filtering depends only on RLS; admin-client paths have no second filter

**Where:** `lib/data/departure-groups*.ts` (`agency_id` appears in about 27 places across the
data files, mostly on inserts); `mutate(..., { client })` accepts an admin client for the
WhatsApp agent and cron; `release-seat-holds` runs with `agencyId: null`.

**What happens:** For session clients, reads and updates are isolated only by RLS. That is
acceptable when RLS is correct, but there is no defence in depth. For admin-client callers
(cron, agent executors) RLS is bypassed, so correctness depends on every caller passing only
ids that belong to the intended agency. `loadStore({ groupIds })` does not itself assert
agency ownership of those ids.

**Fix:** In `loadStore`, when an `agencyId` is known, add `.eq("agency_id", agencyId)` on the
group query and reject ids that do not return. For agent paths, resolve `agencyId` from the
proposal or conversation and pass it in. Add a Vitest that an admin-client mutation with a
foreign group id fails.

**VERIFY:** `departure_group_cost_estimates`, `departure_group_pricing` and the costing view
(see DG-23) with two tenants. Run `get_advisors` (security) on the live project and attach
the output to the PR.

### SEC-11 — P2: persistence is not all-or-nothing outside one code path

**Where:** `departure-groups.ts:594-620`; only the call at `:2788` passes `atomic: true`;
the other roughly 76 `mutate()` call sites use `persistStore`, which can throw
`DeparturePartialWriteError`.

**What happens:** A failure mid-write leaves some collections written and others not. The
code logs the error and tells an operator to reconcile by hand. This is DG-05 restated as a
security/integrity risk: it affects seat counts, money and ticket counters.

**Fix:** Make `atomic` the default in `mutate()` once the RPC covers all collections, then
delete `persistStore`. Until then, flip the flag on the money, seat and cancellation
mutations first (`recordBookingPayment`, `createGroupBooking`, `cancelGroupBooking`,
`moveBookingToGroup`, refund and charge approval). Add an integration test that injects a
failure between collections.

### SEC-12 — P2: personal data handling has no stated retention, access audit or vendor basis

**Where:** passport numbers on `departure_group_pilgrims`, visa and ticket files in
`pilgrim-documents`, `analysePilgrimTicketAction` / `analysePilgrimVisaAction`.

- Passport numbers and dates of birth are stored as plain columns. No retention period,
  erasure path or export path is defined for a traveller after a departure completes.
- Ticket and visa review sends traveller document content to an AI provider. **Decision
  needed:** confirm the provider agreement, the consent basis, and whether the model call
  must receive the whole document. Strip or mask fields the review does not need.
- No audit row is written when someone views or downloads a document (SEC-05).
- The activity trail stores reminder text verbatim, including recipient phone numbers.

**Fix:** Write a short retention policy (for example, delete or anonymise documents and
passport numbers N months after return date); add a scheduled job and a per-traveller
erase action; log document access; mask phone numbers in activity text.

### SEC-13 — P3: maintainability issues that raise the cost of fixing the above

- `actions.ts` is 3,297 lines with about 75 actions; `lib/data/departure-groups.ts` is 4,423
  lines; several dialogs and sheets exceed 1,400 lines
  (`create-departure-group-sheet.tsx`, `add-edit-flight-dialog.tsx`, `request-deviation-dialog.tsx`).
  The repeated "requireUser → role → capability → parse → mutate → revalidate" block is
  copied by hand in every action, which is how SEC-01, SEC-06 and SEC-07 slipped through.
- Test coverage for access is thin: three test files exist for the module
  (`departure-groups-bookings.test.ts`, `departure-groups-copy.test.ts`, `brochure-actions.test.ts`).
  There is no test that checks the capability matrix per action.
- `error.tsx` is five lines and `loading.tsx` one line; verify what a user sees on a failed
  load (and that no internal message leaks). Several actions return raw `error?.message` from
  storage or Postgres to the browser (`document-storage.ts` lines ~104, 172, 232): replace with
  generic text and log the detail server-side.
- `revalidatePath` is called for a subset of the routes a mutation affects (booking route
  aliases, dashboard and finance consumers). The earlier audit asks for this to be checked
  against the installed Next.js docs rather than assumed.

**Fix:** Add a small wrapper, for example `departureAction({ capability, schema, scope }, handler)`,
that performs the common sequence once. Migrate actions to it incrementally while fixing the
findings above, starting with the P0/P1 ones. Do not mass-refactor in one PR.

---

## Why

The module handles money, passport data and seat inventory for multiple agencies, and its
actions are public POST endpoints. The existing code gets the common pattern right, but the
booking-creation path (SEC-01) can bypass the pricing and payment gates the rest of the module
enforces, and several actions (SEC-03, SEC-06, SEC-07) skip the checks that the pages perform.

## Data model changes

- SEC-05: table `departure_group_document_access_log` (agency_id, staff_id, pilgrim_id,
  group_id, document_path, action, created_at) with RLS in the same migration (read: ADMIN,
  CEO; insert: authenticated staff in the same agency). Optional `replaced_at` on documents.
- SEC-09: nullable `import_batch_id` on `departure_group_bookings` and `departure_groups`,
  unique together with the reference/code per agency.
- SEC-12: retention timestamps and an erase function. Needs a policy decision first.
- SEC-04: none (permission rows already exist).
- SEC-10 and DG-23: verify and, if missing, set `security_invoker = true` on the costing view.
  Any change is a migration that includes its RLS or view options, per repo rules.

## Access control changes

- New capability `cancelBookings` (SEC-02) and, optionally, `manageAgentMute` (SEC-06). Add to
  `departure-groups-access.ts` and `module-capability-keys.ts`; defaults: Admin, Operations
  (cancel), Admin, Finance, Operations (mute).
- `departure_groups` capabilities resolved through `loadDynamicCapabilities` (SEC-04).
- Booking creation: Marketing loses the ability to set price, paid amount and `CONFIRMED`
  (SEC-01). This is a behaviour change; tell the sales team before release.
- Guide: group-scope enforcement in actions (SEC-03).

## UI surfaces

- Add Booking sheet and Import Pilgrims dialog (`components/add-booking-sheet.tsx`,
  `[groupId]/components/import-pilgrims-dialog.tsx`): remove or lock price/paid/status fields
  for roles without the matching capability; show server errors on the right field.
- Pilgrims tab booking actions: hide Cancel for roles without `cancelBookings`.
- Documents and Visa tab: show "replaced" state; show access-log link for Admin/CEO.
- Agent tab: mute control respects the new capability and shows validation errors.
- Booking AI Analysis tab: stop sending computed values; call with only the booking id.
- Use shadcn components and the `InputGroup` pattern for any new inputs, per `AGENTS.md`.

## Implementation order

1. **Release blocker:** SEC-01, SEC-07 (smallest changes, highest impact). Tests first.
2. SEC-02, SEC-03, SEC-06 together, with the shared `assertCanActOnGroup` / wrapper.
3. SEC-05 (file binding, upsert, download scoping, access log).
4. SEC-04 (dynamic capabilities) and SEC-08 (validation helpers), applied as the actions are touched.
5. SEC-09, SEC-10, SEC-11. SEC-11 overlaps DG-05; plan with that work rather than twice.
6. SEC-12 after the retention/vendor decisions are made. SEC-13 continuously.

Open one PR per numbered step, per the repo's slice rule.

## Test plan

**Automated (Vitest):**
- Capability matrix: for each role and each action touched, assert allow/deny (table-driven).
- SEC-01: Marketing booking with lowered price, `amountPaid > 0`, and `CONFIRMED` each refused;
  Admin with override allowed; import rows evaluated per row.
- SEC-03: guide not assigned → denied on task create/update; Marketing on a closed group → denied.
- SEC-05: `filePath` with another traveller's prefix rejected; download refuses a path outside the
  agency prefix; replacing a verified document resets its status.
- SEC-06 / SEC-07: invalid `days`, oversized `reason`, oversized `blockers` rejected; unauthenticated
  call to `analyzeBookingAction` refused.
- SEC-09: submitting the same import batch twice creates one set of rows.
- SEC-10: admin-client mutation with a foreign-agency group id fails.
- Run `npm run lint`, `npm run typecheck`, `npm run test` before opening each PR.

**Manual / environment (needs two agencies and one account per role):**
- Run the VERIFY items: guide cross-group write attempt; agency A reading agency B's
  documents, costing view and pricing rows through the Supabase API directly; storage
  policies live; `get_advisors` security output.
- Browser pass per role on list, group detail (all tabs), booking detail, ID card:
  golden path, permission-denied state, error state and empty state.
- Confirm the denied-role and error pages show no internal messages.

## Status

In progress. **SEC-01 fixed (2026-10-06):** `lib/data/departure-groups-booking-terms.ts`
(pure check, 10 Vitest cases) is enforced in `createGroupBookingAction` and per row in
`importGroupPilgrimsAction`; the Add Booking sheet no longer offers Marketing/Operations a
confirmed status or a paid amount. Rules: without `recordPayments` the caller can't send
`amountPaid > 0` or start as `CONFIRMED`/`CANCELLED`; without `overrideCapacityAndPrice` the price
must equal the group's published tier, live early-bird, child or infant rate. Not yet run in a
browser. Other callers of `createGroupBooking` (WhatsApp agent, seat-hold proposals) bypass these
actions and are unchanged. **SEC-02 fixed (2026-10-06):** new capability `cancelBookings` (Admin, Finance, Operations; not
Marketing, CEO, Visa, Guide) in `departure-groups-access.ts` and `module-capability-keys.ts`.
`cancelGroupBookingAction` requires it, and additionally requires `recordPayments` when the stored
`amount_paid` is above zero (`checkBookingCancellationRights`, read from the database, not the client).
Cancel menu items and the dialog in the pilgrims tab and booking detail view now use the new
capability. Not yet run in a browser. Still open under SEC-02: contact edit, payer and relationship
actions still need only `addBookings`, which I judged lower risk. **SEC-03 fixed in code (2026-10-06):** rather than add a check to ~75 actions, the rule is enforced
at the one chokepoint every group write passes through, `mutate()` in `lib/data/departure-groups.ts`
(`refuseUnscopedGroups`, using the new pure `canRoleActOnGroup` in `departure-groups-access.ts`).
For a signed-in person's write (not the agent or cron, which pass their own client/actor): a Guide may
only write to groups they are assigned to, and Marketing only to groups on sale (SELLING, LIMITED_AVAILABILITY,
WAITLIST), matching the pages. RLS stays as the second layer. Tests: `departure-groups-access.test.ts`
(pure rule only; `mutate()` itself is not unit-tested). **Still open under SEC-03:** the live-database
two-account guide check (VERIFY); the agent/cron/proposal-executor paths are not scoped here (their callers
scope them, see SEC-10); read-side group-id endpoints for roles that can open documents/tickets are SEC-05.
**SEC-04 done in code (2026-10-06):** new `getCurrentDepartureCapabilities()` in
`lib/data/departure-groups.ts` merges the saved `role_permissions` row for `departure_groups` over the base
role's set (via `loadDynamicCapabilities`, one lookup per request). All server checks in `actions.ts`,
`document-storage.ts`, `analysis-actions.ts`, the data layer's cost/activity redaction, the list, group,
booking-detail (both routes) and ID-card pages now use it. The UI reads the same value through a new
`DepartureCapabilitiesProvider` / `useDepartureCapabilities(role)` (`departure-groups/capabilities-context.tsx`),
falling back to the base role where no provider wraps the screen (e.g. the Add Booking sheet on `/bookings`).
`visibleTabsFor` takes the resolved set. **Not done:** other modules that call the departure-groups
`capabilitiesFor(role)` directly (campaigns, itinerary-services, flights-tickets, inbox, sidebar, passport
visibility) still use the base role; hard-coded `role === "GUIDE"` / `"MARKETING"` scoping stays role-based by
design. No unit test covers the merge itself (it is the shared, already-used `loadDynamicCapabilities`) and it
has not been tried in a browser with a real custom role. **SEC-05 done in code (2026-10-06), migration not yet applied:**
- Path binding: `submitPilgrimDocumentInStore`, `uploadPilgrimVisaInStore` and `recordTicketUploadInStore`
  refuse a `filePath` that is not directly inside `<agency>/<group>/<pilgrim>/` (`refuseFileOutsidePilgrimFolder`,
  `lib/data/departure-groups-upload-guard.ts`), so every caller (departure groups, documents, pilgrims modules) is covered.
- Real bytes: `submitGroupPilgrimDocument`, `uploadGroupPilgrimVisa` and `uploadGroupPilgrimTicket` first download the
  stored object and check size and magic bytes against the type its key claims (`lib/data/departure-groups-uploads.ts`).
  A rejected file is refused but not deleted from storage.
- No overwrite: upload URLs use `upsert: false` and a unique file name per upload; a re-upload goes through submit,
  which already resets the document to SUBMITTED and clears verification. Old files are left in storage (orphaned).
- Upload URLs now require UUID ids, that the traveller is on the group (RLS-scoped lookup) and the Guide/Marketing group
  scope; raw storage error text is no longer returned to the browser.
- Download: `createDocumentDownloadUrl` accepts only paths of the shapes this module writes, in the caller's own agency,
  applies the group scope, and writes a row to the new `departure_group_document_access_log` before issuing the link
  (if the log write fails, no link is issued). Migration `20270115090000_departure_group_document_access_log.sql`
  (append-only, RLS: insert own rows, ADMIN/CEO read). **Apply it before deploying the code**, or every document open fails.
- Tests: `departure-groups-upload-guard.test.ts` (path rules, sniffing, binding). Not tested: the Server Actions and
  storage calls themselves; nothing run in a browser. No UI yet for reading the access log (Admin/CEO can query the table).
- Behaviour changes to tell staff about: replacing a traveller's file keeps the old file in storage; links to a path
  that does not match `<agency>/<group>/<traveller|_ticket-intake>/<file>` no longer open.
- **Known failing test:** `lib/ops/gate/schema-baseline.test.ts` fails until `supabase/schema-fingerprint.json` is
  regenerated for the new migration (`bash scripts/local/write-schema-fingerprint.sh`, needs a local database built from
  the migrations). Not done; the hashes must not be written by hand.
**SEC-06 done in code (2026-10-06):** `approveAgentProposalSchema`, `rejectAgentProposalSchema` and
`muteAgentOnGroupSchema` (in `lib/validations/departure-groups.ts`, 5 tests) now validate all three agent actions:
uuid ids, `days` an integer 1-90 or null (the `NaN`/huge-value `RangeError` is gone), reason max 300, decision note
max 500, edited payload max 20,000 characters serialised. `setGroupAgentSuppressionAction` now requires
`manageReadiness` (Admin, Finance, Operations, Visa; not Guide/Marketing/CEO), confirms the group exists in the caller's
agency before writing, applies the Guide/Marketing group scope, and returns a generic error instead of the raw database
message. The Mute control is hidden for roles without `manageReadiness`. Reviewed `approveProposal` in
`lib/agent/kernel/proposals/service.ts`: it already loads the proposal by agency, checks the per-kind capability and
high-risk approver roles, re-validates an edited payload against the executor's own schema, forbids editing HIGH-risk
proposals and re-checks a dependency hash, so no change was needed there. Not run in a browser; the actions themselves
have no unit test.
**SEC-07 done in code (2026-10-06):** `analyzeBookingAction` now calls `requireUser()`, validates its input with Zod
and accepts only `{ bookingId }` (uuid). Blockers, traveller count and booking total are recomputed on the server from
the stored booking (`getDepartureGroupDetail` + `identifyBookingBlockers`), so nothing the browser sends reaches the model
prompt. The caller must have `viewModule` and pass `canRoleOpenGroup` for the booking's group. Before the model is called
(and only when there is something to explain) the call is counted with the existing Inbox limiter under a new action
`ANALYSE_BOOKING` (20 per person per hour, 300 per agency per day, refuses if the counter cannot be read); the agency's
monthly AI budget is checked inside the model call as before. `lib/inbox/rate-limit/policy.ts` gained the action (no
migration: the counter table's `action` column is free text); platform overrides work for it like any other action.
The tab no longer sends `travellerCount`, `totalBookingValue` or the blockers. Not run in a browser; the action has no
unit test (its input schema lives in a `"use server"` file and cannot be exported for one).
**SEC-08 done in code, with exceptions (2026-10-06):** `lib/validations/departure-groups.ts` gained shared helpers
`entityId()` (trimmed GUID), `optionalEntityId` (empty string = none), `phoneNumberSchema` and `passportNumberSchema`.
127 id fields (`departureGroupId`, `bookingId`, `groupPilgrimId`, `flightId`, `chargeId`, etc.) and the optional
`supplierId` / `leadId` / `linkedReadinessItemId` now require a GUID instead of any non-empty string. `groupBookingSchema`
caps booking reference (40), names (120), money (1,000,000,000) and travellers (50), validates phone and passport format;
`editBookingSchema`, `bookingReminderSchema` and `createGroupTaskSchema.ownerName` have length caps. 10 tests in
`departure-groups-input-hardening.test.ts`. **Correction to the finding:** the traveller list was already required to equal
`travellerCount`; that part needed no change. `sendBookingReminderInStore` now takes the recipient from the stored booking
instead of trusting the browser's name and number (the UI already sent the booking's own contact).
**Not done:** `templateTransportRequirementId` and `visaId` (a visa number, not a row id) are left as free strings; reminder
text is still composed in the browser and stored as sent (a server-built or re-redacted message for roles without
`viewFinance` is not done); task owner is still resolved by display name rather than `ownerId`; other schemas' free-text
fields (flight, hotel, transport, deviation notes) were not audited for length caps. Behaviour change: a phone number with
letters (e.g. "N/A") or a non-uuid id from an old bookmark/import now fails validation.
**SEC-09 done in code, with a correction (2026-10-06):** **the finding overstated the duplicate risk.** Group codes are unique per
agency (`departure_groups_code_agency_unique`), booking references are unique per agency (`unique (agency_id, booking_reference)`),
and `createGroupBooking` / `isGroupCodeTaken` refuse a taken one before writing, so re-submitting a file produces "already in
use" failures, not duplicates; the "renumber" path only works inside one loaded store and cannot take a reference that exists.
What was real: one request doing up to 200 sequential record creations, no per-user limit, and no progress. Fixed: the import
dialogs now send rows in batches of 25 through `importInChunks` (`lib/import/chunked-import.ts`, 5 tests), show "Importing x of y",
and stop cleanly at a refused batch with earlier rows reported; the server caps one call at 50 rows (was 200) and counts each
call against the limiter under new actions `IMPORT_DEPARTURE_GROUPS` (40/user/hour, 200/agency/day) and `IMPORT_GROUP_BOOKINGS`
(40/user/hour, 400/agency/day), refusing if the counter cannot be read. The import buttons were already disabled while running.
**Not done:** no batch id / migration (not needed given the unique constraints); a run that dies mid-batch is not resumable
automatically, the user re-imports the file and the created rows show as "already in use"; the preview in each dialog is not
capped, so a very large file still parses fully in the browser. Not run in a browser.
**SEC-10 done in code, partly (2026-10-06):** `loadStore` already accepted an `agencyId`; `mutate()` now always passes the
actor's agency (`actor.agencyId`), so a group id that belongs to another agency never loads for a session user, the agent,
a proposal executor or a WhatsApp tool, and the mutator reports it as "no longer exists". When the caller names groups, the
ownership check is an id-only query (`select id ... where id in (...) and agency_id = ...`), not a read of every group the
agency owns. `buildOpsSnapshot` (agent, service-role client) now passes its `agencyId` too (it accepted one and ignored it).
5 tests in `departure-groups-repository.agency-scope.test.ts` (fake service-role client: a foreign id loads nothing,
mixed ids load only the caller's). **Not done:** the seat-hold cron sweeper still runs with no agency (it selects its own
group ids; adding per-agency batching is a separate change); read pages (`getDepartureGroupDetail`, list) still rely on RLS
alone for session users; `departure_group_cost_estimates`, `departure_group_pricing` and the costing view still need the
two-tenant live check (VERIFY, DG-23); `get_advisors` security output has not been run or attached.
**SEC-11 built but switched OFF, and not verified against a database (2026-10-06).** I could not run Postgres here (Docker was not
running), so nothing below has executed SQL. What exists:
- `buildAtomicDiff()` in `departure-groups-repository.ts` (extracted from `persistStoreAtomic`, 6 tests in
  `departure-groups-repository.atomic-diff.test.ts`): the diff sent to the database, now also carrying `expectedVersions`
  (the `row_version` loaded for every updated booking).
- Migration `20270116090000_departure_store_atomic_rpc_v2.sql`: new function `apply_departure_store_changes_atomic_v2` (a NEW name;
  the live `apply_departure_store_changes_atomic` used by booking creation is untouched). Same one-transaction, tenant-checked,
  parent-before-child apply, plus (1) the booking row-version guard (raises 40001, nothing written, which `mutate()` already
  turns into "updated elsewhere, refresh") and (2) column lists taken from the keys actually in each payload, so a missing
  `row_version` is no longer inserted as an explicit NULL.
- `mutate()`: with env `DEPARTURE_ATOMIC_PERSIST=all`, every mutation with a resolved agency goes through v2 (explicit
  `atomic: true` callers also use v2); a caller with no agency (seat-hold sweeper) keeps the row-by-row path. **Unset = no change
  in behaviour**, apart from the migration file existing.
- Why this does not close SEC-11 yet: it only does once the function is applied and checked. Checks to run on a local database
  (`bash scripts/local/rebuild-from-migrations.sh` with the local Supabase stack up), then on staging with the flag on:
  1. the migration applies cleanly and `\df+ apply_departure_store_changes_atomic_v2` shows security invoker, no PUBLIC execute;
  2. create a booking, record a payment, cancel it, move it, edit a flight, assign a room: each succeeds and the rows match what
     the row-by-row path writes (compare a before/after row dump of one group);
  3. force a failure mid-mutation (e.g. a check-violating value in the last collection written) and confirm NOTHING from that
     mutation persisted, which is the point of the change;
  4. two payments on one booking started from the same loaded version: exactly one succeeds, the other gets the
     "updated elsewhere" message;
  5. a call with another agency's row or `p_agency_id` is refused (SQLSTATE 42501).
  Only then set `DEPARTURE_ATOMIC_PERSIST=all`, watch for `DeparturePartialWriteError` (should stop appearing) and unexpected 40001s,
  and finally delete `persistStore` and the flag.
- The schema fingerprint test still fails (now 2 new migrations); regenerate with `scripts/local/write-schema-fingerprint.sh`.
**SEC-12 partly done (2026-10-06); the rest is blocked on decisions that are not mine to make.**
Done: the parts of SEC-12 that need no policy.
- Access audit for traveller files: delivered under SEC-05 (`departure_group_document_access_log`).
- Phone numbers no longer written in full into the permanent activity trail: `maskPhoneNumber()` (`lib/data/departure-groups-privacy.ts`,
  4 tests) is applied to the reminder entry and to the booking-contact-update entry (message and before/after values, keeping the last
  three digits). The booking row still holds the real number. Existing trail rows keep the numbers already written to them.
- The AI vendor setting already exists: `OPENROUTER_DATA_POLICY=deny|zdr` (`lib/ai/openrouter-privacy.ts`), unset by default.
  **Ops item:** confirm it is set in production and that ticket/visa review still answers with it on.
Not done, and why: building a deletion job or an erase button without a policy would either delete records the agency must keep
(booking and payment history, invoices) or give a false sense of compliance. These need an owner's decision first:
1. **Retention period** for passport numbers, passport/visa/ticket files and traveller phone numbers after the return date
   (proposal to react to: files and passport numbers erased 24 months after return; booking, payment and invoice records kept for
   the accounting period your tax advisor sets). Legal/accounting must confirm; I have not.
2. **What "erase a traveller" means**: proposal is to erase passport number, passport expiry, phone, emergency contact, uploaded
   files and the file-path columns, keep the traveller's name on booking and invoice records, and write one audit row; it needs a
   rule for a traveller who still has an open booking or refund.
3. **Whether passport numbers must be encrypted at rest** (they are plain columns today) - a column-encryption change touching search,
   the visa module and imports.
4. **AI review basis**: ticket and visa review sends the traveller's name, passport number and the document image/PDF to the model
   provider. Confirm the provider agreement and consent wording covers that; I have not seen either.
5. **Retention for `departure_group_document_access_log`** (proposal: keep 24 months).
Once 1 and 2 are answered the build is: an agency setting (off by default), a nightly job modelled on the existing
`inbox-retention` sweep with a dry-run mode, and an Admin-only per-traveller erase action - all needing the same
database verification as SEC-11.
SEC-13 is not started.
Items marked VERIFY need a live-database check before they are classed as confirmed defects
or closed. Update this section as each SEC item ships, and fold final decisions into
[`docs/security/access-control.md`](../security/access-control.md) if the new
`assertCanActOnGroup` / action-wrapper pattern becomes standard.
