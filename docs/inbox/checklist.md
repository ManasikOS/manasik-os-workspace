# Manasik Inbox + Copilot — Build Checklist

The single source of truth for **what is done and what is not**. Every
slice in [`implementation-plan.md`](./implementation-plan.md) appears here
as a checkbox. The plan says *what to build*; this file says *how far we
got*.

> **Rule:** a box is ticked only when the slice's PR is **merged** and its
> exit criteria are demonstrably met — not when the code is written, not
> when the PR is open. See [`AGENTS.md`](../../AGENTS.md) § "Inbox +
> Copilot programme".

## Status legend

| Mark | Meaning |
|---|---|
| `- [ ]` | Not started |
| `- [~]` | In progress — put the branch or PR link beside it |
| `- [x]` | Merged, exit criteria met |
| `- [-]` | Deliberately skipped — say why on the line |

**Convention used while a slice is on a branch:** a deliverable box is `[x]` once the code and its tests exist and `lint` / `typecheck` / `test` are green on the branch; **Slice merged** and **Exit** stay `[~]` / `[ ]` until the PR merges and the exit criterion is measured. A migration box is `[x]` once the file exists and has been applied to the Manasik OS project and verified there (dry-run in a rolled-back transaction, then applied, then checked); the applied version numbers differ from the file names — see the Phase 0 note.

Each slice opens with a **Slice merged** box: tick it last, only once
every box beneath it is ticked and the exit criterion has actually been
measured. Keep the **Progress** table below in step with those boxes; it
is what someone reads before reading anything else.

## Progress

