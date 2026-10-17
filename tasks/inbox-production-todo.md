# Task list: Inbox production readiness

Plan: [`tasks/inbox-production-plan.md`](./inbox-production-plan.md) · Parent: `docs/tasks/TASK-032-inbox-production-buildout-and-go-live-gate.md`
Legend: [x] done · [~] built, browser proof pending · [-] deferred. Sizes: XS 1 file · S 1–2 · M 3–5. One task = one PR unless marked (ops).
Standing verification for code tasks: `npm run lint`, `npm run typecheck`, `npm test`; `npm run build` at checkpoints.
Inbox-only fast check: `npx vitest run app/inbox lib/inbox lib/access/inbox-access`. Update `docs/inbox/checklist.md` as slices merge.

## Phase 0: Re-baseline

- [x] **T1 (XS, ops) Run the checks not yet run.** `npm run typecheck`, `npm run build`, `npm audit`, `npm run lint` scoped as in `.github/workflows/inbox-ci.yml`, `npm test`.
  - Accept: one results table in `docs/progress/2026-10-xx-inbox-baseline.md`; any critical or high audit finding has an owner.
  - Verify: you read the table.
  - Depends: none · Files: docs/progress note
- [ ] **T2 (S, ops) Compare staging with the repository.** Run G2 and G15 (`npm run verify:production` against staging, read-only) and list migrations unapplied or applied by hand.
  - Accept: a list of every unapplied migration and every drift group, each with a planned fix (feeds T3, T4).
  - Verify: list matches the G15 output.
  - Depends: none · Files: docs/progress note

## Phase 1: Environment parity

- [ ] **T3 (M, ops) Apply pending migrations to staging, one at a time.** Known pending: `20270105090000_gate_snapshot`, `20270108090000_queue_counts_follow_deletes`, `20270111090000_inbox_conversation_write_hardening`, `20270106090000_clean_rebuild_alignment`, plus anything T2 finds.
  - Accept: each applied after a rolled-back proof; its pgTAP test passes after; a backup exists first; staging's real agency data unchanged.
  - Verify: re-run its test on staging; `inbox-two-agency-isolation` spec still passes.
  - Depends: T2, open question 4 · Files: none (applies existing migrations)
- [ ] **T4 (M) Fix G15 drift with new additive migrations.** Groups: 15 tables of tenant uniqueness (`20260828090000`), 64 tables with the slow per-row RLS form (re-apply the intent of `20261128090000`), `set_updated_at()` hardening that no migration records, 6 staging-only leftover tables and 3 functions (decide keep or drop).
  - Accept: G15 reports zero differing and zero unknown objects on staging; baseline `supabase/schema-fingerprint.json` regenerated; RLS apply in batches with a before and after isolation test.
  - Verify: G15 PASS; `scripts/local/write-schema-fingerprint.sh` baseline test passes; all pgTAP tests pass.
  - Depends: T3 · Files: 2–4 migrations, tests, fingerprint JSON
- [ ] **T5 (S, ops) Final from-scratch clean-rebuild run** of the committed migrations with no patches on a reset local stack.
  - Accept: all migrations apply clean; schema, buckets and cron jobs equal staging by name and fingerprint.
  - Verify: empty diff recorded in `docs/progress/`.
  - Depends: T4, Docker running (open question 5) · Files: docs/progress note
- [ ] **T6 (S, ops) Run every pgTAP test** in `supabase/tests/database/`, including `inbox_voice_transcripts_rls.test.sql` (20 assertions), on the rebuilt database.
  - Accept: all pass, or each failure becomes a fix task.
  - Verify: output saved in `docs/progress/`; checklist line for MED-01 ticked.
  - Depends: T5 · Files: docs/progress note

### Checkpoint A: environment matches the repository
- [ ] T1 table all green · G2, G3, G5, G15 PASS on staging · voice RLS test passes · you review before Phase 2

## Phase 2: Product gaps from the analysis

- [x] **T7 (S) Bulk close confirmation.** Add a confirm dialog naming the count (and "chats with an open review will be skipped"); optional 10-second undo toast that reopens them.
  - Accept: closing 2 or more chats requires an explicit confirm; the dialog states how many will be skipped; keyboard and screen-reader accessible; no change to server rules.
  - Verify: component test; extend `e2e/inbox-ownership-and-bulk.spec.ts`; lint, typecheck.
  - Depends: none · Files: `bulk-selection-bar.tsx`, spec, test
- [x] **T8 (M) Spam-marked chat versus the assistant.** Decide (open question 1) and implement the chosen rule in the reply gate, with a log line when suppressed.
  - Accept: per the decision; `docs/inbox/spam-state-contract.md` and tech doc §27 updated; tests cover spam then new message.
  - Verify: unit tests in `lib/inbox/reply/` and the contract test; lint, typecheck.
  - Depends: owner decision · Files: reply gate, tests, 2 docs
- [ ] **T9 (XS, decision) Read-only roles.** Record the decision on CEO, Finance and Visa visibility in `docs/security/access-control.md`; if limiting, add a repository filter and a test.
  - Accept: decision written; if changed, a role-matrix test proves the new scope.
  - Verify: `lib/access` test; `inbox-shortcuts-denied-and-unavailable` spec still passes.
  - Depends: owner decision · Files: access doc (+ repository, test if changed)
