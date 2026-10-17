# G9 and Quick Chat migrations — rolled-back proofs on staging (17 Oct 2026)

Target: **Manasik OS** (`klognjpwmqwlgeibvanf`), confirmed as staging by the owner. **Nothing was applied.** Each proof ran inside `begin; … rollback;`
through the Supabase MCP `execute_sql`, and a read-only query afterwards confirmed nothing was kept. The backup time was not yet given.

## Before
Agencies 4 · `gate_*`/`enqueue_record_text_message` functions present: 0 · pgTAP installed: no · agencies named `e2e-gate-%`: 0.

## Proof 1 — `20270215090000_quick_chat_record_send` (compile and wiring only; it has no database test file)
`function_exists` true · `security_definer` true · `anon_can_execute` false · `authenticated_can_execute` true · `staff_role_in` and `current_agency_id` exist ·
**`missing_columns`: none** (all 20 columns the function reads or writes exist on staging: conversations, conversation_messages, outbox_messages, conversation_events, staff_profiles).
A plpgsql body is not checked against tables when it is created, so the column check is the part that proves it will not fail at the first call.

## Proof 2 — `20270216090000_gate_disposable_agency_leftovers` with its 13-assertion test
`count 13, failed 0`: ok 1 to ok 13, including "It refuses an agency that is not a gate agency", "The refused agency is untouched", and "A gate agency with a non-cascading child row is removed"
(the `whatsapp_webhook_events` row that blocks a plain delete). The test installed pgTAP inside the transaction, which the rollback removed again.

## After (read-only)
Open transaction: none · the three functions present: 0 · pgTAP installed: no · agencies: 4 (unchanged) · probe agencies, integrations, events: 0 · `probe_tx` temp table: gone.

## Notes
- `execute_sql` returns only the last row-producing result, so the pgTAP output is collected into a temporary table and returned as one JSON row. A first attempt that read pgTAP's internal results table failed with "relation does not exist", and the error rolled everything back (verified the same way).
- Still to do, each waiting for the owner's yes: apply `quick_chat_record_send`, then `gate_disposable_agency_leftovers`, then the verification queries in `docs/runbooks/gate-g9-staging-apply.md`.
