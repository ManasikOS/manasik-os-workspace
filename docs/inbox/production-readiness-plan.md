# Inbox production readiness — plan and checklist

> **Status:** open · **Written:** 17 October 2026 · **Branch:** `UI-update`
> **Owners:** **[C]** = Claude (code, tests, docs) · **[Y]** = you (accounts, machines, decisions) · **[C+Y]** = Claude prepares, you run or approve.
> **Read with:** [analysis report](../progress/2026-10-17-inbox-page-analysis-report.md) · [baseline checks](../progress/2026-10-17-inbox-baseline.md) ·
> [task list](../../tasks/inbox-production-todo.md) (task ids T1–T23) · [plan](../../tasks/inbox-production-plan.md) ·
> [TASK-032](../tasks/TASK-032-inbox-production-buildout-and-go-live-gate.md) (the go-live gate this finishes).
> Where this file and the code disagree, the code wins. Tick boxes here and in the task list together.

## 1. Goal and definition of done

The Inbox is **shippable** when all of these are true:

1. The staging database matches the repository (gate checks G2, G3, G5 and G15 PASS).
2. Every row of the browser acceptance matrix has a passing Playwright spec, and the nightly run is green three times in a row.
3. `npm run verify:production` reports PASS for every check on **two consecutive runs at least 24 hours apart, on the exact commit that is live**. Only the Meta check (G12) may stay deferred, because launch is email first.
4. A rollback plan exists, was dry-run on staging, and names the exact flags and commands.
5. Monitoring is live (Sentry rules, `inbox-health` monitor, worker health) and a test alert reached a person.
6. The pilot rollout passes the thresholds in section 8.

## 2. Decisions already made (2026-10-17)

| Decision | Result |
|---|---|
| Spam-marked chats | The assistant does **not** reply; the quiet-lead nudge skips them (done, T8) |
| CEO, Finance, Visa | Keep read access to every conversation, no write rights; recorded in `docs/security/access-control.md` (done, T9) |
| Launch scope | **Email first.** Meta channels (WhatsApp, Messenger, Instagram) stay off by flag until G12 passes |
| Colour contrast | Not changed. Spec A6 stays failing unless you decide to accept it as a known exception (item B6) |
| Message deep link | Deferred until after launch (T11) |
| Staging backup | Taken before any migration is applied |
| Docker | Available for the clean-rebuild proof |
| Load testing (k6) | **Not used.** Existing `scripts/load/inbox-multitenant.ts` stays as the only load tool |
| Voice transcripts, autonomous replies | **Off** at launch; enabled later per agency |

## 3. Where we are

| Done | Evidence |
|---|---|
| Typecheck, production build, `npm audit` (0 vulnerabilities), lint ratchet (13 of 13), 5,778 unit tests | `2026-10-17-inbox-baseline.md` |
| 22 findings of the 5 Oct security audit fixed | `2026-10-05-inbox-security-and-bug-audit.md` and git history |
| Bulk close confirmation (T7), spam suppression (T8), read-only role record and test (T9) | commits `27583f37`, `dd877b4b`, `942a38e7` |
| Go-live gate core G1–G8, G13, G15; provider simulator; staging allow-list; `is_test` agencies | TASK-032 Status |

Not yet run or built: browser spec B5 and the 9 missing specs; the voice-transcript database test; the voice provider call; gate checks G9–G12 and G14; the nightly gate workflow; the runbook; every owner-side setup step.

## 4. Order of work

```
A Backup + compare ──▶ B Apply + fix staging ──▶ C Clean rebuild + DB tests ──▶ D Browser proof ─┐
                                                                         └──▶ E Voice (parallel) │
F Finish the gate (can start now) ─────────────────────────────────────────────────────────────┤
G Owner setup (Sentry, production, branch protection) (can start now, independent) ────────────┤
                                                                                               ▼
                                                              H Dress rehearsal ──▶ I Gate x2 ──▶ J Pilot ──▶ K Widen
```

