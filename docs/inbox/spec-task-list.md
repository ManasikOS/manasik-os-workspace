# Manasik Inbox Spec Task List

**Plan:** [`spec-implementation-plan.md`](spec-implementation-plan.md)  
**Specification:** [`spec-plan.md`](spec-plan.md)  
**Status:** Ordered task checklist; Phase 0 / BLN-01 complete

The canonical delivery status remains [`checklist.md`](checklist.md). Check boxes here
mirror a completed task only when the corresponding evidence exists in that canonical
checklist; unchecked boxes preserve the proposed task sequence.

## Working conventions

- One task equals one PR and one demonstrable user or system outcome.
- Listed files are the expected maximum surface, not permission to edit unrelated code.
- If a task needs more than five implementation files, split it before coding.
- Every task runs its focused tests plus `npm run lint`, `npm run typecheck`, and `npm run test`.
- UI tasks also run the existing Inbox browser acceptance. Migration tasks include RLS and cross-tenant denial proof.

## Phase 0 - Baseline

### [x] BLN-01 - Lock the current capability and decision baseline

**Outcome:** Product, code, migrations, flags, and live channel behaviour agree on what already exists and what remains to build.

**Likely files (3):**

- `docs/inbox/spec-plan.md`
- `docs/inbox/implementation-plan.md`
- `docs/inbox/checklist.md`

**Acceptance criteria:**

- Existing features are marked as baseline rather than scheduled for rebuild.
- D1-D7 are accepted, changed in the spec, or explicitly deferred with an owner.
- WhatsApp, email, Messenger, Instagram, passport, receipt, and autonomy before-state evidence is linked from the programme docs.

**Verification:** documentation link check; compare checklist claims with focused existing tests and live evidence.  
**Dependencies:** none.  
**Estimated scope:** S.

**Checkpoint P0:** signed off on 2026-09-29; later tasks remain dependency-gated.

## Phase 1 - Autonomy unification

### [~] AUT-01 - Define one effective autonomy policy — implemented on `refining-inbox`, awaiting merge

**Outcome:** Every caller receives one typed effective policy derived from agency setting, entitlement ceiling, feature enablement, and safety clamps.

**Likely files (3):**

- `lib/inbox/autonomy/level.ts`
- `lib/inbox/autonomy/autonomy.test.ts`
- `lib/inbox/autonomy/legacy-authority.test.ts`

**Acceptance criteria:**

- The resolver returns level, reason codes, and limiting authority for L0-L3.
- Disabled, over-ceiling, malformed, and missing settings fail closed.
- A contract test rejects new runtime reads from the legacy authority.

**Verification:** `npm run test -- lib/inbox/autonomy/autonomy.test.ts lib/inbox/autonomy/legacy-authority.test.ts`.  
**Dependencies:** BLN-01.  
**Estimated scope:** M.

### [ ] AUT-02 - Backfill canonical agency policy with audit evidence

**Outcome:** Every agency has an explicit canonical autonomy row, including agencies previously using the compatibility fallback.

**Likely files (2):**

- `supabase/migrations/<timestamp>_inbox_autonomy_canonical_backfill.sql`
- `lib/billing/phase-5-6-migrations.test.ts`

**Acceptance criteria:**

- Backfill is deterministic, idempotent, tenant-safe, and never raises an agency above its entitlement ceiling.
- Before/after level and migration reason are auditable.
- No agency is left dependent on an implicit default.

**Verification:** migration contract tests plus staging row-count and ceiling reconciliation.  
**Dependencies:** AUT-01.  
**Estimated scope:** M.

### [ ] AUT-03 - Cut direct and outbox runtimes over to the effective policy

**Outcome:** Direct send, queued send, replay, and retry use the same autonomy result.

**Likely files (5):**

- `lib/inbox/autonomy/runtime.ts`
- `lib/inbox/autonomy/runtime.test.ts`
- `lib/inbox/autonomy/send-gate.ts`
- `lib/inbox/autonomy/send-gate.test.ts`
- `lib/inbox/autonomy/legacy-authority.test.ts`

**Acceptance criteria:**

