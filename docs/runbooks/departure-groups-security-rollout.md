# Departure Groups security remediation: rollout and verification

The order to ship, switch on and check the work in
[`TASK-037`](../tasks/TASK-037-departure-groups-security-and-flaw-remediation.md) (SEC-01 to SEC-13).
Follow it top to bottom. Each step says what to run, what you should see, and how to undo it.

**State when this was written (2026-10-06):** the code is written and unit-tested (`lib/` and `app/` tests pass except the schema
fingerprint test). **No migration has been applied to any database, nothing was run in a browser, and nothing was checked against a
real tenant.** Everything below that says "check" is a check nobody has done yet.

## 0. Before anything

- [ ] Take a database backup and a storage backup (the `pilgrim-documents` bucket). SEC-12 erasure is permanent.
- [ ] Do the first pass on a **local** database or **staging**, never production first.
- [ ] Confirm you are on the branch that contains the work: `git log --oneline` shows the SEC-12 commit
      ("add automated traveller data retention and sensitive data erasure") and later.

## 1. Build the migrations on a local database

The three new migrations (all after `20270114090000_inbox_rate_limits`):

| File | What it does | Needed for |
|---|---|---|
| `20270115090000_departure_group_document_access_log.sql` | Table that records who opened a traveller file | SEC-05 (**required**, or opening documents fails) |
| `20270116090000_departure_store_atomic_rpc_v2.sql` | New function `apply_departure_store_changes_atomic_v2` (booking row-version guard) | SEC-11 (only used when the flag in step 5 is on) |
| `20270117090000_traveller_sensitive_data_erasure.sql` | Column `sensitive_data_erased_at` + index | SEC-12 (**required** for the erase action and the sweep) |

1. Start the local Supabase stack (Docker must be running; it was not when this work was written).
2. `bash scripts/local/rebuild-from-migrations.sh` (builds an empty database from every migration).
   - **Expect:** `ALL APPLIED: <n> migrations`. A `FAIL <file>` line names the migration and error.
   - The v2 function SQL was **never executed** when written. If it fails here, fix it before going further.
3. `bash scripts/local/write-schema-fingerprint.sh`, then commit `supabase/schema-fingerprint.json`.
   - **Expect:** `npx vitest run lib/ops/gate/schema-baseline.test.ts` passes (it fails today because the file is stale).

**Undo:** the local database is disposable; reset it.

## 2. Database checks (local, then staging)

Run as SQL against the built database.

```sql
-- v2 function exists, is security invoker, and public cannot execute it
select p.proname, p.prosecdef as security_definer,
       has_function_privilege('public', p.oid, 'execute') as public_can_execute
from pg_proc p where p.proname = 'apply_departure_store_changes_atomic_v2';
-- expect: security_definer = false, public_can_execute = false

-- access log is append-only for staff: RLS on, no update/delete policy
select polname, polcmd from pg_policy where polrelid = 'public.departure_group_document_access_log'::regclass;
-- expect: an insert policy and a select policy only

-- erasure marker + index
select column_name from information_schema.columns
 where table_name = 'departure_group_pilgrims' and column_name = 'sensitive_data_erased_at';
```

## 3. Two-tenant and two-account checks (staging)

Create two agencies (A, B) with a group each, and for agency A a Guide assigned to group 1 but not group 2, plus one user per role you care about.

| Check | How | Expect |
|---|---|---|
| Tenant isolation, direct API | As an agency-A user, query the Supabase REST API for B's `departure_groups`, `departure_group_pricing`, `departure_group_cost_estimates` and the `departure_group_costing` view | zero rows, or a permission error. **A row from B is a release blocker** (the costing view was flagged in DG-23) |
| Guide scope | As the Guide, call the create-task action for group 2 (a hand-made request) | refused ("You do not have access to that departure group.") |
| Document download | As agency A, request a signed link for a path starting with B's agency id | refused ("That document reference is invalid.") |
| Access log | Open one traveller file | one new row in `departure_group_document_access_log` for that user |
| Advisors | Supabase security advisor (`get_advisors`) | attach the output to the pull request; no new high findings on the new table or function |

## 4. Deploy the code

- [ ] Migrations 1 and 3 from the table in step 1 are applied to the target database **first**.
- [ ] Deploy.
- [ ] Nothing else changes yet: the v2 function is unused and the retention sweep only reports.

**Undo:** redeploy the previous build. The new table, column and function are harmless to older code.

## 5. Browser pass (staging), one account per role

For each of ADMIN, OPERATIONS, FINANCE, MARKETING, VISA, GUIDE: open the list, a group (every tab the role can see), a booking, and an ID card.
Check the golden path, the permission-denied state and an error state. The changes a person will notice:

