# Applying the G9 migration to staging — exact steps

> **Status:** prepared 17 October 2026. **Nothing here has been run against staging.** Every step marked [Y] waits for your yes.
> Applies migration `20270216090000_gate_disposable_agency_leftovers.sql` (two service-role-only functions) so gate check G9 can run.
> Background: [`production-gate.md`](./production-gate.md), [TASK-032](../tasks/TASK-032-inbox-production-buildout-and-go-live-gate.md), checklist items B/C/F1 in [`../inbox/production-readiness-plan.md`](../inbox/production-readiness-plan.md).

## What is known (read-only look at Supabase on 17 Oct)

| Fact | Value |
|---|---|
| Projects in the organisation | **Manasik OS** (`klognjpwmqwlgeibvanf`, created 1 Aug, the staging project, holds the only real agency) and **ManasikOS Production** (`bidmihfsljrurlnraqmf`, created 4 Oct) |
| Applied migrations | **Both projects list the same 254 migrations**, from `create_packages` to `leads_abuse_limits_and_export_audit` (version `20270208090000`) |
| Not applied on either | `20270215090000_quick_chat_record_send` and `20270216090000_gate_disposable_agency_leftovers` (256 files in the repository, 254 applied) |
| Already applied on both | `gate_snapshot`, `queue_counts_follow_deletes`, `inbox_conversation_write_hardening`, `clean_rebuild_alignment`, `gate_schema_fingerprint`, so **checklist items B1 to B4 are already done by name**. The remaining drift (G15) is in what those objects actually contain, not in missing names |
| Local proof | A database built from all 256 migrations applied with no errors; the new test passes 13 of 13; the schema baseline changed only by the two new functions |

**Important — two migrations are pending, not one.** `20270215090000_quick_chat_record_send` (adds `enqueue_record_text_message`, the narrow Finance/Visa send path for Quick Chat; reverse: `drop function public.enqueue_record_text_message(uuid, text, uuid)`) sits before G9's in the order, and gate check G2 needs every repository migration applied. Decide in step 0 whether to apply it too. The Quick Chat popup is behind `QUICK_CHAT_ENABLED` (off), so applying the function changes nothing a user can do. The recommended order is Quick Chat first, then G9, each with its own proof.

**Which project is staging?** The docs call `Manasik OS` staging and say it holds the real agency `royal-al-fathima`. `ManasikOS Production` has the same migrations and was created on 4 Oct. Confirm the project ref below before any step, and never run these steps against the project you will launch on until the gate says so.

## Step 0 — Before anything [Y]

