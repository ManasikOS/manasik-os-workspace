# Security audit: functions and views reachable without signing in (2026-09-18)

Scope: the 26 `SECURITY DEFINER` functions that the advisor reported as callable by the signed-out `anon`
role, and, because it has the same root cause, the views in `public`. Read-only queries against production,
plus every fix tested inside a transaction that was rolled back. **Applied to production on 2026-09-18** as
`20261126090000_lock_down_definer_functions.sql` and `20261126090001_reset_agency_data_service_role_only.sql`
(see "After applying" at the end).

## Root cause
Supabase's default privileges grant `EXECUTE` on every function the `postgres` role creates in `public`
directly to `anon`, `authenticated` and `service_role`. Earlier migrations ran `revoke ... from public`,
which removes only the built-in PUBLIC role and leaves those grants. The `reset_agency_business_data`
migration even states it grants only to `authenticated`; the live database shows `anon` as well.

## Findings

| # | Severity | What | Who could do it |
|---|---|---|---|
| 1 | **High** | View `departure_group_payment_summaries` ran with its owner's rights (no `security_invoker`) and `anon` had `SELECT`. It returned its row to an unauthenticated caller: expected revenue, collected, outstanding, overdue, refund-pending and supplier payables per departure group, for **every** agency | Anyone holding the public browser key |
| 2 | **High** | Same for view `supplier_directory_rows` (supplier contacts, payment terms, internal notes, outstanding amounts). Empty today, so nothing has leaked yet, but it would from the first supplier saved | Anyone holding the public browser key |
| 3 | **High** | `reset_agency_business_data()` (54 `DELETE` statements) checked only that the caller belongs to an agency, not that they are an ADMIN. The Server Action's checks (ADMIN, not production, typed phrase) are bypassed by calling the function directly | Any signed-in staff member, of any role, on their own agency's data. Not `anon`: it fails the agency check |
| 4 | Low | `increment_conversation_unread(uuid)` has no caller check and updates any conversation by id. Nothing in the app or database calls it | Anyone who knows a conversation id (a random UUID) |
| 5 | Info | The other 22 definer functions all check `auth.uid()` or the caller's role and agency, so they did nothing for an anonymous caller, but `anon` still held the right to call them | n/a |

Checked and fine: every `SECURITY DEFINER` function in `public` pins its `search_path`; every table has row
security enabled; `suspend_agency` is gated by `is_platform_admin()` and is **not** callable by `anon` (an
earlier note of mine said it was; that was wrong); no policy that applies to `anon` calls any of these
functions, so revoking breaks nothing.

## The fix (one migration)
- `reset_agency_business_data()`: adds an ADMIN check inside the function. The rest of the function text was
  verified byte-identical (same hash) to the live definition.
- Both views: `security_invoker = true`, `SELECT` revoked from `anon`.
- `EXECUTE` revoked from `public` and `anon` on all 26 functions; trigger functions and
  `increment_conversation_unread` also revoked from `authenticated` (service role keeps it).
- Default privileges changed so future functions no longer grant `anon` or PUBLIC.

## Test results (rolled-back transaction, production data)
- Privilege matrix over all 26 functions: `anon` denied on all, `service_role` kept on all, `authenticated`
  kept on the 19 it needs and removed from the 7 it does not.
- A signed-in user who is not an admin calling the reset function: permission error (`42501`). The real admin
  still resolves as `ADMIN`. `anon` calling the reset function or a row-security helper: `42501`.
- Row-security helpers still work for a signed-in user, and a write that fires triggers still works with the
  trigger functions revoked. Lead counts were unchanged throughout.
- Views: as owner 1 and 0 rows; as the admin, still 1 and 0; as a different signed-in user, 0 and 0; as `anon`,
  permission denied.
- Default privileges: a function created after the change has `anon = false`, `authenticated` and
  `service_role` true.

## Not changed, worth knowing
- 21 non-definer functions in `public` are still executable by `anon` (triggers, finance helpers and RLS
  predicates such as `staff_role_in`). They run with the caller's rights, so row security still blocks an
  anonymous caller. Left alone because some are used inside policies; revoke them one by one if desired.
- Tables still grant full privileges to `anon` by Supabase default; row security is the barrier, and every
  table has it on.
- Views `supplier_directory_rows` and the payment summaries: if either was ever queried by someone who should not
  have seen it, that access left no trace, because reads through the REST API are not logged in the database.

## After applying (2026-09-18)

Both migrations were applied, then checked against the live database (not the earlier transaction):
- `anon` can execute 0 definer functions in `public`; PUBLIC 0; every view is `security_invoker`; `anon` cannot
  read the two views; new functions no longer grant `anon` or PUBLIC.
- **Second migration, closing the "ADMIN can still call it in production" gap:** `reset_agency_business_data` is now
  `reset_agency_business_data(p_agency_id uuid)`, executable by the **service role only**, and the no-argument version
  is dropped. The Server Action `resetAgencyDataAction` still checks ADMIN, not production and the typed phrase, and
  then calls it with the server-side client and the agency id it resolved. The 54 deletes are unchanged.
  Over the real REST path: service role 200 (unknown agency id: 54 tables, 0 rows deleted); public key 401 `permission
  denied`; the old no-argument form 404. From an admin's own session the function is denied (`42501`).
- Regression check as the signed-in admin: ten pages render without errors; `touch_own_activity`,
  `accept_own_invitation`, `is_platform_admin`, `switch_active_agency` work; both views return the admin's own rows
  (1 and 0); production data untouched (2 leads, 2 packages, 2 pilgrims).
- Not exercised: the Danger Zone reset button itself (it is disabled in production by design and would delete
  data), and staff invitation and package publish flows end to end (their functions keep `authenticated`
  access and their checks are unchanged).
