# TASK-001 Inbox Dialog And Navigation Feedback

## What
Replace the route-intercepted Inbox experience with a header-owned dialog that opens without changing the current URL. Show an Inbox-shaped skeleton immediately while its data loads, remove Inbox from the sidebar, and make ordinary sidebar navigation expose clear pending feedback.

## Why
The current header icon navigates to `/inbox` before opening a modal, which makes the interaction feel like both a page transition and a dialog. Other route changes can also appear unresponsive while server-rendered pages are loading.

## Data model changes
None.

## Access control changes
None. The existing Inbox capability gate remains authoritative in the header and the server-side data loader.

## UI surfaces
- Main header Inbox trigger and dialog
- Inbox workspace loading, view selection, and conversation selection
- Main sidebar navigation
- Main layout route-loading feedback

## Test plan
- Run `npm run lint`, `npm run typecheck`, and `npm run test`.
- Verify in the browser that the header icon opens a dialog without changing the URL, the skeleton appears before data, Inbox is absent from the sidebar, internal Inbox selection stays inside the dialog, closing returns focus to the trigger, and regular sidebar navigation shows pending feedback.
- Verify the dialog's empty, error, permission-denied, desktop, and mobile-width behavior.

## Status
In progress.
