# TASK-040 Departure Flights Responsive UI

## What
Make the Departure Group Flights tab usable across phone, tablet, laptop, and desktop widths while preserving its existing workflows.

## Why
Flight actions, route details, transit legs, deviation rows, and the pilgrim ticketing table assumed wide screens and could clip or compress on smaller devices.

## Data model changes
None.

## Access control changes
None.

## UI surfaces
Departure Group detail page, Flights tab. The per-pilgrim ticketing list now uses the existing shared `DataTable` responsive row pattern.

## Test plan
Run ESLint, TypeScript, and Vitest. Verify the tab at 320px, 768px, 1024px, and 1440px, including headings, actions, routes, transit legs, deviations, and ticketing rows.

## Status
In progress.
