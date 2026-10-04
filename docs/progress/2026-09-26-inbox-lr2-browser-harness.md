# LR2 Playwright browser harness

**Date:** 2026-09-26  
**Status:** implemented; not yet run against a non-production target

`npm run test:e2e` runs the Playwright suite in
[`../../e2e/inbox-lr2.spec.ts`](../../e2e/inbox-lr2.spec.ts). It creates
separate browser contexts for two Agency A staff members, a read-only Agency A
staff member, and an Agency B staff member. The suite covers control, draft,
send, internal note, channel-window/permission/ownership feedback, Realtime
reconnect, tenant isolation, and keyboard/accessibility labels.

The environment parser requires all test identities and fixture conversations,
permits only `staging` or `disposable`, and refuses a project ref that matches
`INBOX_E2E_PRODUCTION_PROJECT_REF`. Browser credentials and artifacts are
ignored by git.

The earlier manual-decision snapshot remains an accurate historical record.
This harness supersedes its interim no-runner decision; the manual runbook
still supplies screen-reader and independent-review evidence. No browser was
signed in and no provider message was sent while implementing this harness, so
LR2 remains open.
