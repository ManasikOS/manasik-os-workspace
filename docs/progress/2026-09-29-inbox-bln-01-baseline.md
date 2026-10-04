# Inbox BLN-01 capability and decision baseline

**Verified:** 2026-09-29

**Repository baseline:** `eb54346` (`main` / `origin/main`)

**Database baseline:** Manasik OS, Supabase project `klognjpwmqwlgeibvanf`

**Scope:** [`BLN-01`](../inbox/spec-task-list.md)

## Outcome

BLN-01 is complete. The repository,
migration history, current rollout settings, and available live channel
evidence have been reconciled. Existing capabilities remain baseline
capabilities; later specification tasks extend or expose them rather than
creating competing implementations.

The repository-wide lint blocker was removed by making the URL-resolved Finance
navigation the remount key for `FinanceWorkspace`, eliminating its synchronous
effect-driven state reset. All required quality gates now pass.

This is a point-in-time engineering baseline, not a production launch record.
The only connected Supabase project available to this workspace is Manasik OS.
Production deployment parity and the two-party browser/provider acceptance
remain separate release gates.

## Repository and migration lock

| Check | Result |
| --- | --- |
| Git base | `eb54346`; the branch starts at the same commit as `main` and `origin/main` |
| Repository migrations | 209 SQL files |
| Manasik OS migrations | 209 rows |
| Name/version reconciliation | Exact set match; no repository-only or database-only migration |
| Latest migration | `20261219090000_tg5_delivery_status_events` |
| Focused baseline tests | 16 files, 223 tests passed |
| Full test gate | 361 files, 3,702 tests passed |
| Typecheck gate | Passed |
| Lint gate | Passed with 279 existing warnings and no errors |

The focused suite covered WhatsApp ingestion/send, Messenger webhook/echo,
Instagram webhook/ingestion, email adapter/poll/start, passport and receipt
review, audio playback, and autonomy runtime/send/legacy-authority contracts.

## Runtime and flag baseline

| Control | Verified state | Consequence for later work |
| --- | --- | --- |
| `plans.features` | Canonical optional-product entitlement source | Do not add parallel Inbox product flags |
| `ai_surface_settings` | Canonical model/autonomy execution source | Surface absence or disabled state must fail closed in Inbox-specific code |
| `agency_settings.inbox_queues_v2` | Temporary grouped-rail rollout control | Preserve until its dedicated removal slice |
| `INBOX_WORKER_ACTIVE` | Deployment environment value is not exposed to this workspace; code defaults to webhook/cron draining when unset | Do not infer the deployed worker mode from source code alone |
| Manasik OS job activity | 3,656 REALTIME and 26 BULK jobs completed in the preceding 14 days; 2 BULK jobs are dead | Queue processing is active, but this does not identify the deployment flag value |
| Inbox Reply | Enabled, `PROPOSE`, L1 for the one current agency | Human approval remains required |
| Inbox Intake | Disabled, `SHADOW`, L0 | No autonomous intake is enabled |
| Triage, intent, risk, risk-model, handoff | Disabled in `SHADOW` | Their code is baseline, but live AI behaviour must not be assumed |
| Autonomy audit | One recorded change, latest at 2026-09-27 08:18 UTC | Later autonomy work must preserve and extend this audit trail |

## Channel before-state

The counts below are aggregate, contain no customer content, and came from the
Manasik OS database on 2026-09-29.

| Channel | Connection/live evidence | Baseline classification |
| --- | --- | --- |
| WhatsApp | One connected account; 19 customer, 15 staff and 1 AI canonical messages; 15 sent outbox rows and 15 sent delivery events | Implemented and exercised. Preserve the adapter, outbox and provider-send boundary |
| Instagram | One connected and one disconnected account; 31 signature-valid webhook rows; 4 customer, 1 staff and 1 AI canonical messages; one sent outbox/delivery row | Implemented and exercised. Preserve; full policy-window acceptance remains a release gate |
| Messenger | One connected account and 100 signature-valid webhook rows; the connection has a recent inbound timestamp, but no Messenger canonical message row exists in the current data set | Implemented in code; transport evidence exists, canonical end-to-end live proof is still required before release |
| Email (`GMAIL`) | One connected mailbox; 4 customer and 14 staff canonical messages; 12 sent and 2 dead outbox rows; 12 sent delivery events | Adapter and live mailbox flow are baseline. Dead-row handling and later email phases remain governed by the email plan |

The webhook audit rows for Messenger and Instagram have no `processed_at`
timestamp. That field is therefore not accepted as processing proof; canonical
messages, outbox rows and delivery events are used where they exist.

## Media and financial-truth before-state

| Capability | Live evidence | Locked interpretation |
| --- | --- | --- |
| Passport | One `PASSPORT` analysis in `REVIEW_REQUIRED` | Existing extraction/review and Save to Documents are baseline; no automatic traveller truth |
| Receipt | One `RECEIPT` analysis in `REVIEW_REQUIRED` | Existing risk review is baseline; a receipt is evidence, never a payment mutation |
| Voice | Five `VOICE` analyses in `READY`; original audio playback has separate verification | Playback is baseline. The planned staff transcript is non-authoritative and does not replace the original |
| Other media | Four `OTHER` analyses in `READY` | Preserve fallback/download behaviour while adding explicit routing |

Related evidence: [audio playback correction](../inbox/audio-playback-verification-2026-09-28.md),
[LR0 release baseline](2026-09-26-inbox-lr0-release-baseline.md),
[provider acceptance preflight](2026-09-23-fix13-browser-provider-acceptance.md), and
[LR2 acceptance decision](2026-09-26-inbox-lr2-manual-acceptance-decision.md).

## Decision lock

The proposed defaults in `spec-implementation-plan.md` are accepted:

1. **D1:** ADMIN, CEO, FINANCE, and assigned staff with
   `openFinanceReview` may promote Finance evidence; the server capability
   check is authoritative.
2. **D2:** unmatched Finance evidence follows agency Inbox retention; legal
   hold overrides deletion.
3. **D3:** transcription uses the existing AI provider abstraction; English,
   Arabic, and mixed-language output are allowed and low confidence is labelled.
4. **D4:** completeness uses `confirmed`, `customer-stated`, `inferred`, and
   `missing`; only confirmed/customer-stated values satisfy readiness.
5. **D5:** staff roles default to My Shift; ADMIN/CEO retain the current
   default until usage evidence supports a change.
6. **D6:** bulk tagging is deferred until a canonical taxonomy and permission
   contract exist.
7. **D7:** Guide access is a separate approval-gated pilot specification, not
   part of the core release.

## Checkpoint P0 sign-off

Engineering baseline sign-off is complete. Later tasks may rely on the
repository/migration and explicit decision facts above. They must not assume:

- production deployment parity with Manasik OS;
- a verified value for `INBOX_WORKER_ACTIVE` in the deployed environment;
- canonical Messenger end-to-end traffic from the current live data set; or
- completion of the pending two-party browser/provider acceptance.

Those are explicit release-evidence gaps, not reasons to rebuild existing
capabilities.
