# TASK-014 Inbox Production Readiness

## What

A prioritized go-live checklist for the Inbox + Copilot programme: what has
to close, in order, before the Inbox carries real customer traffic in
production. This is a synthesis and tracking layer, not a replacement for
[`docs/inbox/checklist.md`](../inbox/checklist.md), which remains the
authoritative, slice-by-slice source of truth for that programme (see
[`AGENTS.md`](../../AGENTS.md) § "Inbox + Copilot programme"). Where an item
here duplicates a line there, that line is quoted or linked rather than
re-tracked — ticking a box here does not tick it there, and vice versa.

## Why

As of 2026-09-27, [`docs/inbox/checklist.md`](../inbox/checklist.md) records
**0 of 33 slices** as done under its own strict rule (merged PR + measured
exit criterion). A round of characterization testing across `lib/inbox`
(send-gate, outbox drain, media intelligence, identity/lead-linking, the
Inngest functions, media ingest, and the autonomy runtime) found and fixed
seven real defects and surfaced one unresolved design question. Backend
business logic is now materially better tested, but production readiness
also depends on live measurement, browser acceptance, and UI coverage that
have not happened. This task exists so "is the Inbox ready" has one place to
check instead of being re-derived from a 33-slice tracker and a long chat
history every time someone asks.

## Data model changes

None. This task tracks verification and fixes against the existing schema;
any migration a P0/P1 item turns out to need is scoped and recorded in
`docs/inbox/checklist.md` under its own slice, not here.

## Access control changes

None planned by this task itself. The P0 entitlement-bypass item (below) may
turn into an access-control fix once triaged; if so, it is implemented and
recorded under its own PR following the standard rules (`requireUser()`,
capability check, agency scoping), and this doc is updated to link it.

## UI surfaces

None added. `app/inbox/**` is in scope only as a coverage gap (P2) — no
UI change is proposed by this task.

## Checklist

### P0 — Blockers (must close before any production traffic)

- [x] **Mutable search-path finding on `enqueue_inbox_text_message`** —
      flagged in the LR0 staging advisor baseline
      ([`2026-09-26-inbox-lr0-release-baseline.md`](../progress/2026-09-26-inbox-lr0-release-baseline.md))
      as a release blocker; migration
      `20260926070345_inbox_text_message_search_path_hardening.sql` had
      already landed on `main` but this doc had not been updated to reflect
      it. Re-verified live against staging project `klognjpwmqwlgeibvanf`
      on 2026-09-27: `pg_proc.proconfig = {search_path=""}`,
      `authenticated_exec = true`, `anon_exec = false`, and the security
      advisor's `function_search_path_mutable` list (13 findings, all
      finance/reconciliation triggers) no longer includes this function.
      **Resolved on the only Supabase project that currently exists.**
      Staging is not production — re-verify under the production
      reconciliation gate below once that project is provisioned.