| Phase | Slices | Done | Status |
|---|---|---|---|
| Spec refinement Phase 0 — baseline lock | 1 | 1/1 | BLN-01 verified against repository tests and Manasik OS; D1-D7 locked; [evidence](../progress/2026-09-29-inbox-bln-01-baseline.md) |
| Spec refinement Phase 1 — autonomy unification | 5 | 0/5 | AUT-01 implemented and verified on `refining-inbox`; awaiting merge before AUT-02 |
| Spec refinement Phase 2 — staff action surface | 6 | 0/6 | STF-01 implemented and browser-verified in managed worktree `inbox-stf-01`; awaiting merge before STF-02 |
| Spec refinement Phase 3 — Finance evidence | 5 | 2/5 | FIN-01 and FIN-02 are merged; FIN-03 is in progress on `codex/inbox-fin-03`; FIN-04 is merged (PR #170); FIN-05 is merged (PR #171) with browser acceptance outstanding |
| Spec refinement Phase 4 — Media routing | 4 | 0/4 | MED-01 to MED-04 are merged (PRs #172-#175); each exit is still open pending staging and browser verification (RLS test, provider call, signed-in browser checks) |
| Spec refinement Phase 5 — Productivity controls | 3 | 0/3 | PRD-01 to PRD-03 are implemented on `codex/inbox-prd-01` / `-02` / `-03` and await merge; PRD-03's migration is applied to Manasik OS; the declared STF-02 dependency is not built |
| Spec refinement Phase 6 — Outcomes and guidance | 3 | 0/3 | OUT-01, OUT-02 and OUT-03 are in progress on `codex/inbox-out-01`, `codex/inbox-out-02` and `codex/inbox-out-03`; its declared dependencies AUT-05 and STF-06 are not built, so the metrics that depend on them are declared blocked |
| Phase 0 — measurement and contracts | 3 | 0/3 | Built, applied and verified on `transforming-inbox` — awaiting merge + deploy for the cron-fed exit measurements |
| Phase 1 — lanes and fairness | 3 | 0/3 | Built on `transforming-inbox`; MI1.1 exit measured on the live DB; MI1.2/MI1.3 exits need real handlers (MI2.4) + a deploy |
| Phase 2 — intelligence projection | 6 | 0/6 | MI2.1–MI2.4 built, applied and on `main` (MI2.4 exit unmeasured — needs the surface on and live traffic); MI2.5 on `main` (browser exit not done); MI2.6 on `main` (end-to-end exit needs the deployed sweep) |
| Phase 3 — commercial intelligence | 5 | 0/5 | MI3.1 on main (PR #130; migration applied; exit needs the surface on). MI3.2 on main (PR #131; exit needs a live group and S2 on). MI3.3 on main (PR #132; exit needs a real cross-channel contact). MI3.4 on main (PR #133; exit needs a seeded agency). MI3.5 on main (PR #134; exit needs a saved policy). Phase 3 is code-complete |
| Phase 4 — protection and continuity | 6 | 0/6 | MI4.1 on main (PR #135; exit needs live shadow traffic). MI4.2 on main (PR #136; exit needs the surface past SHADOW). MI4.3 on main (PR #137; migration applied; exit needs live shadow traffic). MI4.4 on main (PR #138; exit needs two signed-in browser sessions). MI4.5 on main (PR #139; migration applied to Manasik OS, verified by version only — exit needs a signed-in browser session and a confirmed booking). MI4.1b migration and the MI4.5 fixes are applied. MI4.6 is written (12 proposal kinds + 3 stamped flows; all sixteen of the plan's conversions covered), both migrations are applied and verified, and its code is on main (commit a84d482); its browser exit is unmeasured |
| Phase 5 — grounded replies, media, policy | 4 | 0/4 | Implemented and on main; MI5.2–MI5.4 migrations applied and verified on Manasik OS; merge and live exits pending |
| Phase 6 — autonomy, owner view, commercial | 6 | 0/6 | Implemented and on main; MI6.1/MI6.3/MI6.4/MI6.6 migrations applied and verified on Manasik OS; scale run, merge, and live exits pending |
| Scaling track | 9 | 0/9 | SC0–SC7 are built and merged into main (the `scaling-inbox` branch is an ancestor of main). Checked against the live Manasik OS database on 2026-09-25: the SC1 atomic ingest function, the SC2 message-sequence counters, the SC3 version trigger and the SC5 scoped-broadcast functions and triggers are all present — they are recorded in `schema_migrations`, but under the timestamps the Supabase tool stamped on 2026-09-25 (`20260925041420` … `20260925042011`) rather than the repository file versions (`20261202094000` … `20261203090000`) — see the Applied-version note below; this is the only difference, all 181 migration names match. Not confirmed: that main is the build currently deployed. Still open: browser acceptance, the Realtime/webhook harness and SC8, and every exit measurement |
| **Total** | **50** | **3/50** | **BLN-01, FIN-01, and FIN-02 are complete; AUT-01 and STF-01 retain their recorded merge status, and FIN-03 is in progress. Older MI exits and FIX1–FIX13 retain their existing status; FIX13 still awaits a signed-in non-production acceptance environment** |
| Email channel track | 6 | 0/6 | EM0–EM2 built and applied to Manasik OS (2026-09-28); EM3–EM5 not started, see [`email-channel-implementation-plan.md`](./email-channel-implementation-plan.md) |
| Email Trust Guardian track | 8 | 0/8 | TG0 is in progress on `fixing-existing-things` by explicit requester direction; EM3–EM5 remain incomplete prerequisites |

### Spec refinement Phase 0 — BLN-01 baseline and decision lock

- [x] **Slice complete** — repository, migrations, flags, runtime state, and available live evidence reconciled on 2026-09-29
- [x] Existing WhatsApp, Messenger, Instagram, email, passport, receipt, audio, and autonomy capabilities are baseline work, not scheduled rebuilds
- [x] D1-D7 accepted or explicitly deferred in [`spec-plan.md`](./spec-plan.md) and [`spec-implementation-plan.md`](./spec-implementation-plan.md)
- [x] Focused verification: 16 Vitest files / 223 tests passed
- [x] Full verification: lint and typecheck passed; 361 Vitest files / 3,702 tests passed
- [x] Repository and Manasik OS migration histories match exactly at 209 migrations; latest `20261219090000_tg5_delivery_status_events`
- [x] Live aggregate evidence and its limitations are recorded without customer content in [`2026-09-29-inbox-bln-01-baseline.md`](../progress/2026-09-29-inbox-bln-01-baseline.md)
- [x] `npm run lint` passes with 279 existing warnings and no errors; the Finance navigation state-reset blocker was removed without changing its URL contract
- [x] **Exit / Checkpoint P0:** engineering baseline signed off; unverified deployment/browser/provider facts are explicitly barred as assumptions for later tasks

### Spec refinement Phase 1 — autonomy unification

#### AUT-01 — one effective autonomy policy contract

- [~] **Slice merged** — implemented on `refining-inbox`; awaiting review and merge before AUT-02 starts
- [x] `resolveEffectiveAutonomyPolicy()` returns normalized policy facts, final L0-L3 level, stable reason codes/messages, and the limiting authority
- [x] Missing or malformed settings and policy facts fail closed at L0
- [x] Plan, surface, channel availability, human ownership, evidence, channel-policy, and protection-gate clamps are explicit and tested
- [x] Existing runtime behaviour is unchanged until the AUT-02 backfill and AUT-03 cutover
- [x] Contract test prevents any new production runtime from reading the legacy assistant authority
- [x] Focused verification: 2 Vitest files / 30 tests passed
- [x] Full verification: lint passed with 279 existing warnings and no errors; typecheck passed; 361 Vitest files / 3,720 tests passed
- [x] **AUT-01 exit:** the canonical additive resolver contract is complete; AUT-02 remains blocked until this slice merges

### Spec refinement Phase 2 — staff action surface

#### STF-01 — one recommended next action

- [~] **Slice merged** — implemented in managed worktree `inbox-stf-01`; awaiting review and merge before STF-02 starts
- [x] The deterministic decision table returns at most one primary action with a stable reason code, urgency, typed safe destination, and explicit availability state
- [x] Payment, complaint, visa, document, quote, changed-offer, blocked-offer, and ordinary-reply scenarios have decision-table coverage; visible interventions outrank ordinary and commercial work
- [x] `recommended-next-action-card.tsx` renders immediately below human-review cards in the customer context rail and routes only to editable drafts, draft quotes, live offer review, or the existing conversion preview workflow
- [x] Unavailable quote and conversion actions remain visible and state the exact prerequisite; the browser fixture showed `Select a departure group for this customer first.` without creating work
- [x] Payment and other consequential conversions remain behind the existing preview/confirm boundary; no recommendation sends a message, confirms money, or creates work directly
- [x] Focused verification: 13 decision-table tests passed; all six touched files pass scoped ESLint; typecheck passed
- [x] Full verification: 361 Vitest files / 3,704 tests passed; repository-wide lint reaches one pre-existing `finance-workspace.tsx` hook error on the base commit, while STF-01 files are clean
- [x] Browser acceptance: desktop context rail shows one high-urgency payment recommendation above customer details, the safe action is disabled when its prerequisite is absent, and the exact blocker is visible; pre-existing empty-avatar `src` warnings remain unrelated
- [x] **STF-01 exit:** supported scenarios have one deterministic recommendation, safe destinations preserve review boundaries, and unavailable actions explain their blocker; STF-02 remains blocked until this slice merges

### Spec refinement Phase 3 — Finance evidence

#### FIN-01 — tenant-safe Finance evidence intake

- [x] **Slice merged** — PR #167 merged as `6c6c3c991944f8e834b557378328ed434ba09f32`
- [x] `finance_evidence_intake` is separate from `payments`, carries source and optional CRM links, candidate attribution, review actors/timestamps, and permits `payment_id` only for a reviewed `MATCHED_TO_PAYMENT` state
- [x] Every tenant-owned reference uses a composite `(id, agency_id)` foreign key; `(agency_id, source_attachment_id)` is the retry/concurrency idempotency guard
- [x] D2 is encoded with required `retention_expires_at` (FIN-02 must derive it from the agency Inbox policy) plus an explicit legal-hold override; source links may detach when Inbox retention removes the original message graph
- [x] The existing `payment-proofs` bucket remains private; four agency-prefix Storage policies preserve Finance/Admin writes and Finance/Admin/CEO reads
- [x] Table grants are least-privilege, RLS is agency-scoped, CEO is read-only, and Marketing/Operations/Visa/Guide receive no direct evidence access
- [x] Focused verification: 7 Vitest migration-contract tests passed
- [x] Live non-production verification: 12 pgTAP assertions passed for same-agency access, cross-agency denial, unauthorised denial, and CEO read-only; RLS enabled, bucket private, 3 table policies, and 4 Storage policies confirmed
- [x] Migration `20261220090000_finance_evidence_intake.sql` applied to Manasik OS and recorded in migration history
- [x] Full verification: lint passed with the existing 279 warnings and no errors; typecheck passed; 363 Vitest files / 3,740 tests passed
- [x] **FIN-01 exit:** the merged evidence boundary is proven private, tenant-safe, idempotent by source attachment, and structurally unable to create or mutate payment truth

#### FIN-02 — idempotent evidence intake command

- [x] **Slice merged** — PR #168 merged as `4c09e52fe9d8bdeb5cade2b4039e291a71360cc8`
- [x] The Server Action calls `requireUser()` first, accepts only a strict attachment UUID, re-derives all source/CRM context server-side, and checks D1 using the caller's effective Inbox/Finance capabilities plus conversation assignment
- [x] Every database lookup is explicitly caller-agency scoped; the privileged client is confined to the authenticated, authorised command because D1 allows CEO/capable assigned staff while direct evidence and Storage RLS deliberately remain Finance/Admin write-only
- [x] The retained Inbox object is downloaded, checksum-verified, and uploaded to the private `payment-proofs` bucket under a deterministic agency-prefixed path before any evidence row is created
- [x] `(agency_id, source_attachment_id)` converges concurrent inserts on one evidence item; the evidence UUID is also the idempotency key for one append-only Finance audit event, and retries repair a missing audit without duplicating it
- [x] Candidate amount/reference/date remain explicitly non-authoritative model candidates; the command leaves `payment_id` null and has no payment, allocation, verification, or reconciliation mutation path
- [x] Focused verification: 2 Vitest files / 17 tests passed for permission, strict input, retention, checksum/path/size guards, concurrency/retry, tenant isolation, audit uniqueness, and payment immutability
- [x] Full verification: lint passed with the existing 279 warnings and no errors; typecheck passed; 365 Vitest files / 3,757 tests passed
- [x] **FIN-02 exit:** an authorised caller receives the same evidence id on retry/concurrency, exactly one audit trail exists, and payments remain unchanged

#### FIN-03 — Inbox receipt promotion status

- [~] **Slice merged** — implementation in progress on `codex/inbox-fin-03`; do not tick until the exit criterion is proven and merged
- [x] Eligible, Finance-supported receipt cards show `Copy to Finance` only to authorised reviewers; denied receipt cards explain that Finance review access is required without exposing the action
- [x] Ready, pending, copied, duplicate, and error states are plain and accessible; copying states that no payment is created or verified
- [x] A successful copy links to the created Finance evidence id, and repeat attempts converge on the existing item through FIN-02 idempotency
- [x] Focused verification: 3 Vitest files / 40 tests passed for supported/denied availability, completed/error settlement, evidence deep links, retry/concurrency convergence, audit uniqueness, and payment immutability
- [ ] Browser acceptance: authorised and denied receipt cards, successful deep link, repeat click, and recoverable error are demonstrated — blocked until the checked-in harness has named non-production credentials and FIN-03 receipt fixtures
- [x] Full verification: lint passed with the existing 279 warnings and no errors; typecheck passed; 365 Vitest files / 3,773 tests passed
- [ ] **FIN-03 exit:** an eligible authorised receipt can be copied once into Finance evidence, retry resolves to the same item, no payment is created or verified, and denied/failed states are unambiguous; awaiting verification and merge

#### FIN-04 — deterministic Finance evidence matching

- [x] **Slice merged** — PR #170 merged as `1989478`
- [x] `lib/finance/evidence-matching.ts` ranks existing payments against pending evidence from explicit reference, amount (±1 cent), booking/departure-group link and date signals; every candidate carries reason codes plus plain-language reasons, and a payment qualifies only when an exact reference or amount anchors it
- [x] Nothing is auto-applied: the result is typed `autoApplied: false`, ties for the top score yield `AMBIGUOUS`, and no-signal evidence yields `UNMATCHED` with a reason; reversals, voided/failed payments and payments already linked to other evidence are excluded
- [x] `listUnmatchedEvidenceWithCandidates` is read-only, denies roles outside ADMIN/CEO/FINANCE before reading, scopes every query to the caller's agency, drops any row from another agency, clamps the page size, and builds payment lookups from separate `.in()` filters so untrusted receipt text cannot alter query shape
- [x] The FIN-02 "no payment-ledger mutation" guard now permits reading `payments` for ranking but still fails on any insert/update/upsert/delete against it
- [x] Focused verification: 2 Vitest files / 29 tests passed for the candidate matrix, tolerance, reference normalisation, ambiguity, deterministic ordering, tenant isolation, role denial, linked-payment exclusion, and the read-only guard
- [x] Full verification: typecheck passed; lint clean on the four touched files; 366 Vitest files / 3,794 of 3,795 tests passed — the single failure, `lib/security/inbox-media-csp.test.ts`, also fails on unmodified `main` and is unrelated
- [x] **FIN-04 exit:** Finance can list unmatched evidence with deterministic candidates and reason codes, no candidate is auto-applied, and results are agency-scoped (consumed by FIN-05)

#### FIN-05 — Finance intake review UI

- [~] **Slice merged** — PR #171 merged as `dcb40fc`; left in flight because the browser-acceptance exit below is unproven
- [x] The Payments subview shows "Receipts waiting for Finance review" to ADMIN/CEO/FINANCE only; the FIN-03 deep link (`evidenceId`) is validated as a UUID, honoured only on the payments subview, and highlights the item (a plain note appears if it is no longer pending)
- [x] Actions `loadFinanceEvidenceIntakeAction`, `matchFinanceEvidenceAction`, `dismissFinanceEvidenceAction` call `requireUser()` first, validate with strict Zod, derive agency/actor from the session, and replace unexpected failures with plain words; CEO is read-only
- [x] Match is re-validated server-side: the payment must be a deterministic candidate for that receipt, not already linked to other evidence, and the conditional `PENDING_REVIEW` update lets only one reviewer decide; repeat identical matches are idempotent and a conflicting second decision is refused
- [x] Match/dismiss write one audit event each (deterministic id, `NOTE_ADDED`) and never insert, update, verify, or allocate a payment; dismissal requires a reason
- [x] The Inbox source link is shown only when the viewer can open the Inbox and the conversation still exists; raw conversation/message ids and the agency id never reach the browser
- [x] Focused verification: 4 new/extended Vitest files (navigation 5, matching/DTO 4, repository review 8, actions 13) passed for role denial, tenant isolation, race, idempotency, candidate enforcement, linked-payment refusal, and navigation validation
- [x] Full verification: typecheck passed; lint 0 errors (warnings only in untouched files); 367 Vitest files / 3,824 of 3,825 tests passed — the one failure, `lib/security/inbox-media-csp.test.ts`, also fails on unmodified `main`
- [ ] Browser acceptance: allowed and denied review flows, deep link, match, dismiss, and repeat click are demonstrated — blocked until the checked-in harness has named non-production credentials and a seeded evidence item
- [ ] Message-level source link: the Inbox accepts only `?conversation=`, so the link opens the conversation, not the exact message — needs an Inbox `message` parameter (separate slice)
- [ ] Receipt preview inside Finance: reviewers open the Inbox conversation to see the image; a signed-URL preview was not part of this slice
- [ ] **FIN-05 exit:** Finance can match, dismiss, or leave receipt evidence pending, every decision is audited and never changes payment verification state, and the source conversation link respects the viewer's access; awaiting browser acceptance and merge

### Spec refinement Phase 4 — Media routing

#### MED-01 — transcript job and result persistence

- [~] **Slice merged** — implementation in progress on `codex/inbox-med-01`; do not tick until the exit criterion is proven and merged
- [x] Migration `20261221090000_inbox_voice_transcripts.sql` adds `inbox_voice_transcripts`, separate from the customer message: composite agency foreign keys to the source attachment and message, one transcript per attachment (`unique (agency_id, attachment_id)`), a status lifecycle (`PENDING`, `PROCESSING`, `COMPLETE`, `LOW_CONFIDENCE`, `FAILED`, `SKIPPED`) enforced by a shape check, bounded machine failure reasons, language, provider/model, confidence, and lifecycle timestamps
- [x] Transcripts are non-authoritative by construction (`non_authoritative` is checked true) and the migration does not touch `conversation_messages`, `message_attachments`, or the legacy `message_media_analyses.transcript` column
- [x] Retention follows the source (cascade on attachment/message delete); a legal hold blocks deletion of the held row, and therefore of its source, until released
- [x] RLS: staff-only agency-scoped select for the Inbox roles; no client insert/update/delete grants — the worker (MED-02) writes with service role
- [x] Focused verification: 8 Vitest migration-contract tests passed
- [x] Migration applied to Manasik OS on 2026-10-01 at the user's request, recorded as `20261001023136_inbox_voice_transcripts` (the tool stamps its own timestamp, not the file's `20261221090000` — same note as the earlier Applied-version entries). Read-only verification: table exists with 0 rows, RLS enabled, one select policy, `authenticated` holds SELECT only, and the updated_at and legal-hold triggers are present
- [ ] Live RLS test run: `supabase/tests/database/inbox_voice_transcripts_rls.test.sql` (20 assertions: same-agency read, cross-agency denial, GUIDE denial, no client writes, constraint shape, cascade, held-row delete blocked) is written but **not run** — executing it seeds throwaway agencies/users in the shared project (inside a rolled-back transaction) and that was declined; run it on a local or branch database
- [ ] **MED-01 exit:** schema records source, status, language, provider/model, confidence and timestamps; cross-agency access is denied; retention follows the source unless a legal hold applies; transcript text is never in the customer message body — awaiting live RLS proof and merge

#### MED-02 — asynchronous voice transcription

- [~] **Slice merged** — PR #173 merged; left in flight because the staging and browser verification items below are unproven
- [x] `lib/inbox/media/voice-transcript.ts`: supported audio formats, media limits (10 MiB, 300 s), eligibility order (disabled, format, size, duration), strict model-output schema, D3 settling (English/Arabic/mixed expected; confidence below 0.70 or an unlisted language is kept but labelled `LOW_CONFIDENCE`; no speech is `NO_SPEECH`), and a dependency-free Ogg Opus duration reader so WhatsApp voice notes get a real duration limit
- [x] `generateAudioTranscript` added to the shared provider seam (`lib/ai/provider.ts`): same configuration check, budget gate and `ai_runs` metering as other surfaces; any degraded allowance state stops audio; provider errors keep only the HTTP status, never the request or reply; model `AI_TRANSCRIBE_MODEL` (default `google/gemini-3.8-flash`)
- [x] `voice-transcript-worker.ts`: idempotent claim on `(agency_id, attachment_id)` (a finished, skipped or failed note is never re-sent to the provider), entitlement and limits checked before provider use, transient failures retried and settled `FAILED` only on the final attempt, lost races are harmless, and logs carry metadata only
- [x] Default off: transcription requires the plan's media-intelligence feature **and** an explicit enabled `ai_surface_settings` row for surface `inbox_voice_transcript` (the shared budget gate treats a missing row as permissive); checkpoint P4a review is still required before enabling by default
- [x] `TRANSCRIBE_VOICE` handler runs the worker only after the original is retained and the analysis is marked ready; a retry never fails the note, and an unexpected transcription error on the final attempt is logged and swallowed so playback and download are preserved; transcript text is written only to `inbox_voice_transcripts`, never to the message or the media analysis
- [x] `loadVoiceTranscriptMetrics` reports counts by status and failure reason, success rate, audio seconds, AI runs, cost and mean latency, selecting metadata columns only
- [x] Focused verification: 5 new/extended test files (rules 20, provider 9, worker 14, handlers 11, metrics 20) passed
- [x] Full verification: typecheck passed; lint 0 errors on touched paths; 371 Vitest files / 3,885 of 3,886 tests passed — the one failure, `lib/security/inbox-media-csp.test.ts`, also fails on unmodified `main`
- [ ] Live provider verification: the OpenRouter `input_audio` request shape and the chosen model's audio support are unproven against a real provider (no key or sample audio was used) — needs a staging call before relying on it
- [ ] Persistence verification: the Supabase store (upsert/optimistic claim) is covered by the in-memory worker test only; it needs the MED-01 table plus a staging run, which also depends on the unrun MED-01 RLS test
- [ ] **MED-02 exit:** eligible voice notes produce a staff-only transcript without blocking ingestion or playback; retries are idempotent; terminal failure preserves playback/download; duration, cost, latency, success and failure reason are observable without transcript content — awaiting a staging run and merge

#### MED-03 — transcript status and playback fallback

- [~] **Slice merged** — PR #174 merged; left in flight because the staging and browser verification items below are unproven
- [x] `toVoiceTranscriptView` turns a stored transcript into one of five understandable states — transcribing, complete, low confidence, failed, unavailable (disabled, allowance used up, format, too long, too large) — in plain words with no raw reason codes; every state says the original voice note remains playable
- [x] `app/inbox/components/voice-transcript-panel.tsx` shows the transcript under the customer's voice bubble, never in place of the audio player (which is untouched), labelled "Staff only" and as a machine aid, with a low-confidence badge, language label, `dir="auto"` for Arabic, and a bounded poll while pending (no new realtime trigger was added)
- [x] Staff-only and non-authoritative: the panel states the text is never sent to the customer and only offers Copy, so using it in a reply is an explicit staff action; the outbound send path does not read it
- [x] Role-scoped repository: `loadMessageArtifacts` fetches transcripts only for `canViewVoiceTranscripts(role)` (mirrors the table's read policy; GUIDE excluded), agency-scoped, explicit columns, voice analyses only; a viewer without access receives no transcript text at all
- [x] Containment test: only the Inbox artifact loader, the worker and the metrics loader may reference the transcript table, so it cannot leak into message bodies, reply context, or the send path
- [x] Focused verification: `voice-transcript.test.ts` now has 31 tests (state matrix, projection and role gate, containment)
- [x] Full verification: typecheck passed; lint 0 errors; 371 Vitest files / 3,896 of 3,897 tests passed. The one failure, `lib/security/inbox-media-csp.test.ts`, is environmental: Playwright's Chromium is not installed on this machine (`npx playwright install`), so it cannot launch a browser; it also fails on unmodified `main`
- [ ] Browser verification: pending, complete, low-confidence, failed, and disabled states shown beside working original playback, for an allowed role and a denied role — not done; there is no signed-in non-production environment, and the live transcript pipeline is not yet exercised (MED-01 RLS test unrun, MED-02 provider call unproven)
- [ ] **MED-03 exit:** staff can read a clearly attributed transcript when available and always retain original audio controls; the transcript is staff-only, non-authoritative, and excluded from outbound replies unless staff explicitly use it — awaiting browser verification and merge. **Checkpoint P4a** (review transcript quality and cost samples before enabling by default) remains open and blocks enabling by default

#### MED-04 — route brochure and other supported media

- [~] **Slice merged** — PR #175 merged; left in flight because the staging and browser verification items below are unproven
- [x] `lib/inbox/media/routing.ts` is the decision table: options derive from media kind, file type, size, the viewer's capabilities and whether the Inbox copy still exists. Brochure → proposal collateral; other files → Documents; receipt → Finance intake; passport → traveller Documents; voice → none; every file keeps a manual download. Each denied or unavailable option carries a plain reason, and `sendsOrPublishesAutomatically` is `false` by contract
- [x] Passports and receipts can never be saved to the shared Document Vault (readable by every staff role); this is enforced in the table and re-enforced on the server from the file's own kind
- [x] Unsupported Office/text files keep manual download with a clear limitation ("cannot be read automatically"); Office files the vault accepts can still be saved, text files cannot
- [x] `saveInboxMediaToVaultAction` (`app/inbox/vault-actions.ts`) calls `requireUser()` first, validates with strict Zod, takes the agency from the session, and needs the new `saveMediaToVault` capability (Inbox access plus vault write); the copy logic in `lib/inbox/media/media-to-vault.ts` is idempotent and race-safe (conditional claim on `promoted_document_id`, the loser's copy is removed), re-checks the 10 MiB limit after download, cleans up a failed insert, and returns plain-language errors only
- [x] A saved brochure is linked to the chat's departure group when one exists (`departureGroupId` added to `loadInboxMediaContext`, always from the caller's agency); it is not sent or published
- [x] `media-routing-actions.tsx` shows the card for brochures and non-image other files; photos stay in their bubble
- [x] Focused verification: routing 16, vault saver 12, vault actions 23 (7 new), context 3, plus access tests — all passed
- [x] Full verification: typecheck passed; lint 0 errors on new files; 373 Vitest files / 3,938 of 3,939 tests passed — the one failure is the Playwright-browser gap in `lib/security/inbox-media-csp.test.ts` (run `npx playwright install`)
- [-] `app/(main)/departure-groups/[groupId]/brochure-actions.ts` was not changed: it generates a brochure from a departure group, which this slice does not do; linking a saved brochure to its group is done through the vault document's `source_departure_group_id`
- [ ] Browser verification: allowed and denied destinations for each role, the saved state, the limitation note on an Office/text file, and a repeated click — not done; no signed-in non-production environment
- [ ] Live storage check: the `content-vault` upload and the `message_attachments` conditional update are covered by the in-memory saver test only — needs a staging run
- [ ] **MED-04 exit:** all supported media has a safe action and a functional fallback; brochure routing never publishes or sends collateral automatically — awaiting browser verification and merge. **Checkpoint P4** (all supported media has a safe action and a working fallback) is therefore still open

### Spec refinement Phase 5 — Productivity controls

#### PRD-01 — centralised shortcut registry and focus guards

- [~] **Slice merged** — implementation in progress on `codex/inbox-prd-01`; do not tick until the exit criterion is proven and merged
- [-] Declared dependency STF-02 (Copilot panel states) is not built. It has no technical bearing on a key registry, so PRD-01 was built ahead of it; recorded here so the order is a visible choice, not an oversight
- [x] `lib/inbox/keyboard-shortcuts.ts` is the single registry: J, K, /, r, n, a, e, b, q, `g` then `d`, Escape and ? each with a label, plain description, group, permission/context needs, `aria-keyshortcuts` value and a `wired` flag so the help overlay (PRD-02) never advertises a key that does nothing
- [x] Focus guards: nothing runs while typing in an input, textarea, select or content-editable control (only Escape may), while an input method is composing, or with Ctrl, Alt or Meta held; capitals are ignored as before
- [x] `g` then `d` completes only within 1 s and never while typing; a different second key cancels the sequence and is read on its own
- [x] `findInboxShortcutCollisions` fails on an identical binding or a single key that shadows a sequence start; the real registry has none
- [x] `inboxShortcutAvailability` explains in plain words why a command is unavailable (no conversation open, role cannot reply, no linked lead, and so on); permissions are still enforced server-side when a command runs
- [x] The list handler now reads J, K and / from the registry, scoped so it cannot swallow `g`, with unchanged behaviour
- [x] Focused verification: `keyboard-shortcuts.test.ts` 21 tests (coverage, collisions, typing, IME, modifiers, sequence timeout and cancel, scope, availability)
- [x] Full verification: typecheck passed; lint clean on the touched files; 374 Vitest files / 3,959 of 3,960 tests passed — the one failure is the Playwright-browser gap in `lib/security/inbox-media-csp.test.ts`
- [-] `conversation-panel.tsx` was not changed: nothing in the panel consumes a shortcut until PRD-02 wires the commands
- [ ] Browser check that J, K and / still behave as before in the real list — not done; no signed-in non-production environment
- [ ] **PRD-01 exit:** one registry defines keys, availability, labels and text-entry exclusions, and colliding bindings fail a test — awaiting merge

#### PRD-02 — wire shortcuts and add discoverable help

- [~] **Slice merged** — implementation in progress on `codex/inbox-prd-02` (stacked on PRD-01); do not tick until the exit criterion is proven and merged
- [x] Each command is carried out by the visible control that already does the job, found by a marker attribute (`lib/inbox/shortcut-targets.ts`). A shortcut is available only while its control is on screen and enabled, so it can never do more than the control, and the server still enforces permissions when the control's action runs
- [x] `r` and `n` press the Reply and Internal note tabs and then focus the box (Reply is marked only while replying is allowed); `a` opens the owner picker (present only for roles that can assign); `q` focuses the visible Create quote button and never presses it, so a keypress cannot create a quote; `e`, `b` and `g` then `d` press new visible "Open lead / booking / departure group" links
- [x] The new links (`linked-record-links-block.tsx`) appear in the customer panel only for records that exist and that the role may open (new `canOpenLead`, `canOpenBooking`, `canOpenDepartureGroup` flags mirror the Leads and Departure Groups access); addresses are built only from UUIDs (`lib/inbox/linked-record-links.ts`)
- [x] `?` opens a help dialog built from the registry (`inbox-shortcut-help.tsx`), so it lists only wired shortcuts; a "Keyboard shortcuts" button in the rail opens the same dialog; shortcut-backed controls carry `aria-keyshortcuts`
- [x] An unavailable shortcut says why in a toast instead of failing silently; Escape with nothing to close stays quiet; no shortcut runs while any dialog is open, while typing, while composing, or with a modifier held; `g` then `d` times out after 1 s
- [x] Focused verification: shortcut-targets 10, linked-record-links 7, registry 24 (3 new for the help grouping and wired state) — all passed
- [x] Full verification: typecheck passed; lint 0 errors; 376 Vitest files / 3,979 of 3,980 tests passed — the one failure is the Playwright-browser gap in `lib/security/inbox-media-csp.test.ts`
- [-] Escape: native dialogs, sheets and popovers already close on Escape and restore focus, so the Escape command only drives surfaces registered through `registerTransientSurface`; none are registered yet, so in practice Escape is handled by each surface itself
- [-] J, K and / stay in the conversation list handler (PRD-01); the provider deliberately does not claim them
- [ ] Browser keyboard acceptance — not done; there is no signed-in non-production environment. Still unproven in a real browser: that clicking a tab or the owner picker programmatically activates it, that focus returns after the help dialog closes, screen-reader announcement of the labels, and that no shortcut fires inside the dialogs it should ignore
- [ ] Component tests: the provider and the help dialog have no automated tests (the test setup has no DOM); only the pure logic behind them is covered
- [ ] **PRD-02 exit:** staff can run every supported command and open an accessible help overlay, each respecting the same permissions and disabled states as its visible control — awaiting browser keyboard acceptance and merge

#### PRD-03 — bulk mark spam

- [~] **Slice merged** — implementation in progress on `codex/inbox-prd-03` (stacked on PRD-02); do not tick until the exit criterion is proven and merged
- [x] Spam-state contract decided (2026-10-01) and written down in [`spam-state-contract.md`](spam-state-contract.md): conversation-level `lifecycle_status = 'SPAM'`, restored from the chat's own state, no new column. Tag changes stay deferred (D6)
- [x] Migration `20261222090000_inbox_spam_lifecycle_queues.sql` makes the queue function treat lifecycle SPAM as spam (the Spam queue and every exclusion). It is the latest function body with exactly one line changed (proved by a contract test), no table, policy or column change, grants kept, existing spam rows re-synced, rollback documented, and null-safe (see the next item)
- [x] **Applied to Manasik OS on 2026-10-01 at the user's request**, recorded as `20261001035136_inbox_spam_lifecycle_queues` and `20261001035236_inbox_spam_lifecycle_queues_null_safe` (the tool stamps its own versions). The release order stands: this migration must be in place before this code ships
- [x] **Defect found and fixed during verification.** The first version used `… or c.lifecycle_status = 'SPAM'`; `lifecycle_status` is nullable and all 5 live conversations are NULL, so `is_spam` became NULL and the queue function dropped them from All, Needs reply and every other queue (computed 5 rows against 22 stored). Caught by a read-only comparison of computed against stored membership right after applying; corrected about two minutes later with `coalesce(c.lifecycle_status = 'SPAM', false)` before any membership refresh ran. Afterwards computed and stored membership match exactly (22 / 22, no differences). The repo file is the final definition and a new contract test guards null safety
- [x] `planBulkAction` gains `MARK_SPAM` and `UNMARK_SPAM`: marking writes only `lifecycle_status` and never the state; restoring writes CLOSED or OPEN from the state, and a test proves the round trip for every state; chats with a booking, an open review, or an already-spam lead are skipped with a plain reason; a fact that cannot be read skips the chat
- [x] `bulkUpdateConversationsAction` extended: same `closeConversation` permission, strict Zod, every read agency-scoped; **fails closed** — any foreign or missing id, or any unreadable safety fact, changes nothing; each write is guarded on state and lifecycle; a lost race is counted as skipped; one `SPAM_MARKED` / `SPAM_RESTORED` audit event per changed conversation
- [x] The selection bar shows **Mark as spam** (or **Not spam** in the Spam view) behind a confirmation that says what happens and that nothing is deleted or sent; there is still no bulk send, payment, document-verification, review-resolution or AI-approval action
- [x] Focused verification: planning 17 (9 new, including the round trip), action 12 (new file: permission, cross-agency fail-closed, booking/review/lead guards, unreadable facts, race, audit, restore, input boundary), migration contract 8 (including null safety); the existing assign/close bulk tests still pass unchanged
- [x] Full verification: typecheck passed; lint 0 errors; 378 Vitest files / 4,008 of 4,009 tests passed — the one failure is the Playwright-browser gap in `lib/security/inbox-media-csp.test.ts`
- [-] The existing assign and close bulk actions keep their original skip-and-continue behaviour; fail-closed applies to the new spam actions only
- [ ] Browser confirmation test (the confirm dialog, the Spam view button, restore) — not done; no signed-in non-production environment
- [ ] Live check that a real mark and restore move a conversation in and out of the Spam queue — not done: it needs writing a test change to a live conversation, which was not requested. The function and grants are verified, and computed membership equals stored membership
- [ ] **PRD-03 exit:** bulk mark-spam is reversible, permission-checked and agency-scoped for every selected row, fails closed on partial authorisation, and cannot trigger sends, payment changes, document verification or review resolution — awaiting migration, browser confirmation and merge. **Checkpoint P5** (accessibility and safety review of all keyboard and bulk flows) is still open

### Spec refinement Phase 6 — Outcomes and guidance

#### OUT-01 — reconciled outcome metric contracts

- [~] **Slice merged** — implementation in progress on `codex/inbox-out-01` (stacked on PRD-03); do not tick until the exit criterion is proven and merged
- [-] Declared dependencies AUT-05 (autonomy policy) and STF-06 (My Shift) are not built. Metrics that need them (never-autonomous violations, autonomy demotion rate) are declared **BLOCKED** with that reason; the My Shift counts are not part of this slice. Recorded here so the order is a visible choice
- [x] `lib/metrics/inbox-outcomes.ts` holds 27 metric contracts across the four families. Each declares its numerator, denominator, unit, value basis (stock as of now, or whole-UTC-day window), time basis, source tables and columns, tenant scope (`agency_id`), exclusions, audience, an exact drill-down (an Inbox queue view, or a named reviewed event set), and `exposesContent: false`
- [x] 17 are **measurable** from stored facts: 12 queue-size metrics whose count equals the rows a drill-down opens (overdue, nearing deadline, unassigned, awaiting reply, four sales queues, payments, complaints, documents, escalations), open blocking reviews, median and p95 payment-review time, AI cost per analysed conversation, and the skip-before-AI rate
- [x] 10 are **blocked, with the reason named**, instead of a number that only looks real: first-response time (no stored first-response timestamp), within-SLA (only the current deadline is stored), the three funnel conversion rates (only the current commercial stage is stored, no history), never-autonomous violations and autonomy demotion (AUT-05), draft acceptance (no stored edit measure), and triage corrections (not stored)
- [x] Computation is pure and honest: zero denominators give `NO_DATA` (never 0 or NaN), rates divide window totals rather than averaging daily ratios, windows are whole UTC days, percentiles are nearest-rank, impossible durations are ignored, and a truncated read is flagged `partial`
- [x] `loadInboxOutcomes` (`lib/data/inbox-commercial-repository.ts`) names the agency on every read, counts queues with head-only exact counts, bounds the review read, never touches message, attachment, transcript or document tables, and reports a failed source (its metrics read as no data) instead of failing everything
- [x] Role scoping is part of the contract: `inboxOutcomeMetricsVisibleTo(role)` shows AI cost and quality only to ADMIN and CEO, payment-review figures only to roles that can open the Finance ledger, and nothing to a role with no Inbox access
- [x] `lib/metrics/registry.ts` re-exports the outcome contracts and a test proves no metric key is reused across the finance and Inbox registries
- [x] Focused verification: contracts and computation 22, loader and two-agency reconciliation 9, registry 2 (new) — queue counts reconcile to membership rows, AI cost and skip rate to the daily rows in the window, review times and the open count to the review rows, with the other agency's rows never counted
- [x] Full verification: typecheck passed; lint 0 errors; 379 Vitest files / 4,042 of 4,043 tests passed — the one failure is the Playwright-browser gap in `lib/security/inbox-media-csp.test.ts`
- [x] **Finding recorded as an explicit exclusion:** `inbox_intelligence_kpis_daily` only sums AI surfaces named `INBOX_<NAME>` in capitals, so the lower-case `inbox_media_intelligence` and `inbox_voice_transcript` runs are **not** in the AI cost metric. Fixing that needs a view or rollup change and is not part of this slice
- [-] A pre-existing test file (`inbox-commercial-repository.test.ts`) was briefly overwritten while writing the new tests and was restored; its 3 original tests are intact and unchanged apart from switching to a static import
- [ ] Seeded live reconciliation against Manasik OS rows (not just fixtures) — not done; the 5 live conversations make a weak sample and a read of live data was not requested
- [ ] **OUT-01 exit:** each metric declares source tables, tenant scope, time basis, exclusions and an exact drill-down; cost and quality metrics expose no message content or sensitive fields; totals reconcile to source rows for seeded agencies — awaiting merge. OUT-02 builds the cards and the drill-down UI; the event-set drill-downs have no screen yet (`href: null`)

#### OUT-02 — role-safe outcome cards and exact drill-down

- [~] **Slice merged** — implementation in progress on `codex/inbox-out-02` (stacked on OUT-01); do not tick until the exit criterion is proven in a browser and merged
- [x] `lib/metrics/inbox-outcome-cards.ts` turns computed values into cards and applies the role filter on the server, so a card a role may not see is never built or sent. Every state is explicit: a number, "No data yet", "Not measurable yet" (with the reason), or "Could not be read" (a failed source is never shown as zero)
- [x] `loadInboxOutcomeCardsForRole` (`lib/data/inbox-commercial-repository.ts`) reads nothing for a role that cannot open the Inbox, and marks metrics whose source failed as unavailable
- [x] `loadInboxOutcomeCardsAction` (`app/inbox/outcome-actions.ts`) starts with `requireUser()`, takes agency and role from the session only, and returns plain-language errors
- [x] `inbox-outcome-metrics.tsx` adds an Outcomes panel opened from the Inbox rail: cards grouped by family, loading, empty, error-with-retry and partial states, and an "Open these conversations" button that opens the exact queue view the count is made from
- [x] Focused verification: cards and role matrix 19, repository role scoping and count-to-view reconciliation 5 (new), action 4 — every role is checked against `inboxOutcomeMetricsVisibleTo`, owner-only and Finance-only cards are absent for other roles, and each count equals the membership rows its drill-down view opens
- [x] Full verification: typecheck passed; lint 0 errors; 380 of 381 Vitest files / 4,070 of 4,071 tests passed — the one failure is the Playwright-browser gap in `lib/security/inbox-media-csp.test.ts`
- [-] Finance, sensitive-document and cross-branch scoping: Finance-only metrics are role-gated; the metrics carry counts only, never document fields or content. There is no branch dimension in the Inbox data, so no cross-branch card exists to scope
- [-] Event-set drill-downs (open blocking reviews, payment-review times) have no screen, so those cards show a number with no "Open" button rather than a link that goes nowhere
- [ ] **Browser drill-down test not run** — there is no signed-in non-production environment, so the Outcomes panel has not been opened in a browser and the click-through to the queue view is not demonstrated
- [ ] **OUT-02 exit:** every displayed count opens the exact permitted source rows; empty, delayed and partial states are explicit — code and unit proof done, browser proof outstanding

#### OUT-03 — role guidance and release proof

- [~] **Slice merged** — implementation in progress on `codex/inbox-out-03` (stacked on OUT-02); do not tick: the release-evidence half of the exit criterion is not met
- [x] Role guides written: `docs/inbox/staff-guide.md`, `docs/inbox/admin-guide.md`, `docs/inbox/finance-evidence-guide.md`; each covers daily use, boundaries, recovery paths and expected outcomes. Role facts (who can decide Finance evidence, see transcripts, see each outcome card, bulk-mark spam) were checked against the access code, and recovery rows for Finance evidence state that no undo or re-open exists
- [x] `docs/usages/inbox/usage-guide.md` reconciled: voice transcripts, saving files to Documents (never passports or receipts), spam definition, and links to the role guides; `docs/inbox/README.md` indexes the new files; relative links checked
- [x] `docs/inbox/release-evidence-assisted-operation.md` created as the P6 evidence record, with every row **not collected** and the AUT-05-blocked row marked blocked
- [ ] **Release evidence not collected:** one week of reconciled metrics, reviewed risk samples, channel proof, a rollback drill, browser acceptance, and the open live checks from MED-01, MED-02 and PRD-03. These need a staffed run against a signed-in non-production environment and real data; none was fabricated
- [ ] Role-based documentation walkthrough by a person in each role — not done
- [ ] **OUT-03 exit:** guidance exists; "release evidence links one week of reconciled metrics, risk samples, channel proof and rollback drill" is **not met**. **Checkpoint P6 stays open**

### LR0 reconciliation — 2026-09-26

- [x] Repository merge provenance reconciled at release-candidate commit `d711787`; the branches cited as `transforming-inbox`, `scaling-inbox`, `fixing-inbox`, `inbox-performance-optimization`, and `upgrade-inbox` are ancestors of local `main` and the candidate. See [`2026-09-26-inbox-lr0-release-baseline.md`](../progress/2026-09-26-inbox-lr0-release-baseline.md).
- [x] Staging migration and advisor reconciliation completed against Supabase project `klognjpwmqwlgeibvanf`: all 191 repository SQL migrations match staging. The advisor baseline found a mutable search path on `enqueue_inbox_text_message`; it is a release blocker recorded in the LR0 snapshot for a dedicated security-remediation slice.
- [-] Production migration/advisor reconciliation is deliberately deferred until the separate production Supabase project is created; it is a LR7 pre-release gate, not a staging-LR0 action.
- [~] The detailed `**Slice merged**` labels below retain historical branch provenance. Their checkbox state remains in-flight until each named exit criterion is demonstrated; no slice, R/G, or programme definition-of-done box was promoted by LR0.

### LR1 security remediation — 2026-09-26

- [x] Staging migration `20260926070345_inbox_text_message_search_path_hardening.sql` pins `enqueue_inbox_text_message(uuid, text, uuid)` to `search_path = ''` while retaining its authenticated staff caller and in-function auth/agency checks. Direct staging verification confirms the persisted setting and grant; the RPC is absent from the mutable-search-path advisor finding.
- [x] Scoped lint is clean for `app/inbox/**`, `lib/inbox/**`, `lib/channels/**`, and `lib/agent/whatsapp/**`; unused Inbox UI values and unused test mock parameters were removed without suppressions or runtime changes.
- [x] LR1 RPC audit complete ([record](../progress/2026-09-26-inbox-lr1-rpc-audit.md)); global warnings are tracked as TASK-011 (owner still to be named).
- [x] LR1 complete on staging: migration `20260926130557_inbox_autonomy_actor_binding.sql` applied (recorded as `20260926130557`), verified directly and rechecked against the advisor. Open human follow-ups: name the TASK-011 owner; release-owner sign-off of the RPC audit.

### LR2 browser acceptance — 2026-09-26

- [x] `npm run test:e2e` now runs the Playwright LR2 harness against explicitly named real staff sessions and Agency A/B fixture conversations. Its parser refuses a production-equivalent project ref, one worker serializes mutable fixtures, and captured trace/video/screenshot artifacts are ignored by git. The remaining [LR2 runbook](../runbooks/inbox-launch-readiness-acceptance.md) provides the human screen-reader and independent-review evidence the browser runner cannot honestly claim.
- [ ] The harness and runbook have not yet run against a named deployed non-production candidate with two agencies, three staff identities, and a provider test contact. LR2 acceptance and programme exits remain open until its dated two-party evidence record passes every row.

## Scaling track

### SC0 — Baseline, contract and architecture amendment

- [~] **Slice merged** — local implementation is in progress; staging baseline and merge are pending
- [x] `TASK-005-inbox-scaling-baseline.md` records SC0 scope, access posture, and test plan
- [x] `scripts/load/inbox-multitenant.ts` defaults to a no-connection/no-write dry run and refuses execution unless its declared staging project ref matches the Supabase URL and differs from production
- [x] The runner can create and remove a uniquely tagged 50-agency × 200-conversation disposable fixture set with `--seed-fixtures`
- [x] Vitest covers dry-run parsing, malformed profiles, and production/mismatched target refusal
- [x] Architecture §7.5 and the Inbox operations runbook document scoped topics, patch/delta reads, reconnect reconciliation, and the baseline evidence to record
- [ ] **Exit:** a current-build staging Baseline profile records delivered events per inbound, Server Action calls per inbound, webhook p95, queue-age percentiles, database connections, and event-to-visible latency

### SC0 — evidence recorded 2026-09-24 (Baseline profile, staging)

- [x] Two real defects in the harness found and fixed while taking the baseline: it read only 1,000 of 10,000 jobs (API row cap) and crashed with HTTP 414 on a 10,000-id filter; it now pages, chunks, and prints why jobs did not finish
- [x] Baseline on the then-current build: about **57 jobs/s** (~3,400/min) drained from a 10,000-job burst; p95 **160–173 s**; per-agency fairness spread about **3%**; 221–260 of 10,000 jobs dead-lettered, all "Exceeded the lane's time budget"
- [x] Root cause of those dead letters fixed (the runner also left its fixtures behind after a statement timeout on a 10,000-row delete; removal is now batched): `claim_channel_jobs` counts an attempt at claim time and a tick that ran out of time failed in-flight jobs through `fail_channel_job`, spending an attempt they never faulted for. `release_channel_job` (migration `20261202093900`) refunds it; a job that had used most of the tick still fails normally. Unit-tested; **applied to staging but not yet measured** — the workers that drain staging run the deployed build
- [ ] Exit still open: delivered Realtime events per inbound, Server Action calls per inbound, webhook p95, database connection use and event-to-visible latency were **not** measured (no signed-in browser or webhook-driving harness yet)

### SC1 — Atomic inbound message and required-job persistence

- [~] **Slice merged** — implemented and applied to staging on `scaling-inbox`; not merged
- [x] Migration `20261202094000_sc1_atomic_inbound_persistence.sql`: `ingest_inbound_message_atomic` (message + agent job + REALTIME ENRICH job in one transaction, `security definer`, `search_path = ''`, service-role only, conversation/agency pairing verified) and `repair_missing_enrich_jobs` (bounded, agency-scoped, idempotent)
- [x] `lib/inbox/ingest.ts` and `lib/data/whatsapp-repository.ts` use it; a failed write throws so the webhook answers retryably instead of acknowledging a message with no work queued
- [x] Repair runs from the SLA sweep; migration-content, repair and ingest tests added or rewritten
- [x] Staging fault injection (rolled-back transactions): duplicate delivery → one message, one agent job, one queued ENRICH; foreign-agency conversation rejected (`42501`); grants are `service_role` only; an injected `agent_jobs` failure left **0 messages and 0 jobs**; repair restored a lost job and a second run repaired 0
- [ ] Exit: fault injection at **every** persistence boundary through a real signed webhook and confirmation of no duplicate provider-visible reply — needs the deployed build

### SC2 — Typed Realtime contract without client behavior change

- [~] **Slice merged** — applied to staging; not merged
- [x] `lib/inbox/realtime/contracts.ts`: strict, versioned, PII-free union; unknown, extra-field and legacy payloads parse as "unknown" (one bounded reconciliation)
- [x] Migrations `20261202094100` (typed event builder, topics unchanged) and `20261202094150` — **found that nothing assigned `conversation_messages.sequence_number` after its one-time backfill (0 of 60 messages had one)**; a per-conversation counter table and `BEFORE INSERT` trigger now assign it (backfilled, no duplicates, consecutive on insert)
- [x] Captured on staging: an inbound message emits typed LIST + THREAD events with the sequence and no text, names or phone numbers
- [x] Contract, topic and migration-content tests (managed `realtime` schema is not touched)
- [ ] Exit: a signed-in staging client logging every variant (message, delivery, note, intelligence, presence, queue) in the Realtime Inspector — no signed-in browser session was available

### SC3 — Scoped repositories and Server Actions

- [~] **Slice merged** — not merged
- [x] `loadInboxConversationListPatch`, `loadInboxThreadDelta`, `loadInboxNotesDelta`, `loadInboxPresence` and four matching Server Actions (`requireUser()`, Zod, agency named next to the conversation)
- [x] Migration `20261202094200_sc3_conversation_version.sql`: `conversations.version` advances only on visible changes (verified: presence-only, bookkeeping-only and no-op updates leave it alone)
- [x] 19 tests: cursor filter, paging (`hasMore`), merge of requested ids, removed notes, MINE view, role/agency refusal, filter-injection rejection
- [x] No new index: the existing ones cover every scoped read (notes timeline, message sequence, attachments, media)
- [ ] Exit: p95 per scoped read at 100,000 conversations and a 10,000-message thread (`EXPLAIN (ANALYZE, BUFFERS)`) — not measured

### SC4 — Incremental client synchronization

- [~] **Slice merged** — not merged
- [x] Pure modules with tests: `inbox-sync-merge.ts` (list/thread/notes merge), `inbox-sync-plan.ts` (event plan + 150 ms batcher, 500 ms cap, hidden-tab pause, reconnect collapse), `single-flight-runner.ts` (serialised thread/note reads; nothing dropped)
- [x] `InboxRealtime` subscribes to the list topic plus only the open conversation's topic; `header-inbox-dialog.tsx` patches rows and merges deltas — no skeleton, no four-part refresh (that path is kept only as the bounded reconciliation)
- [ ] Browser acceptance (two signed-in sessions, missed-event recovery) — not done
- [ ] Exit measurement (one list patch + at most one thread delta per inbound) — not measured

### SC5 — Scope database broadcasts

- [~] **Slice merged** — migration `20261202094300_sc5_scoped_inbox_broadcasts.sql` is on main and **its objects are present in the live Manasik OS database** (checked 2026-09-25: `broadcast_inbox_list_event`, `broadcast_inbox_presence_event` and the scoped triggers exist). It was proven in a rolled-back transaction first; the plan required the SC4 client to be the deployed build before applying, and that deployment has not been confirmed here. If an older client is still live, notes and delivery ticks will not reach its open thread
- [x] Measured (agency topic / conversation topic): inbound message 1/1 (was 2/2); delivery status 0/1; note 0/1; composer presence 0/1; no-op message or conversation update 0/0; visible conversation change 1/0
- [x] `scripts/sql/verify-sc5-scoped-broadcasts.sql` re-runs that proof after apply; migration-content tests (12) pin the routing and safety rules
- [ ] Not built: lead/booking `CONTEXT` events (no trigger exists today; the lead store's bulk saves would create event storms)
- [ ] Exit: ≥70% fewer delivered events and Server Action calls per inbound under the Baseline profile, convergence after a dropped event — needs the SC4 build confirmed as the deployed one, then a signed-in measurement

### SC6 — Exact optimistic-send reconciliation

- [~] **Slice merged** — not merged
- [x] The composer generates the idempotency key per send attempt; `sendStaffMessage` passes it to `enqueue_inbox_text_message` (previously a fresh random key per call, so a retry duplicated) and returns the canonical message id
- [x] `settlePendingMessages` matches by exact key (text/timestamp matching removed); retry reuses the key; a send no longer calls the full `refreshInbox()`; notes and composer claims use scoped reads
- [x] 13 pending-message tests and 6 action tests (retry reuses the key, identical text with a new key is a new message, malformed key rejected)
- [ ] Exit: staff send observed across two live sessions without a full refresh — not done

### SC7 — Worker capacity proof and conditional runtime

- [~] **Slice merged** — harness extended; capacity proof and any worker change pending
- [x] `scripts/load/inbox-load-profiles.ts` + tests: `sustained`, `burst`, `noisy-tenant` profiles, exact per-second schedule, noisy-neighbour statistics, safety limits; runner drives them, samples queue age, can mimic the after-webhook drain kick, and writes a JSON report
- [x] Sustained (p95 2.5 s, 0 dead letters), Noisy-tenant (p95 3.0 s, control-agency spread 4.6%) and Burst (p95 20 s, oldest queued job 17.5 s, 1.9% dead-lettered on the pre-fix deployed drain) measured on staging; §10.2 gate analysed in `docs/progress/2026-09-24-inbox-scaling-sc0-sc7.md` — **decision: no dedicated worker yet**; re-run Burst after deploying the `release_channel_job` fix, and repeat with model-backed enrichment
- [ ] Exit: sustained and burst meet the queue SLOs with ≥30% throughput headroom — **Sustained does (drain ceiling ~3× the target); Burst does not**
- [-] No dedicated worker was added: the gate has not been shown to trip

### SC8 — Full scale proof and production rollout

- [ ] **Slice merged** — not started: needs the SC1–SC6 build deployed, a signed-in two-agency browser acceptance, a Meta test-provider run, Realtime and connection headroom numbers, and the staged rollout

## Remediation plan

### FIX1 — One outbound authorization boundary

- [~] **Slice merged** — implementation is in progress on `fix-bug`; provider acceptance and latency evidence are still required
- [x] Shared fail-closed authorization is implemented in `lib/inbox/outbound/authorize-provider-send.ts`
- [x] Both Inbox `sendReply()` paths call the shared boundary immediately before provider contact
- [x] Channel-policy, ownership, protection, autonomy, and live-offer coverage passes; full lint (279 pre-existing warnings), typecheck, and all 2,037 tests pass
- [ ] **Exit:** provider-window acceptance produces no invalid delivery attempt and authorization p95 is ≤ 100 ms

### FIX2 — Retention integrity and resumable batches

- [~] **Slice merged** — implementation is in progress on `FIX2`; the 1M-row `EXPLAIN` (deferred to FIX14, see below) and the live dry-run/live reconciliation evidence are still required
- [x] `supabase/migrations/20261202092900_fix2_retention_resumable_sweep.sql` — `inbox_retention_cursors` table (RLS + service-role-only writes) and `inbox_retention_candidate_conversations()`, a keyset-paged, security-definer function classifying a conversation as booking-linked via a direct `departure_group_bookings.source_conversation_id` link or via `conversation.lead_id → leads.booking_id`. Applied to Manasik OS and verified.
- [x] `runRetentionSweepForAgency()` (`lib/inbox/retention/sweep.ts`) is rebuilt on one shared primitive, `runResumableSweep()`, used by **every** scope (MESSAGES and the six table-scoped sweeps: ATTACHMENTS, VOICE_AUDIO, INTELLIGENCE, SIGNALS, AI_RUNS, WEBHOOK_PAYLOADS) — each loops by its own keyset cursor until its batch/wall-clock budget is reached, persists the cursor after every successful batch under its own `(agency_id, scope)` key, and resumes from the last persisted cursor on the next call; a failed batch leaves the cursor untouched so it is retried, not skipped or lost
- [x] The five non-MESSAGES table scopes page via `fetchScopeCandidates()`, a keyset `.or()` filter over `(timestampColumn, id)` matched to `.order(timestampColumn, id)` — the same pattern as the SQL candidate function, generalized to plain PostgREST filters since those tables need no booking-linkage classification
- [x] Dry runs preview the same candidate pages as a live sweep but never advance the persisted cursor, so a scheduled live sweep cannot be made to skip rows a dry run only inspected — verified for MESSAGES and for a storage-backed scope (ATTACHMENTS)
- [x] Storage-before-row deletion order is unchanged (`deleteConversationMessageBatch` for MESSAGES, `removeAttachmentObjects` before the row delete for ATTACHMENTS/VOICE_AUDIO); `agent_runs` is documented as intentionally excluded from the nightly sweep (no agency-configured retention window for it; removed only alongside its conversation by `deleteInboxConversations`)
- [x] Tests: keyset pagination and cursor resume across pages, dry-run cursor isolation, retry-on-failure without cursor advancement, and batch-budget cutoff for MESSAGES; the same pagination/cursor-isolation/storage-removal behaviour re-verified end-to-end for a second, differently-shaped scope (ATTACHMENTS) to prove the shared primitive generalizes; migration-content assertions for the booking-linked classification, keyset ordering, service-role-only grants, and the added index (`lib/inbox/retention/sweep.test.ts`, 19 tests)
- [x] `EXPLAIN (ANALYZE, BUFFERS)` of `inbox_retention_candidate_conversations()`'s own query, measured against 100,000 synthetic conversations (4,000 booking-linked via a real lead→booking chain) seeded into a tagged, disposable agency on Manasik OS, then deleted after measurement. Found and fixed a real regression: without an index, the query ran a parallel seq scan + external disk sort, **103.8 ms** for one 250-row page — already over the 100 ms budget at 1/10th the plan's target scale. Added `supabase/migrations/20261202093000_fix2_retention_conversation_keyset_index.sql` (`conversations (agency_id, last_activity_at, id)`), applied and verified on Manasik OS; re-measured **7.1 ms** at the epoch cursor and **22.8 ms** mid-sweep (cursor after 50k rows) — both index-scan-backed, both well inside budget. Full before/after in [`docs/progress/2026-09-23-fix2-retention-performance.md`](../progress/2026-09-23-fix2-retention-performance.md). The 1,000,000-row figure itself was not reached: bulk-inserting through `conversations`' per-row queue-refresh trigger repeatedly hit Supabase's statement timeout at that volume against the real project, and disabling that trigger to force it through was judged out of scope for this slice — deferred to FIX14's dedicated staging load harness, which already owns full-scale verification.
- [ ] **Exit:** dry-run counts equal the live sweep, no protected booking message is deleted, and no expired unpromoted passport remains after the bounded backlog is drained

### FIX3 — Complete AI-assisted conversation metering

- [~] **Slice merged** — implementation is merged into `main`; a controlled fixture reconciling the usage counter to the distinct set of qualifying conversations on real data is still required
- [x] Audited all four qualifying boundaries against the actual code (not the architecture doc's description of it): boundary 1 (successful S1/S2/S4 enrichment write, `lib/inbox/intelligence/pipeline.ts`) was **already wired**; boundaries 2–4 (generated draft, approved-answer cache shown to staff, first L3 intake turn) were **not metered anywhere** — found by grepping every caller of `meterAiConversation`/`meter_ai_conversation` and finding only one call site before this slice
- [x] Added `utcMonthStart()` to `lib/billing/meter.ts` — the one small application helper FIX3 asks for, deriving the billing period consistently — and switched the existing S1/S2/S4 call site to use it instead of its own inline computation
- [x] Metered boundary 2/3 (generated draft and approved-answer cache) at `suggestConversationReplyAction` (`app/inbox/actions.ts`) — the single place either kind of reply reaches staff — called once, with the service-role admin client, right before the success return, never on a failed draft or a failed proposal-evidence write
- [x] Metered boundary 4 (first L3 intake turn) at `runBoundedInboxIntake`'s atomic first-turn claim (`lib/inbox/autonomy/intake-runtime.ts`) — exactly one caller meters before the intake proceeds; retries and later turns do not re-meter
- [x] Did not add a fifth call site: the legacy WhatsApp agentic loop (`runAgentTurn` / `agent_runs`) is a separate, older system from the four boundaries FIX3 names, with its own cost ledger (`ai_runs`/`agent_runs`, MI0.1)
- [x] Tests cover successful enrichment/no-op paths, generated and cached drafts, failed draft/evidence paths, the atomic first L3 turn, later turns, UTC month derivation, and the agency/conversation/period database key
- [x] Confirmed `resolveAiDegradation()` reads `agency_usage_counters`, the same counter `meter_ai_conversation` maintains
- [ ] A controlled fixture reconciling the usage counter to the distinct set of qualifying conversations exactly, on real (not mocked) data — needs a real environment
- [ ] **Exit:** the fixture above reconciles exactly, and the 80/100/120% degradation ladder is confirmed against that same number in a real environment

### FIX4 — L3 first-turn and multilingual safety

- [~] **Slice merged** — implementation is in progress on `FIX4`; the multilingual overnight-scenario exit needs a live environment
- [x] **Found and fixed the real first-turn bug the plan named**: `runBoundedInboxIntake`'s `!existing` branch hardcoded `replyKey = "ASK_DATES"` and never called `advanceIntakeFlow` at all — a first customer message asking about price, payment, a refund, a visa, a medical condition, or a religious ruling sailed straight through with **zero deny-topic check** and got asked "what dates suit you?" instead of a handover. Every later turn already ran `advanceIntakeFlow`; only the first one bypassed it.
- [x] `advanceIntakeFlow()` (`lib/inbox/autonomy/intake-flow.ts`) now runs identically on every turn including the first — no special-casing around the transition. An `isFirstTurn` option changes only how a non-deny, non-empty message is read: on the first turn it is the trigger that started the intake, not necessarily an answer to "what dates suit you", so it is filed as the DATES answer only when it actually names a period (`hasDateMention` — month names, "next/this/early/late month/year", or a numeric date); otherwise DATES is still asked for real instead of the greeting being stored as if it were a date. Every later turn is unchanged: always a direct reply to a specific question already asked.
- [x] New forbidden-topic lexicon, `lib/inbox/autonomy/intake-deny-topics.ts` — English, Sinhala, Tamil and Singlish/Tanglish forms for price/booking, payment, refund/cancellation, visa, medical, and religious-ruling questions. Reused rather than duplicated: the price/booking/payment/refund/visa patterns are the exact same multilingual regexes `lib/inbox/intelligence/triage-lexicon.ts` already matches those intents with (`patternsForIntent`, newly exported for this); medical and religious have no triage-intent equivalent, so they are defined here directly, matched to the categories `lib/inbox/risk/never-promise.ts` already refuses an automated reply from claiming (`HEALTH_OR_SAFETY_ADVICE`, `RELIGIOUS_RULING`) — same category id and meaning, not the same phrase-level patterns, since never-promise matches a model's own claim and this matches a customer's question.
- [x] **Found and fixed a second, deeper pre-existing bug** while wiring this up: the "already processed" idempotency branch computed the right `replyKey` from the stored row but then fell through to the normal compose-and-send path anyway — a redelivered webhook for the same message (first turn or any later turn) would re-send the same question, or re-run the handover side effects (lead note, owner assignment, conversation state) a second time. Fixed with an early return the instant a message's id matches what is already stored as last processed, before any side effect runs again.
- [x] First-turn idempotency across a genuine race: no `inbox_intake_states` row exists yet for a brand-new conversation, and nothing upstream deduplicates a redelivered `PROCESS_INBOUND` job before it reaches here, so two concurrent calls could previously both compose and send. `claimFirstIntakeTurn()` does a plain insert that either succeeds (this call owns the first turn) or hits the table's `(agency_id, conversation_id)` primary key — reading back what the winner wrote lets the loser fall through to the same idempotent path a later duplicate takes.
- [x] Handover still persists the provisional lead and collected facts, opens a `HUMAN_REQUESTED` handoff with an assigned owner, and sends no automated answer to the forbidden question — unchanged, and now reachable from every turn including the first.
- [x] Tests: every deny topic × English/Sinhala/Tamil/Singlish combination (`lib/inbox/autonomy/intake-deny-topics.test.ts`, 24 tests); first-turn handover for every topic — and confirmation the same topic still hands over mid-flow, proving this is not a first-turn-only check — plus the date-skip and no-date-still-asks cases (`lib/inbox/autonomy/intake-flow.test.ts`, +8 tests); runtime-level first-message handover, the date-skip integration path, and a genuinely duplicated first message sending exactly one reply and claiming exactly once (`lib/inbox/autonomy/intake-runtime.test.ts`, +3 tests)
- [ ] **Output quality** — short, one-thing-at-a-time, language-matched questions were already true of the existing `INTAKE_QUESTIONS`; not changed here. Golden-output meaning/protected-claims review needs a live environment.
- [ ] **Exit:** the multilingual overnight scenario (real inbound traffic across English/Sinhala/Tamil) produces one provisional lead, correct collected facts, one visible human-review requirement, and zero deny-list violations — needs a live environment

### FIX5 — Traveller-aware media intelligence

- [~] **Slice merged** — implementation is in progress in this working tree; migration application and provider/browser evidence remain
- [x] One agency-scoped media context loader reads the linked lead, booking, all booking travellers in one query, departure date, and passport-validity setting; it has a cross-agency test
- [x] Deterministic passport review now reports field mismatches, expiry, departure-validity shortfall, missing traveller, low confidence, and ambiguous traveller selection without sending canonical traveller data to the model
- [x] Candidate fields remain in `message_media_analyses`; the worker and staff selection action do not update a pilgrim or payment record. Receipt handling remains Finance proof review only
- [x] The Inbox attachment card requires staff selection where more than one booking traveller is plausible. Re-analysis attaches to the existing `PASSPORT_EXPIRY` card instead of stacking a second review
- [~] Tests cover exact/mismatch/expired/validity/low-confidence/no-traveller/multi-traveller/cross-agency and receipt proof-only paths; focused suite passes locally. Migration is applied (reported 2026-09-23); live provider/private-storage five-minute-link verification remains
- [ ] **Exit:** a test-provider passport and receipt produce the documented Documents/Finance reviews, keep originals private, and issue five-minute signed URLs

### FIX6 — Event-driven commercial projection freshness

- [~] **Slice merged** — implementation is in progress in this working tree; migration application and live queue movement evidence remain
- [x] One idempotent database projection service derives the stage from the existing lead, quote, booking, matched-offer, and travel-reading facts without a model call
- [x] Lead stage/booking linkage, quote, booking, and payment writes trigger the service for the affected agency conversations; cross-agency records are excluded by every join
- [x] Queue membership refreshes only from the resulting `commercial_stage` projection write, including the commercial-stage trigger column
- [ ] **Exit:** creating a quote or booking moves the open Inbox conversation to the correct queue without a customer message or page-refresh workaround

### FIX7 — Exact queue counts at scale

- [~] **Slice merged** — linked-database migration is applied; the 1m-row performance measurement and reconciliation evidence remain
- [x] Exact agency-scoped counter rows are backfilled from queue membership and updated atomically from each refresh's old/new queue sets
- [x] Negative queue deltas update existing counters instead of proposing an invalid negative insert; the regression migration is applied to Manasik OS as `20260923175047` and the inbound WAITING_CUSTOMER → NEEDS_REPLY transition was verified in a rolled-back live transaction
- [x] The rail RPC reads the small counter set instead of grouping all membership rows; `MINE` uses a partial exact-count index
- [x] A reconciliation query and migration tests cover counter equality, agency scoping, RLS, and concurrent-refresh serialization
- [ ] **Exit:** count render p95 is below 300 ms at 1m conversations, with before/after plan and write-cost delta recorded

### FIX8 — Routing availability and capability correctness

- [~] **Slice merged** — implementation is in progress in this working tree; migration application and real-staff exit evidence remain
- [x] Individual `SHIFT` and `LEAVE` records are agency-scoped, RLS-protected, and manageable from Operations settings
- [x] Every routing path requires active access dates, a current shift without overlapping leave, and the resolved Inbox `sendMessage` capability
- [x] Coordinators without Inbox permission fall through to another eligible candidate or visibly `UNASSIGNED`; office hours remain an additional agency calendar
- [ ] **Exit:** real test staff demonstrate sticky, coordinator, least-loaded, and unassigned routing while the SLA clock continues

### FIX9 — Canonical rollout and entitlement contract

- [~] **Slice merged** — implementation is in progress in this working tree; migration application and live downgrade evidence remain
- [x] One typed `resolveInboxFeatureAvailability()` resolver reads cached plan features, named AI-surface state, and the temporary queue rollout input without creating a second entitlement cache
- [x] Server/worker enforcement gates offer matching, approved-answer cache reads/writes, media analysis, and owner-panel data; human replies and deterministic payment-risk protection remain baseline behaviour
- [x] `plans.features` now carries the documented Starter/Growth/Professional/Enterprise matrix; the migration updates existing installations while the original seed stays consistent for new ones
- [x] Architecture §14 and the implementation-plan rollout table remove stale `inbox_autonomy_l2` / `inbox_autonomy_l3` promises
- [ ] **Exit:** every optional surface is verified in a signed-in UI and a downgraded agency cannot execute a previously entitled premium feature

### FIX10 — Language translation and output quality

- [~] **Slice merged** — implementation is in progress in this working tree; migration application and signed-in acceptance remain
- [x] On-demand message and digest translation uses the shared `generateStructured()` seam, is separately metered as `INBOX_TRANSLATION`, shows source/confidence, retains the original, and persists no translation
- [x] Reply packs retain the frozen system block, use verified facts before prose guidance, add the stored digest once, and cap recent turns at six
- [x] Deterministic `inbox_language_kpis_daily` buckets aggregate the stored `language_code` under `security_invoker`; the owner panel exposes the agency-scoped counts
- [x] Translation failures return a useful staff-facing fallback without exposing provider errors
- [ ] **Exit:** a signed-in staff member translates English/Sinhala/Tamil/mixed message and digest examples while the original remains visible, and the owner language drill-down is verified

### FIX11 — Workflow conversion contract

- [~] **Slice merged** — implementation is in progress in this working tree; migration application and the passport-expiry browser acceptance remain
- [x] Architecture §11.3 records all sixteen actions as a create, selection/update, or communication action; it no longer claims every action creates a workflow record
- [x] Task-shaped conversions assign an accountable staff member, preserve their 24-hour task due date, and notify that person; complaint cases use Support's high-priority 24-hour SLA and notify Operations
- [x] The existing guarded lead path used by identity “Create separate lead” stamps its conversation and source message
- [ ] **Exit:** the passport-expiry browser scenario proves each offered action does exactly what its label says

### FIX12 — Traceability and database security verification

- [~] **Slice merged** — implementation is in progress in this working tree; WhatsApp-disabled acceptance remains
- [x] [Traceability index](./traceability.md) maps G1–G15 and R1–R7 to code, a named existing test, and the outstanding live-evidence slice without duplicating fixtures
- [x] `scripts/sql/verify-fix12-inbox-security.sql` provides a rolled-back schema inspection for applied Inbox migrations, RLS, invoker views, definer hardening, source-link composite keys, and constraints
- [x] Linked Manasik OS verification finds all 38 Inbox programme migrations through `20261202093700` installed and no missing targeted RLS, invoker view, definer hardening, source-link composite key/pair check, or SLA-minute check; no migration was pending to apply
- [x] The WhatsApp `PROCESS_INBOUND` hand-off leaves its existing agent turn untouched when `INBOX_INTAKE` is disabled; the focused runtime test proves it performs no new side effect before returning control to the pre-programme path
- [ ] **Exit:** verify WhatsApp with optional Inbox surfaces disabled

### FIX13 — Browser and provider acceptance

- [~] **Slice merged** — preflight is recorded; a signed-in non-production environment and named test fixtures are required before the live scenarios can run
- [x] [Preflight snapshot](../progress/2026-09-23-fix13-browser-provider-acceptance.md) records the required scenario evidence, confirms no provider or customer data was touched, and lists the exact prerequisites
- [ ] **Exit:** complete every `usage.md` §13 scenario with test-only fixtures and record observed results, screenshots where useful, and provider bill/rate comparisons without secrets or PII

## Email channel track

Full plan: [`email-channel-implementation-plan.md`](./email-channel-implementation-plan.md).
Adds Email (generic SMTP+IMAP, provider code `GMAIL`) as a Gmail-like Inbox channel:
read, thread (one conversation per contact, per D2), reply/compose, attachments, search.
No autonomous AI on email in this scope (D4).

### EM0 — Schema and connection bridge

- [~] **Slice merged** — built and applied to Manasik OS on `fixing-existing-things`; not merged
- [x] Migration `20261212090000_email_channel_foundation.sql` adds `imap_host`/`imap_port`/
      `imap_security` to `agency_smtp_settings` and upserts a `channel_connections` row
      (`provider = 'GMAIL'`) from `save_agency_smtp_settings`, keyed by the new
      `channel_connections_gmail_agency_unique` (agency_id, provider) partial index
- [x] **Verified, not a new migration:** `conversation_messages_external_id_unique`
      (agency_id, external_message_id) already existed (migration `20260825090000`) and is
      reused for Message-ID dedupe in Phase 2
- [x] Settings UI: IMAP fields added to the existing email settings form; the Zod schema moved
      to `lib/validations/agency-email-settings.ts` (a `"use server"` file can only export
      functions) with 4 new tests for the all-or-nothing IMAP rule
- [x] **Exit (verified 2026-09-28):** rolled-back live-DB transaction confirms an SMTP-only save
      leaves the connection `NOT_CONNECTED`, and adding IMAP on a second save (no password
      resupplied) flips it to `CONNECTED` with exactly one row, no duplicate. Full
      `typecheck`/`lint`/`test` run: 3621/3622 passing (the one failure is a pre-existing local
      Playwright browser binary, unrelated)

### EM1 — The `gmailChannelAdapter`

- [~] **Slice merged** — built on `fixing-existing-things`; not merged
- [x] `lib/channels/email/adapter.ts` implements `ChannelRuntimeAdapter`; registered in
      `lib/channels/registry.ts`
- [x] `EMAIL_PROFILE` added to `lib/channels/profile.ts`; `isAgentChannel` rewritten as an
      explicit check so it stays agent-excluded independent of the profile map (per D4)
- [x] `channelAcceptsAttachment` gains a `GMAIL` case (image + document)
- [x] **Found while building:** subject/cc/bcc don't reach `adapter.sendReply` yet — the outbox
      command and `authorizeProviderSend` need extending too, moved into Phase 3/EM3's task list
      rather than solved here
- [x] **Exit (verified 2026-09-28):** `lib/channels/email/adapter.test.ts` (13 tests) plus
      updated registry/profile/attachment tests all pass; full `typecheck`/`lint`/`test`
      3636/3637 (one pre-existing, unrelated local Playwright failure)

### EM2 — Inbound IMAP poll

- [~] **Slice merged** — built on `fixing-existing-things`; cron migration applied to Manasik OS
      and verified scheduled/active; not merged
- [x] `lib/channels/email/imap-poll.ts` + cron route `app/api/cron/inbox-email-poll`; migration
      `20261213090000_em2_inbox_email_poll_cron.sql` applied
- [x] Ingestion reuses `ingestInboundMessage()` directly with `agentAllowed: false`; attachments
      uploaded directly during poll (deviation from `persistInboundMediaAttachments`, documented
      in the plan)
- [x] Cursor advances per-message after durable, idempotent writes; first connect bootstraps
      forward instead of importing existing mail
- [x] `ingestInboundMessage` gained an `email` field, forwarded to `linkConversationToLead`'s
      existing (previously unused by any caller) `EXACT_EMAIL` identity-graph match
- [x] Tests: `lib/channels/email/imap-poll.test.ts` (13), `lib/inbox/ingest.test.ts` (+1)
- [ ] **Exit:** a real inbound email appears in the Inbox within one poll cycle; a re-poll
      never duplicates it *(covered by test fixtures; a live test mailbox has not been run)*

### EM3 — Composer and conversation UI

- [ ] **Slice merged** — not started
- [ ] Subject/Cc/Bcc on the composer, gated by channel capabilities
- [ ] "Compose email" entry point; sanitized read-only HTML body rendering
- [ ] **Exit:** reply with Cc/Bcc/subject; compose-new to a fresh address works end to end

### EM4 — Search, folders, read/unread

- [ ] **Slice merged** — not started
- [ ] Search covers subject + body; Email rail queue and lifecycle-status views verified
      channel-neutral
- [ ] **Exit:** search finds an email conversation by subject or body

### EM5 — Security, tests, entitlements

- [ ] **Slice merged** — not started
- [ ] Address validation on every send path; inbound HTML sanitization with an XSS fixture test
- [ ] Entitlement gate via `resolveInboxFeatureAvailability` (Professional-tier channel)
- [ ] **Exit:** lint/typecheck/test green; downgraded agency cannot use the channel; XSS
      fixture never renders

### TG0 — Baseline proof and contract

- [~] **Slice merged** — implementation in progress on `fixing-existing-things`; EM3–EM5 remain incomplete prerequisites accepted explicitly by the requester
- [~] Provider-profile defaults, delivery-profile setup validation, safe diagnostic codes, and dispatch-policy types
- [ ] **Exit:** generic configuration remains valid; every provider preset is validated; unsupported port/security combinations and cross-domain sender attempts fail before persistence

### TG1 — Guided configuration and connection verification

- [~] **Slice merged** — implementation in progress on `fixing-existing-things`
- [~] Safe SMTP verify/test-submission and IMAP INBOX connection-check service; delivery-profile migration with agency RLS
- [~] Provider selection/prefill and persisted safe outcomes in Settings; browser proof and applied migration remain
- [ ] **Exit:** Hostinger-style TLS/465 + IMAP/993 and Generic STARTTLS setup show separate SMTP and IMAP outcomes; bad credentials leave the saved Vault secret intact
---

## Pre-flight — once, before MI0.1

- [x] Baseline recorded: `npm run typecheck && npm run lint && npm test` all green, result written down — before MI0.1: typecheck clean, 100 files / 895 tests passing; after Phase 0: 0 lint errors (259 pre-existing warnings, none from this programme), typecheck clean, 104 files / 948 tests passing
- [x] Latest `supabase/migrations/` filename snapshotted — `20261201090000_lead_retention_followups.sql` (programme migrations start at `20261202090000`)
- [ ] Production numbers captured *(needs production access — not done)*: conversations per agency, inbound messages/day, p95 webhook→visible latency, `ai_runs` volume, `agent_jobs` depth
- [ ] `OPENROUTER_API_KEY`, `CRON_SECRET`, `META_APP_SECRET` confirmed per environment *(needs each environment's settings — not done)*
- [ ] Tracking board created with one row per slice

---

## Phase 0 — measurement and contracts

Nothing can be made cheap or fast before it is measured.

> **Applied-version note:** the migrations were applied through the Supabase tool, which stamps its own timestamp, so `supabase_migrations.schema_migrations` holds `20260920153139` (MI0.1), `20260920153228` (MI0.3), and later ones likewise, while the repo files are `20261202090000`, `…090100`, `…090200`, `…090300`. They sorted *before* `20261201090000`. **Resolved:** `list_migrations` on Manasik OS (checked 2026-09-21) lists every MI migration under its file version (`20261202090000` … `20261202091800`), so `supabase db push` no longer trips on it.

### MI0.1 — Finish the AI cost ledger

- [~] **Slice merged** — branch `transforming-inbox`, not merged. Migration applied to Manasik OS (recorded there as version `20260920153139`, not the file's `20261202090000` — see note under Phase 0) — every box below ticked and the exit criterion demonstrated
- [x] Migration `20261202090000_mi0_1_ai_usage_daily` (applied + verified: rollup dry-run on real `agent_runs` produced 3 rows, re-run left 3 — idempotent; also adds a $0 rate for the free model in use, which the dry-run showed as 9 unpriced runs; also widens `ai_runs.cost_usd` to `numeric(12,8)` — `(10,4)` rounded a classify call to $0; adds `unpriced_runs`; folds `agent_runs` in as surface `WHATSAPP_AGENT`) (+ missing `ai_model_rates` rows), RLS in the same migration
- [x] `lib/ai/rates.ts` — dated rate lookup, 5-minute cache
- [x] `lib/ai/telemetry.ts` — real four-component `estimateCostUsd()` (input / output / cache-read / cache-write priced separately)
- [x] Rollup wired (`app/api/cron/ai-usage-rollup`, hourly at :15 — recomputes yesterday + today; allow-listed in `invoke_cron_route`) into `app/api/cron/*`
- [x] Tests (`lib/ai/rates.test.ts`, `usage-rollup.test.ts`; rollup idempotency is `on conflict do update` in SQL — idempotency now verified against real data on the live DB): `effective_from` boundary · unknown model records `null` not `0` · cache-read priced at the cache rate · rollup idempotent
- [ ] **Exit** *(needs the deployed cron to fill `ai_usage_daily`, and an OpenRouter dashboard to reconcile against)*: month-to-date AI cost shows on `/management/ai-agent` and reconciles with OpenRouter within 5 %

### MI0.2 — Pipeline contracts

- [~] **Slice merged** — branch `transforming-inbox`, not merged — every box below ticked and the exit criterion demonstrated
- [x] `lib/inbox/intelligence/contracts.ts` — every enum and Zod schema; `TravelIntent` re-exported, not redefined
- [x] Tests (26): enums closed and exhaustively switchable · unknown codes rejected · `TravelIntent` jsonb round-trip
- [~] **Exit:** no intent / signal / queue code typed as a bare `string` anywhere in the new modules
  *(holds for every module written so far; it stays open as an ongoing constraint on MI1+ modules)*

### MI0.3 — Observability baseline

- [~] **Slice merged** — branch `transforming-inbox`, not merged; migration applied to Manasik OS (recorded there as `20260920153228`); all three views return rows against live data, and each is `security_invoker` — every box below ticked and the exit criterion demonstrated
- [x] Migration `20261202090100_mi0_3_inbox_metrics_views` — `inbox_intelligence_kpis_daily`, `inbox_lane_health`, `inbox_gate_skip_reasons` (`security invoker`). **Plan deviation:** also creates `inbox_gate_decisions` (RLS'd, empty) — a view needs a base table and MI2.3's exit reads this view. `inbox_lane_health` reads `agent_jobs` as lane `LEGACY_AGENT` until MI1.1 re-creates it
- [x] `lib/metrics/inbox-intelligence-metrics.ts`
- [x] Tests: every view agency-scoped; two-agency fixture returns no foreign rows (12; the fixture proves the loaders filter by agency, and a static test proves each view is `security_invoker` — real RLS is **unexercised until applied**)
- [x] **Exit** *(views applied and queried live — the KPI view returns real inbound volume with `s0_skip_rate` null and zero AI, as expected before MI2.3/2.4)*: every KPI queryable (all zero is the correct first answer)

---

## Phase 1 — lanes and fairness

The scale prerequisite. **Do not ship MI2.4 beyond a pilot agency until this phase is merged.**

### MI1.1 — `channel_jobs` with lanes and fair-share claiming

- [~] **Slice merged** — branch `transforming-inbox`, not merged; migration applied to Manasik OS
- [x] Migration `20261202090200_mi1_1_channel_jobs` — table, `unique (agency_id, coalesce_key) where status = 'QUEUED'`, both indexes, RLS
- [x] `claim_channel_jobs(...)` RPC — ranked in a subquery, `for update skip locked` in the outer query (Architecture §7.2's sketch puts it on a window-function query, which Postgres rejects), claims serialised per lane by an advisory lock so the cap is exact; plus `enqueue_/complete_/fail_/release_stale_` RPCs;, `security definer`, `set search_path = ''`, `service_role` grant only
- [x] `lib/inbox/jobs/queue.ts`
- [x] Tests — behaviours proven against the live Postgres by `scripts/sql/verify-mi1-1-channel-jobs.sql` (rolled back), TypeScript layer by `queue.test.ts` (13): coalescing · fairness (500 jobs A + 5 jobs B served in one tick) · per-agency cap · retry/dead-letter · stale-lock release · cross-tenant claim isolation
- [x] **Exit (measured 2026-09-20, live DB):** 10 000 queued rows across 50 agencies, p95 claim < 50 ms, no starvation over 100 ticks — **measured: claim p95 21.15 ms, max 28.61 ms; one agency held 8 040 rows and all 50 agencies were served on each of the first 40 ticks**

### MI1.2 — Lane workers and the settle delay

- [~] **Slice merged** — branch `transforming-inbox`, not merged
- [x] `lib/inbox/jobs/drain.ts` (+ `settle.ts` — the settle delay and `enrich:<conversation>` coalesce key; the per-agency-configurable delay is a parameter, its settings column arrives with MI2.4's migration) — `processLane()` + handler registry
- [x] `app/api/cron/agent-jobs/route.ts` — three lane drains, budgets summing under 50 s, existing calls untouched
- [x] Both webhook handlers — `after()` also drains REALTIME with a 10 s budget; `processDueJobs` call left alone
- [x] Tests (23 across queue/drain): budget respected · a throwing handler fails one job, not the tick · settle delay batches a five-message burst into one run
- [ ] **Exit** *(claim-level drain verified live: 200 jobs / 3 agencies, one holding 150, drained in 16 claim rounds with the small agencies served in round 1; end-to-end timing needs a real handler — MI2.4 — and a deploy)*: 200-message burst across 3 agencies drains within two cron ticks, no REALTIME job older than 10 s

### MI1.3 — Worker shard fan-out

- [~] **Slice merged** — branch `transforming-inbox`, not merged; cron migration `20261202090300_mi1_3_inbox_lanes_cron` applied (schedules a route that only exists once deployed — until then those calls 404 harmlessly)
- [x] `app/api/cron/inbox-lanes/route.ts` with `?lane=&shard=`
- [-] `proxy.ts` — skipped: `MACHINE_ROUTES` already contains the `/api/cron` prefix, so the route is reachable without a session as-is
- [x] Tests (13): no double-processing (guaranteed by the per-lane advisory lock + `SKIP LOCKED`, proven in the MI1.1 SQL script; the route test asserts shards never fan out further) across shards · fan-out threshold respected · unauthenticated request gets 401
- [ ] **Exit** *(needs a deploy and a real handler)*: 2 000-job REALTIME backlog clears in under 60 s

---

## Phase 2 — the intelligence projection

### MI2.1 — Projection tables

- [~] **Slice merged** — branch `inbox-phase-2-intelligence`, not merged; migration applied to Manasik OS
- [x] Migration `20261202090400_mi2_1_conversation_intelligence` — all four tables + the §5.8 column additions, RLS, composite FKs, indexes. `conversation_queue_membership` PK is `(agency_id, queue_code, conversation_id)` (priority_rank is mutable, so it is a separate desc index instead — deviation from §5.4). A trigger keeps `conversations.intelligence_state` in step with the projection's `state`
- [x] `lib/data/conversation-intelligence-repository.ts`
- [x] Tests — 23 unit tests, plus 22 database checks with real FKs and RLS in `scripts/sql/verify-mi2-1-conversation-intelligence.sql` (rolled back): upsert idempotent on `input_fingerprint` · cross-agency intervention impossible · RLS blocks cross-tenant read · open-intervention gate query correct
- [x] **Exit (measured 2026-09-20, live DB):** a seeded conversation has a readable, agency-scoped intelligence row — a signed-in staff member of agency A read A's row and none of B's, on all four tables

### MI2.2 — Queue membership function and rail

- [~] **Slice merged** — branch `inbox-phase-2-intelligence`, not merged; migrations applied to Manasik OS
- [x] Migrations `20261202090500_mi2_2_conversation_queues` (`compute_conversation_queues()` is the single predicate definition; `refresh_conversation_queues()`; triggers on conversations, intelligence, interventions, messages and leads; backfill; `inbox_queue_counts()`; the `agency_settings.inbox_queues_v2` flag), `…090600_mi2_2b_rls_initplan_inbox_tables` and `…090700_mi2_2c_queue_counts_definer` (both found by the performance run: my RLS policies called `current_agency_id()` per row and the counts query timed out at 20 000 conversations)
- [x] `lib/inbox/queues.ts` — the queue catalogue, grouped Inbox / Commercial / Operations / Channels
- [x] `lib/inbox/views.ts` (the in-memory predicates are deleted; `EMAIL` and `SPAM` were added to the queue contract so every legacy view maps to a queue; the original nine keep their exact meaning) — old nine views mapped onto queue codes, one predicate not two
- [x] `lib/data/inbox-repository.ts` — **`VIEW_SCAN_LIMIT = 5000` scan removed**; counts via `inbox_queue_counts`, list via keyset-paginated `lib/data/inbox-queue-repository.ts`. The server returns `nextCursor`; the "load older chats" control was wired later (see "Other gap fixes"; the first 100 per view render exactly as before)
- [x] `inbox-view-rail.tsx` renders grouped queues with counts when `agency_settings.inbox_queues_v2` is true; the original rail is unchanged when it is false. **Not verified in a browser** — the app needs a sign-in, which I cannot perform. The flag is off for every agency
- [x] Tests — 19 unit tests (mapping, catalogue, cursor, keyset walk with tied timestamps) plus `scripts/sql/verify-mi2-2-conversation-queues.sql` (28 database checks, rolled back): membership + non-membership per queue · trigger correctness across assignment/close/new message/intervention · counts match brute force over 5 000 rows · no duplicates or gaps across pages
- [~] **Exit (measured 2026-09-20, live DB, 100 000 conversations / 322 859 membership rows, `scripts/sql/verify-mi2-2-queue-performance.sql`):** rail counts **p95 131 ms** (max 202 ms) ✓; list first page 5.9 ms and the page after 40 000 rows 3.1 ms, both **Index Only Scan** ✓. **The counts plan is a Seq Scan + HashAggregate, not index-only** (it reads nearly every row of the agency), so it grows linearly — about 1.3 s expected at 1 M conversations; add per-queue counters before an agency approaches that. Leaving this box open for that reason

### MI2.3 — The S0 gate

- [~] **Slice merged** — branch `inbox-mi2-3-s0-gate`, not merged; migration applied to Manasik OS
- [x] `lib/inbox/intelligence/gate.ts` — pure `shouldEnrich()`, every §6 S0 rule (surface off · plan exhausted · spam · closed · human active in the last 2 min · unchanged fingerprint · acknowledgement), red-flag detection in English, Sinhala and Tamil. Also `gate-log.ts` (`recordGateDecision`, never throws) and migration `20261202090800_mi2_3_gate_reason_constraint` (closed reason list + decision/reason agreement, so a skip cannot be logged without a reason). **`recordGateDecision` is not called by anything yet — MI2.4's pipeline calls it**
- [x] ≥ 25 fixtures in `gate.test.ts` — 107 cases across 34 test definitions (rules, 19 acknowledgement / 11 non-acknowledgement phrases in three languages, 15 red-flag positives and 7 negatives, the risk matrix); the tests found two real bugs before shipping (Sinhala/Tamil vowel signs stripped as punctuation; "got it" rejected)
- [x] Test: **a refund / distress / bank-mismatch phrase escalates to risk even when every skip rule holds** — this test is never deleted (a 7 × 3 matrix: each skip rule against each red flag, plus all skip rules at once, plus a precision check that ordinary messages do not escalate)
- [x] **Exit (measured 2026-09-20, live DB, `scripts/sql/verify-mi2-3-gate-log.sql`):** every skip recorded with a reason in `inbox_gate_skip_reasons` — 10 decisions gave each skip reason its own row, `s0_skip_rate` 0.60, and the risk-escalated skip was counted. *This proves the log and the view; the live S0 skip rate of real traffic (target ≥ 50 %) needs MI2.4 to be wired in*

### MI2.4 — S1 triage

- [ ] **Slice merged** — every box below ticked and the exit criterion demonstrated *(branch `inbox-mi2-4-s1-triage`; exit needs the surface switched on and live traffic)*
- [x] Migration `_mi2_4_inbox_triage_surface` — `INBOX_TRIAGE` seeded `SHADOW`, disabled (applied and verified 2026-09-20: 1 agency, 1 row, none on). Also adds `conversation_intelligence.digest`. An agency with **no** row is treated as OFF by the pipeline, because `lib/ai/budget.ts` is permissive for a missing row
- [x] `lib/inbox/intelligence/digest.ts` — rolling 400-token digest, incremental, oldest turns dropped first, Sinhala/Tamil counted pessimistically; stored in `conversation_intelligence.digest`
- [x] `lib/ai/surfaces/inbox/triage.ts` — one `classify` call + rule fallback (`triage-lexicon.ts`, English/Sinhala/Tamil/Singlish); a model `SPAM` verdict on a message about the agency's business is overruled
- [x] `lib/inbox/intelligence/pipeline.ts` — S0→S1 orchestration, `ENRICH` handler (`register-handlers.ts`, imported by both webhooks and both crons). Logs every gate decision, records red flags as rule signals even on a skip, and leaves an existing projection untouched on a skip
- [x] Both webhook paths enqueue `ENRICH` on REALTIME with the coalesce key; persist-and-ack unchanged. *Deviation: the enqueue lives in the shared `ingestInboundMessage` (both handlers call it) rather than in each handler; the handlers only kick the REALTIME drain*
- [x] Tests: 60 labelled messages (30 English, 10 Sinhala, 10 Tamil, 10 mixed) — rule reading 59/60 intent-correct, zero `SPAM` false-positives on genuine enquiries · model failure leaves `source = 'RULES'` + note · no call when the gate says skip · digest within budget in all three scripts. *The 59/60 is the RULE fallback measured on fixtures written alongside it, so it is optimistic; the model's own accuracy is not measured here*
- [ ] **Exit:** shadow mode fills the projection on live traffic, p95 triage < 5 s, S0 skip rate visible and ≥ 50 % *(not measured — needs `INBOX_TRIAGE` enabled for an agency, a deploy, and real messages)*

### MI2.5 — Context rail reads the projection

- [ ] **Slice merged** — every box below ticked and the exit criterion demonstrated *(branch `inbox-mi2-5-context-rail`; the exit is a browser check and needs a signed-in session)*
- [x] `conversation-intelligence-rail.tsx` + `intelligence-evidence-popover.tsx` (shadcn only — Card, Badge, Popover, Button, Skeleton; every fact has a "Why?" showing the message it was read from and a button that scrolls the thread to it; message bubbles now carry `id="inbox-message-<id>"`). The wording and every honesty rule live in a pure, tested `lib/inbox/intelligence/rail-view.ts`
- [x] `customer-context-panel.tsx` composes the rail above the existing lead block, replacing nothing; the rail renders nothing when the agency does not use `INBOX_TRIAGE` and has no stored reading, so the panel looks exactly as before
- [x] `loadInboxIntelligence()` added as a **fourth independent loader** (`inbox-repository.ts` → `inbox-intelligence-repository.ts`, `loadInboxIntelligenceAction`, its own sequence-guarded load in `header-inbox-dialog.tsx`), so a slow projection cannot delay the transcript or the lead panel
- [x] Migration `20261202091000_mi2_5_intelligence_realtime` — the projection now sends the existing `inbox.invalidate` broadcast (applied and verified live: a FRESH→FRESH change now broadcasts; before, only a state change did, via `conversations`). Not in the plan: without it a re-read would not refresh an open rail
- [x] Tests: `PENDING` (and no row) renders the deterministic half + "Copilot is reading this conversation", never an empty panel · a `RULES` reading is labelled a keyword match · a `FAILED` row shows its note · low confidence is stated · every fact carries its source message · flags show even while pending/failed · loader is agency-scoped and returns live signals only · the realtime trigger exists. *Not tested by a component test: the repo has no DOM test environment. The realtime refresh is proven at the database (broadcast fires) and by the dialog's existing refresh path (`refreshInboxDialog` now also reloads the reading silently), not by rendering the rail*
- [ ] **Exit:** verified in the browser at desktop, tablet and mobile widths *(not done — the app needs a signed-in session, which I cannot provide)*

### MI2.6 — SLA policy and the deadline clock (R2)

- [ ] **Slice merged** — every box below ticked and the exit criterion demonstrated *(branch `inbox-mi2-6-sla-clock`; see the exit line)*
- [x] Migration `_mi2_6_inbox_sla_policies` (`20261202091100`, applied and verified live) — `inbox_sla_policies` with RLS in the same migration (read: inbox roles; write: ADMIN/CEO), seeded for every agency from R2's table (the three fastest queues take the agency's existing `ai_settings.handoff_alert_minutes`), `compute_conversation_queues()` gains `SLA_BREACHED` / `NEARING_DEADLINE` and +150 priority on breach, and the sweep is scheduled every 2 min through `invoke_cron_route`. Reuses `agency_settings.timezone` + `ai_settings.working_hours`; no second calendar
- [x] `lib/inbox/sla/business-hours.ts` — pure `addBusinessMinutes` / `isWithinBusinessHours` / `nextOpening`, tested on a Friday-evening arrival, a public-holiday gap, a midnight rollover, split days, a 24-hour-target across a weekend and the `Asia/Colombo` baseline (plus one DST zone). **`ai_settings.working_hours` had no defined shape anywhere and nothing wrote it, so this file defines it** (`{weekly:{mon:["09:00-17:00"]}, holidays:["2026-12-25"]}`); an unset or unparsable value means "always open"
- [x] `lib/inbox/sla/due-at.ts` — `computeSlaDueAt`: `least(queue target, window − 2 h)`, clock pauses in `WAITING_CUSTOMER`/`RESOLVED`, out-of-hours rule falls out of the calendar arithmetic. **Deviation from R2 rule 2:** `WAITING_TEAM` pauses the *resolution* clock only. `WAITING_TEAM` is entered by any open intervention — including the `SLA_BREACH` one a breach opens — so pausing the first-reply clock there would let opening a breach erase it
- [x] Breach handling — `SLA_BREACHED` signal on every breach; an intervention (`SLA_BREACH`, REVIEW) only for `ESCALATIONS`, `COMPLAINTS`, `PAYMENT_DISCUSSIONS`, `BOOKING_READY`; the signal is superseded when the deadline clears. **Deviation:** the plan put this in `refresh_conversation_queues` (SQL) and `lib/inbox/risk/registry.ts` (not yet built, MI4). The business-hours arithmetic must live in ONE place, so the deadline is computed in TypeScript (`lib/inbox/sla/sweep.ts`, run by `app/api/cron/inbox-sla`) and written to `conversations.sla_due_at`; SQL only reads it. A deadline passes without any row changing, so a sweep is required in any design
- [x] `inbox-sla-form.tsx` — per-queue editing (reply/resolve minutes, working-hours-only clock, open-a-review switch) and the working hours + holidays, on the Operations settings page. Server actions start with `requireUser()`, check `editOperations`, validate with Zod, and write through the signed-in client so RLS is the backstop. `NEARING_DEADLINE` / `SLA_BREACHED` are now available queues with views `nearing-deadline` / `overdue`
- [x] Test: **the channel window wins when it is sooner** — never delete this one (`due-at.test.ts`, describe block named for it)
- [x] Tests: one fixture per R2 row (12, first-reply and resolution) · a conversation parked on the customer never breaches (and 50 of them, a week on) · resuming restarts the clock from the new message, never back-dated · 24/7 queue breaches overnight, business-hours queue does not · seed rows equal the code defaults · the sweep is idempotent
- [ ] **Exit:** `NEARING_DEADLINE` and `SLA_BREACHED` counts correct for a seeded `Asia/Colombo` agency, no breach for a paused conversation *(proved in two halves, not yet end to end: the SQL predicates, rank raise and clearing were verified on the live DB with a rolled-back seeded agency — `scripts/sql/verify-mi2-6-sla.sql`; the deadline maths, breach decisions and paused-never-breaches are unit-tested and the sweep runs against a fake database. The real sweep against the live database needs the deployed cron route and a `CRON_SECRET`)*

**Open items from this slice**
- No working hours are saved for any agency yet, so until an owner sets them every "business hours" queue counts around the clock. The form for it is in the Operations settings.
- Business-hours "24 h" and R2's "3 business days" are both seeded as 1 440 open minutes (three 8-hour days); an agency with a different working day edits the minutes.
- The sweep examines at most 1 000 waiting conversations per agency per run, oldest first.
- Not tested by a component test (no DOM environment): `inbox-sla-form.tsx`. Not yet seen in a browser.

---

## Phase 3 — commercial intelligence

### MI3.1 — S2 structured travel intent in the Inbox

- [ ] **Slice merged** — every box below ticked and the exit criterion demonstrated *(on main as PR #130; the exit is a look at the rail with the surface on)*
- [x] Migration `_mi3_1_inbox_intent_surface` (`20261202091200`, applied and verified live: 1 agency, 1 row, none on) — `INBOX_INTENT` seeded `SHADOW`, disabled; plus `conversation_intelligence.travel_intent_evidence` (per-field reading: source, value, evidence). An agency with no row is treated as off by the pipeline
- [x] `lib/ai/surfaces/inbox/travel-intent.ts` + pure `lib/inbox/intelligence/travel-intent.ts` — rules first (the existing extractor), the model only for the fields the rules left unresolved, in **one** call, none when the rules read everything. **Deviation:** the plan said to call the lead-side OpenRouter provider; that provider bypasses `generateStructured()` (no `ai_runs` row, no budget check, no usage rollup), which the programme's rule forbids. This goes through `generateStructured()` with a small closed schema instead. The model must quote the customer verbatim for every field and a quote that is not in their messages is discarded — the rail shows what is evidenced, not what a model asserted
- [x] Pipeline S2 — runs after S1 only for `PACKAGE_ENQUIRY`, `PRICE_REQUEST`, `BOOKING_REQUEST`, `GROUP_ENQUIRY`, only where `INBOX_INTENT` is on, in the same single projection write; an S2 failure never costs the triage result
- [x] Rail renders travellers, window, room, hotel distance, budget, journey and origin (**origin** is not in `TravelIntent`, so it lives in the new per-field map; rule-read from a list of Sri Lankan towns) **with evidence snippets** and a "Why?" link to the source message; each field says "Keyword match" when a rule, not the model, read it
- [x] Tests: the brief's worked example ("4 adults from Kandy, December, school holidays, close hotel, quad") — rules read travellers, window, room and origin, one model call reads the rest, every field has evidence · rules-only path makes no model call · a partial rule result triggers exactly one call, asking only about the unresolved fields · a made-up quote is dropped · a rule reading is never overwritten by the model · Sinhala goes through the model · S2 is skipped for non-commercial intents, an off/absent surface, and a gate skip
- [ ] **Exit:** intent fields visible, `source` labelled per field *(the labelling and evidence are unit-tested on the view model; not yet seen in a browser with the surface on and real messages)*

**Open items from this slice**
- Because the rules almost never resolve all seven fields (budget and origin are rarely stated), nearly every commercial conversation makes one cheap `classify` call. Watch `ai_usage_daily` for `INBOX_INTENT` once it is on.
- Origin knows 32 Sri Lankan towns; anywhere else is left to the model.
- Not seen in a browser; no component test (no DOM environment).

### MI3.2 — S3 live offer matching in the Inbox

- [ ] **Slice merged** — every box below ticked and the exit criterion demonstrated *(branch `inbox-mi3-2-offer-matching`; the exit is a staff member answering a real enquiry from the card, with S2 switched on and a live group)*
- [x] `lib/inbox/intelligence/offer.ts` — pure adapter over the Sales Engine's `matchOffers()`; the candidates come from `loadOfferCandidates()` (the loader behind `/departure-groups` and the Leads drawer), now agency-scoped; the snapshot stores `as_of`, `priced_at` **and** the matched seat count, plus what the card shows
- [x] `revalidateOffer()` returning `FRESH | PRICE_CHANGED | SEATS_INSUFFICIENT | EARLY_BIRD_EXPIRING` (R1) — plus a fifth state, `NO_LONGER_AVAILABLE`, so a closed, departed or foreign group can never read FRESH
- [x] `conversation-offer-card.tsx` with the four PDF actions (`Draft reply`, `Create quote`, `Open group`, `Ask follow-up`); the two text actions put an editable draft in the message box and send nothing
- [x] Server Actions `createQuoteFromConversation`, `openDepartureGroupFromConversation` (and `prepareOfferMessageAction` for the two text actions) — `requireUser()` + capability + Zod; the browser names only the conversation, the offer is re-read and re-checked on the server
- [x] Pipeline S3 — no model, no surface of its own; runs whenever S2 read a journey **and** a party, in the same single projection write; a failure keeps triage and the travel details; a no-match clears a stale offer
- [x] Tests: sold-out group only as waitlist · unpriced room type never offered · recommendation changes with live seats · `as_of`/`priced_at`/seat count recorded · `revalidateOffer` returns `PRICE_CHANGED` after a reprice and `FRESH` when only `updated_at` moved · cross-tenant group never a candidate (candidate loader **and** the live check)
- [ ] **Exit:** "cheapest 10-day Umrah in November for three" answered from the conversation, figures matching `/departure-groups` exactly *(the figures come from the same loader, and the rail re-checks them live each time it opens; not yet seen in a browser against real groups)*

**Open items from this slice**
- No migration was needed (`matched_offer` is jsonb; the new fields default, so an older snapshot still parses).
- A conversation whose only option is a **waitlist** shows no offer card: the matcher returns waitlist options only when nothing is bookable, and `matched_offer` holds a bookable offer. The waitlist case is tested at the matcher; surfacing it on the card is a later step.
- S3 runs only when S2 ran, so nothing appears until `INBOX_INTENT` is switched on.
- The plan says to reuse the offer-matching fixtures already in the repo; there are none, so the tests build their own.
- `loadOfferCandidates` still lists every agency's groups before filtering to one (it goes through `listDepartureGroups`). Correct, but wasteful once there are many agencies.
- Not seen in a browser; no component test (no DOM environment).

### MI3.3 — Cross-channel identity graph and merge review

- [ ] **Slice merged** — every box below ticked and the exit criterion demonstrated *(branch `inbox-mi3-3-identity-graph`; the exit is a real Instagram contact followed by the same person on WhatsApp, in a browser)*
- [x] Migration `_mi3_3_contact_identity_links` (`20261202091300`, applied and verified live: duplicate pair, inconsistent decision and cross-agency link all rejected; rolled back) — edge table, RLS, indexes on both identity columns and `(agency_id, status)`. **Deviation:** the edge is *(subject identity → candidate lead)*, not identity ↔ identity, because most leads predate the Inbox and have no identity row
- [x] `lib/inbox/identity/graph.ts` — candidate ranking and bands (`EXACT_IDENTITY`, `HIGH`, `MEDIUM`, `LOW`), pure. Signals: exact phone/email, same last nine digits (prefix differs), same full name, similar name, same travel month. `LOW` (a name alone) is never proposed
- [x] `identity-match-card.tsx` — "Possible existing lead found" with `[Link conversation]` / `[Create separate lead]`, shown in the context panel when a conversation has no lead
- [x] `lead-linking.ts` / `lead-link-decision.ts` route a non-exact match to a `PROPOSED` link and create **no** lead; an exact phone or a single exact email still links as before; a failed graph lookup falls back to the old behaviour instead of blocking the inbound message
- [x] Confirm / keep-separate / unlink actions write `identity_match_events` (`LINKED` / `SPLIT` / `UNLINKED`; proposals write `AMBIGUOUS`). Each is `requireUser()` + role check + Zod, and runs on the service role only after the check, with every query scoped to the agency
- [x] Tests: only `EXACT_IDENTITY` auto-confirms · a rejected pair is never re-proposed · confirming points one identity at one lead and writes nothing to `leads` · a link across agencies is impossible (repository and database) · unlinking restores the prior state (including a lead the identity had before, and not clobbering a later change)
- [ ] **Exit:** the Instagram→WhatsApp worked example produces the merge card, not a duplicate lead *(the ranking and the "no lead is created" path are unit-tested with the example; not yet seen in a browser)*

**Open items from this slice**
- The plan's PDF is not in the repo, so the worked example is modelled as: an Instagram contact "Fathima Rizvi" exists as a lead, then a new WhatsApp number writes in with the same full name and the same travel month.
- A contact with a suggestion has **no lead** until a person decides, so no owner or follow-up is created in the meantime. That is the point of the slice, but it means an undecided card leaves a conversation unowned.
- The travel-month signal reads only the first message text; the S2 travel window is not used (it arrives after the lead decision).
- Email is only compared when a channel supplies one; nothing passes an email yet.
- Not seen in a browser; no component test (no DOM environment).

### MI3.4 — Commercial stage and estimated value

- [ ] **Slice merged** — every box below ticked and the exit criterion demonstrated *(branch `inbox-mi3-4-commercial-stage`; the exit is a look at the four Sales queues against a seeded agency)*
- [x] `lib/inbox/intelligence/commercial-stage.ts` — pure, **no model call**; stage from the lead's stage, quotes, booking, the matched offer and what S1/S2 read; value from the matched offer's total only
- [x] Commercial queue predicates — migration `_mi3_4_commercial_queues` (`20261202091400`, applied and verified live against a real conversation: each stage lands in exactly its queue, BOOKED / LOST / a non-commercial intent in none). They are added to `compute_conversation_queues()`, which `refresh_conversation_queues` already calls, so the refresh function itself is unchanged. The four queues are now available and have views (`new-enquiries`, `qualified`, `ready-to-book`, `quote-sent`)
- [x] Pipeline writes stage and value in the same single projection write; a failed read leaves the stored stage alone
- [x] Tests: a fixture per stage transition · value comes only from the matched offer · a lost lead leaves every commercial queue · the SQL predicates and `commercialQueuesFor` are compared by a test
- [ ] **Exit:** `NEW_ENQUIRIES`, `QUALIFIED`, `BOOKING_READY`, `QUOTE_SENT` populate correctly against a seeded agency *(verified on one real conversation by stage; not yet against a seeded agency in the running app)*

**Open items from this slice**
- The stage is recomputed when a customer message is enriched, not when a quote is sent or a booking is made. A quote sent by staff moves the conversation to `QUOTE_SENT` on the customer's next message (or the next enrichment), not instantly. Recomputing on those events belongs with the Phase 4 handoff work.
- `QUALIFIED` reads `READY_TO_RECOMMEND`: a matched offer, or travellers and travel month both read, or the lead marked qualified by staff. The catalogue's description ("travellers, dates and room type") is a little stronger than that; it was left unchanged.
- Existing conversations keep the default stage `UNQUALIFIED` until their next enrichment, so those with a commercial intent already show under New enquiries.
- Only the stage and value are stored; no queue counts or SLA settings changed (the policies for these four queues were seeded in MI2.6).

### MI3.5 — Routing and auto-assignment (R3)

- [ ] **Slice merged** — every box below ticked and the exit criterion demonstrated *(branch `inbox-mi3-5-routing`; the exit needs a policy saved for an agency and real conversations)*
- [x] Migration `_mi3_5_inbox_routing_policy` (`20261202091500`, applied and verified live: 0 rows after apply, RLS on with 2 policies, defaults correct, bad threshold / non-object roles / bad mode rejected) — `inbox_routing_policy`, plus `staff_profiles.last_assigned_at`. **No seed:** an agency with no row is routed exactly as before
- [x] `lib/inbox/routing/resolve-owner.ts` — the pure four-step chain (owner-sticky → designated coordinator → least-loaded or round-robin on-shift → `default_lead_owner_id`), taking candidate staff with their availability and load as input
- [x] `lib/inbox/routing/load.ts` — weighted open `NEEDS_REPLY` count (1 per conversation, +1 per 100 priority points, up to 4); `policy.ts` — knobs, defaults, validation
- [x] Settings form (`app/(main)/management/settings/operations/inbox-routing-form.tsx`, with its action) — saving creates the policy and turns routing on
- [x] `assignOwner()` in `lib/agent/whatsapp/tools/handoff.ts` delegates to the chain; with no policy it returns the configured default owner unchecked, as before; if the chain cannot be read the old rule answers
- [x] Pipeline assigns an unassigned, open conversation when it is enriched; a failure never costs the reading; the write only lands while `assigned_to_id` is still null
- [x] Tests: sticky wins over least-loaded when the owner is available and loses when not · off-shift / outside-access-dates / deactivated staff never assigned, conversation stays unassigned and nothing is written · a party of 12 → group coordinator · visa and documents topics route to their roles · ties break deterministically on `last_assigned_at` · no policy row = unchanged · cross-agency scoping on every read and write
- [ ] **Exit:** a new enquiry from a known customer reaches their existing owner; an unknown 12-person enquiry reaches the group coordinator *(both are unit-tested end to end against a fake database; not yet seen with a saved policy on real conversations)*

**Open items from this slice**
- **"On shift" is the office calendar.** No per-person shift or leave record exists, so a person is available when their account is `ACTIVE`, inside its access dates, and (if "only assign during working hours" is on) the agency's working hours are open. A member of staff on leave is only excluded if their access dates or status say so. Per-person shifts would need their own table.
- **Nothing assigns until a policy is saved** (an agency with no row is unchanged). After saving, an unassigned conversation is routed at its next enrichment, which needs `INBOX_TRIAGE` on; the AI handoff uses the chain immediately.
- The chain runs when a conversation is enriched, not on the very first inbound before any reading, because party size and topic come from S1/S2.
- Coordinators are chosen by role, not by inbox capability: routing visa questions to the visa role assigns someone who can see the conversation but, under the current role matrix, cannot reply in the Inbox.
- The load count reads the 2,000 most recent `NEEDS_REPLY` rows; a larger backlog is measured on those.
- The plan puts the form under `management/settings/`; it sits beside the reply-target form on the Operations page, where the SLA settings already are.

---

## Phase 4 — protection and continuity

The phase that makes the Inbox operationally essential rather than merely clever.

### MI4.1 — Rule-based risk detectors

- [ ] **Slice merged** — every box below ticked and the exit criterion demonstrated *(branch `inbox-mi4-1-risk-detectors`; the exit is measured precision on live traffic in shadow, which needs the surface on and staff labelling what fired)*
- [x] Migration `_mi4_1_approved_payment_accounts` (`20261202091600`, applied and verified live: duplicate account, non-digit account and a zero age limit all rejected; RLS on with 2 policies; `INBOX_RISK` seeded SHADOW and disabled) — `agency_payment_accounts` (Admin/Finance only), **`agency_settings.offer_snapshot_max_age_minutes`** (default 60, display-only, R1)
- [x] Eleven detectors in `lib/inbox/risk/detectors/*.ts`, each pure, each with its own test file. `BANK_DETAIL_MISMATCH` reuses the S0 gate's own number matching so the two can never disagree
- [x] `lib/inbox/risk/registry.ts` (a test compares it with `RULE_ONLY_SIGNAL_CODES`), `run.ts`; S4 added to the pipeline behind the new `INBOX_RISK` surface; state signals that stop being true are superseded, message signals never are
- [x] Tests: a positive, a negative and a near-miss per detector · the facts loader (only COMPLETED payments count, agency-scoped, **strict: any failed read throws rather than becoming "no payments"**)
- [x] Test: `PAYMENT_CLAIM_UNVERIFIED` fires on an unconfirmed claim (including the brief's LKR 250 000 example) and **not** when Finance has confirmed it; still fires when the confirmed total is short or the payment is only pending
- [x] Test: `STALE_PRICE_QUOTED` fires when `priced_at` moved and **not** merely because the snapshot is old (R1 — an ancient snapshot with an unchanged price stays quiet)
- [ ] **Exit:** shadow precision measured per detector; `PAYMENT_CLAIM_UNVERIFIED` ≥ 95 % is the gate for MI4.2 *(no live traffic has run through the detectors; nothing is measured yet)*

**Open items from this slice**
- **Shadow means invisible.** With `INBOX_RISK` in SHADOW the detectors record signals and the rail hides them (the S0 flags and the bank-detail flag stay visible). Moving the surface to PROPOSE or ACTIVE shows them. **No intervention is opened** in this slice: that is MI4.2.
- **Labelling exists in code and its MI4.1b migration is applied.** Precision still needs enough staff verdicts over live shadow traffic before it can be measured.
- **The approved-accounts list now has a settings screen** (Settings → Finance; see "Other gap fixes"). Until an agency's Admin or Finance adds accounts, every bank-account number a customer mentions is flagged, exactly as the S0 gate did before.
- `SENSITIVE_DOC_RECEIVED` reads only the file name and caption; the image classifier is MI5.4. A passport photo named `IMG_1234.jpg` is not caught.
- The detectors run when a conversation is enriched (a customer message), not on a timer, so `WINDOW_CLOSING_SOON` is evaluated at the customer's next message and is not a live countdown.
- `offer_snapshot_max_age_minutes` only adds a "worked out N minutes ago" line to the offer card; it never blocks a send.

### MI4.2 — Interventions and the protection gate

- [ ] **Slice merged** — every box below ticked and the exit criterion demonstrated *(branch `inbox-mi4-2-interventions`; the exit is the worked example run in the app with `INBOX_RISK` past SHADOW)*
- [x] `conversation-intervention-card.tsx` — headline, guidance, what to do, owner, acknowledge, resolve / dismiss with a required note. Shown in the rail to everyone who can open the Inbox
- [x] `lib/inbox/risk/protection-gate.ts` — pure; three audiences (automated send, AI draft, staff send). No migration was needed: `conversation_interventions` has existed since MI2.1
- [x] `lib/inbox/risk/never-promise.ts` — the §10.3 deny list as a constant (eleven entries) plus a phrase matcher; `lib/inbox/risk/interventions.ts` — which signals become cards, who owns them, who may close them
- [x] `claim-verifier.ts` gains `verifyDraft` — the never-promise check beside the ungrounded-figure check
- [x] Enforced server-side in three places: `sendStaffMessage` (a person's message), the reply-draft workflow (an AI draft), and the WhatsApp agent's outbound gate (an automated send, fail-closed if the open reviews cannot be read). `updateInterventionAction` re-checks who may close a review
- [x] Cards open from S4 findings and S0 red flags only when `INBOX_RISK` is past SHADOW; the owning role is notified once per new card through the existing staff-notification path
- [x] Tests: **one test per deny-list entry asserting refusal at every autonomy level (L0–L3)** · an open `PAYMENT_CLAIM` blocks a confirming draft and a confirming staff message · resolving unblocks · the gate holds when the Server Action is called directly · only Finance/Admin can close a money review · closing needs a note · fails closed when the reviews cannot be read
- [ ] **Exit:** the "paid LKR 250 000, nothing recorded" example produces the card, a Finance review task, and a draft that acknowledges without confirming *(each piece is tested: the finding, the card, the Finance notification, the withheld confirming draft and the acknowledging one; not yet seen end to end in the app)*

**Open items from this slice**
- **"A Finance review task" is a notification to Finance plus the card**, not a separate task record. It reuses the existing notification kind for handoffs (`HANDOFF_ESCALATED`) so no migration was needed; a dedicated task type would need one.
- **There is no autonomy ladder yet** (MI6.1). `AUTONOMY_LEVELS` (L0–L3) now lives in `contracts.ts` (re-exported by `never-promise.ts`).
- **The never-autonomous list applies to automated text (agent replies, AI drafts), not to a person.** A person may still say those things when no review guards them. While a blocking review is open, what it guards is refused for a person too.
- The phrase matcher is a deliberately cautious net, not a judge of meaning. It will withhold some harmless drafts and cannot catch every wording; it is the middle of three layers.
- A blocking review stops the **AI agent** from replying at all; a person answering from the Inbox is not stopped except for the guarded words.
- Cards are not closed automatically when Finance later records the payment; a person resolves them with a note.
- Not seen in a browser; no component test (no DOM environment). Nothing yet lets staff mark a signal right or wrong, so MI4.1's precision gate for this slice is still unmeasured.

### MI4.3 — Model-assisted risk classification

- [ ] **Slice merged** — every box below ticked and the exit criterion demonstrated *(branch `inbox-mi4-3-risk-classify`; the exit is a week of live shadow traffic with no missed complaint, and the recall gate measured on real messages)*
- [x] Migration `_mi4_3_inbox_risk_model_surface` (`20261202091700`, applied and verified live: 1 agency, 1 row, none switched on). **Deviation:** it seeds a NEW surface, `INBOX_RISK_MODEL`, not `INBOX_RISK` — `INBOX_RISK` was already seeded by MI4.1 and switches the free detectors on; the model call gets its own switch and budget so turning the free detectors on can never start spending
- [x] `lib/ai/surfaces/inbox/risk-classify.ts` — one `classify`-tier call through `generateStructured` (so it is in `ai_runs`, under its surface's budget and in `ai_usage_daily`) returning complaint / fraud concern / medical urgency / religious ruling **and distress** with a verbatim quote and a confidence. `lib/inbox/risk/classify.ts` — the pure lexicon, decision and answer guard
- [x] `lib/data/inbox-risk-repository.ts` (the plan's `run.ts` is pure, so the I/O half sits here) — rules first, the model only when the lexicon is inconclusive **and** the gate allowed enrichment; the four signals become review cards past SHADOW (fraud and medical urgency block)
- [x] Tests on a labelled set of **forty** messages (English, Sinhala, Tamil): strong phrases settled with no model call · quiet messages cost nothing · decoys ("please help me choose a package") never flagged by rules · **with the model down, every distressed fixture is still reported (100 %, gate 95 %)** · a failed model falls back to the lexicon's cues, never to "no risk" · a message nobody can read is reported as unread · the model's quote must be in the message, at ≥ 60 % confidence · cost: the model is asked for fewer than half the labelled traffic
- [ ] **Exit:** shadow review shows no missed complaint over a week of live traffic *(nothing has run on live traffic; the recall figure above is the lexicon fallback on the fixtures, not the model on real messages)*

**Open items from this slice**
- **The recall gate is not measured on the model.** The fixtures prove the fallback path (lexicon with the model down) and the guards; the model's own recall on real traffic needs a week of `INBOX_RISK_MODEL` in SHADOW and a way to mark a signal right or wrong (still missing, from MI4.1).
- **Two switches.** `INBOX_RISK` (free rule detectors, the lexicon flags and the review cards) and `INBOX_RISK_MODEL` (the model call). With only `INBOX_RISK` on, the lexicon still catches strong phrases; weak cues and Sinhala/Tamil messages with no strong phrase are left alone rather than guessed at, so the model is what extends coverage.
- **Strong phrases are cautious and English-led.** The Sinhala and Tamil lexicon is a handful of stems; those messages depend on the model. The fixtures found and fixed a false alarm ("please help me…") and three misses while writing them; the lexicon will need tuning against real traffic.
- The throw path of the classifier's `try/catch` is not unit-tested (the test harness reported the mock's rejection as a test failure); `generateStructured` returns a note rather than throwing, so it is defensive.
- Distress is included beside the four flags in the same call, because the plan's recall gate is defined on distressed customers; the S0 lexicon already raises `DISTRESS_LANGUAGE` for its own phrases, and duplicates on the same message are collapsed.

### MI4.4 — Collision protection and presence

- [ ] **Slice merged** — on main (PR #138); stays open until the two-session exit is demonstrated
- [x] `composer-presence-banner.tsx`
- [x] `message-composer.tsx` claims/releases `composing_by` with a heartbeat; soft-claim action added
- [x] Tests: stale claim ignored · **the banner warns, never hard-blocks** (a hard lock strands a conversation when a tab closes) · `CONCURRENT_COMPOSER` signal written
- [ ] **Exit:** two browser sessions on one conversation each see the other

### MI4.5 — Sales→operations handoff summary

- [~] **Slice merged** — on main (PR #139) but the exit is not demonstrated; stays open until a confirmed booking is handed over and acknowledged in a signed-in browser
- [x] Migration `20261202091800_mi4_5_conversation_handoffs` — applied to Manasik OS (appears in `list_migrations` under its file version; table exists, RLS on, 3 policies, 0 rows). **Not yet exercised:** `scripts/sql/verify-mi4-5-conversation-handoffs.sql` is written but has not been run; run it before relying on the constraints
- [x] `lib/inbox/handoff/build.ts` — deterministic customer, booking, selection and commercial snapshot. **Fixed after merge:** open items were counted over the whole departure group, so "2 passport scans missing" could count other customers' documents. Documents are now read only for **this booking's travellers** (`departure_group_pilgrims.booking_id`), only *required* items count, `SUBMITTED` is reported as "awaiting verification" (not "missing"), and group tasks are worded as group work
- [x] `lib/ai/surfaces/inbox/handoff-narrate.ts` — narrates only customer expectations and sentiment, `RULES`/`LLM` attribution, rejects an introduced figure, never throws
- [x] **Fixed after merge — narration is off by default.** `INBOX_HANDOFF` ships disabled, so the first handoff used to be stored with empty expectations forever. Now a repeat click (button "Add customer summary") fills in the prose while the handoff is unacknowledged and empty (`attachHandoffNarration`, trusted client after the role check; it touches only expectations and sentiment, never the facts, never an acknowledged handoff). A repeat click on a complete handoff makes **no** model call
- [x] **Fixed after merge — the conversation links to its handoff.** `loadInboxLeadContext` returns the stored handoff; the panel shows "Handed to Operations · waiting / acknowledged on …" with **View handoff**, instead of offering to make another. Operations is **notified once** on creation (`HANDOFF_ESCALATED`, to Operations and Admin, not the creator). No timeline event: nothing in the app writes `conversation_events` yet
- [x] **Fixed after merge — the right booking.** The lead's own `booking_id` (when confirmed) wins; the newest confirmed booking is only the fallback
- [x] **Fixed after merge — race.** A lost race on the unique booking index returns the winner (`created: false`) instead of an error
- [x] `handoff-summary-sheet.tsx` and Operations' unacknowledged list show the stored snapshot and attribution, and say plainly when no customer summary was written
- [x] Tests: build (5) · repository flow (13: two customers in one group, other agency's rows never counted, lead's booking chosen, fallback, every read agency-scoped, idempotent create, race winner, narration fill-in guards, cross-agency) · actions (create, repeat click, back-fill, failed narration, role refusal, acknowledge actor)
- [ ] **Exit:** a confirmed booking produces a handoff Operations can acknowledge *(covered end to end against a fake database; not seen in a signed-in browser, and the live constraints are unexercised)*

**Open items from MI4.4–MI4.5**
- Run `scripts/sql/verify-mi4-5-conversation-handoffs.sql` and repeat MI4.4's two-session presence check and MI4.5's confirmed-booking → Operations acknowledgement path in a signed-in browser.
- Handoff creation is a **deliberate manual action** — nothing prompts staff when a booking is confirmed. A reminder (or auto-draft) belongs with the MI4.6 conversions.
- Group readiness tasks are group-level (flights, hotels), not per booking; they are listed as "Group task not complete". Per-booking readiness does not exist in the data model.
- `HANDOFF_SUMMARY` is declared as a STANDARD-lane job kind in `contracts.ts` but unused: handoffs are created by an action, not a job.
- The MI4.4 lint error (`setState` inside an effect in `message-composer.tsx`) is fixed; the earlier "0 lint errors" claim was wrong.

### MI4.1b — Signal review verdicts (gap fix for MI4.1 / MI4.3)

Added after review: the MI4.1 precision gate (≥ 95 % on `PAYMENT_CLAIM_UNVERIFIED`) and MI4.3's recall gate had no way to be measured, because staff could not mark a signal right or wrong.

- [~] **Slice merged** — implementation exists and the migration is applied; the live-signal exit is not measured
- [x] Migration `20261202091900_mi4_1b_signal_review_verdicts` — applied and verified on Manasik OS: all three review columns, constraints/indexes, column-only staff update grant/RLS policy and `security_invoker` precision view exist
- [x] `lib/inbox/risk/precision.ts` (pure: precision, the ≥ 95 % target, and a 20-verdict minimum before a gate can be "met"), `lib/data/inbox-signal-review-repository.ts`, `reviewInboxSignalAction`, `signal-review-card.tsx` on **Settings → Operations** ("Copilot accuracy check"; one tap per signal, shadow signals included, quotes the customer's words)
- [x] Tests: gate maths · once-only, agency-scoped writes · role refusal · migration statically proves column-only grants and `security_invoker`
- [ ] **Exit:** verdicts can be recorded and `PAYMENT_CLAIM_UNVERIFIED` precision is readable *(needs live reviewed signals)*
- Limitation: the card is on the Operations settings page, so **Finance and Sales cannot reach it** (they lack `viewOperations`). Judging is allowed for Admin, Sales, Operations and Finance in the action and the policy; Finance needs the card on its own page or a link.

### Other gap fixes (written, uncommitted)

- [x] MI4.1 — **approved bank accounts screen** on Settings → Finance (`agency_payment_accounts`; Finance/Admin only; only the last four digits are ever shown; accounts are switched off, never deleted). Until an agency lists an account every quoted account number is still flagged
- [x] MI4.2 — `AUTONOMY_LEVELS` / `AutonomyLevel` moved to `lib/inbox/intelligence/contracts.ts` (re-exported from `never-promise.ts`, so no import broke) — MI6.1 should build on that
- [x] MI3.2 — `loadOfferCandidates` no longer hydrates every agency's departure groups before filtering: `listDepartureGroups` / `loadStore` accept an `agencyId` and resolve that agency's groups in the query. The in-memory filter stays as a second check
- [x] MI2.2 — the **"Load older chats" control** is wired (keyset cursor; older pages are kept across refreshes, de-duplicated, cleared on a view change; a note says search only covers loaded chats)

### MI4.6 — Conversation → workflow conversions

Built on the existing proposal kernel, as planned. **All sixteen of the plan's conversions are covered:** twelve through the new "Turn into work" menu, three (lead, quote, booking) through their existing buttons, which now stamp the same back-link, and departure-group assignment, which only *selects* a group (it creates nothing to link).

- [~] **Slice merged** — implementation is on main (commit a84d482); migrations `20261202092000` and `20261202092100` are applied, but the browser exit is not measured
- [x] Migrations — `20261202092000_mi4_6_conversation_source_links` (`leads`, `lead_quotes`, `departure_group_bookings`, `departure_group_tasks`, `pilgrim_support_requests`) and `20261202092100_mi4_6b_more_source_links` (`pilgrims`, `booking_traveller_relationships`, `lead_notes`) are applied and verified on Manasik OS: each of the eight tables has both source columns, three tenant-safe constraints and its partial source-conversation index
- [x] **Twelve proposal kinds** (module / capability that gates each, risk):
  - task-shaped, one row in `departure_group_tasks` — `CONVERSATION_DOCUMENT_REQUEST`, `_VISA_TASK`, `_PAYMENT_FOLLOW_UP`, `_ROOMING_REQUEST`, `_TRANSPORT_REQUIREMENT`, `_GUIDE_ESCALATION`, and `_FEEDBACK_REQUEST` (which survey to send) — `inbox.convertConversation`, LOW/MEDIUM
  - `_COMPLAINT_CASE` — one row in `pilgrim_support_requests` plus an opening note — `inbox.convertConversation`, MEDIUM
  - `_PILGRIM_PROFILE` — a traveller profile from the lead (`origin_lead_id`) — `pilgrims.createPilgrim`, LOW
  - `_TRAVELLER_RELATIONSHIP` — a family / mahram link between two travellers of the booking — `pilgrims.manageTravelAndRooming`, LOW
  - `_PACKAGE_RECOMMENDATION` — a note on the lead naming an open package; it does **not** change the lead's chosen package — `leads.addNote`, LOW
  - `_SEAT_HOLD` — a `HELD` booking through the same `createGroupBooking()` the WhatsApp agent and Departure Groups use (capacity guard, atomic write, the group's own hold period, released by the hourly sweep) — `leads.convertToBooking`, MEDIUM
  Every kind writes with **both source columns in the same statement** (the seat hold stamps its booking straight after, because the booking engine cannot carry them)
- [x] **The proper fix for "conversions that need a decision": a parameterised framework, not five special cases.** Each kind declares typed `fields` (`SELECT` / `NUMBER` / `BOOLEAN`); the **server** supplies the choices for this conversation (`lib/inbox/conversions/choices.ts` — only this booking's travellers, this agency's open packages and active surveys, a seat count bounded by the seats left); `params.ts` refuses any value the server did not offer *before* a request is written; the kind's own Zod schema validates it again; the executor re-checks against the live database at approval. Display names in the "Check before creating" step are derived by the server (`labels`), never sent by the browser, and no decision ever reads them
- [x] **Each kind runs under the capability of the module that owns what it writes**, so a role that cannot do it by hand cannot do it from a chat: the menu greys the option with "Your role cannot do this.", the preview refuses it, and the kernel refuses it again at approval. *Finding:* the `bookings` and `relationships` modules' capability sets are still **placeholders that grant writes only to Admin/CEO**, so they are deliberately not used
- [x] **Tenant-safety fix found on the way:** `resolveOrCreatePilgrimPerson()` matched an existing traveller by passport / phone across **every agency** whenever it ran on the service-role client (the WhatsApp booking agent and now the seat hold), and could attach a booking to another agency's traveller. It now takes the booking's `agencyId` (passed by `createGroupBooking`), filters both lookups by it and stamps new profiles with it. The session path is unchanged
- [x] `lib/inbox/conversions/{catalogue,params,choices,service,source-link}.ts`, `conversation-pack.ts` (lead, booking, travellers, profile, phone, party size — every query names the agency), `conversation-convert-menu.tsx` (details → "Check before creating" → Create; cancelling withdraws the request), `conversion-actions.ts` (`requireUser()`, Zod, agency/person/role from the session, the Inbox capability here **and** the kind's own at approval)
- [x] Small backwards-compatible kernel change: `createProposal` accepts `notify: false` and `proposedBy` (the audit trail names the person, not "Agent")
- [x] Tests (102 new across MI4.6; suite 173 files / 1,936 tests, typecheck clean, lint 0 errors): every executor writes one row with **both source columns**; a message from another conversation or agency can never be the source; a failed insert leaves nothing; supersede when the group changes; **through the real kernel with a fake database:** preview creates nothing, confirm creates one object, cancel leaves no object and cannot be confirmed later, a second preview shows the same request, two confirmations create one object, a repeat within 2 minutes is refused, two different traveller pairs stay open at once, a forged traveller id is refused before any request is written, **a role without the capability is refused at approval and nothing is created**, another agency's request cannot be confirmed; seat hold: `HELD` not confirmed, the group's own hold period, priced from the live offer for this agency, refused for too many seats / a closed departure / an unpriced room / an existing booking / no phone, the booking engine's own refusal passes through, a failed lead link does not fail seats that are held; the person-matching scope fix; both migrations statically prove composite FKs
- [ ] **Exit:** the passport-expiry example offers all five actions and each works *(the mapping is: open existing pilgrim → the customer's traveller profile / "Create traveller profile"; document issue → "Request documents"; renewal → the same task with a note; assign visa officer → "Create visa task"; safe reply → the existing draft button. Not reproduced one-for-one, and nothing has been run in a browser)*

**Corrections to what this slice first reported**
- It said a complaint case would often be blocked because the customer "has no linked traveller record". `departure_group_pilgrims.pilgrim_id` is `NOT NULL`: every traveller on a booking already has a profile. The complaint case is blocked only for a customer with **no booking at all**, and "Create traveller profile" is for that customer.
- It said a feedback request needed a survey "request" record. There is none — the app keeps survey templates and submitted responses only — so the honest object is a task for a person to send the survey.

**Open items**
- Run a signed-in check: create each conversion from a real conversation and confirm the row's `source_conversation_id` / `source_message_id`. **Seat hold especially:** hold seats for a test lead and confirm the booking is `HELD`, linked to the lead, and released by the sweep.
- [x] FIX11: task-shaped conversions assign the designated group owner when available (otherwise the approving staff member), keep the task board's 24-hour due date, and notify the owner. Complaint cases now receive the Support module's high-priority 24-hour SLA and notify Operations.
- A seat hold is offered only where the lead has a selected group and a phone number; the reference is `LD-<lead reference>`, so a second hold for the same lead is refused by the booking engine rather than double-holding.
- No component test (no DOM environment); the menu has not been seen in a browser.

---

## Phase 5 — grounded replies, media, and channel policy

### MI5.1 — Widen the reply pack and the draft surface

- [~] **Slice merged** — implementation is on `fixing-existing`; no slice PR has merged and the seeded-data exit is not yet demonstrated
- [x] `lib/inbox/reply-pack.ts` — implemented and covered on `fixing-existing`
- [x] `reply-context.ts` kept as the narrow no-intelligence fallback
- [x] `workflows.ts` splits frozen system (cached) from volatile instruction
- [x] Draft lands **inside** the composer and remains editable/sendable; the composer inserts published brochure links and creates quote drafts through the existing guarded quote workflow
- [x] Tests: absent figures withheld, blocking intervention refused, changed `priced_at` refused before a model call, and stable system fingerprint asserted
- [ ] **Exit:** the PDF's suggested reply reproducible against seeded data with real inclusions and availability

### MI5.2 — Answer cache (R4)

- [~] **Slice merged** — implementation is on `fixing-existing`; no slice PR has merged and the model-call exit is not yet demonstrated
- [x] Migration `_mi5_2_conversation_answer_cache` applied to Manasik OS as `20260922181303`; pgvector operators are schema-qualified, and the table/RLS, locked-path RPCs, index and security-invoker KPI view were verified live
- [x] `lib/inbox/answers/eligibility.ts` implements cacheable classes and every `NEVER_CACHEABLE` class
- [x] `lib/inbox/answers/cache.ts` implements third-occurrence proposal, approval, version matching, 90-day expiry, and two-rejection retirement
- [x] `approved-answers.tsx` approval queue implemented
- [x] `approveInboxAnswer` capability defaults to ADMIN/CEO and remains dynamically grantable
- [x] Pure cache/eligibility coverage includes every never-cacheable class, tenant/version/similarity/approval/expiry/occurrence/retirement cases; missing-capability and two-question/one-model-call integration tests pass, and two substantial staff corrections atomically retire an approved cached answer
- [ ] **Exit:** hit rate visible in the KPI view; the same question twice makes one model call

### MI5.3 — Full channel-policy state and the `HUMAN_AGENT` path (G14)

- [~] **Slice merged** — implementation is on `fixing-existing`; no slice PR has merged and the one-week live-traffic exit is pending
- [x] Migration `_mi5_3_human_agent_window` applied to Manasik OS as `20260922181310`; the window column and locked-path inbound trigger function were verified live
- [x] `lib/channels/policy-state.ts` implements window/action/template/tag/charge state
- [~] `channel-policy-banner.tsx` and the categorised existing-conversation template picker are wired to approved-template sending; variables, preview, and the latest Meta-derived category/country rate are shown before send; awaiting live rate data and merge
- [x] `composer-state.ts` returns the richer state while preserving existing block reasons
- [x] Adapters declare tag support and both server send/outbox paths recheck policy; `HUMAN_AGENT` is limited to human-authored `HUMAN_ACTIVE` support replies
- [x] `docs/runbooks/channel-messaging-policy-verification.md` written
- [x] Critical automated-surface refusal coverage is implemented across autonomy levels
- [~] Core policy rows, exact window boundaries, both HUMAN_AGENT channels and every eligibility/refusal row in Architecture §10.4 are covered; projected rates use `whatsapp_rate_observations`, while live provider/rate reconciliation remains
- [ ] **Exit:** no delivery failure attributable to a window or tag mistake over a week of live traffic

### MI5.4 — Media intelligence (G8)

- [~] **Slice merged** — implementation is on `fixing-existing`; no slice PR has merged and end-to-end media exits are pending
- [x] Migration `_mi5_4_message_media_analyses` applied to Manasik OS as `20260922181459`; the tenant-composite foreign keys, RLS, private bucket, agency-path storage policy and redaction columns were verified live
- [x] `lib/inbox/media/classify.ts`, `passport.ts`, and `receipt.ts` implemented
- [~] `attachment-intelligence-card.tsx` highlights uncertain fields; the worker now retains originals in the private `inbox-attachments` bucket and the RLS-scoped repository issues five-minute signed view/play links; awaiting migration/application and merge
- [~] Attachment ingest enqueues BULK transcription/document/receipt jobs; all three handlers are registered, preserve the existing voice transcriber, retry idempotently, and mark terminal failures; awaiting live worker verification and merge
- [x] Receipt invariant test passes: no payment mutation; the worker records the claim signal, opens a Finance-owned `PAYMENT_CLAIM` review, and links its proof analysis
- [~] Expired-passport, low-confidence, non-authoritative transcription, safe Meta download, retained-original, and terminal-failure tests pass (focused media suite: 16 tests); live provider/storage verification remains
- [ ] **Exit:** voice note → summary with audio playable; passport → document review with candidate fields; receipt → Finance review

---

## Phase 6 — autonomy, owner view, and commercial

> **Gate:** do not ship Phase 6 to an agency that has not run Phases 2–4
> in shadow for at least a week. Autonomy on top of unmeasured
> intelligence is the failure mode that loses an agency's trust
> permanently.

### MI6.1 — Autonomy ladder for Inbox surfaces (G9, R5)

- [~] **Slice merged** — implementation is on `fixing-existing`; no slice PR has merged and live promotion has not been observed
- [x] Migration `_mi6_1_inbox_autonomy` applied to Manasik OS as `20260922181507`; all four RLS tables, disabled SHADOW seeds and locked-path audited level-change RPC were verified live
- [x] `lib/inbox/autonomy/level.ts` implements entitlement ∧ surface ∧ conversation state
- [x] `lib/inbox/autonomy/send-gate.ts` implements the final refusal point
- [~] `lib/inbox/autonomy/promotion.ts` implements the shared R5 promotion/demotion thresholds and 14-day narrow window; the server runtime checks current evidence before every automated send and atomically steps an unsafe L2/L3 setting down; awaiting live verification and merge
- [x] Inbox autonomy control implements L0–L3, a read-only never-autonomous list, and named L2/L3 blockers
- [x] Both automated delivery paths (`outbox/drain.ts` and the direct channel `deliverAgentReply`) consult the same final runtime gate before provider contact and audit refusal/send decisions
- [x] Copilot proposals record `PROPOSED` evidence, staff send/heavy-edit resolves it to `SENT`/`REJECTED`, and the intelligence rail records reviewed S1 intent samples instead of incorrectly treating risk-signal precision as triage accuracy
- [~] Manual promotion/demotion uses an atomic audited RPC, preserves the original promotion timestamp, permits safety demotion even while evidence is below threshold, and still blocks an unsafe upward move; awaiting database integration coverage
- [~] Level, deny-list, threshold, approved-set, 150-decision, narrow-window, direct-send refusal, heavy-edit, and one-step demotion coverage passes (focused autonomy/action suite: 50 tests); live promotion/demotion and audit-table verification remain
- [ ] **Exit:** L0→L1→L2 is observable, reversible, audited, and L2 cannot be enabled while any blocker stands

### MI6.2 — L3 bounded autonomous intake

- [~] **Slice merged** — state machine, persistence and runtime orchestration are on `fixing-existing`; no slice PR has merged and the live overnight exit remains
- [x] `lib/inbox/autonomy/intake-flow.ts` declares the bounded state machine, first/second stall behaviour, deterministic English/Sinhala/Tamil questions, and mandatory handovers
- [~] The PROCESS_INBOUND runtime resolves the effective `INBOX_INTAKE` L3 entitlement before the model, persists `inbox_intake_states`, creates/updates only a provisional lead, and hands over with a collected-facts note on completion or a forbidden topic; awaiting migration/application and live verification
- [x] `lib/inbox/autonomy/__evals__/*` includes the worked multilingual flow
- [x] Intake tool set remains a tested strict subset with no money/inventory-confirmation tool, while the deterministic runtime invokes no booking or payment path
- [~] Eight-step, mid-flow price handover, no-booking, two-turn stall, provisional-lead, runtime handover, delivery-gate, Sinhala, and Tamil coverage passes (focused L3/migration suite: 29 tests); live overnight verification remains
- [ ] **Exit:** overnight enquiries produce provisional leads, correct queue, human-review requirement, zero deny-list violations across the eval suite

### MI6.3 — Owner inbox intelligence (G10, R6)

- [~] **Slice merged** — implementation is on `fixing-existing`; no slice PR has merged and exact drill-through exits are pending
- [x] Migration `_mi6_3_inbox_owner_kpis` applied to Manasik OS as `20260922181513`; the view exists with `security_invoker=true`
- [x] `inbox-intelligence-panel.tsx` links each metric to its queue and labels pipeline values as estimates
- [x] `lib/inbox/pipeline-value.ts` buckets per currency without conversion or cross-currency sums
- [~] Currency bucketing, single-currency output, deterministic KPI-column mapping, security-invoker source checks, and working Inbox-dialog queue drill-through are covered; a database fixture reconciliation and signed-in UI proof remain
- [ ] **Exit:** each number drills to its exact underlying queue

### MI6.4 — Plans, entitlements and metering (G13)

- [~] **Slice merged** — implementation is on `fixing-existing`; no slice PR has merged and live allowance degradation is pending
- [x] Migration `_mi6_4_plans_entitlements` applied to Manasik OS as `20260922181521`; all four RLS tables, four plan seeds, grandfathered subscriptions and locked-path metering RPCs were verified live
- [x] `lib/billing/entitlements.ts` and atomic `lib/billing/meter.ts` implemented
- [x] Platform plan assignment and read-only agency usage card implemented
- [x] `lib/ai/budget.ts` implements the §8.6 degradation ladder
- [x] Intelligence gate reads exhausted entitlements while rule-based risk remains active
- [~] Idempotent metering, every ladder rung, 200%-utilisation risk, human-send-at-200%, and downgrade-trigger clamp/reason coverage pass; live database clamp and allowance degradation remain
- [ ] **Exit:** an agency at its allowance degrades exactly as specified, the owner sees why, and no customer conversation is silenced

### MI6.5 — Scale verification

- [~] **Slice merged** — harness/runbook are on `fixing-existing`; staging scale run and exit are pending
- [x] `scripts/load/inbox-multitenant.ts` enqueues 50 agencies × 200 real ENRICH jobs for staging workers, polls end-to-end completion, reports per-agency percentiles/S0 skip/cost/fairness, asserts the measurable targets, and cleans up by run id; not run against staging
- [x] `docs/runbooks/inbox-intelligence-operations.md` covers queue depth, starvation, budget exhaustion, provider outage, and replay
- [x] `docs/progress/2026-09-21-inbox-phases-5-6-implementation.md` records implementation status, not results; measured scale snapshot remains
- [ ] Tests: every SLO from Architecture §12 · S0 skip rate and cost-per-enriched-conversation within target · no agency's REALTIME p95 degrades > 20 % under another agency's burst
- [ ] **Exit:** every SLO met, results recorded, runbook written

### MI6.6 — Retention and deletion (R7)

- [~] **Slice merged** — implementation is on `fixing-existing`; no slice PR has merged and dry-run/live reconciliation is pending

> Land this **before** an agency accumulates a year of attachments —
> retroactive retention on a full store is a migration, not a sweep.

- [x] Migration `_mi6_6_conversation_retention` applied to Manasik OS as `20260922181535`; all seven bounded settings, attachment promotion/expiry state, RLS sweep audit and locked-path cron function were verified live
- [x] `lib/inbox/retention/policy.ts` is pure and clamps to platform bounds
- [~] `lib/inbox/retention/sweep.ts` is batched, audited with a cursor, and supports `dryRun`; private Storage objects are removed before attachment/message rows through one shared deletion primitive, with fault coverage proving a Storage failure stops row deletion; multi-batch live fault injection remains
- [~] `lib/inbox/retention/promote-attachment.ts` plus the Inbox "Save to Documents" action copies passport/payment-proof originals into an existing single-traveller requirement, submits them for normal verification, and exempts the Inbox row from short attachment expiry; multi-traveller bookings deliberately require choosing the traveller in Documents; awaiting live storage/RLS verification
- [~] `inbox-retention-form.tsx` shows bounds and every message attachment now shows its known expiry date, including attachments with no intelligence analysis; awaiting browser proof
- [x] Nightly BULK cron is registered; the signed Meta deletion callback revokes credentials and resolves its connection-owned conversations through the same Storage/message deletion primitive as retention; the public legal page accurately distinguishes deauthorization from Meta deletion and remains non-destructive itself
- [x] Booking-linked-at-24-months protection test passes
- [~] Unconverted/booking-window/bounds/plan-tier, database bounds, Storage-before-row deletion/failure, dry-run no-mutation, intervention lifetime, and Meta callback routing coverage passes; multi-batch live audit and Meta-equivalence verification remain
- [ ] **Exit:** dry run counts match the live sweep; no passport attachment older than its window remains in the message store

---

## Per-PR gate — tick for every slice, not once

Copy this block into each slice's PR description.

- [ ] New table ⇒ RLS **in the same migration**; new `security definer` ⇒ `set search_path = ''` + minimal grant
- [ ] Every Server Action / Route Handler: `requireUser()` first, capability check, Zod at the boundary, agency-scoped read and write
- [ ] No generic component or function names
- [ ] shadcn through MCP only; every input in the mandated `InputGroup` composition; no new colours
- [ ] Every model call through `generateStructured()` or the shared tool runner, with `surface` / `agencyId` / `subjectType` / `subjectId`; never throws to the caller
- [ ] Every AI-derived value shows `RULES` vs `LLM` and its confidence
- [ ] Two-agency cross-tenant isolation test for every new repository function
- [ ] `npm run lint && npm run typecheck && npm run test` green
- [ ] Checklist box ticked here, and the Progress table updated

---

## Decisions R1–R7 — implemented and covered

Architecture §16. Tick when the behaviour exists **and** its test exists.

- [ ] **R1** Price staleness by change-detection, not a timer — MI3.2, MI4.1
- [ ] **R2** Per-queue SLA with the channel window outranking every target — MI2.6
- [ ] **R3** Owner-sticky routing, least-loaded only as tie-break — MI3.5
- [~] **R4** Implemented and unit-covered on `fixing-existing`; migration applied and verified, merge/model-call exit pending — MI5.2
- [~] **R5** Implemented and unit-covered on `fixing-existing`; merge and live evidence pending — MI6.1
- [~] **R6** Implemented and unit-covered on `fixing-existing`; merge and UI integration proof pending — MI6.3
- [~] **R7** Constraint migration and uniform pure policy are written on `fixing-existing`; database applied and verified, merge and dry-run/live reconciliation pending — MI6.6

## Gaps G1–G15 — closed

Architecture §3.2. Each needs a test naming its gap id.

- [ ] **G1** Conversation intelligence fields — MI2.1, MI2.4
- [ ] **G2** Business-consequence queues — MI2.2, MI3.4 *(MI2.2's half is built: escalations, complaints, payments, documents, visa; commercial queues land in MI3.4)*
- [ ] **G3** Offer matching as an Inbox surface — MI3.2
- [ ] **G4** Risk and escalation engine — MI4.1, MI4.2, MI4.3 *(MI2.3 built the S0 red-flag escalation that feeds it)*
- [ ] **G5** Cross-channel identity graph with approved merges — MI3.3
- [ ] **G6** Sales→operations handoff summary — MI4.5
- [ ] **G7** Conversation→workflow conversions — MI4.6
- [ ] **G8** Attachment and media intelligence — MI5.4
- [ ] **G9** Autonomy ladder L0–L3 — MI6.1, MI6.2
- [ ] **G10** Owner inbox intelligence — MI6.3
- [ ] **G11** Per-run AI cost and quotas — MI0.1, MI6.4
- [ ] **G12** Lanes, fairness, and the 5 000-row queue-count scan — MI1.1, MI1.2, MI1.3, MI2.2 *(scan removed and lanes built; awaiting merge and the MI1.2/1.3 end-to-end exits)*
- [ ] **G13** Plans, entitlements, metering — MI6.4
- [ ] **G14** Meta `HUMAN_AGENT` 7-day window — MI5.3
- [ ] **G15** Per-conversation language state — MI2.4

## Programme definition of done

- [ ] All fifteen gaps closed, each with a test naming its gap id
- [ ] All seven decisions implemented and covered
- [ ] Every SLO in Architecture §12 met under the MI6.5 load test
- [ ] AI cost per enriched conversation ≤ $0.012 **measured**, not estimated
- [ ] S0 skip rate ≥ 50 % measured on live traffic
- [ ] Zero cross-tenant leakage across every retrieval path
- [ ] Every never-autonomous item refused at every autonomy level, with a test per item
- [ ] The current WhatsApp reply path behaves identically to its pre-programme baseline with every new flag off
- [ ] [`architecture.md`](./architecture.md) and [`implementation-plan.md`](./implementation-plan.md) updated to match what was actually built, with a `docs/progress/` snapshot per phase
