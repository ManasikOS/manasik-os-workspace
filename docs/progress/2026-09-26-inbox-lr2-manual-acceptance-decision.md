# LR2 browser acceptance decision

**Date:** 2026-09-26  
**Status:** manual suite documented; live acceptance not run

## Decision

LR2 uses the staffed manual suite in
[`inbox-launch-readiness-acceptance.md`](../runbooks/inbox-launch-readiness-acceptance.md)
until the project approves a browser harness that can create two isolated
non-production agencies and Inbox fixtures, sign in distinct eligible and
denied-write staff sessions, exercise a real provider test/delivery path and
controlled load error, and demonstrate Realtime reconnect recovery.

The current test configuration is intentionally Node-only Vitest. No browser
runner or approved fixture/session bootstrap exists. Introducing one inside
LR2 would be a separate platform decision, not evidence that this deployed
release candidate is safe.

## Coverage mapping

| LR2 requirement | Runbook evidence |
| --- | --- |
| Human Inbox golden flow | G1–G6 |
| Empty, load error, blocked channel window, permission, and coworker ownership feedback | N1–N5 |
| Keyboard, focus, labels/errors, landmarks, and responsive accessibility | A1–A5 |
| Two staff sessions, reconnect recovery, and no cross-agency disclosure | R1–R4 |

## Not performed

No browser was signed in, provider message sent, data changed, or staging or
production system accessed while documenting this decision. This is not
acceptance evidence and does not promote an LR2/programme checkbox. A later
dated snapshot must cite the operator, independent reviewer, deployed
commit/environment, protected test identities, and protected evidence before
LR2 can advance.
