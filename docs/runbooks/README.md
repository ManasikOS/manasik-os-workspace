# Runbooks

Operational procedures: manual verification steps, external submission
processes (e.g. WhatsApp/Meta app review), and anything else a person runs
by hand rather than code that executes automatically.

Keep these current with the actual external service/UI they describe —
unlike [`docs/progress/`](../progress/) snapshots, a stale runbook is a bug
because someone will follow it literally.

## Index

- [`messenger-meta-setup-and-test.md`](messenger-meta-setup-and-test.md) — Meta app setup, connecting a test Page, the end-to-end Messenger test, and App Review.
- [`messenger-instagram-hardening.md`](messenger-instagram-hardening.md) — Phase 8: what is enforced and where it is tested, Meta's deauthorize and data-deletion callbacks, the tenant-isolation SQL checks, and the redaction check.
- [`instagram-meta-setup-and-test.md`](instagram-meta-setup-and-test.md) — Instagram's own onboarding: its Login configuration, the Instagram webhook, connecting an account, and the Instagram test script.
- [`whatsapp-app-review-submission.md`](whatsapp-app-review-submission.md) — ready-to-paste WhatsApp App Review content.
- [`whatsapp-connection-verification-runbook.md`](whatsapp-connection-verification-runbook.md) — verifying a WhatsApp connection.
- [`performance-baseline-runbook.md`](performance-baseline-runbook.md) — measuring page performance.
- [`supabase-scheduling.md`](supabase-scheduling.md) — the scheduler (decision R9): `pg_cron` jobs, Vault configuration, pausing and resuming a job, job health, and recovery.
- [`inngest.md`](inngest.md) — *(removed, R9)* what replaced Inngest, what was deleted, and how to finish the removal in the dashboards.
- [`inbox-worker.md`](inbox-worker.md) — the always-on Inbox worker: build and check, configuration, deployment requirements, the staged rollout and rollback, and what to watch.
- [`inbox-health-alerts.md`](inbox-health-alerts.md) — the five-minute Inbox health check: what it reports to Sentry, the Sentry alert rules to create, release order, and rollback.
- [`inbox-attachment-checks.md`](inbox-attachment-checks.md) — what happens to a file before it is sent from the Inbox (SEC-8): the policy-filter checks and what they cannot catch, what `PENDING` and `CLEAN` really mean while no scanner runs, the upload size limit, and the decision on adding a real scan.
- [`inbox-rate-limits.md`](inbox-rate-limits.md) — the per-person and per-agency limits on starting chats, template sends and AI helpers (SEC-6): the defaults, how to change one agency's limits, how to see usage, and what happens if the counter fails.
- [`outbound-allowlist.md`](outbound-allowlist.md) — outside production the app sends only to the contacts in `INBOX_OUTBOUND_ALLOWLIST` (empty means nobody), where it is enforced, how to set it, plus the environment banner.
- [`production-gate.md`](production-gate.md) — the go-live gate (`npm run verify:production`): what each of its checks proves, what a FAIL or PENDING means, the settings it needs, and what it does to the target.
- [`provider-simulator.md`](provider-simulator.md) — how tests and the go-live gate drive the Inbox without a real phone or Meta account: the in-memory sender for test agencies, signed fake webhooks, failure injection, and the safeguards.
- [`inbox-remodel-verification.md`](inbox-remodel-verification.md) — the step-by-step browser check for the Inbox remodel (TASK-007 / TASK-009): opening, owners, composer, attachments, search, bulk actions, saved views, assistant settings and accessibility.
- [`inbox-launch-readiness-acceptance.md`](inbox-launch-readiness-acceptance.md) — LR2's staffed staging/disposable acceptance suite for human Inbox flows, state feedback, accessibility, Realtime recovery, and tenant isolation.
- [`onboarding-invite-template-verification.md`](onboarding-invite-template-verification.md) — proving self-serve signup end to end on a real Supabase project: the Invite template, the golden path, and the failure paths (defect D1).
- [`departure-groups-security-rollout.md`](departure-groups-security-rollout.md) — the ordered rollout and verification of the Departure Groups security work (TASK-037): migrations, database and two-tenant checks, the browser pass per role, atomic persistence, traveller data retention and erasure, and the decisions still open.
- [`operations-navigation-journeys.md`](operations-navigation-journeys.md) — TASK-013 Slice 4: role-by-role check of the consolidated Operations navigation, old-bookmark redirects and responsive layout.