- [ ] **Marketing / Operations, Add Booking:** no "Confirmed" status and the paid amount is locked; the price is the group's published rate and cannot be edited. Submitting a hand-made lower price is refused (SEC-01).
- [ ] **Marketing:** no "Cancel Booking" anywhere (SEC-02). **Operations:** can cancel an unpaid booking, but a paid one says to ask finance.
- [ ] **A custom role** with `recordPayments` removed no longer shows Record Payment, and the server refuses a direct call (SEC-04).
- [ ] **Documents:** upload a passport scan, replace it (the old file stays in storage; the document goes back to "submitted"), open it (SEC-05). Upload a renamed `.exe` as `.pdf`: refused.
- [ ] **Agent tab:** Mute is hidden for Guide/Marketing/CEO; for Operations, muting for 7 days works (SEC-06).
- [ ] **Booking > AI Analysis:** works, and a second analysis counts against the limit (20 per person per hour) (SEC-07).
- [ ] **Imports:** import 60 rows into a test group; the button shows "Importing 25 of 60", and re-importing the same file gives "already in use" rows, not duplicates (SEC-09).
- [ ] **Booking contact edit / reminder:** the activity trail shows `••••567`, not the full number (SEC-12).
- [ ] **Admin, Pilgrims tab > a traveller of a *finished* group > Erase Sensitive Details** (see step 7 for what to check afterwards). On a traveller whose trip has not finished it must refuse.
- [ ] **Error pages:** force an error (stop the database or throw in a test route) and confirm the page does not show internal text. Do this against a **production build** (`npm run build && npm run start`), not `npm run dev`.

## 6. Atomic persistence (SEC-11), optional and separate

Do this only after steps 1 to 5 are clean. It changes how **every** departure mutation is written.

1. On staging set `DEPARTURE_ATOMIC_PERSIST=all` and restart.
2. Create a booking, record a payment, cancel it, move it, edit a flight, assign a room. Each should succeed.
3. Compare one group's rows before and after against the same actions on a copy without the flag. They should match.
4. **Force a failure** part-way (for example a database check constraint on the last table written) and confirm **nothing** from that mutation persisted.
5. Start two payments on one booking from the same loaded screen: exactly one succeeds, the other says "This booking was just updated elsewhere. Refresh and try again."
6. Watch the logs for a day. `DeparturePartialWriteError` should stop appearing; unexpected `40001` conflicts need a look.

**Undo:** unset `DEPARTURE_ATOMIC_PERSIST` and restart. Nothing in the database needs reverting.
When it has run clean for a while, the row-by-row writer (`persistStore`) and the flag can be deleted (separate change).

## 7. Retention and erasure (SEC-12)

Policy: sensitive details are erased **24 months after the group's return date**, and earlier at a person's request once the trip is over.
Erased: phone, passport number/expiry/country, date of birth, visa number and note, emergency contact, every uploaded file and the AI-read text.
Kept: the traveller's name, bookings, payments, invoices, an audit entry. Not erased: the person's WhatsApp number and email, medical notes, support-case attachments.

1. **Manual erase on staging.** Erase one test traveller of a finished group. Check:
   - the passport, visa and ticket files are gone from the `pilgrim-documents` bucket;
   - the traveller's row has the fields cleared and `sensitive_data_erased_at` set; the name is intact;
   - the shared person record (`pilgrims`) has its passport/ID cleared **only if** that person has no other un-erased trip;
   - the activity trail has a `TRAVELLER_DATA_ERASED` entry containing no personal detail;
   - erasing the same traveller again is refused.
2. **Dry run of the sweep.** `GET /api/cron/traveller-data-retention` with header `Authorization: Bearer $CRON_SECRET`.
   - **Expect:** JSON with `"dryRun": true`. `travellersErased` is the number it **would** erase this run (capped at 50 per agency), `travellersSkipped` are
     travellers still owing money or a refund, `accessLogRowsRemoved` is the number of log rows it would trim.
   - Spot-check three of the travellers it would erase: return date really more than 24 months ago, no balance owed.
3. **Go live.** Only after a person has read the dry-run numbers: set `TRAVELLER_RETENTION_LIVE=true`. The same call now erases. A large backlog clears over several nights (50 per agency per run).
4. **Schedule it.** The route is deliberately **not** scheduled. Add a `pg_cron` job in a new migration (and add the path to the `invoke_cron_route` allow-list, then update
   `lib/inbox/invoke-cron-route-allow-list.test.ts`, which currently lists it as unscheduled). Pattern: see [`supabase-scheduling.md`](supabase-scheduling.md). Suggested: once a day, off-peak.

**Undo:** unset `TRAVELLER_RETENTION_LIVE` to go back to dry-run. **Erased data cannot be restored** except from the step-0 backups.

## 8. Settings to confirm in production

- [ ] `OPENROUTER_DATA_POLICY=deny` (or `zdr`) is set, and ticket/visa review still answers with it on (see `lib/ai/openrouter-privacy.ts`).
- [ ] `CRON_SECRET` is set (the retention route returns 500 without it).

## 9. Decisions still open (not built)

Record the answer in the task document when each is made.

1. Encrypt passport numbers at rest? (They are plain columns; encryption touches search, the visa module and imports.)
2. Does your AI provider agreement and consent wording cover sending a traveller's name, passport number and document to the model for ticket and visa review?
3. Should erasure also clear the person's WhatsApp number and email, medical notes and support-case attachments?
4. Should travellers whose erasure was already requested under another rule (e.g. a customer asking by email) be tracked? Today an Admin does it by hand per traveller.

## Done when

- [ ] Steps 1 to 5 pass on staging and the pull request carries the advisor output.
- [ ] Step 6 either passed or was consciously deferred (write which).
- [ ] Step 7 items 1 and 2 done; item 3 and 4 done only when the owner agreed.
- [ ] `TASK-037`'s Status section is updated with what was verified and when, and any VERIFY item that failed is fixed or has its own task.
