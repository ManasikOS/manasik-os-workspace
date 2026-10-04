# TASK-008 Dashboard Reference Alignment

## What
Align the existing role-aware dashboard's top layer with the supplied role
dashboard reference: a personal briefing, compact KPI row, period control,
and working drill-downs.

## Why
The dashboard needs to answer each signed-in staff member's operational
question immediately, while keeping its metrics and actions connected to the
real, role-gated data already assembled by the dashboard repository.

## Data model changes
None.

## Access control changes
None. The existing server-side role and capability gates remain the sole
authority for which data and panels are visible.

## UI surfaces
`/dashboard`, its briefing panel, KPI row, and upcoming-departures panel.

## Test plan
Run lint, typecheck, and the targeted dashboard tests. Manually verify the
dashboard at desktop and mobile widths, including the period control and the
departure-groups drill-down.

## Status
Done. The dashboard preserves its existing server-side role and data gates,
now labels the briefing to the current role, uses a safe staff-name greeting,
exposes the period control, presents metrics four-up on wide screens, and
links the departure-groups summary to its full queue.
