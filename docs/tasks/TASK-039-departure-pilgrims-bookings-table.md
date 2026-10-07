# TASK-039 Departure Pilgrims and Bookings Table

## What
Use the existing shared `DataTable` component from the Departure Groups page for the pilgrim manifest and booking list on the Departure Group detail page.

## Why
The hand-built wide tables did not follow the established responsive row pattern and were difficult to use on smaller screens.

## Data model changes
None.

## Access control changes
None.

## UI surfaces
Departure Group detail page, Pilgrims & Bookings tab. Existing card headings remain inside their cards.

## Test plan
Run lint, TypeScript, and Vitest. Verify mobile card rows and desktop table rows in the browser.

## Status
Done.