- [x] **Autonomy entitlement-ceiling bypass** — in
      `lib/inbox/autonomy/runtime.ts`, the legacy WhatsApp-assistant fallback
      set `level = "L3"` *after* the entitlement-ceiling `lowerAutonomyLevel`
      step had already run, for the one narrow case where the Inbox reply
      surface is disabled, the source is `GENERATED`, the legacy assistant is
      active, and nobody has ever configured the Inbox reply surface. An
      agency on a downgraded plan (L0/L1 ceiling) in that state got L3
      automated sends regardless of its plan. Decision taken: the legacy
      switch is a stand-in for the Inbox reply surface, not a way around the
      plan's entitlement ceiling — it should never authorize more than the
      plan allows, matching every other autonomy path in this function.
      Fixed by clamping the fallback's `L3` against
      `entitlements?.autonomyCeiling ?? "L0"` with the same
      `lowerAutonomyLevel` used everywhere else in this function. Two new
      RED→GREEN tests pin the fix in `lib/inbox/autonomy/runtime.test.ts`
      ("still caps the legacy-assistant fallback at the plan's entitlement
      ceiling", "caps the legacy-assistant fallback at L0 when the agency has
      no entitlements row"); full `lib/inbox` suite (151 files, 1961 tests)
      and `npm run typecheck` both pass.
- [ ] **LR2 browser acceptance** — run the Playwright harness and the manual
      runbook ([`inbox-launch-readiness-acceptance.md`](../runbooks/inbox-launch-readiness-acceptance.md))
      against a deployed non-production environment with two agencies, three
      staff identities, and a provider test contact. Has never run against a
      real deployed candidate.
- [ ] **Confirm which build is actually deployed.** SC1 (atomic ingest), SC5
      (scoped broadcasts) and the `release_channel_job` refund fix are
      applied to staging/main but the checklist repeatedly notes the
      deployed build is unconfirmed. If an older client is live while SC5's
      triggers are active, notes and delivery ticks silently stop reaching
      open threads.
- [ ] **Production Supabase project reconciliation** — deliberately deferred
      until that project exists (LR7 gate); must happen before go-live.

### P1 — Exit criteria that need live measurement

Each of these already has code and a passing focused test suite; none has
the checklist's required staging/production measurement. Full detail and
current wording lives in `docs/inbox/checklist.md` under the cited slice —
linked here as one flat list to work through in order:

- [ ] SLA sweep and breach detection, measured end-to-end on a deployed
      schedule (MI2.6).
- [ ] Autonomy promotion/demotion observed live: L0→L1→L2 reversible,
      audited, blocked while any blocker stands (MI4.1).
- [ ] Autonomy L3 intake overnight-enquiry exit: provisional leads, correct
      queue, zero deny-list violations across a live eval run.
- [ ] Media pipeline exit: voice→summary, passport→document review,
      receipt→Finance review, proven with a live provider and live storage.
- [ ] Retention sweep: multi-batch live fault injection; dry-run counts
      matched against a live sweep.
- [ ] Channel-policy / template-sending exit: one week with no delivery
      failure attributable to a window or tag mistake, under live traffic.
- [ ] Commercial-intelligence surfaces (offer freshness, lead scoring,
      financial safety) turned on with real traffic and their exits
      measured.
- [ ] SC4–SC8 (incremental sync, scoped broadcasts, optimistic-send
      reconciliation, worker capacity, full-scale rollout): each needs the
      confirmed-deployed build plus a signed-in two-agency browser session;
      none has run.

### P2 — Test coverage (this session's work)

- [x] `lib/inbox/autonomy/send-gate.ts` — characterized (16 tests); no bugs.
- [x] `lib/inbox/risk/run.ts`, `lib/inbox/sla/policies.ts` — characterized
      (11 + 15 tests); no bugs.
- [x] `lib/inbox/outbox/drain.ts`, `lib/inbox/jobs/settle.ts` —
      characterized (44 + 17 tests); **fixed** two retryable-vs-permanent
      misclassifications (an author-less message retried instead of failing
      immediately; a policy refusal retried instead of treated as final).
- [x] `app/inbox` composer/panel optimistic-send path — extracted into
      `lib/inbox/pending-send.ts` (11 tests) and `lib/inbox/pending-messages.ts`
      (6 new tests); **fixed** a retry-of-a-failed-file-send bug that would
      have sent the "Sending …" placeholder text instead of the file.
- [x] `lib/inbox/media/passport.ts`, `lib/inbox/media/receipt.ts` —
      characterized (37 + 7 tests); **fixed** an unreadable passport expiry
      date (e.g. `31/12/2019`) silently passing as valid with no review.
- [x] `lib/inbox/routing/policy.ts` — characterized (52 tests); no bugs.
- [x] `lib/inbox/identity.ts`, `lib/inbox/lead-linking.ts` — characterized
      (33 + 41 tests); **fixed** three bugs: a partial-link state left behind
      on a mid-`attach` failure, an orphaned duplicate-risk lead left behind
      on a failed identity save for phone-less channels, and two silent
      (unchecked) history/activity insert failures.
- [x] Inngest functions (`forwarder.ts`, `reconcile-function.ts`,
      `knowledge-function.ts`, `lifecycle-functions.ts`) — characterized
      (24 + 26 tests); no bugs.
- [x] `lib/inbox/media/ingest.ts` — characterized (45 tests); **fixed** a
      mark-before-store ordering bug (a message could be read by a media
      model before it was marked sensitive) and a silent failed-job-enqueue.
- [x] `lib/inbox/autonomy/runtime.ts` — characterized (48 tests); surfaced
      the P0 entitlement-bypass item above; no fix applied pending decision.
- [ ] **`app/inbox` UI layer** — ~10,000 lines across 54 files, 2 test
      files. No component tests for the composer, workspace controller, or
      conversation panel exist because this repo has no jsdom/Testing
      Library. Largest remaining blind spot; needs a decision on whether to
      add that tooling before writing these.
- [ ] `lib/inbox/autonomy/evidence.ts` — untested; aggregates the counts
      `evaluateAutonomyPromotion` runs on (rejection rate, deny-list
      violations, triage accuracy). A miscount would silently let an agency
      promote autonomy it hasn't earned, or block one that has.
- [ ] `lib/inbox/reply-context.ts` — untested; builds the redacted context a
      reply-suggestion prompt is grounded in. Its own docstring flags this
      exact class of leak risk (a future column added without updating the
      redaction backstop).
- [ ] `lib/inbox/conversions/choices.ts` — untested; every query is
      agency-scoped by hand, which is easy to regress silently.
- [ ] Reference-numbering race in `lead-linking.ts` — two simultaneous
      first messages could allocate the same lead reference. Flagged, not
      fixed; depends on whether `leads.reference` has a unique constraint
      (not yet checked).

### P3 — Operational readiness

- [ ] `npm run lint`, `npm run typecheck`, and `npm run test` all green in
      one run on the branch that will actually deploy. Every fix above was
      verified in isolation during this session, never as one combined run.
- [ ] TASK-011 (global RPC-audit warnings) needs an owner named.
- [ ] Release-owner sign-off on the LR1 RPC audit
      ([`2026-09-26-inbox-lr1-rpc-audit.md`](../progress/2026-09-26-inbox-lr1-rpc-audit.md)).
- [ ] Runbooks (`inbox-launch-readiness-acceptance.md`, the scaling runbook)
      walked once end-to-end by someone other than the author.

### P4 — Can follow initial launch

- [ ] SC8 full-scale proof and staged production rollout.
- [ ] Dedicated worker decision for the BULK lane — currently "no dedicated
      worker yet"; the gate hasn't tripped, but the Burst load profile
      doesn't meet its SLO headroom.
- [ ] Lead/booking `CONTEXT` realtime events (SC5) — deliberately not built.

## Test plan

- P2 items are closed by writing/passing a Vitest suite for the target
  module, then a mutation check (deliberately breaking the fix or a
  neighbouring invariant, confirming the test catches it, then reverting)
  before considering the item done — see the individual commits/PRs this
  task links to for the pattern used throughout.
- P0/P1 items are closed by the live/staging measurement each one names;
  none of them is closable by another unit test.
- Before this task is marked Done, run `npm run lint`, `npm run typecheck`,
  and `npm run test` once, together, on the deploy branch (P3's first item),
  and record the result here.

## Status

In progress. P2's completed rows reflect work already merged into local
`lib/inbox` test files this session; P0/P1/P3 are all open. Do not mark this
task Done while any P0 box is unchecked.