- Equivalent input produces the same L0-L3 decision on every execution path.
- Missing or invalid policy fails to human review rather than autonomous send.
- Logs/audit evidence identify policy level and clamp reason without storing sensitive message content.

**Verification:** focused runtime/send-gate tests and a direct-versus-outbox staging replay.  
**Dependencies:** AUT-02.  
**Estimated scope:** M.

**Checkpoint P1a:** demonstrate parity and fallback removal before changing Admin UI.

### [ ] AUT-04 - Show the effective hierarchy in Admin

**Outcome:** ADMIN/CEO can see configured level, entitlement ceiling, effective level, and why the effective level is lower.

**Likely files (4):**

- `app/(main)/management/ai-agent/inbox-autonomy-control.tsx`
- `app/(main)/management/ai-agent/actions.ts`
- `lib/inbox/autonomy/labels.ts`
- `lib/inbox/autonomy/labels.test.ts`

**Acceptance criteria:**

- The control uses clear L0-L3 labels and explains every clamp.
- Updates require authorised actor, Zod-valid input, and a reason.
- A successful change displays the persisted effective result rather than an optimistic value.

**Verification:** label/action tests and browser acceptance as ADMIN and unauthorised staff.  
**Dependencies:** AUT-03.  
**Estimated scope:** M.

### [ ] AUT-05 - Remove the misleading failed-turn setting

**Outcome:** UI, validation, persistence, and documentation consistently describe immediate deterministic handoff on failure.

**Likely files (5):**

- `app/(main)/management/ai-agent/followup-settings-form.tsx`
- `app/(main)/management/ai-agent/actions.ts`
- `supabase/migrations/<timestamp>_remove_ai_failed_turn_setting.sql`
- `lib/inbox/autonomy/intake-flow.test.ts`
- `docs/inbox/architecture.md`

**Acceptance criteria:**

- No active UI or runtime path reads or writes `escalate_after_failed_turns`.
- Failure still hands off immediately, with a passing regression test.
- Migration is backward-safe and architecture wording matches runtime behaviour.

**Verification:** repository search, focused handoff tests, migration contract test, full quality gates.  
**Dependencies:** AUT-04.  
**Estimated scope:** S.

**Checkpoint P1:** autonomy-unification exit criterion is proven before bounded-autonomy rollout work.

## Phase 2 - Staff action surface

### [~] STF-01 - Expose one recommended next action — implemented in managed worktree `inbox-stf-01`, awaiting merge

**Outcome:** The selected conversation presents one deterministic action with reason, urgency, and a safe destination.

**Likely files (4):**

- `lib/inbox/next-best-action.ts`
- `lib/inbox/next-best-action.test.ts`
- `app/inbox/components/recommended-next-action-card.tsx`
- `app/inbox/components/customer-context-panel.tsx`

**Acceptance criteria:**

- Each supported scenario resolves to at most one primary action and a stable reason code.
- The button routes to an existing safe workflow; unavailable actions explain why.
- Risk, payment, and passport actions never bypass their existing review boundaries.

**Verification:** decision-table unit tests and browser acceptance across representative conversations.  
**Dependencies:** BLN-01.  
**Estimated scope:** M.

### [ ] STF-02 - Make Copilot loading, empty, stale, and error states actionable

**Outcome:** Staff are never blocked by an ambiguous AI panel.

**Likely files (4):**

- `lib/inbox/intelligence/rail-view.ts`
- `lib/inbox/intelligence/rail-view.test.ts`
- `app/inbox/components/conversation-intelligence-rail.tsx`
- `app/inbox/components/inbox-copilot.tsx`

**Acceptance criteria:**

- Every state has plain-language status and an allowed next step.
- Retry/refresh is permission-safe and does not duplicate a job.
- AI unavailability never blocks manual reply, ownership, or routing work.

**Verification:** focused rail tests plus browser error/loading simulation.  
**Dependencies:** STF-01.  
**Estimated scope:** S.

### [ ] STF-03 - Expand lead completeness to eight sourced facts

**Outcome:** Readiness covers journey, dates, contact, package, travellers, room, origin, and passport readiness with evidence state.

**Likely files (3):**

- `lib/inbox/lead-completeness.ts`
- `lib/inbox/lead-completeness.test.ts`
- `lib/data/conversation-intelligence-repository.ts`

