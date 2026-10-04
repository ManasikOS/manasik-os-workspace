# TASK-005 Inbox Scaling Baseline

## What

Implement SC0 from `docs/inbox/scaling.md`: a fail-closed load-runner contract, disposable 50-agency fixture setup/cleanup, the documented scoped Realtime/read target, and an operations checklist for recording the current baseline.

## Why

The current Inbox has agency-wide invalidations that can trigger four full reads. Before changing persistence, database broadcasts, or the client, the team needs a safe and reproducible measurement baseline.

## Data model changes

None.

## Access control changes

None. The runner is service-role-only and refuses every target except an explicitly identified staging project or a project whose owner has supplied the exact disposable-data confirmation.

## UI surfaces

None.

## Test plan

Vitest covers dry-run parsing, invalid profile rejection, staging-target rejection, and the explicit disposable-current-project exception. An authorised disposable run must record the SC0 exit metrics before SC1 or SC2 begins.

## Status

In progress — local SC0 safety and documentation work is implemented; the disposable baseline remains unmeasured.
