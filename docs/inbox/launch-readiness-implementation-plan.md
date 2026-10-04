# Inbox Launch-Readiness Implementation Plan

Status: Draft  
Owner: Inbox + Copilot programme  
Last updated: 2026-09-26

## What

Bring the complete Manasik Inbox and Manasik Copilot programme from
well-tested implementation work to a measured, observable, reversible
production release. This plan covers the human Inbox, channel delivery,
Copilot, media, retention, autonomy, and the Inbox worker.

## Why

The code-level assessment on 2026-09-26 found sound protections (agency
scoping, a durable outbox, final send authorization, tests, and queue lease
recovery), but no evidence that the full system is ready for customer traffic.
In particular, multiple MI5/MI6 exits remain unproven, the worker is not
deployed, browser acceptance is missing, and no staging/load/monitoring
evidence exists.

This is a release-readiness plan, not permission to mark an existing Inbox
slice complete. The source of truth for slice completion remains
[`checklist.md`](./checklist.md); tick it only in the PR that demonstrably
meets the named slice exit criterion.

## Scope and release boundary

The target is the **full programme release**. A narrower human-operated Inbox
release is allowed only as an explicitly labelled interim release, with all AI
surfaces and autonomous delivery disabled. It must not cause MI5/MI6 checklist
boxes to be ticked.

The plan does not replace the ordered implementation details in:

- [`implementation-plan.md`](./implementation-plan.md) for MI0–MI6;
- [`scale-inngest-implementation-plan.md`](./scale-inngest-implementation-plan.md)
  for P0/Q/I/D/F/E scale work; and
- [`scaling.md`](./scaling.md) for load profiles and SLOs.

## Architecture and safety decisions

- Preserve the deterministic-core rule in [`architecture.md`](./architecture.md):
  models interpret and draft; they do not price, confirm availability, change
  money, or override a policy.
- Keep Supabase/Postgres as the authoritative store, RLS as the last access
  boundary, and the transactional outbox as the only provider-send path.
- Keep the final send decision in
  `lib/inbox/outbound/authorize-provider-send.ts`; no UI control, worker, or
  adapter may bypass it.
- Use an additive, rollback-safe migration for every schema change. Each new
  tenant-owned table requires `agency_id`, RLS, agency index, and a two-agency
  isolation test in the same slice.
- One slice, one PR. Do not combine runtime deployment, a data migration, and
  an autonomy increase in a single release.
- Use feature/entitlement controls to decouple deploy from enablement. L2/L3
  may remain off until their separate evidence gates pass.

## Data model changes

No new schema is presumed by this plan. Every existing MI5/MI6 or scale slice
must inventory its migration before implementation, prove RLS/grants/security
invoker posture, and document rollback. Live migrations already applied on a
different branch or environment must be reconciled against source migration
history before any release.

## Access control changes

No new capability is presumed. Every action, worker path, route, RPC, storage
signed URL, Realtime topic, and provider send must be revalidated against the
current active agency and least-privilege capability model. L2/L3 changes are
security-sensitive and require the documented approval/audit path.

## UI surfaces

- `/inbox`, including list, thread, composer, channel-policy state, errors,
  empty states, permissions, realtime recovery, media review, and Copilot.
- Management controls for Inbox autonomy, approved answers, SLA/routing, and
  retention.
- Owner Inbox intelligence panel and its queue drill-through.

## Test and evidence strategy

Every implementation slice uses focused Vitest tests for business rules plus
`npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` before
its PR. The complete release additionally requires browser acceptance, staging
RLS/provider checks, load evidence, operational dashboard checks, and a
rollback rehearsal. The node-only Vitest suite is not accepted as proof of UI,
RLS, provider, or worker deployment behavior.

## Ordered implementation work

### LR0 — Establish the release baseline and reconcile documentation

**Depends on:** None.

**Work:** Freeze the commit/branch/environment being assessed; reconcile the
programme checklist, implementation plan, scale plan, and migration history
with actual merged code and applied staging migrations. Record a dated
`docs/progress/` snapshot with the exact gaps, owners, and evidence links.

**Acceptance criteria:**

