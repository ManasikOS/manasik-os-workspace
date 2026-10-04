# TASK-032 Inbox production build-out and go-live gate

## What
Finish all remaining Inbox engineering now, without waiting for Meta's review (about a month) or for the Sentry alert setup, and replace
the manual go-live checklist with one **automatic production gate**: a command and a scheduled job that checks everything that makes the
Inbox safe to launch and reports PASS, FAIL, or PENDING (waiting on something outside the code, such as Meta).

When the owner submits the Meta review and finishes Sentry, no more code work is needed: the gate notices, flips those checks from
PENDING to PASS, and the final verification completes on its own.

This supersedes the engineering items in TASK-031 (sections B, D and E). TASK-031 stays as the owner-action list (A and C).

## Why
Meta approval gates exactly one thing: real customers' messages from live Meta accounts through WhatsApp, Instagram and Facebook. It does
not gate building, testing, securing or deploying the Inbox. The Meta test app the owner already has can carry every test. Two other
waits are avoidable too:
- **No real test contacts needed.** A provider simulator (W1) replaces sending to real phones, so TASK-031 A3 no longer blocks anything.
- **No paid Supabase branch needed.** The clean-rebuild proof can run on a local database (W6), free, if Docker is available.

## Principles
1. **Every check is automatic and repeatable.** A person reading a screen is not verification. Where only a person can act (Meta review,
   Sentry rules), the gate checks the *result* through an API and shows PENDING until it appears.
2. **The gate never messages a real person and never touches real agencies.** It uses one disposable test agency that cannot reach a
   provider (W2) and deletes it afterwards, proving zero rows are left.
3. **Read-only against production by default.** The only writes are the disposable agency and its teardown.
4. **One slice, one PR**, with tests, per `AGENTS.md`. No slice depends on Meta.
5. **No secret values in the repo, logs or reports.** Checks report presence and a short fingerprint only.

## Workstreams (all codable now)

### W1. Provider simulator (replaces real test contacts)
- A local and staging-only stand-in for Meta: sends correctly signed inbound webhooks (text, image, status updates, duplicates, out of
  order) to the app, and a fake Graph API that accepts outbound sends and answers success, rate-limit and permanent-failure on demand.
- Needs the Graph base URL to be configurable in the provider adapters (confirm in `lib/channels`; add an env override if missing).
- **Done when:** the outbound path, the worker, delivery-status updates and replies are exercised end to end with no real number.
- Covers TASK-029 P2.5 and TASK-030 groups B and M without A3.

### W2. Send safety guards
- Add `agencies.is_test boolean not null default false` (additive migration; RLS unchanged; isolation test). Only the service role sets it.
- In `lib/inbox/outbound/authorize-provider-send.ts` (the one place every send passes): a test agency can **never** reach a real provider;
  it may only send to the simulator. Everything else behaves as today.
- Add the staging outbound allow-list from TASK-029 code change 4: `INBOX_OUTBOUND_ALLOWLIST` (comma list), enforced when
  `SENTRY_ENVIRONMENT`/app environment is not production. Empty list in a non-production environment means "send to nobody".
- **Done when:** unit tests prove a test agency and a non-allow-listed recipient are refused; a normal production agency is unaffected.

### W3. Environment awareness
- A visible "Staging" strip driven by a public env var (TASK-029 code change 3), using existing shadcn components.
- A required-variable list in code (`lib/ops/required-env.ts`) with a test, used by the gate and by the app's startup check.
- A `CRON_SECRET`-protected `GET /api/health/config` returning, per required variable: present or missing, plus an 8-character HMAC
  fingerprint for secrets (so the gate can prove production secrets differ from staging). Never a value. Tested for leaks.

### W4. Browser acceptance, fully automated
- Seed two `E2E-` agencies on staging with the existing seeder, run the 32 specs, triage and fix every failure.
- Write the missing groups (O4, B4, C4 to C9, X, F) and the two-agency UI isolation spec (agency A cannot see, open, search or act on B).
- Provider-dependent steps run against the simulator (W1).
- **Done when:** every row in the TASK-030 matrix has a passing spec; results saved in `docs/progress/`; the browser list is part of CI.

### W5. Security leftovers
- D1: prove the twelve server-only tables are never read with a user session; add a pgTAP assertion that `authenticated` has no policy.
- D3: rewrite the package wrappers' `current_staff_role() not in (...)` guards to fail closed on their own, with no-agency and
  suspended-agency pgTAP cases.