Migrations (A–C) are strictly sequential. F and G do not wait for anything.

---

## 5. The checklist

### A. Backup and comparison (nothing changes yet)

- [ ] **A1 [Y] Take a staging backup** (Supabase backup or branch) and note its time here: `__________`. Verify: you can see it in the dashboard.
- [ ] **A2 [Y] Start Docker Desktop.** Verify: `docker ps` works.
- [ ] **A3 [C+Y] T2: compare staging with the repository.** Run `npm run verify:production` against staging, read-only. Accept: a list of every unapplied migration and every drifted group in `docs/progress/2026-10-xx-staging-comparison.md`, each with its planned fix.
- [ ] **A4 [Y] Confirm which environment is staging** (project id and URL) so every later step names it. Never run these steps against the real production project.

### Checkpoint A
- [ ] Backup exists · comparison note written · you approve starting changes

### B. Apply and fix staging (one change at a time)

For each migration: rolled-back proof first, apply, run its database test, re-run the two-agency isolation spec.

- [ ] **B1 [C+Y] Apply `20270105090000_gate_snapshot`** (read-only function). Verify: G2–G5 stop failing for "snapshot missing".
- [ ] **B2 [C+Y] Apply `20270108090000_queue_counts_follow_deletes`.** Verify: queue counts equal real counts for the real agency.
- [ ] **B3 [C+Y] Apply `20270111090000_inbox_conversation_write_hardening`.** Verify: staff cannot edit reply-window columns or delete a conversation directly; sends still work.
- [ ] **B4 [C+Y] Apply `20270106090000_clean_rebuild_alignment`.** Verify: its 12 assertions pass on staging.
- [ ] **B5 [C] T4: draft additive migrations for the remaining G15 drift**, each with a database test and a documented rollback:
  - [ ] tenant uniqueness on 15 tables (`20260828090000` intent)
  - [ ] per-call row-security form on 64 tables (`20261128090000` intent), in batches
  - [ ] `set_updated_at()` hardening recorded in a migration
  - [ ] decision on 6 staging-only leftover tables and 3 functions: keep or drop (you decide, B6)
- [ ] **B6 [Y] Decide keep or drop for the staging-only leftovers.**
- [ ] **B7 [Y] Apply the B5 migrations** in the order I give, one at a time, running the test after each.
- [ ] **B8 [C] Regenerate `supabase/schema-fingerprint.json`** and commit it.

### Checkpoint B
- [ ] G15 reports zero differing and zero unknown objects on staging · G2, G3, G5 PASS · isolation spec green

### C. Clean rebuild and database tests

- [ ] **C1 [C+Y] T5: reset the local stack and apply every committed migration with no patches.** Accept: all apply cleanly; schema, buckets and cron jobs match staging by name and fingerprint; result in `docs/progress/`.
- [ ] **C2 [C+Y] T6: run every test in `supabase/tests/database/`**, including `inbox_voice_transcripts_rls.test.sql` (20 assertions). Accept: all pass, or each failure becomes a fix task.
- [ ] **C3 [C] Tick the MED-01 line in `docs/inbox/checklist.md`** once C2 passes.

### Checkpoint C
- [ ] Empty diff recorded · all database tests pass

### D. Browser proof (Playwright)

- [ ] **D1 [Y] Create the four E2E staff logins** on the rebuilt stack or staging (names in `e2e/support` and `scripts/e2e/seed-inbox-lr2-fixtures.ts`). Verify: sign-in works.
- [ ] **D2 [C+Y] Seed fixtures and run the existing 43 specs**, including the new **B5** (bulk close asks first). Accept: all pass except A6 (contrast), which is item D6.
- [ ] **D3 [C] T12a: write specs O4, C4, C6.**
- [ ] **D4 [C] T12b: write specs X3, F1, F2, F3.**
- [ ] **D5 [C] T12c: write specs F4, F5, F6.** For D3–D5, provider steps use the simulator; no real number is messaged.
- [ ] **D6 [Y] Decide on A6 (colour contrast):** accept as a known exception (I mark it in the spec and the checklist), or reopen the design question.
- [ ] **D7 [C] T13: add the nightly browser workflow** against the rebuilt database.
- [ ] **D8 [Y] Watch three consecutive green nightly runs.**