**Acceptance criteria:**

- Each fact is `confirmed`, `customer-stated`, `inferred`, or `missing` and carries a source reference where available.
- Inferred values do not satisfy proposal readiness.
- Missing-fact prompts are deterministic and never ask for an already confirmed fact.

**Verification:** fact-state decision table and repository projection tests.  
**Dependencies:** STF-01 and D4.  
**Estimated scope:** M.

**Checkpoint P2a:** verify action selection and completeness rules before adding draft provenance.

### [ ] STF-04 - Show the exact facts used by a suggested draft

**Outcome:** Staff can inspect the verified inputs behind a proposed reply before sending.

**Likely files (5):**

- `lib/inbox/reply-pack.ts`
- `lib/inbox/reply-pack.test.ts`
- `lib/inbox/reply-pack-loader.ts`
- `app/inbox/components/lead-completeness-block.tsx`
- `app/inbox/components/conversation-panel.tsx`

**Acceptance criteria:**

- Reply packs carry source IDs and evidence state for every customer fact used.
- UI distinguishes verified/customer-stated facts from inferred suggestions.
- Stale or superseded facts force regeneration or explicit staff review.

**Verification:** reply-pack tests and a browser scenario with mixed evidence states.  
**Dependencies:** STF-03.  
**Estimated scope:** M.

### [ ] STF-05 - Build the My Shift projection

**Outcome:** Staff receive agency-scoped counts for assigned unread, SLA risk, drafts awaiting review, and follow-ups due.

**Likely files (4):**

- `lib/data/inbox-my-shift-repository.ts`
- `lib/data/inbox-my-shift-repository.test.ts`
- `lib/inbox/my-shift.ts`
- `lib/inbox/my-shift.test.ts`

**Acceptance criteria:**

- Counts and drill-down filters share the same query contract.
- Staff see only work visible to their role and assignment scope.
- Empty and degraded-source states are explicit rather than silently zero.

**Verification:** repository tenant/role tests and count-to-filter reconciliation.  
**Dependencies:** STF-02 and D5.  
**Estimated scope:** M.

### [ ] STF-06 - Add My Shift landing and exact drill-down

**Outcome:** Staff can start from a concise shift summary and open the exact underlying Inbox rows.

**Likely files (4):**

- `app/inbox/components/my-shift-summary.tsx`
- `app/inbox/components/inbox-view-rail.tsx`
- `app/inbox/page.tsx`
- `app/inbox/inbox-acceptance.spec.ts`

**Acceptance criteria:**

- Each count opens the matching queue/filter without count drift.
- Staff default follows D5; ADMIN/CEO retain their agreed default.
- The surface is keyboard accessible and communicates zero/degraded states clearly.

**Verification:** browser acceptance for staff, ADMIN, and an empty agency.  
**Dependencies:** STF-05.  
**Estimated scope:** M.

**Checkpoint P2:** complete an observed staff workflow from My Shift to a safe recommended action and reviewed draft.

## Phase 3 - Finance evidence

### [x] FIN-01 - Create tenant-safe Finance evidence intake — merged in PR #167

**Outcome:** A private, auditable evidence record can reference a source conversation, message, and attachment without becoming payment truth.

**Likely files (2):**

- `supabase/migrations/<timestamp>_finance_evidence_intake.sql`
- `lib/finance/finance-evidence-migration.test.ts`

**Acceptance criteria:**

- Table, indexes, private Storage policy, and RLS are created together and agency-scoped.
- A source attachment has an idempotency constraint; evidence status is separate from payment status.
- Unauthorised and cross-agency selects/inserts/updates are denied.

**Verification:** migration contract and live RLS denial tests.  
**Dependencies:** BLN-01 and D2.  
**Estimated scope:** M.

### [x] FIN-02 - Add the idempotent evidence intake command — merged in PR #168

**Outcome:** An authorised user can copy a receipt into Finance intake and repeated requests return the same evidence record.

**Likely files (5):**

- `lib/finance/finance-evidence.ts`
- `lib/finance/finance-evidence.test.ts`
- `lib/data/finance-evidence-repository.ts`
- `lib/data/finance-evidence-repository.test.ts`
- `app/inbox/actions.ts`