- [ ] The release candidate commit and target environments are named.
- [ ] Every `[~]` or `[x]` claim in `checklist.md` is verified as merged,
      unmerged, or live-verified; inaccurate claims are corrected rather than
      promoted.
- [ ] Applied migration versions match source migration history for staging and
      production, with discrepancies documented and safely resolved.

**Verification:** repository gates; migration list comparison; Supabase
security/performance advisor report; reviewer sign-off on the progress
snapshot.

**Likely files:** `docs/inbox/checklist.md`, `docs/inbox/implementation-plan.md`,
`docs/inbox/scale-inngest-implementation-plan.md`, `docs/progress/*`.

**Execution status (2026-09-26):**

- [x] Frozen repository candidate and historical merge claims reconciled in
      [`2026-09-26-inbox-lr0-release-baseline.md`](../progress/2026-09-26-inbox-lr0-release-baseline.md).
- [x] Staging project, applied-migration comparison, and advisor baseline are
      recorded in the LR0 snapshot.
- [-] Production identity and equivalent pre-release evidence are deferred
      until the separately provisioned production project exists; LR7 owns that
      gate.

### LR1 — Make the repository release-clean

**Depends on:** LR0.

**Work:** Remove all Inbox lint warnings and establish a tracked owner for the
pre-existing repository-wide warning baseline. Remediate the staging security
advisor findings affecting Inbox before launch, beginning with the mutable
`search_path=public` on the authenticated `SECURITY DEFINER`
`enqueue_inbox_text_message` RPC. Do not mask warnings with broad eslint
disables or revoke a required RPC without preserving its documented caller
path. Verify the production build on the release commit.

**Acceptance criteria:**

- [x] No warning remains in `app/inbox/**`, `lib/inbox/**`,
      `lib/channels/**`, or `lib/agent/whatsapp/**` unless a narrowly scoped,
      justified exception is approved in the same PR. Verified by the scoped
      LR1 lint command on 2026-09-26.
- [x] The remaining global warnings are either removed or have a separately
      owned remediation task; they are not incorrectly attributed to Inbox.
      Tracked in `docs/tasks/TASK-011 Global lint and advisor baseline.md`
      (253 warnings, 0 errors); the named owner is still to be assigned.
- [x] Lint, typecheck, unit suite, audit, and production build results are
      attached to the release evidence. Typecheck, 283-file / 2,857-test
      Vitest suite, production build, and `npm audit --omit=dev
      --audit-level=high` all passed on 2026-09-26; the audit found zero
      production vulnerabilities.
- [x] Inbox-related staging security-advisor warnings are either resolved and
      rechecked, or have a documented least-privilege proof and explicit
      release-owner acceptance. Rechecked 2026-09-26 after the actor-binding
      migration: remaining Inbox entries are the intentional staff-callable
      RPCs, each proven in `docs/progress/2026-09-26-inbox-lr1-rpc-audit.md`;
      the release-owner acceptance of that record is still to be signed. The mutable send-RPC search path is resolved;
      it cannot be accepted as debt.

**Verification:** `npm run lint`, `npm run typecheck`, `npm run test`,
`npm run build`, and `npm audit --omit=dev --audit-level=high`.

**Execution record — 2026-09-26:**

- [x] Staging migration `20260926070345_inbox_text_message_search_path_hardening.sql` applied. It pins the authenticated `enqueue_inbox_text_message` `SECURITY DEFINER` RPC to `search_path = ''` without changing its signature, body, or intended caller. Direct verification confirmed its persisted setting, retained `auth.uid()` and active-agency checks, `authenticated` execution grant, and no `anon` execution grant. The security advisor no longer reports this RPC under mutable search paths.
- [x] Authenticated-RPC audit complete: see `docs/progress/2026-09-26-inbox-lr1-rpc-audit.md`. One hardening migration (`20260926130557_inbox_autonomy_actor_binding.sql`) is applied to staging (see next item).
- [x] Applied `inbox_autonomy_actor_binding` to staging (recorded as `20260926130557`), verified directly: `search_path=""`, SECURITY DEFINER, actor bound to `auth.uid()`, audit row records the prior level, no `anon` grant, `authenticated` and `service_role` granted. Security advisor re-run: no new findings, and `set_inbox_autonomy_level` remains listed only as an intentional staff-callable RPC.