- [-] **T10 (S) Colour contrast (spec A6). REVERTED 2026-10-17 at the owner's request; colours stay as the design system has them.** Fix the failing token pairs found by the accessibility spec to WCAG 2.1 AA (4.5:1).
  - Accept: `inbox-accessibility.spec.ts` contrast check passes in light and dark themes.
  - Verify: the spec; visual check in the browser pane.
  - Depends: none · Files: 1–2 style files, spec
- [-] **T11 (M, optional, DEFERRED after launch) Message deep link.** Accept `?message=<uuid>` (same untrusted-address rules as `?conversation=`); scroll to and highlight that message; Finance receipt link uses it.
  - Accept: invalid ids ignored; link respects viewer access; opens the exact message.
  - Verify: `page-request.test.ts` extended; one spec.
  - Depends: none · Files: `page-request.ts`, controller, thread, tests

## Phase 3: Browser acceptance

- [ ] **T12a (M) Write specs O4, C4, C6.** Fixtures per TASK-030 matrix; provider steps use the simulator.
- [ ] **T12b (M) Write spec X3 and F1 to F3.**
- [ ] **T12c (M) Write specs F4 to F6.**
  - Accept (each): matrix rows have a passing spec; each spec cleans up its own data.
  - Verify: `npx playwright test e2e/<spec>` against the rebuilt stack.
  - Depends: T5 · Files: `e2e/inbox-*.spec.ts`, fixtures
- [ ] **T13 (S) Nightly browser run in CI** against the rebuilt database; triage every failure.
  - Accept: 3 consecutive nightly runs green; results linked from `docs/progress/`.
  - Verify: workflow run history.
  - Depends: T10, T12a–c · Files: workflow file

### Checkpoint B: acceptance proven
- [ ] Every TASK-030 matrix row has a passing spec · you review before Phase 5

## Phase 4: Voice transcripts (parallel with Phase 3)

- [ ] **T14 (S, ops) One real staging provider call** with sample audio; confirm the `input_audio` request shape and the model's audio support.
  - Accept: a transcript is produced and stored staff-only; cost and latency logged; failure path preserves playback.
  - Verify: staging run saved in `docs/progress/`.
  - Depends: T6 · Files: possibly the provider adapter + test
- [ ] **T15 (XS, decision) Checkpoint P4a.** Review quality and cost samples; record the decision. Feature stays off by default at launch.
  - Accept: decision written in the checklist.
  - Verify: you sign off.
  - Depends: T14 · Files: checklist

## Phase 5: Finish the gate

- [ ] **T16 (M) G9 disposable-agency check.** Creates a test agency, sends a signed event and a duplicate, runs the acceptance subset, tears down, proves zero leftover rows.
  - Accept: check returns PASS/FAIL; teardown verified.
  - Verify: gate unit tests (PASS, FAIL and PENDING paths); dress rehearsal on staging.
  - Depends: T12a–c · Files: `scripts/gate/*`, tests
- [ ] **T17 (M) G10, G11, G12, G14 and the nightly `production-gate.yml`** with the pinned "Production gate" issue.
  - Accept: each returns PENDING until its external setting exists; secrets referenced by name only; exit codes 0/1/2/3 as documented.
  - Verify: gate tests; manual workflow dispatch.
  - Depends: T16 · Files: `scripts/gate/*`, workflow, tests
- [ ] **T18 (S) Runbook, rollback plan, checklist.** `docs/runbooks/production-go-live.md` with the owner steps in order, a rollback plan (flags, revert, migration rollback with times), and reconcile `docs/inbox/checklist.md`.
  - Accept: a person who did not build it can follow it; rollback steps name exact flags and commands.
  - Verify: you read it; dry-run the flag-off steps on staging.
  - Depends: T17 · Files: runbook, checklist

### Checkpoint C: dress rehearsal
- [ ] `npm run verify:production` on staging: only owner-dependent checks are PENDING · you approve starting Phase 6

## Phase 6: Owner actions and launch

- [ ] **T19 (S, owner) Sentry.** Create the five alert rules and the `inbox-health` monitor; add a read token to GitHub secrets. Accept: G10, G11, G14 PASS.
- [ ] **T20 (M, owner) Production projects.** Create production Supabase and Vercel projects; set fresh variables (names in the runbook); deploy the worker; apply all migrations. Accept: G1 to G9, G13, G15 PASS on production.
- [ ] **T21 (S, owner) Meta.** Submit the review, or record the email-first decision with Meta channels off by flag. Accept: G12 PASS, or documented as deferred.
- [ ] **T22 (XS, gate) Two passing gate runs at least 24 hours apart** on the live commit. Accept: pinned issue shows both dates and the commit. Verify: you read it; go or no-go.
- [ ] **T23 (S, ops) Staged rollout.** Pilot agency (autonomy and voice off) for 24 to 48 hours, then widen. Advance only inside the skill's thresholds: error rate within 10% of baseline, p95 within 20%, no new client error types. Watch `inbox-health` alerts for the first hour and first week.
  - Roll back if: error rate over 2x baseline, p95 over 50% worse, data-integrity issue, or a security finding.
  - Rollback: disable the flag (under 1 minute), revert and redeploy (under 5 minutes), migration rollback per its file (under 15 minutes).

### Checkpoint D: launched
- [ ] Week-one monitoring clean · autonomy and voice enablement planned as separate follow-up rollouts

## Parallelization
- Phase 2 tasks (T7, T9, T10, T11) are independent of Phase 1 and of each other; they can start now.
- Phase 3 specs need T5. Phase 4 needs T6. Phase 3 and 4 run in parallel.
- Migrations (T3, T4) are strictly sequential. Never run two sessions on the same migration or gate files.