**Acceptance criteria:**

- Action begins with `requireUser()`, validates with Zod, checks D1 capability, and scopes every operation to the caller's agency.
- Copying does not insert, update, verify, or reconcile a payment.
- Retry/concurrency returns one evidence item and one audit trail.

**Verification:** permission, concurrency, cross-tenant, and no-payment-mutation tests.  
**Dependencies:** FIN-01 and D1.  
**Estimated scope:** M.

### [ ] FIN-03 - Add receipt promotion status to Inbox

**Outcome:** Eligible receipt cards offer `Copy to Finance`; completed or denied states are unambiguous.

**Likely files (3):**

- `app/inbox/components/conversation-panel.tsx`
- `app/inbox/components/receipt-finance-action.tsx`
- `lib/inbox/media/receipt.test.ts`

**Acceptance criteria:**

- The action appears only for supported receipt media and authorised users.
- Success links to the Finance evidence item and repeat clicks do not duplicate it.
- The copy states plainly that no payment was created or verified.

**Verification:** component/browser tests for allowed, denied, duplicate, and error states.  
**Dependencies:** FIN-02.  
**Estimated scope:** S.

**Checkpoint P3a:** demonstrate receipt-to-intake with payments unchanged before building Finance matching.

### [ ] FIN-04 - Build deterministic Finance evidence matching

**Outcome:** Finance can list unmatched evidence and see deterministic candidate payments/bookings without automatic mutation.

**Likely files (4):**

- `lib/finance/evidence-matching.ts`
- `lib/finance/evidence-matching.test.ts`
- `lib/data/finance-evidence-repository.ts`
- `lib/data/finance-evidence-repository.test.ts`

**Acceptance criteria:**

- Candidate ranking uses explicit identifiers/amount/date/customer evidence and exposes reason codes.
- No candidate is auto-applied; ambiguous evidence remains unmatched.
- Results are agency-scoped and omit data the viewer cannot access.

**Verification:** deterministic candidate matrix, tenant isolation, and ambiguity tests.  
**Dependencies:** FIN-02.  
**Estimated scope:** M.

### [ ] FIN-05 - Add Finance intake review UI

**Outcome:** Finance can review, match, reject, or leave evidence pending and can return to the source message.

**Likely files (5):**

- `app/(main)/finance/payments/components/finance-evidence-intake.tsx`
- `app/(main)/finance/payments/components/finance-workspace.tsx`
- `app/(main)/finance/payments/actions.ts`
- `lib/finance/workspace-navigation.ts`
- `lib/finance/workspace-navigation.test.ts`

**Acceptance criteria:**

- Only authorised roles can open and act on intake records.
- Match/reject is audited and never silently changes payment verification state.
- Source link opens the exact permitted Inbox conversation/message.

**Verification:** action tests, navigation tests, and end-to-end allowed/denied review flows.  
**Dependencies:** FIN-04.  
**Estimated scope:** M.

**Checkpoint P3:** prove Storage/RLS/idempotency/no-payment-mutation and source-link behaviour in a staging agency.

## Phase 4 - Media routing

### [ ] MED-01 - Add transcript job and result persistence

**Outcome:** Voice transcription has explicit lifecycle, attribution, confidence, retention, and tenant boundaries.

**Likely files (2):**

- `supabase/migrations/<timestamp>_inbox_voice_transcripts.sql`
- `lib/inbox/media/voice-transcript-migration.test.ts`

**Acceptance criteria:**

- Schema records source attachment, status, language, provider/model, confidence, and timestamps.
- RLS denies cross-agency access; retention follows the source message unless legal hold applies.
- Transcript text is labelled non-authoritative and is not written into the customer message body.

**Verification:** migration contract and live RLS tests.  
**Dependencies:** BLN-01.  
**Estimated scope:** M.

### [ ] MED-02 - Process voice transcription asynchronously

**Outcome:** Eligible voice attachments produce a staff-only transcript without blocking message ingestion or playback.

**Likely files (5):**

- `lib/inbox/media/voice-transcript.ts`
- `lib/inbox/media/voice-transcript.test.ts`
- `lib/inbox/media/voice-transcript-worker.ts`
- `lib/inbox/media/voice-transcript-worker.test.ts`
- `lib/metrics/inbox-intelligence-metrics.ts`