### Checkpoint D
- [ ] Every row of the TASK-030 matrix has a passing spec · results saved in `docs/progress/`

### E. Voice transcripts (parallel with D; stays off at launch)

- [ ] **E1 [Y] T14: run one real staging call** with sample audio and your provider key. Accept: transcript stored staff-only; cost and latency logged; playback still works if it fails.
- [ ] **E2 [C] Fix the provider adapter** if E1 shows a wrong request shape.
- [ ] **E3 [Y] T15: review quality and cost samples** and write the decision. Voice stays **off** by default at launch.

### F. Finish the go-live gate (can start now)

- [~] **F1 [C] T16: gate check G9 (code done 2026-10-17; database test 13/13 and baseline regenerated locally; migration `20270216090000` still to apply to staging)** — disposable `is_test` agency, signed event and duplicate, acceptance subset, teardown, proof of zero leftover rows. Verify: gate tests cover PASS, FAIL and PENDING.
- [ ] **F2 [C] T17: gate checks G10, G11, G12, G14** (Sentry received, Sentry rules, Meta live, alert delivery). Each is PENDING until its external setting exists; secrets are referenced by name only.
- [ ] **F3 [C] T17: `production-gate.yml`** nightly and on demand, with the pinned "Production gate" issue. Exit codes 0 all pass, 1 failure, 2 only pending, 3 missing setting.
- [ ] **F4 [C] T18: `docs/runbooks/production-go-live.md`** — owner steps in order, variable names (never values), how to read the gate, what each FAIL means.
- [ ] **F5 [C] T18: rollback plan** with times: flag off under 1 minute, revert and redeploy under 5, migration rollback per its file under 15.
- [ ] **F6 [C] Reconcile `docs/inbox/checklist.md`** with this file and the code.
- [ ] **F7 [Y] Dry-run the flag-off steps on staging** and confirm the runbook is followable.

### G. Owner setup (can start now)

- [ ] **G1 [Y] Branch protection:** make **"Inbox CI / inbox-ci"** a required status check in GitHub.
- [ ] **G2 [Y] T19: Sentry** — create the five alert rules and the `inbox-health` cron monitor; add a read token to GitHub secrets (name given in the runbook). Verify: G10, G11, G14 move to PASS.
- [ ] **G3 [Y] T20: production projects** — create the production Supabase and Vercel projects; set fresh variables (never reuse staging secrets; G6 compares fingerprints); apply all migrations; deploy the worker.
- [ ] **G4 [Y] Set the email channel live and the Meta channels off by flag** for the first agency. Confirm the email mailbox readiness check passes.
- [ ] **G5 [Y] T21: record the Meta decision** — G12 stays deferred; launch on email only. Submit the Meta review later, on your schedule.
- [ ] **G6 [Y] Choose the pilot agency** and a named on-call person for the first week.

### H. Dress rehearsal

- [ ] **H1 [C+Y] Run `npm run verify:production` against staging.** Accept: every check PASS except owner-dependent ones still PENDING, and each PENDING has a reason.
- [ ] **H2 [Y] Review the report** and approve moving to production.

### I. Production gate

- [ ] **I1 [C+Y] Run the gate against production.** Accept: every check PASS except G12 (deferred).
- [ ] **I2 [Y] Second run at least 24 hours after I1**, on the same live commit. Record both dates and the commit: `__________`.
- [ ] **I3 [Y] Go or no-go decision**, written here: `__________`.

### J. Pilot rollout