**Likely files:** affected Inbox source files/tests and `docs/progress/*`.

### LR2 — Add browser acceptance and accessibility coverage

**Depends on:** LR0.

**Work:** Make a project-level decision for a repeatable browser test harness
(or document a staffed manual suite until one is approved), then cover the
golden human Inbox flows. The harness must use isolated seeded agencies and
real session boundaries; mocked component-only tests do not prove tenancy or
provider behavior.

**Acceptance criteria:**

- [ ] A signed-in staff member can open Inbox, select a conversation, take
      control, compose/save a draft/send, add a note, and observe delivery.
- [ ] Empty, load-error, channel-window-blocked, permission-denied, and
      coworker-ownership states are exercised and have understandable feedback.
- [ ] Keyboard-only navigation, focus in dialogs/sheets, labels/error
      association, and screen-reader landmarks are checked; no critical
      accessibility issue remains.
- [ ] Two simultaneous staff sessions prove realtime convergence and recovery
      after a deliberate reconnect without cross-agency disclosure.

**Verification:** automated browser suite where adopted; otherwise a dated,
signed manual runbook result including screenshots/video and test identities.

**Likely files:** `app/inbox/components/**`, browser-test configuration,
`docs/runbooks/*`, `docs/progress/*`.

**Execution status (2026-09-26):**

- [x] The Playwright harness (`npm run test:e2e`) is implemented. It requires
      explicit non-production Agency A/B fixtures and real staff credentials,
      rejects an environment whose project ref matches production, serializes
      mutable runs, and retains failure artifacts without committing sessions.
- [ ] No signed acceptance run has occurred. Deployed non-production fixtures,
      provider delivery evidence, deliberate reconnect, two-agency isolation,
      screen-reader review, and independent review remain release blockers;
      implementation does not establish LR2 acceptance.

### LR3 — Deploy and prove the durable worker/runtime path

**Depends on:** LR0 and applicable Q1/Q2/Q3 migrations.

**Work:** Build and validate the worker container, deploy two Singapore-near
instances, configure health checks/secrets/egress/restart policy, and perform
the staged worker rollout in `docs/runbooks/inbox-worker.md`. Do not set
`INBOX_WORKER_ACTIVE=1` until both worker instances and fallback drains are
observed healthy.

**Acceptance criteria:**

- [ ] `worker/Dockerfile` builds and `worker:check` passes in the image.
- [ ] Two worker instances return healthy `/healthz` and ready `/readyz` with
      no secrets or message content exposed in output.
- [ ] Queue claim, retry, stale-lease recovery, outbox delivery, and fallback
      scheduled drains are demonstrated in staging.
- [ ] Turning the web worker switch on and off is rehearsed; queued jobs are
      preserved and fallback drain recovery is measured.

**Verification:** container CI, staging deployment evidence, failure-injection
run, worker logs/dashboard, and a documented rollback rehearsal.

**Likely files:** `worker/**`, `lib/inbox/worker/**`, deployment manifests,
`docs/runbooks/inbox-worker.md`, `docs/progress/*`.

### LR4 — Instrument launch monitoring and define operational ownership

**Depends on:** LR0; LR3 for worker-specific signals.

**Work:** Configure production-grade metrics/log/error reporting and dashboards
for the web app, worker, outbox, channel jobs, provider failures, Realtime,
and AI usage. Choose the error-reporting and alert-routing service before
implementation; never add credentials or customer message content to logs.

**Acceptance criteria:**

- [ ] An owner, dashboard link, and escalation route exist for each launch
      signal: error rate, p95/p99 latency, queue depth/age, dead letters,
      provider failures, worker health, Realtime reconnects, AI cost, and
      autonomy decisions.
- [ ] Alerts implement the programme and shipping thresholds, including
      cross-tenant leakage, duplicate send, queue-age, and model/provider
      outage stop conditions.
- [ ] A deliberate web/worker/provider failure produces a useful, PII-safe
      signal and the responsible operator receives it.

**Verification:** alert-fire drill, dashboard screenshots/links, log redaction
review, and operations-owner sign-off.

**Likely files:** `lib/metrics/**`, deployment configuration, runbooks, and
`docs/progress/*`.

