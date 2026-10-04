# Inbox LR0 release-baseline reconciliation

Date: 2026-09-26  
Scope: LR0 repository/staging baseline, plus the first LR1 staging security
remediation. No production mutation was made.

## Frozen candidate

| Item | Evidence |
|---|---|
| Candidate branch | `p0-inbox-scale-fixes` |
| Candidate commit | `d7117878ec603144a7dea6e053372e0fbe5ce19a` — `feat: add inbox UI components, helper utilities, and configuration files` |
| Candidate relationship | `origin/main` (`7b0d77d`) is an ancestor of the candidate. |
| Worktree at inspection | No uncommitted product code. The only later changes are this launch-readiness documentation and its README link. |
| Staging target | Supabase project `klognjpwmqwlgeibvanf`, identified by the configured project-scoped Supabase MCP URL. The user confirmed this is the current staging setup. |
| Production boundary | Production will be a separately created Supabase project and is not part of the current setup. Its project/deployment identity is intentionally unavailable until it is provisioned. |

This snapshot freezes the source revision for LR0. It is not a deployment
approval and does not establish that `d711787` is deployed anywhere.

## Repository reconciliation

The following named sources are all ancestors of both the frozen candidate and
local `main`; therefore a checklist statement that they are “not merged” is
not current repository evidence:

| Historical source / representative commit | Repository result |
|---|---|
| `origin/transforming-inbox` — `a1783d5` | Ancestor of `main` and candidate |
| `origin/scaling-inbox` — `1e4c236` | Ancestor of `main` and candidate |
| `origin/fixing-inbox` — `b8e608c` | Ancestor of `main` and candidate |
| `inbox-performance-optimization` — `9f5b7d4` | Ancestor of `main` and candidate |
| `upgrade-inbox` — `f8629e3` | Ancestor of `main` and candidate |
| MI4.5 / MI4.6 — `824c1e0`, `a84d482` | Ancestors of `main` and candidate |
| MI5/MI6 implementation — `18e93b6` | Ancestor of `main` and candidate |
| Dedicated worker — `44a6398` | Ancestor of `main` and candidate |

The detailed `- [~] **Slice merged**` wording in
[`docs/inbox/checklist.md`](../inbox/checklist.md) is therefore historical
branch provenance, not the current source-of-truth merge state. The Progress
table's “on main” statements for Phases 2–6 and the scaling track agree with
the Git ancestry above. No `Slice merged` checkbox is changed by this finding:
the programme rule requires the exit criterion to be demonstrably met, and
the exits below remain open.

## Slice evidence matrix

| Area | Source-code status at candidate | Exit / live-evidence status | LR0 disposition |
|---|---|---|---|
| Scaling SC0–SC7 | Present in candidate; SC8 is not started | SC0 Realtime/webhook measures, SC2/SC4/SC6 browser proof, SC3 query plans, SC5 reduction measure, SC7 post-fix burst and model-backed run remain open | Keep `[~]` / `[ ]`; do not promote |
| FIX1–FIX14 | Source is represented in the candidate history; individual historical branch names are not current merge evidence | Provider acceptance, retention reconciliation, browser, performance, policy, and downgrade exits remain open as recorded | Keep in flight |
| MI0–MI2 | `transforming-inbox` source is in `main` and candidate | Live/deployed measurements and several browser/cron exits remain open | Keep 0/3, 0/3, and 0/6 completion counts |
| MI3–MI4.6 | Representative commits are in `main` and candidate | Seeded/browser/shadow-traffic exits remain open | Keep 0/5 and 0/6 completion counts |
| MI5.1–MI5.4 | MI5 source is in `main` and candidate | Grounded-reply, model-call/cache, one-week policy, and end-to-end media exits remain open | Keep 0/4 completion count |
| MI6.1–MI6.6 | MI6 source is in `main` and candidate | Promotion, overnight intake, KPI drill-through, degradation, scale, and retention exits remain open | Keep 0/6 completion count |

## Migration reconciliation

### Staging evidence

