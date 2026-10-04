# Tenant-isolation audit of staging, 2026-10-02

TASK-029 P2.4, first pass. Read-only: catalogue queries and one rolled-back behavioural test against the staging Supabase project. No data
was written and no customer content is recorded here. The repeatable script is
[`scripts/sql/verify-tenant-isolation.sql`](../../scripts/sql/verify-tenant-isolation.sql).

Why this matters: the product is multi-tenant with one shared set of environment variables, so row-level security (RLS) and the code are
the only things separating agencies. Staging holds 3 agencies, but only one has members and documents, so a cross-agency leak is not yet
visible in day-to-day use. That is exactly why it has to be tested deliberately.

## Result

| # | Check | Result |
|---|---|---|
| 1 | RLS on every table | **Pass.** All 227 public tables have RLS on, 210 of them tenant tables (with `agency_id`). Twelve tenant tables have RLS on and no policy, which makes them reachable only with the server key: `agency_smtp_settings`, `ai_conversation_meter_events`, `conversation_message_counters`, `conversation_queue_counts`, `inbox_intake_states`, `inbox_reply_queue_agencies`, `knowledge_chunks`, `message_delivery_status_buffer`, `onboarding_events`, `outbox_messages`, `pending_agency_signups`, `reply_intents`. Expected to be server-only; confirm each. |
| 2 | No unconditional policies | **Fail.** Eight tables have `true` policies for any signed-in user and no `agency_id` (see F2). Two more (`ai_model_rates`, `country_locale_defaults`) are global reference data and are fine. |
| 3 | Storage buckets private and agency-scoped | **Fail.** All 8 buckets are private. But `pilgrim-documents` and `whatsapp-media` have policies with no agency check (see F1). |
| 4 | Privileged functions | **Pass on the checked points.** 28 security-definer functions are callable by signed-in users and none by `anon`; every one fixes its `search_path`. Whether each checks the caller's agency inside is not yet reviewed. |
| 5 | Behavioural test | **Fail, confirming F1.** A signed-in user belonging to no agency sees 23 of 23 pilgrim documents and 0 of everything else tested (conversations, messages, agencies, inbox attachments, payment proofs, content vault). |
| 6 | Realtime | **Not yet tested.** Two policies exist (`inbox_realtime_receive`, `inbox_realtime_presence_write`), both restricted to `inbox:` topics; the agency segment check was not read in full. |

## Findings

### F1 (critical, FIXED on staging 2026-10-02): any signed-in user can read, overwrite and delete every agency's pilgrim documents