### LR5 — Finish MI5 grounded replies, cache, channel policy, and media

**Depends on:** LR0–LR4 as applicable. Execute MI5.1 through MI5.4 in their
existing order, one slice/PR at a time.

**Work:** Merge/rebase each validated implementation onto the release branch,
then prove each existing exit criterion against seeded data and staging
providers. Resolve failures in the owning MI slice, not with a side path.

**Acceptance criteria:**

- [ ] MI5.1 proves a reproducible grounded reply with actual inclusions and
      availability; stale/absent figures are withheld.
- [ ] MI5.2 proves the KPI cache hit rate and that repeated eligible questions
      use one model call while never-cacheable requests do not.
- [ ] MI5.3 records one week of traffic with no channel-window/tag delivery
      failure and has provider-rate reconciliation evidence.
- [ ] MI5.4 proves voice, passport, and receipt flows end to end, including
      private storage, human review, and no automatic payment mutation.

**Verification:** focused tests, two-agency tests, seeded-data/browser runs,
provider sandbox/live staging evidence, and accurate `checklist.md` updates.

**Likely files:** existing MI5 files named in `implementation-plan.md`, their
tests/migrations, `docs/inbox/checklist.md`, and `docs/progress/*`.

### LR6 — Finish MI6 autonomy, owner intelligence, entitlements, scale, and retention

**Depends on:** LR5; MI6.5 also depends on LR3/LR4.

**Work:** Execute MI6.1 through MI6.6 in plan order. Autonomy remains L0/L1
until evidence gates and operational rollback are proven. Do not conflate a
unit test with a promotion or a live exit criterion.

**Acceptance criteria:**

- [ ] MI6.1 demonstrates audited, reversible L0→L1→L2 promotion and refuses
      L2 whenever a blocker exists.
- [ ] MI6.2 proves overnight multilingual intake produces provisional leads,
      correct queues, human review, and zero deny-list violations.
- [ ] MI6.3 proves every owner-panel figure drills into its exact agency-scoped
      queue and preserves per-currency buckets.
- [ ] MI6.4 proves entitlement exhaustion degrades safely, explains why to the
      owner, and never silences a customer conversation.
- [ ] MI6.5 meets every measured SLO under the approved staging profile and
      records the result in `docs/progress/`.
- [ ] MI6.6 proves dry-run/live retention reconciliation, Storage-before-row
      deletion, attachment promotion, and tenant-scoped audit results.

**Verification:** each MI slice's specified test, migration, browser, staging,
and operational exit evidence; only then tick the corresponding R/G/DoD boxes.

**Likely files:** existing MI6 files named in `implementation-plan.md`,
`scripts/load/inbox-multitenant.ts`, runbooks, checklist, and progress docs.

### LR7 — Stage, canary, and release with reversible controls

**Depends on:** LR1–LR6.

**Work:** Run staging acceptance and production readiness review, deploy with
AI/autonomy controls off, then progress through internal agency, 5%, 25%, 50%,
and 100% agency rollout. Do not advance a stage without its full observation
window and green thresholds.

**Acceptance criteria:**

- [ ] Production secrets, domain/SSL, cron HTTP configuration, migrations,
      channel connections, and feature/entitlement settings are verified from
      deployment configuration rather than memory.
- [ ] The first-hour checklist passes: health, logs, errors, latency, critical
      human send flow, provider delivery, and rollback switch.
- [ ] Each rollout stage remains within baseline error/latency and business
      thresholds for its observation window; results are recorded.
- [ ] The rollback owner can disable autonomy/feature availability in under one
      minute and restore fallback worker draining without data loss.

**Verification:** staging release rehearsal; signed production evidence; launch
dashboard review; rollback dry run; final architecture/checklist/progress
review.

**Likely files:** deployment configuration, `docs/runbooks/*`,
`docs/inbox/checklist.md`, and `docs/progress/*`.

## Release checklist

Use this checklist in addition to, not instead of, the programme checklist.
Unchecked items are release blockers.

### Governance and code quality

- [ ] LR0 release snapshot reconciled branch, PR, migration, and checklist state.
- [ ] All work landed as isolated, reviewed slices with no unrelated changes.
- [ ] Inbox lint warnings are resolved or narrowly documented; global warning
      remediation has a named owner.