Read-only `list_migrations` verification against staging on 2026-09-26 found
an exact match: **191 staging migrations and 191 repository `.sql` migration
files**, with no migration absent from either side. This supersedes the earlier
LR0 uncertainty about timestamp alignment for staging.

The comparison used the project-scoped Supabase database integration rather
than application credentials. No customer rows, credentials, or write query
were read or issued.

### Advisor baseline

Read-only Supabase security and performance advisors ran on the same staging
project. Their findings are remediation input, not proof that the findings are
exploitable by themselves.

| Finding | Staging result | LR0 classification |
|---|---|---|
| RLS enabled, no policy | 14 informational findings; 10 are Inbox/channel tables. Nine have no `anon` or `authenticated` table privileges. `whatsapp_webhook_hits` has grants but RLS with no policy, so direct `anon`/`authenticated` operations are denied. | Expected locked-path posture; retain as an advisor baseline and re-check after each migration. |
| Mutable `search_path` on `SECURITY DEFINER` functions | The initial baseline included `enqueue_inbox_text_message` with `search_path=public`. After LR1 migration `20260926070345_inbox_text_message_search_path_hardening.sql`, direct staging inspection reports `search_path=\"\"`, authenticated execution true, anon execution false, and the preserved auth/agency checks. The post-migration advisor no longer lists this RPC; 13 unrelated core/finance findings remain. | **Resolved for the Inbox text send RPC.** The remaining findings are outside this Inbox slice and need separately owned remediation. |
| `authenticated` executable `SECURITY DEFINER` functions | 27 warnings. Inbox examples include text/media enqueue, queue counts, answer-cache operations, and autonomy level changes. Most sampled Inbox functions pin an empty search path and are intentionally callable by authenticated staff. | Audit each function's body, grants, `auth.uid()`/agency checks, and capability boundary in the dedicated security slice; do not globally revoke needed RPCs. |
| Performance advisor | 176 unindexed-FK informational findings, 249 unused-index informational findings, and 141 multiple-permissive-policy warnings; Inbox objects are represented in each category. | Triage against Inbox query plans and live traffic before adding or dropping indexes/policies. No performance migration is justified from lint output alone. |

The relevant advisor remediation references are:

- [RLS enabled, no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [Security-definer executable by authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Unindexed foreign key](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)
- [Unused index](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)
- [Multiple permissive policies](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies)

### Remaining LR0 evidence

- [x] Name and query the current staging project.
- [x] Compare staging and repository migration inventories.
- [x] Run staging security and performance advisors.
- [-] Production reconciliation is deferred by design until the separate
      production Supabase project is provisioned. It is a LR7 pre-release gate,
      not an outstanding staging-LR0 action.
- [x] Staging baseline reviewed and the resulting security-remediation priority
      recorded in the launch-readiness plan.

## Evidence that is still intentionally unverified

- No signed-in browser, provider sandbox, worker deployment, cron invocation,
  storage/RLS query, or load test ran during LR0.
- Existing “applied to Manasik OS” and “checked live” statements were retained
  as dated claims from earlier records unless replaced by the staging checks
  recorded above.
- No programme, R/G, definition-of-done, or slice exit box was ticked.

## LR1 verification after the first security remediation

- Scoped lint passes with no warnings in `app/inbox/**`, `lib/inbox/**`,
  `lib/channels/**`, or `lib/agent/whatsapp/**`.
- `npm run typecheck` passes.
- `npm run test` passes: 283 files and 2,857 tests.
- `npm run build` succeeds for `/inbox` and the full application.
- `npm audit --omit=dev --audit-level=high` reports zero production
  vulnerabilities.
- The repository-wide lint baseline still has 259 warnings outside the scoped
  Inbox/channel/WhatsApp areas. It is not attributed to Inbox and needs a
  separately named release owner before LR1 can close.

## Outcome

Repository and staging reconciliation are complete and correct the
merge-provenance ambiguity. **LR0 is complete for staging.** LR1 has resolved
the mutable search-path release blocker for the Inbox text send RPC on staging;
its broader lint-cleanup and authenticated-RPC audit remain open. Production
reconciliation will be repeated under LR7 after the separate production
project is created.
