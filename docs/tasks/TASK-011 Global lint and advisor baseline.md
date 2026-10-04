# TASK-011 Global lint and advisor baseline

**Owner:** _release owner to be named before LR7_ · **Status:** open · **Raised by:** LR1, 2026-09-26

Not Inbox debt. Inbox scopes (`app/inbox`, `lib/inbox`, `lib/channels`, `lib/agent/whatsapp`) are clean.

## Scope
1. `npm run lint`: 253 warnings, 0 errors (mostly `no-unused-vars` and `react-hooks/incompatible-library` for TanStack Table in `components/`, dashboard and finance code). Remove or justify each; do not add broad disables.
2. Security advisor `function_search_path_mutable` (13 finance/invoice trigger functions, `staff_role_in`, `can_act_on_insight`). `staff_role_in` is used by RLS and Inbox RPCs, so fix it first.
3. Enable Supabase Auth leaked-password protection.
4. Review the non-Inbox `authenticated_security_definer_function_executable` findings (packages, invitations, agency suspend/resume).

## Done when
`npm run lint` has zero warnings or each remaining one is documented, and the advisor shows no WARN-level findings or each has an accepted least-privilege note.