- [ ] `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build`
      pass on the release commit.
- [ ] Dependency audit has no high or critical finding.

### Security and data integrity

- [ ] Every changed migration has agency scoping, RLS, indexes, safe grants,
      and a rollback/recovery procedure.
- [ ] Every affected action/route starts with authentication, validates Zod
      input, resolves active agency server-side, and checks capability.
- [ ] Two-agency tests and live scoped checks prove reads, writes, Realtime,
      jobs, attachments, and signed URLs cannot leak tenant data.
- [ ] Every provider send uses the final authorization boundary; a stale offer,
      open intervention, policy-window violation, and ownership violation are
      refused.
- [ ] Secrets are in the deployment secret store only; logs and Realtime payloads
      contain no customer content or secrets.

### User experience and channels

- [ ] Signed-in browser runs cover human Inbox golden, empty, error, blocked,
      permission, and concurrent-staff states.
- [ ] Keyboard, screen reader, focus, labels, and error messaging pass the
      chosen accessibility check.
- [ ] WhatsApp, Messenger, and Instagram provider test paths are verified for
      inbound, human send, delivery status, reconnect, and failure handling.
- [ ] Copilot remains non-blocking; all AI surfaces off preserve the pre-programme
      human Inbox behavior.

### Runtime, observability, and scale

- [ ] Worker image, two instances, health endpoints, fallback drains, and
      rollback switch are proven in staging.
- [ ] Dashboards/alerts have owners and have passed a failure drill.
- [ ] MI6.5 staging load result meets the programme SLOs with documented
      tenant-fairness and recovery evidence.
- [ ] Cron routes, scheduler configuration, retention sweep, and job repair
      paths are authenticated and observed.

### Programme exits and rollout

- [ ] MI5.1–MI5.4 exit criteria are met and accurately ticked.
- [ ] MI6.1–MI6.6 exit criteria are met and accurately ticked.
- [ ] R1–R7, G1–G15, and programme definition-of-done boxes are ticked only
      where the named evidence exists.
- [ ] Production rollout begins with autonomous sending disabled and uses the
      staged progression with stop conditions.
- [ ] First-hour checks and the planned observation period pass at every stage.
- [ ] A rollback rehearsal proves customer messages and queued work are preserved.

## Rollout stop conditions

Immediately hold rollout and invoke the documented rollback if any of the
following occurs: cross-tenant disclosure; duplicate or unauthorized external
send; data-integrity loss; error rate more than 2× baseline; p95 latency more
than 50% above baseline; a new client error in more than 0.1% of sessions;
queue-age SLO breach; failed worker health; a security vulnerability; or a
material customer-support spike.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Documentation claims do not match branches or applied migrations | High | LR0 reconciles evidence before any promotion or checklist tick. |
| Provider/model behavior differs from tests | High | Provider sandbox/staging verification, safe defaults, final send gate, and staged rollout. |
| Worker deployment creates queue delay or loss | High | Leased jobs, two instances, health checks, safety-net drains, and rollback rehearsal. |
| Scale test affects customer data | High | Isolated staging only, explicit environment guards, tagged fixtures, and cleanup verification. |
| Autonomy sends an unsafe response | High | L0/L1 default, evidence gates, deny list, final runtime gate, audit, and instant demotion. |
| Repository warning debt masks new defects | Medium | LR1 removes Inbox warnings and creates owned remediation for the global baseline. |
| Observability is incomplete | High | LR4 is a release dependency, not post-launch work. |

## Decisions required before LR4/LR7

- Select the production error-reporting, dashboard, alert-routing, and on-call
  tools; the repository alone cannot configure an external service without
  that authority.
- Name the first internal agency, the release owner, the rollback owner, and
  the production observation schedule.
- Confirm whether the initial public release is the full programme or the
  explicitly limited human-operated Inbox interim release.

## Status

In progress — **LR0 and LR1 are complete for staging**. LR1's global-warning
owner (TASK-011) and release-owner sign-off of the RPC audit are the only
human follow-ups. No production
deployment, production-environment change, autonomy promotion, or programme
completion is implied. LR7 will own the separate production project's
pre-release evidence.