- D2 (`package_*` tables): kept out of scope unless the owner says drop; the default is to leave them with no policy, as now.
- Re-run `scripts/sql/verify-tenant-isolation.sql` as part of the gate (G3).

### W6. Clean-rebuild proof without paying
- Build a fresh database from all migrations using the Supabase CLI against a **local Docker database** (`supabase start`,
  `supabase db reset`), no hand edits. Compare schema, buckets and cron jobs with staging by migration **name**.
- Fix each failure with an additive migration. Record the empty diff, or each difference, in `docs/progress/`.
- If Docker is not available on the owner's machine, fall back to a preview branch at $0.01344/hour with the owner's approval.

### W7. The production go-live gate (the final verification)
`npm run verify:production` and a scheduled GitHub Actions workflow `production-gate.yml` (manual trigger plus nightly). Each check
returns PASS, FAIL or PENDING; the report is a markdown table saved as a workflow artifact and, on a state change, posted to one pinned
GitHub issue "Production gate".

Exit codes: `0` all PASS, `2` only PENDING remain (nothing broken), `1` at least one FAIL.

| Check | What it verifies | Source | Pending until |
|---|---|---|---|
| G1 Liveness and build | `/api/health` and `/api/health/ready` answer 200; the build id equals the expected `main` commit | HTTP | n/a |
| G2 Migrations | applied migration names equal the repository's files, none missing or extra | read-only database | n/a |
| G3 Tenant isolation | the isolation audit returns zero findings | read-only database | n/a |
| G4 Scheduled jobs | every cron job healthy; `inbox-health` ran in the last 10 minutes | read-only database | n/a |
| G5 Storage | required buckets exist and are private; no policy lacks an agency check | read-only database | n/a |
| G6 Configuration | every required variable present; production secrets differ from staging by fingerprint; `SENTRY_ENVIRONMENT` is `production` | `/api/health/config` | n/a |
| G7 Worker | production worker `/healthz` and `/readyz` are 200; `INBOX_WORKER_ACTIVE` is on | HTTP | worker deployed |
| G8 Webhook security | handshake with the verify token returns the challenge; a bad signature is rejected; a valid signature for the test agency is accepted and stored once, a duplicate stored once | HTTP | Meta webhook URL set |
| G9 Disposable-agency acceptance | creates `E2E-GATE-<time>` (`is_test = true`), runs the acceptance subset, tears it down, and confirms zero leftover rows | Playwright + service role | n/a |
| G10 Sentry received | a gate test event reaches Sentry tagged `production` | Sentry API (read token) | Sentry token set and DSN live |
| G11 Sentry alerts | the five rules and the `inbox-health` cron monitor exist and are enabled | Sentry API | rules created |
| G12 Meta live | app is in Live mode, required permissions have advanced access, tokens valid, per channel | Meta Graph API (and the owner's recorded approval where Meta exposes no field) | Meta approved |
| G13 Rollback | the previous production deployment is a rollback candidate; the rollback runbook exists | Vercel API | n/a |
| G14 Alert delivery | the on-call channel received the gate's test alert | Sentry API | rules and channels set |

**Final verification** = two consecutive gate runs at least 24 hours apart with every check PASS, the run on the exact commit that is
live. The pinned issue shows the dates and commit. Launch is allowed only on that.

### W8. Runbooks
- `docs/runbooks/production-go-live.md`: the order of owner actions, the exact variables to set (names only), how to read the gate, and
  what each FAIL means.
- Update `docs/inbox/checklist.md` as slices merge, per `AGENTS.md`.

## Data model changes
One additive column: `agencies.is_test` (W2), with an isolation test and an RLS review. Any migration the clean rebuild (W6) finds
necessary is additive and has its own test. No other schema change.

## Access control changes
None for users. The new `/api/health/config` and the gate's helper routes accept only `Authorization: Bearer $CRON_SECRET`, like the
existing cron routes. `is_test` can be changed only with the service role.

## UI surfaces
A staging strip (W3). Nothing else.

## Slices, in order (each its own PR)
| # | Slice | Depends on | Owner input |
|---|---|---|---|
| S1 | `is_test` column and send guard (W2) | none | none |
| S2 | Required-env list and `/api/health/config` (W3) | none | none |
| S3 | Provider simulator (W1) | none | none |
| S4 | Isolation leftovers D1 and D3 (W5) | none | none |
| S5 | Local clean-rebuild proof (W6) | none | Docker installed, or approve the branch cost |
| S6 | Seed `E2E-` agencies, run and fix the 32 specs, add the missing specs and the two-agency spec (W4) | S1, S3 | none |
| S7 | Gate core and checks G1 to G9, G13 (W7) | S1, S2, S3 | production URL and read-only credentials when production exists |
| S8 | Gate Sentry and Meta checks G10 to G12, G14, and the scheduled workflow with the pinned issue (W7) | S7 | tokens in GitHub secrets (names listed in the runbook) |
| S9 | Staging strip and outbound allow-list (W2, W3) | S1 | none |
| S10 | Runbook and checklist updates (W8) | all | none |

S1 to S4 can start immediately and in parallel. Until production exists, the gate runs against staging as a **dress rehearsal**: every
check except G12 and the production-only values can be PASS on staging today, so the first production run holds no surprises.

## What the owner does (small, and after the code is merged)
1. Submit the Meta review. Then add the Meta read credentials to GitHub secrets (names in the runbook).
2. Finish Sentry: DSN is done; create the five alert rules (TASK-031 C1) and add a read-only Sentry token to GitHub secrets.
3. Create the production Supabase project and Vercel project, and set fresh variables (TASK-031 E1 to E3).
4. Read the pinned "Production gate" issue. When it shows two passing runs a day apart, launch.

## What does not change
- Real WhatsApp, Instagram and Facebook traffic still needs Meta's approval. G12 will stay PENDING until then, and the launch waits on
  it for those channels.
- **Launch option while Meta is pending:** the Inbox's email channel does not depend on Meta. If the email channel is judged ready
  (TASK-025, TASK-026), the first agency can go live on email with the Meta channels switched off by feature flag, and Meta channels
  enabled later when G12 passes. Decide this when the gate is built.

## Out of scope
New Inbox features, UI redesign, new channels, changes to other modules, Meta business verification itself.

## Test plan
- **Automated:** unit tests for the send guard, the env list and config route (no values leak), the simulator, and each gate check
  (including the PENDING and FAIL paths); pgTAP for `is_test` and the D1/D3 assertions; the 32+ browser specs; `inbox-ci`,
  `packages-ci`.
- **Environment proof:** local clean rebuild (W6); dress-rehearsal gate runs on staging; later the two production gate runs.

## Status
In progress.

- **Gate check G15, schema fingerprint (built, branch `feat/gate-schema-fingerprint`):** migration `20270109090000_gate_schema_fingerprint.sql` adds `public.gate_schema_fingerprint()` (service role only; one 10-character hash per public-schema object: columns, constraints, indexes, triggers, policies, grants, functions, views); the committed baseline `supabase/schema-fingerprint.json` (1330 objects) is the fingerprint of a database built from the repository; G15 compares any environment with it and names every object that differs, is missing, or is not in the repository. A test fails CI if the baseline is not regenerated after a migration. Regenerate with `scripts/local/write-schema-fingerprint.sh`. 9 of 9 database assertions pass; 74 gate tests pass. **Applied to staging on 2026-10-03** (with the follow-up `20270110090000_gate_schema_fingerprint_ignore_comments.sql`, which makes function hashes ignore comments and whitespace: the first run flagged 88 functions that differed only by comments or Windows line endings). **First G15 result on staging: FAIL, 99 differ and 32 not in the repository, of 1330.** Real drift: the 15 tables of tenant uniqueness and their keys and indexes (17 constraint and 13 index groups), the leftover columns on packages, departure_group_bookings, departure_groups and agencies (4 tables), the staging-only leftovers (6 tables with their policies, indexes and triggers, and 3 functions), **64 tables whose row-level-security policies are still in the slow per-row form** (`20261128090000_perf_rls_initplan_and_duplicate_index.sql` is recorded as applied but its effect is missing; the performance form calls `current_agency_id()` once per query, staging calls it per row) and **`set_updated_at()`, which staging has hardened with an empty search_path and the repository does not** (a hand-made change no migration records, so a database built from the repository would lack it). Closes the gap that G2 compares names only.
- **S6 part 2 (browser run on the rebuilt database, 2026-10-03):** the specs first scored 0 of 32 because the Inbox did not load on a database built from the migrations (the code named a foreign key only staging has); now 16 passed, 8 failed, 8 skipped. Fixed: that key, six composite foreign keys that failed on delete, unlabelled login and file inputs, the owner picker showing a raw id, invalid ARIA on the tabs, nested buttons in the list, fixture data, two stale specs. Still open: colour contrast, the `r` shortcut, draft retention, two-session convergence, template send re-check; the missing spec groups and the two-agency UI spec are not written. Also found: 15 tables where staging is behind `20260828090000_tenant_uniqueness`. Full record: `docs/progress/2026-10-03-browser-run-s6.md`. Migration `20270107090000_composite_foreign_key_delete_behaviour.sql` is APPLIED to staging (2026-10-03, verified). **Second pass: 31 of 32 specs pass;** the eight failures were traced (a realtime join refused before the token was set, a CSP that blocked any non-`supabase.co` Supabase origin, the `r` shortcut, an unnamed Send button, stale specs); only colour contrast (A6) remains, a design decision. **Third pass:** C5, C8, C9, K3, K4, X1, X2, B4 and the two-agency isolation spec are written (43 specs, 42 pass; contrast aside). They found two more product bugs: queue counts never followed a conversation delete (live staging's real agency already drifted; fix `20270108090000_queue_counts_follow_deletes.sql`, NOT yet applied to staging) and the colleague-is-writing warning hidden for up to a minute (fixed). Still unwritten: O4, C4, C6, X3, F1 to F6 (each needs fixtures or a provider; see the progress record).
- **S5 (clean-rebuild proof), done once with patches:** on 2026-10-03 all 226 migrations were applied to an empty local Supabase database (the self-hosted stack the owner set up in Docker). Two migrations failed on a fresh database and are fixed in place; staging was found **behind** the repository in two security-relevant ways (no MARKETING column scope on packages; an all-commands `staff write` policy on the departure-group audit log) and a fresh build was looser than staging in two others; the repository's own marketing-scope trigger was broken (it blocked even the `featured` flag) and is re-created with the fix. All of it, with a 12-assertion database test that passes on the rebuilt database and on staging (rolled back), is in `20270106090000_clean_rebuild_alignment.sql`. The gate's required-bucket list drops the unused `whatsapp-media`. Full write-up: `docs/progress/2026-10-03-clean-rebuild-proof.md`. **Still to do:** a final from-scratch run of the committed files without patches (needs a reset of the local stack), and apply the new migration to staging. A fingerprint-based drift check for the gate is recommended.
- **S9 (staging banner and outbound allow-list):** built on branch `feat/staging-banner-and-outbound-allowlist`; no migration. Outside production (`SENTRY_ENVIRONMENT` not `production`) the app sends only to the contacts in `INBOX_OUTBOUND_ALLOWLIST`: empty or unset means nobody, `*` means everyone, production ignores it (and the go-live gate flags it as a problem there). Enforced in the send authorization (outbox and AI replies) and at every direct sender (template sends, announcements, unsupported-file notices, the setup test message); a scan test fails if a send path lacks it. A disposable test agency is not subject to it. A small fixed label ("Staging environment: test data only") shows on every page of a non-production deployment, driven by the same `SENTRY_ENVIRONMENT`. **Effect once deployed: staging sends nothing until the owner sets `INBOX_OUTBOUND_ALLOWLIST`.** Guide: `docs/runbooks/outbound-allowlist.md`.
- **S7a (gate core):** built on branch `feat/go-live-gate-core`; one migration, NOT yet applied: `20270105090000_gate_snapshot.sql` (`public.gate_snapshot()`, read-only, service role only, names and counts only; 9 of 9 database assertions pass in a rolled-back transaction on staging). `npm run verify:production` runs checks G1 (liveness and build), G2 (migrations by name), G3 (tenant isolation), G4 (scheduled jobs), G5 (storage), G6 (configuration, with the staging comparison for production), G7 (worker), G8 (webhook security without secrets: forged, unsigned and wrong-token events refused; the real handshake when tokens are supplied) and G13 (rollback via Vercel). Each is PASS, FAIL or PENDING; G9 to G12 and G14 are listed as PENDING "not built yet", so the gate cannot pass before they exist. Exit codes: 0 all passed, 2 only pending, 1 a failure, 3 a missing setting. **Dress rehearsal on live staging (read-only):** G1 PASS (the live build is the head of `main`), G6 PASS, G8 refuses forged and unsigned events and wrong tokens on all three channels (PENDING only for the real tokens), G2 to G5 FAIL only because `gate_snapshot()` is not applied yet. **S7b** (G9, the disposable-agency check with a signed event, duplicate and clean removal) waits for the S6 test agencies and logins; **S8** adds G10, G11, G12, G14 and the nightly workflow. Guide: `docs/runbooks/production-gate.md`.
- **S4 (isolation leftovers D1 and D3): merged (PR #214) and APPLIED to staging on 2026-10-02**, recorded as `revoke_server_only_table_privileges` (version `20261002152143`) and `harden_package_wrapper_guards` (`20261002152148`). The first revokes the default `anon`/`authenticated` grants from the eight server-only tables that still had them; the second makes six package functions refuse on their own. Each was proven in a rolled-back transaction before applying (D1: 6 of 10 database assertions failed before, 10 of 10 after; D3: 6 of 20 before, 20 of 20 after). Verified on live staging after applying: no policy-less table has a client privilege (20 of 20), none of the six wrappers keeps the old guard, the internal package step is still not callable by staff, and the real CEO is refused by the wrapper, by the internal step and on `platform_admins`; the real ADMIN can close sales, force-archive, restore and publish, is refused on the outbox, and the plain-archive business rule still holds; OPERATIONS can close sales. No data changed (3 agencies, 8 users, packages Draft and Open for Sale). D2 (dropping the `package_*` tables) stays out of scope; those four tables now have neither policy nor client privilege.
- **S2 (required-variable list and `/api/health/config`):** built on branch `feat/required-env-and-health-config`; no migration. `lib/ops/required-env.ts` lists what a deployment needs (`always`, `deployed` for staging and production, `optional`) and the test-only settings that must never be set in a deployed environment; `GET /api/health/config` (bearer `CRON_SECRET`, not public) reports presence, the environment name, config values, and an 8-character fingerprint of each secret and identifier, never a secret or identifier value. Gate checks G6 will read it. The app-startup use of the list mentioned in W3 is not built; the gate is the consumer for now.
- **S6 (test agencies and browser specs), part 1:** the fixture seeder now makes both fixture agencies TEST agencies (`is_test`) connected through simulated `sim-` WhatsApp numbers with a linked integration row, so the outbox can resolve a sendable connection and every send is answered by the simulator. Agencies and connections are written even when the staff users are missing. **Findings on staging (2026-10-02):** the two fixture agencies (`lr2-fixture-agency-a`, `lr2-fixture-agency-b`) already exist, are not yet marked `is_test`, and have no connections; the agency named `royal-al-fathima` is the only real agency and holds the live Meta connections. The fixture agencies keep their `lr2-fixture-` slugs (the specs depend on them), not the `E2E-` prefix named earlier in this plan. **Blocked:** none of the four E2E staff logins exist in Supabase Auth, and Docker Desktop is installed but not running, so the 32 specs have not been run. Two ways forward: (a) start Docker Desktop and run the whole stack locally (a fresh database built from the migrations, which also delivers the S5 clean-rebuild proof), or (b) the owner creates the four staff logins on staging.
- **S3 (provider simulator):** built on branch `feat/provider-simulator`; no migration. A test agency now goes through the normal send policy and is answered by an in-memory adapter instead of being refused (the S1 refusal remains for announcements, the unsupported-file notice and the setup test message). Inbound: signed Meta-shaped payload builders for WhatsApp, Messenger and Instagram (text, image, receipts, duplicates, forged and unsigned events, the handshake) that refuse any account id not starting with `sim-`. Guide: `docs/runbooks/provider-simulator.md`.
- **S1 (`is_test` column and send guard): merged (PR #210) and APPLIED to staging on 2026-10-02**, recorded as `agencies_is_test` (version `20261002140016`). Verified after applying: the column is a not-null boolean defaulting to false, all 3 agencies are real agencies (0 marked as test), the guard trigger is in place and the function is not security definer. Every place that contacts a customer is guarded (the Inbox outbox drain, the AI reply drain, the unsupported-file notices, approved-template sends, announcement broadcasts and the WhatsApp setup test message), and a scan test fails if a new send path appears unguarded. Test agencies are left out of the health-alert queue numbers so their refused sends cannot page anyone. The staging outbound allow-list is still S9. Since S3, a test agency is answered by the simulator rather than refused on the main send paths.