**Acceptance criteria:**

- Worker checks entitlement, media limits, supported format, and D3 language/confidence rules before provider use.
- Retries are idempotent and terminal failure preserves playback/download.
- Duration, cost, latency, success, and failure reason are observable without exposing transcript content in logs.

**Verification:** worker success/retry/quota/unsupported/provider-failure tests.  
**Dependencies:** MED-01 and D3.  
**Estimated scope:** M.

### [ ] MED-03 - Show transcript status and playback fallback

**Outcome:** Staff can read a clearly attributed transcript when available and always retain original audio controls.

**Likely files (4):**

- `app/inbox/components/voice-transcript-panel.tsx`
- `app/inbox/components/conversation-panel.tsx`
- `lib/data/inbox-repository.ts`
- `lib/inbox/media/voice-transcript.test.ts`

**Acceptance criteria:**

- Pending, complete, low-confidence, failed, and disabled states are understandable.
- Original playback remains available in every state.
- Transcript is staff-only, non-authoritative, and excluded from outbound reply unless staff explicitly uses it.

**Verification:** component/browser state matrix and role-scoped repository test.  
**Dependencies:** MED-02.  
**Estimated scope:** S.

**Checkpoint P4a:** review transcript quality and cost samples before enabling by default.

### [ ] MED-04 - Route brochure and other supported media

**Outcome:** Media cards offer explicit safe destinations such as proposal collateral, Documents, or Finance intake.

**Likely files (5):**

- `lib/inbox/media/context.ts`
- `lib/inbox/media/context.test.ts`
- `app/inbox/vault-actions.ts`
- `app/inbox/components/media-routing-actions.tsx`
- `app/(main)/departure-groups/[groupId]/brochure-actions.ts`

**Acceptance criteria:**

- Routing options derive from media type, role capability, and linked record context.
- Brochure routing does not publish or send collateral automatically.
- Unsupported Office/text files retain manual download/preview with a clear limitation.

**Verification:** media routing decision table and browser tests for allowed/denied destinations.  
**Dependencies:** FIN-02 where Finance is a destination.  
**Estimated scope:** M.

**Checkpoint P4:** all supported media has a safe action and a functional fallback.

## Phase 5 - Productivity controls

### [ ] PRD-01 - Centralise shortcut definitions and focus guards

**Outcome:** A single registry defines keys, availability, labels, and text-entry exclusions.

**Likely files (3):**

- `lib/inbox/keyboard-shortcuts.ts`
- `lib/inbox/keyboard-shortcuts.test.ts`
- `app/inbox/components/conversation-panel.tsx`

**Acceptance criteria:**

- Registry covers existing J/K and `/` plus r, n, a, e, b, q, gd, Escape, and `?`.
- Commands are ignored in editable controls unless explicitly allowed.
- Duplicate/colliding bindings fail a unit test.

**Verification:** focused registry, sequence, and focus-context tests.  
**Dependencies:** STF-02.  
**Estimated scope:** S.

### [ ] PRD-02 - Wire shortcuts and add discoverable help

**Outcome:** Staff can execute the supported commands and open an accessible help overlay.

**Likely files (4):**

- `app/inbox/components/inbox-shortcut-provider.tsx`
- `app/inbox/components/inbox-shortcut-help.tsx`
- `app/inbox/components/conversation-panel.tsx`
- `app/inbox/components/inbox-view-rail.tsx`

**Acceptance criteria:**

- Each command respects the same permissions and disabled states as its visible control.
- `?` opens a keyboard-accessible help overlay; Escape closes the topmost transient surface.
- Multi-key `gd` cannot fire while typing or after its sequence timeout.

**Verification:** browser keyboard acceptance including screen-reader labels and focus restoration.  
**Dependencies:** PRD-01.  
**Estimated scope:** M.

### [ ] PRD-03 - Extend bulk actions only with safe operations

**Outcome:** Bulk `mark spam` is supported; tag changes remain deferred unless D6 supplies a governed taxonomy.

**Likely files (4):**

