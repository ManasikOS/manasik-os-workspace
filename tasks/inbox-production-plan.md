# Implementation Plan: Inbox production readiness

Task list: [`tasks/inbox-production-todo.md`](./inbox-production-todo.md) · Written 2026-10-17 · Read-only planning; no code changed.
Inputs: [`docs/progress/2026-10-17-inbox-page-analysis-report.md`](../docs/progress/2026-10-17-inbox-page-analysis-report.md),
[`docs/tasks/TASK-032-inbox-production-buildout-and-go-live-gate.md`](../docs/tasks/TASK-032-inbox-production-buildout-and-go-live-gate.md)
(its Status section is the record of what is already built), `docs/inbox/checklist.md`.

> `tasks/plan.md` and `tasks/todo.md` still hold the unfinished Inngest-replacement plan (8 open tasks), so this plan uses its own
> file names, like the Quick Chat and Dashboard plans. Nothing existing was overwritten.

## Overview

The Inbox code is in good shape (2,864 unit tests pass, all 22 findings of the 5 Oct audit fixed, lint at its ceiling). What stands
between it and production is **proof and environment, not features**: staging has drifted from the migrations, a few browser specs and
gate checks are unwritten, voice transcripts are unproven, and the owner-side steps (Sentry, production project, Meta) are not done.
TASK-032 already defines the go-live gate (`npm run verify:production`, checks G1 to G15). **This plan finishes TASK-032 and adds the product
gaps the 17 Oct analysis found.** It does not add features.

Definition of "production ready" = TASK-032's final verification: **two consecutive gate runs, at least 24 hours apart, every check PASS,
on the exact commit that is live**, plus the items in Phase 2 closed or explicitly accepted by the owner.

## Corrections to the 17 Oct report

The report said browser acceptance had "never been demonstrated" and the voice RLS test was blocked. TASK-032 shows a local Docker stack
and staging runs exist (43 specs, 42 pass; contrast open). The real gaps are: **9 unwritten specs, contrast (A6), the voice RLS test and
provider call still unrun, and staging drift (G15: 99 objects differ)**. The tasks below use the TASK-032 record.

## Architecture decisions

- **Prove on a rebuilt database first, then staging, then production.** Every migration change is additive, has a rolled-back proof, and a
  pgTAP test. Staging drift is fixed by applying the repository's own migrations, never by hand edits.
- **The gate is the single source of truth for "ready".** No manual checklist replaces a gate check. Owner actions show as PENDING until
  the API reports them.
- **Email can launch first.** If Meta approval lags, go live on email with Meta channels off by flag (TASK-032 "Launch option").
- **Risky features stay off by default:** voice transcripts and autonomous replies are enabled per agency after launch, never at launch.
- **Behaviour decisions are the owner's** (spam versus assistant, read-only role visibility, bulk close). The plan makes each a small task
  with a recommended default.

## Task list (summary; details in the todo file)

### Phase 0: Re-baseline (no code)
- T1 Run typecheck, build, audit, lint, unit tests; record results
- T2 Compare staging with the repository (migrations and fingerprint); list what is unapplied

### Phase 1: Environment parity
- T3 Apply pending migrations to staging with proofs (gate snapshot, queue counts, write hardening, clean-rebuild alignment)
- T4 Fix G15 drift: tenant uniqueness, per-row RLS form on 64 tables, `set_updated_at`
- T5 Final from-scratch clean-rebuild run of the committed files
- T6 Run every pgTAP test, including the voice-transcript RLS test, on the rebuilt database

### Checkpoint A: environment matches the repository
- G2, G3, G5, G15 PASS on staging; T1 all green; the voice RLS test passes

### Phase 2: Product gaps from the analysis
- T7 Bulk close: confirmation step (and undo window if cheap)
- T8 Decide and implement: spam-marked chat versus the WhatsApp assistant
- T9 Decide and record: read-only roles (CEO, Finance, Visa) seeing all conversations
- T10 Colour contrast (spec A6) fix
- T11 Message-level deep link (`?message=`), optional

### Phase 3: Browser acceptance
- T12 Write the 9 missing specs (O4, C4, C6, X3, F1 to F6 grouped into 3 tasks)
- T13 Run the full browser suite in CI nightly against the rebuilt database; triage to green

### Checkpoint B: acceptance proven
- Every row of the TASK-030 matrix has a passing spec; results saved in `docs/progress/`

### Phase 4: Voice transcripts (can run in parallel with Phase 3)
- T14 One staging provider call with real sample audio; confirm request shape and model support
- T15 Quality and cost sample review (checkpoint P4a); decision recorded; flag stays off at launch

### Phase 5: Finish the gate
- T16 G9 disposable-agency check (S7b)
- T17 G10, G11, G12, G14 and the nightly workflow with the pinned issue (S8)
- T18 Production go-live runbook, rollback plan, checklist update (S10)

### Checkpoint C: dress rehearsal
- `npm run verify:production` on staging: everything PASS except owner-dependent PENDING (G10 to G12, G14, G7 if worker not deployed)

### Phase 6: Owner actions and launch
- T19 Sentry: five alert rules, read token in GitHub secrets
- T20 Production Supabase and Vercel projects, fresh variables, worker deployed
- T21 Meta review submission (or explicit email-first decision)
- T22 Two gate runs 24 hours apart; go or no-go
- T23 Staged rollout: pilot agency, then widen; first-hour and first-week monitoring

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Applying migrations to staging changes live data or security | High | Each is additive; rolled-back proof first; verify after; staging holds the only real agency (`royal-al-fathima`), so take a backup first |
| The per-row to per-call RLS rewrite on 64 tables changes results | High | pgTAP isolation tests before and after; apply in batches; the existing two-agency spec must stay green |
| Voice provider does not support the audio shape | Medium | Isolated in T14; feature stays off; launch not blocked |
| Meta review takes about a month | Medium | Email-first launch; G12 stays PENDING without blocking email |
| Docker Desktop not running blocks local rebuilds | Medium | Start it as a task precondition, or approve the $0.01344/hour preview branch |
| Changing spam behaviour affects customers' replies | Medium | Owner decision first (T8); small change behind the existing spam contract tests |
| Docs are stale in places | Low | T18 reconciles the checklist; code wins |

## Decisions (owner, 2026-10-17)

1. Spam-marked chats: **suppress the assistant** (T8 implements it).
2. Read-only roles (CEO, Finance, Visa): **keep full visibility, record it as intended** (T9).
3. Launch scope: **email first**; Meta channels off by flag until G12 passes.
4. A staging backup is taken before T3 and T4.
5. Docker is available for T5 and T6.
6. Message deep link (T11): **deferred** until after launch.

## Open questions (answered above; kept for the record)

1. **Spam versus assistant (T8):** should a spam-marked WhatsApp chat stop the assistant replying? Recommended: yes, suppress and log.
2. **Read-only roles (T9):** should CEO, Finance and Visa see every conversation? Recommended: keep, but record it as intended, or limit
   to linked conversations for Finance and Visa.
3. **Launch scope:** email-first while Meta is pending, or wait for all four channels?
4. **Staging backup:** can a backup or branch be taken before T3 and T4?
5. **Docker:** is Docker Desktop available for T5 and T6, or approve the preview branch cost?
6. **Message deep link (T11):** needed for launch, or after?