**Fixed.** Migration `20261230090000_fix_pilgrim_documents_storage_isolation.sql` (PR #202) was applied to staging on 2026-10-02 with the
owner's go-ahead and is recorded in the migration history as `fix_pilgrim_documents_storage_isolation`. Verified afterwards, read-only:
no storage policy in any of the eight buckets lacks an agency check; all 23 pilgrim documents are intact; the staging ADMIN, CEO and
OPERATIONS users still see all 23 (and the inbox attachments and payment proofs their roles allow), and a signed-in user with no agency
now sees 0 of everything. Before the fix, a new pgTAP test failed 15 of 17 assertions; with it, all 17 pass. Not yet checked: a real
staff session uploading and signing a pilgrim document in the browser (TASK-030 will cover it). The original finding follows.

- **What:** the four storage policies on `pilgrim-documents` check only the bucket name. They apply to every `authenticated` user, which
  includes pilgrim and agent portal logins and any account created by sign-up. Confirmed by the behavioural test: a user with no agency
  lists all 23 objects. Insert, update and delete are open in the same way, so a signed-in user could also replace or remove a passport scan.
  `whatsapp-media` has a role check (`staff_role_in`) but no agency check, so staff of one agency could read another's media; the
  bucket is empty today.
- **Why it is drift, not a missing migration:** the repository's `20260827090000_tenant_storage_isolation.sql` already defines the
  correctly scoped policies (agency folder plus role), and that migration is recorded as applied. The live policies are the original
  unscoped ones from `20260811090000_departure_groups_documents_lifecycle.sql`. Something re-created the old policies after the
  scoping migration. A fresh build from the repository would produce the secure version, so production built from the repo would not
  have this specific problem. This is the kind of drift the clean-rebuild proof (P2.2) is meant to find.
- **All 23 objects are already stored under an agency-id folder**, so scoping the policies by folder will not orphan any existing file.
- **Fix:** a corrective migration that re-asserts the scoped policies from `20260827090000` for `pilgrim-documents` (agency folder plus
  the role lists in that file), and adds the same agency-folder check to `whatsapp-media`. First confirm how the app writes
  `whatsapp-media` paths so the check matches. The server-side code writes with the service key and is unaffected; browser uploads use
  signed URLs, which are checked separately.

### F2 (high, latent, FIXED on staging 2026-10-02): eight child tables are open to every signed-in user

**Fixed.** Migration `20261231090000_fix_child_table_tenant_isolation.sql` (PR #204) was applied to staging on 2026-10-02 with the
owner's go-ahead and is recorded as `fix_child_table_tenant_isolation`. Verified afterwards: the only unconditional policies left in the
public schema are the two global reference tables (`ai_model_rates`, `country_locale_defaults`); the four package tables have no policy
and still have row-level security on; the four repository tables have their 8 policies. A new pgTAP test failed 22 of 27 assertions
before the fix and **passed all 27 against the live applied state** (run in a rolled-back transaction; no test data remains). It also
shows that a guide who can see a departure group still cannot read its reminders, collection risk or quote lines. The four tables were
empty throughout, so nothing leaked. Not yet checked: a real finance session in the browser creating a reminder and rescheduling a
milestone (TASK-030 covers it). **Decision left to the owner:** `package_content`, `package_faqs`, `package_media` and
`package_seo_analyses` exist on staging only (no migration defines them and no code uses them); they were locked down, not dropped.
The original finding follows.

- **What:** `payment_reminders`, `booking_collection_risk`, `milestone_change_events` and `quote_line_items` (created in the repository by
  `20261109090000_p1_2_payment_plans_risk.sql` and `20261111090000_p1_4_quotes_lifecycle.sql` with `using (true)` policies), and
  `package_content`, `package_faqs`, `package_media` and `package_seo_analyses` (policies not found in the migrations by name). None has
  an `agency_id`; each belongs to a tenant only through a parent row (booking, departure group, quote, package). All eight are empty
  today, so nothing has leaked, but the first quote line or payment reminder created would be visible to, and editable by, every
  agency and every portal login.
- **This one is in the repository itself**, so a fresh production build would inherit it.
- **Fix:** a migration that replaces each `true` policy with one that checks the parent's `agency_id` through the existing helper
  (`current_agency_id()`), plus a two-agency test per table in the same PR, per the repository rules. Needs the parent mapping read
  for each table first.

### F3 (serious, FIXED on staging 2026-10-02): authorisation gaps in privileged functions

**Fixed.** Migration `20270101090000_fix_function_authorization_gaps.sql` (PR #205) was applied to staging on 2026-10-02 with the owner's
go-ahead and is recorded as `fix_function_authorization_gaps`. Found by reading the bodies of the 28 security-definer functions that
signed-in users can call, then proving each suspect in a rolled-back transaction.

**Common cause.** A comparison with NULL is never true, and `if NULL then` does not raise. Guards written as
`if <agency differs> or <role not allowed> then raise` let a caller through when one side was NULL. `current_agency_id()` is NULL for a user
with no staff profile and for staff of a **suspended** agency; `staff_role_in()` was NULL (not false) for a user with no profile.

| Function | What was possible (proved, rolled back) | Fix |
|---|---|---|
| `set_inbox_autonomy_level` | The ADMIN of a **suspended agency** switched **another agency's Inbox to autonomous replies** (L3, ACTIVE). A user with no profile was stopped only by a foreign-key error in the audit insert | Guard fails closed: caller needs an agency, it must be the one changed, and an ADMIN or CEO role there |
| `record_conversation_answer_candidate` | A user with no agency, or the admin of a suspended agency, wrote and overwrote any agency's answer-cache rows, including an approved answer's text | Same fail-closed guard |
| `packages_apply_status_transition` | The step behind the package wrappers had no role check and was executable by signed-in users: a CEO refused by `archive_package` archived a package by calling it directly | Execute revoked from `authenticated`; the five wrappers keep working |
| `staff_role_in` (root cause) | Returned NULL for a user with no profile, so `not staff_role_in(...)` was NULL in four functions | Now returns false, never NULL. Four policies negate it but each also requires `agency_id = current_agency_id()` first, so nothing changes for them |

Verified on the live applied state: the suspended-agency exploit is refused and writes nothing; the real staging ADMIN can still change
agency 1's own autonomy and archive a package through the wrapper; the real CEO is refused by the wrapper and by the direct call; a user
with no agency is refused on both functions; the catalogue shows the fixed guards, `authenticated` no longer able to run the package step
and `anon` still unable to call the autonomy function. A new pgTAP test failed 9 of 23 assertions before the fix and passed all 23 with it.
No real data changed.

**Inbox Realtime policies: sound, no change.** Both policies (`inbox_realtime_receive`, `inbox_realtime_presence_write`) require the
topic's agency to equal `current_agency_id()` and a staff role. Eight assertions pass before and after: an agency can broadcast on and
receive only its own `inbox:<agency>` topic, an agency B admin, a user with no agency and a guide in the wrong role cannot.

**Checked and left unchanged.** The other callable functions (their checks hold); `reject_conversation_answer_cache_hit` has the same
`<>` pattern but is not callable by signed-in users; the package wrappers using `current_staff_role() not in (...)` pass a NULL role but
are stopped by a second check that needs the agency (worth hardening later).

**Follow-ups D1 and D3 (TASK-032 S4): fixed, merged (PR #214) and APPLIED to staging on 2026-10-02** (recorded as `revoke_server_only_table_privileges` and
`harden_package_wrapper_guards`), after being proven in rolled-back transactions.

- **D1, server-only tables.** Twenty public tables have row-level security and no policy. Twelve also had no client privileges; the other
  eight (`knowledge_chunks`, `pending_agency_signups`, `platform_admins`, `whatsapp_webhook_hits` and the four staging-only `package_*`
  tables) still carried Supabase's default grants to `anon` and `authenticated`, so only the missing policy protected them. Every code
  path that touches any of the twenty uses the service role or a worker with the admin client, every function that touches them is security
  definer or service-role-only, and no policy, view or invoker function a client can run references them, so nothing the application does
  depends on those grants. Migration `20270103090000_revoke_server_only_table_privileges.sql` revokes them; a database test failed 6 of 10
  assertions before it (naming exactly the eight) and passed 10 of 10 with it; the audit script has a new check (1b) for the same rule.
- **D3, package wrapper guards.** `archive_package`, `close_package_sales`, `publish_package`, `reopen_package`, `restore_package` and
  `package_versions_create` compared the role with `not in (...)`, which is NULL for a caller with no profile, so the guard let that caller
  through to the internal step. Not exploitable (the step fails closed) but a latent hazard. Migration
  `20270104090000_harden_package_wrapper_guards.sql` makes each refuse on its own (role, then agency; `archive_package` also checks the
  package belongs to the caller's agency before reading about it). A database test failed 6 of 20 before and passed 20 of 20 with it. Allowed
  roles, messages and results for a legitimate caller are unchanged; a user with no profile is now refused with the role message (42501)
  instead of "no active agency" (28000).

**Still to do under F3.** A real agency-A-versus-B test of conversations and messages in the browser once the test agencies and their
logins exist (TASK-029 P2.3, TASK-032 S6).

## Recommended order (steps 1 and 2 are done on staging; F3 is done too)

1. Fix F1 on staging first (it exposes existing data), then add it to the repository as an idempotent migration with a test that no
   tenant-bucket storage policy lacks an agency check.
2. Fix F2 in the repository and apply to staging before any quote, reminder or package content is created.
3. Seed the `E2E-` agencies, then complete F3 with real two-agency tests (pgTAP) and the browser isolation tests (TASK-030).
4. Re-run the script after every migration batch, and before production go-live.

## Status

Audit complete for the catalogue checks, the function review, the Realtime policies and the behavioural tests. **F1, F2 and F3, and the
follow-ups D1 and D3, are all fixed and applied on staging** (migrations `fix_pilgrim_documents_storage_isolation`,
`fix_child_table_tenant_isolation`, `fix_function_authorization_gaps`, `revoke_server_only_table_privileges` and
`harden_package_wrapper_guards`; PRs #202, #204, #205 and #214 are merged). The twenty server-only tables (the twelve first found plus eight that
still carried default grants) now have no client privilege, and the audit script checks it (1b). Still to do: the real two-agency browser
test once the test agencies and their logins exist (TASK-032 S6), and the owner's decision on dropping the four staging-only `package_*`
tables (they now have neither a policy nor a client privilege). Re-run [`scripts/sql/verify-tenant-isolation.sql`](../../scripts/sql/verify-tenant-isolation.sql) after every migration batch and
before production go-live.