- [ ] Backup exists for the target project; note its time: `__________` (checklist A1).
- [ ] You confirm the target is **`klognjpwmqwlgeibvanf` (Manasik OS)**: `__________`.
- [ ] Decide: apply Quick Chat's `20270215090000` first (recommended), or leave it and accept that G2 will stay FAIL for it.
- [ ] The staging outbound allow-list `INBOX_OUTBOUND_ALLOWLIST` is empty or unset on staging (the default), so nothing can be sent to a real number. (G9's agency is `is_test` and cannot reach a provider anyway.)

## Step 1 — Rolled-back proof (changes nothing)

The proof applies the migration and runs the 13 database assertions in one transaction that ends in `rollback`. It is built by a script that only prints SQL:

```bash
bash scripts/local/build-rolled-back-proof.sh \
  supabase/migrations/20270216090000_gate_disposable_agency_leftovers.sql \
  supabase/tests/database/gate_disposable_agency_leftovers.test.sql > proof-g9.sql
```

Run the contents of `proof-g9.sql` on the target (SQL editor, or the Supabase MCP `execute_sql`).

**Expect:** thirteen lines `ok 1` to `ok 13`, no `not ok`, no `ERROR`.
**Then check nothing was kept** (both must be empty or zero):

```sql
select proname from pg_proc where proname in ('gate_disposable_agency_leftovers', 'gate_delete_disposable_agency');
select count(*) from public.agencies where slug like 'e2e-gate-%';
```

I ran this same proof on the local rebuilt database on 17 Oct: 13 of 13 ok, rolled back, no leftovers. **Stop if** any assertion fails, or if the proof needs `pgtap` and the target does not have it (the earlier gate tests ran there in rolled-back transactions, so it should).

Repeat step 1 for `20270215090000_quick_chat_record_send.sql` first if you chose to apply it. It has no database test file of its own, so its proof is only that the file runs inside a `begin; … rollback;` without error.

## Step 2 — Apply [Y, one at a time]

1. Apply `20270215090000_quick_chat_record_send.sql` (if chosen) as migration `quick_chat_record_send`.
2. Apply `20270216090000_gate_disposable_agency_leftovers.sql` as migration `gate_disposable_agency_leftovers`.

The Supabase MCP `apply_migration` records its own version number; the gate (G2) compares **names**, so use these exact names.

## Step 3 — Verify on the target (read-only)

```sql
-- Both exist, service role only
select p.proname,
       has_function_privilege('anon', p.oid, 'execute') as anon_can,
       has_function_privilege('authenticated', p.oid, 'execute') as signed_in_can,
       has_function_privilege('service_role', p.oid, 'execute') as service_can
  from pg_proc p
 where p.proname in ('gate_disposable_agency_leftovers', 'gate_delete_disposable_agency');
-- expect two rows: false, false, true

-- The finder answers an empty list for an agency that does not exist
select public.gate_disposable_agency_leftovers(gen_random_uuid());   -- expect []

-- The remover refuses anything that is not a gate agency (this does NOT touch a real agency: the id is random)
select public.gate_delete_disposable_agency(gen_random_uuid());      -- expect ERROR 42501 "not a disposable gate agency"
```

Never call the remover with a real agency's id, even though it would refuse.

## Step 4 — Run the gate (staging) [Y]

1. Fill `.env.gate` for staging (`GATE_EXPECTED_ENVIRONMENT=staging`), including `GATE_META_APP_SECRET` (the staging deployment's platform Meta app secret; never paste it into chat).
2. `npm run verify:production`
3. **Expect:** G2 PASS (names equal), G15 reports the two new functions as matching the baseline (any other drift is the known 99-object list), and **G9 PASS**.
4. Immediately afterwards confirm G9 cleaned up:

```sql
select id, slug, created_at from public.agencies where slug like 'e2e-gate-%';   -- expect no rows
```

## What G9 does on staging, so there are no surprises

- Creates one agency (`is_test = true`, slug `e2e-gate-…`) with a simulated number `sim-gate-…`; sends it three webhook posts (valid, the same again, forged); counts its rows; removes it; asks the finder whether anything still names it.
- The agency cannot send to a real provider (the send guard), and the payload builders refuse any account id that does not start `sim`.
- The inbound event enqueues the normal enrichment and reply jobs for that agency. They run against the simulator, and the agency is deleted within seconds; any job that has not finished is deleted with it. Expect at most a trivial AI cost for one short message.
- If a run is killed halfway, the next run removes the leftover once it is an hour old, or you can remove it by hand with `select public.gate_delete_disposable_agency('<id>')` (it only works for `e2e-gate-` test agencies).

## If something goes wrong

| Situation | Action |
|---|---|
| A proof assertion fails | Nothing was kept. Stop, send me the output, no apply |
| Apply fails halfway | The migration is one statement block per function; check which function exists with the Step 1 query, then re-run (it is idempotent: `create or replace`) |
| G9 FAILs with "still blocks the delete" | A table that names an agency has no delete path. This is the finding the check exists for; the message names the table. Do not work around it; send me the output |
| G9 left an `e2e-gate-` agency | Remove it with the remover function (above), then check Step 4's last query |
| You want it gone | `drop function public.gate_disposable_agency_leftovers(uuid); drop function public.gate_delete_disposable_agency(uuid);` (G9 then goes back to FAIL "function does not exist", not a pass) |

## After it works

- [ ] Tick checklist **F1** and record the run date and the report path in `docs/inbox/production-readiness-plan.md` section 10.
- [ ] Record the apply in TASK-032 Status, as the earlier slices did (version numbers and what was verified).
- [ ] Repeat Steps 1 to 4 on the production project **only when the production gate is run** (checklist I1), not before.