- `lib/inbox/bulk-actions.ts`
- `lib/inbox/bulk-actions.test.ts`
- `app/inbox/components/bulk-selection-bar.tsx`
- `app/inbox/actions.ts`

**Acceptance criteria:**

- Every selected conversation is permission-checked and agency-scoped before mutation.
- Partial authorisation fails closed with no partial mutation.
- Bulk sends, payment changes, document verification, and AI review resolution remain impossible.

**Verification:** mixed-permission, cross-tenant, concurrency, and browser confirmation tests.  
**Dependencies:** PRD-02 and D6.  
**Estimated scope:** M.

**Checkpoint P5:** accessibility and safety review for all keyboard and bulk flows.

## Phase 6 - Outcomes and guidance

### [ ] OUT-01 - Define reconciled outcome metric contracts

**Outcome:** Operational, commercial, safety, and AI quality/cost metrics have named numerators, denominators, windows, and drill-down filters.

**Likely files (5):**

- `lib/metrics/inbox-outcomes.ts`
- `lib/metrics/inbox-outcomes.test.ts`
- `lib/metrics/registry.ts`
- `lib/metrics/registry.test.ts`
- `lib/data/inbox-commercial-repository.ts`

**Acceptance criteria:**

- Each metric declares source tables, tenant scope, time basis, exclusions, and exact drill-down.
- Cost and quality metrics do not expose message content or sensitive document fields.
- Metric totals reconcile to source rows for seeded agencies.

**Verification:** seeded reconciliation, zero-denominator, timezone, and cross-tenant tests.  
**Dependencies:** AUT-05, STF-06, FIN-05, MED-04, PRD-03.  
**Estimated scope:** M.

### [ ] OUT-02 - Add role-safe outcome cards and exact drill-down

**Outcome:** Managers can understand outcomes while staff see only metrics relevant and permitted for their role.

**Likely files (4):**

- `app/inbox/components/inbox-outcome-metrics.tsx`
- `app/inbox/components/inbox-view-rail.tsx`
- `lib/data/inbox-commercial-repository.ts`
- `lib/data/inbox-commercial-repository.test.ts`

**Acceptance criteria:**

- Every displayed count opens the exact permitted source rows.
- Finance, sensitive document, and cross-branch data remain capability-scoped.
- Empty, delayed, and partial metric states are explicit.

**Verification:** role matrix, count-to-row reconciliation, and browser drill-down tests.  
**Dependencies:** OUT-01.  
**Estimated scope:** M.

### [ ] OUT-03 - Publish role guidance and collect release proof

**Outcome:** Staff, managers, admins, and Finance have concise operating guidance backed by measured acceptance evidence.

**Likely files (5):**

- `docs/usages/inbox/usage-guide.md`
- `docs/inbox/staff-guide.md`
- `docs/inbox/admin-guide.md`
- `docs/inbox/finance-evidence-guide.md`
- `docs/inbox/checklist.md`

**Acceptance criteria:**

- Guidance explains daily use, boundaries, recovery paths, and expected outcomes by role.
- Release evidence links one week of reconciled metrics, risk samples, channel proof, and rollback drill.
- Canonical checklist ticks only demonstrably completed and merged work.

**Verification:** role-based documentation walkthrough, link check, and programme exit-criterion review.  
**Dependencies:** OUT-02.  
**Estimated scope:** M.

**Checkpoint P6:** approve or reject measured assisted operation and bounded-autonomy pilot separately.

## Phase 7 - Guide pilot decision

### [ ] GDE-00 - Write a separate Guide group-support specification

**Outcome:** Guide Inbox access has its own approval boundary, data model, threat model, operational window, and implementation tasks.

**Likely files (2):**

- `docs/inbox/guide-group-support-spec.md`
- `docs/inbox/checklist.md`

**Acceptance criteria:**

- Scope is limited to assigned groups and an explicit pre/post-departure window.
- Specification proves how finance, passport, unrelated conversations, and cross-group data are excluded.
- No implementation begins until product, security, and operations approve the separate plan.

**Verification:** architecture/security review with explicit cross-group denial scenarios.  
**Dependencies:** OUT-03 and D7.  
**Estimated scope:** S.

**Checkpoint P7:** human approval is required before creating any Guide implementation task.