- [ ] **J1 [Y] Enable the Inbox for the pilot agency** with autonomous replies and voice transcripts **off**.
- [ ] **J2 [Y] Watch the first hour:** health endpoint 200, no new error types in Sentry, latency normal, logs flowing, the critical flow works by hand (receive an email, reply, assign, close).
- [ ] **J3 [Y] Hold 24 to 48 hours**, then compare against the baseline (section 8).

### K. Widen and close out

- [ ] **K1 [Y] Widen agency by agency**, repeating the J3 comparison each time.
- [ ] **K2 [Y] First-week review** of `inbox-health` alerts, error rate and customer-reported issues.
- [ ] **K3 [C] Close out:** update `docs/inbox/checklist.md`, mark TASK-032 done, write the launch note in `docs/progress/`.
- [ ] **K4 [Y] Plan the follow-up rollouts as separate decisions:** Meta channels (when G12 passes), voice transcripts, autonomous replies, message deep link (T11).

---

## 6. Risks and what to do

| Risk | Impact | Mitigation |
|---|---|---|
| A migration changes the only real agency's data or security | High | A1 backup; proof in a rolled-back transaction; one at a time; test after each; stop on any surprise |
| Rewriting 64 tables' row-security form changes who sees what | High | Batches; isolation test before and after; the two-agency spec must stay green |
| The gate passes on staging but production differs | High | Fresh production variables; G6 compares fingerprints; run the gate on production twice |
| Docker or the local stack is slow or flaky | Medium | Use `PLAYWRIGHT_SLOW_FACTOR`; retry once before diagnosing; fall back to staging runs |
| Meta approval is delayed | Medium | Email-first launch; G12 deferred, never forced to PASS |
| Voice provider rejects the audio shape | Low | Feature is off at launch; fix after |
| Docs go stale | Low | F6 reconciles; code wins; update on each merge |

## 7. Rollback plan (to be finalised in F5)

| Situation | Action | Time |
|---|---|---|
| A new feature misbehaves | Turn its flag off (Quick Chat: `QUICK_CHAT_ENABLED`; assistant: autonomy off in `management/ai-agent`; Meta channels: channel flag) | under 1 minute |
| The release is bad | Revert the release commit and redeploy | under 5 minutes |
| A migration is bad | Run that migration's documented rollback (each file states it; for write hardening: recreate the two policies, drop the trigger and function) | under 15 minutes |
| Data was written wrongly | Restore from the A1 backup only as a last resort, with your approval | per backup |

Roll back immediately on: error rate over 2x baseline, p95 latency over 50% worse, a data-integrity issue, or a security finding.

## 8. Rollout thresholds (from the shipping skill)

| Metric | Advance | Hold and investigate | Roll back |
|---|---|---|---|
| Error rate | within 10% of baseline | 10–100% above | over 2x |
| p95 latency | within 20% of baseline | 20–50% above | over 50% above |
| New client JS errors | none | under 0.1% of sessions | over 0.1% |
| Business metrics (reply times, unassigned count) | neutral or better | decline under 5% | decline over 5% |

The baseline is taken from the dress-rehearsal run (H1) and the pilot's first 24 hours.

## 9. Parked

- Colour contrast fix (reverted by request) · message deep link (T11) · Meta channels at launch · voice transcripts and autonomous replies at launch · undo for bulk close (needs a server reopen action) · load tool beyond the existing runner.

## 10. Progress log

| Date | Item | Note |
|---|---|---|
| 2026-10-17 | T1, T7, T8, T9 | done; see section 3 |
| 2026-10-17 | F1 / T16 (G9) | code, unit tests, local migration test and baseline done; migration still to apply to staging |
| 2026-10-17 | C1 (partial) | 256 migrations built a fresh local database with no errors; fingerprint matched the old baseline apart from the two new functions. Not yet recorded as the formal C1/T5 proof against staging |
| | | |
