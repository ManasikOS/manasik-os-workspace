# LR1 authenticated SECURITY DEFINER RPC audit

**Date:** 2026-09-26 · **Project:** staging `klognjpwmqwlgeibvanf` · **Status:** audit complete; hardening migration applied to staging and verified

Source: security advisor `authenticated_security_definer_function_executable` (27 findings) plus a direct `pg_proc` check. Inbox-relevant findings only; package, staff-invitation, agency-suspension and portal helpers belong to their own modules.

| RPC | Caller | Guards in body | Verdict |
|---|---|---|---|
| `enqueue_inbox_text_message` | signed-in staff | `auth.uid()`, staff role, active agency, `search_path=''` | Accept |
| `enqueue_inbox_media_message` | signed-in staff | `auth.uid()`, staff role, active agency, storage-path pinned to agency/conversation, `search_path=''` | Accept |
| `inbox_queue_counts` | signed-in staff | agency from `current_agency_id()`, role list, `p_staff_id = auth.uid()` for MINE | Accept |
| `record_conversation_answer_cache_hit` | AI workflow | agency match or `service_role` | Accept: cross-agency writes impossible |
| `record_conversation_answer_candidate` | AI workflow | agency match or `service_role`; rows land as CANDIDATE, need approval | Accept (see follow-up) |
| `set_inbox_autonomy_level` | ADMIN/CEO + service role | agency, ADMIN/CEO role; **`p_actor_id` was caller-supplied** | **Fix**: migration `20260926130557_inbox_autonomy_actor_binding.sql` requires `p_actor_id = auth.uid()` for non-service callers |

All inbox worker/queue/broadcast functions have no `anon` or `authenticated` execute grant.

**Follow-up (not release-blocking):** the answer-cache RPCs allow any staff role in the agency to write candidates. Restrict to the roles that can reach the AI surface, or move the calls to `service_role` only, once the caller client is confirmed.

**Not Inbox, not attributed here:** 13 mutable-`search_path` functions (finance/invoice triggers, `staff_role_in`, `can_act_on_insight`), 14 RLS-no-policy INFO tables (server-only tables, intentional), and leaked-password protection being off. See TASK-011.
