# TASK-010 Inbox Component Decomposition

## What

Split the Inbox's oversized client components into focused state, synchronization, and presentation units without changing its behaviour.

## Why

The workspace controller, conversation panel, list, composer, conversion menu, view rail, and context panel exceed the UI maintainability threshold. Smaller units make Inbox changes easier to review and less likely to disrupt real-time reconciliation.

## Data model changes

None.

## Access control changes

None. Existing capability checks remain at their current UI/action boundaries.

## UI surfaces

`/inbox`: extract, in order, controller state/realtime synchronization, message timeline, composer controls, conversation rows, and context sections. Preserve the current desktop rail and responsive customer-details Sheet.

## Test plan

Retain all existing Inbox logic tests. Add focused pure tests only when an extracted helper has business-rule branching. Run lint, typecheck, full Vitest, then verify list selection, message sending, and customer-context access in the browser at tablet and desktop widths.

## Status

In progress — the Inbox view rail navigation has been extracted into its own focused component. Next: separate `InboxWorkspaceController` loading and real-time synchronization responsibilities without changing reconciliation behaviour.
