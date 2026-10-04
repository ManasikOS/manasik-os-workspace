# TASK-019 Composer dropdown-menu redesign (completed in-progress work)

## What
Finished an in-progress redesign of the message composer's toolbar
([`app/inbox/components/message-composer.tsx`](../../app/inbox/components/message-composer.tsx)):
the "Mention staff", "Saved replies", and "Attach brochure" controls now
use the design system's `DropdownMenu` instead of a native `<select>`,
matching the rest of the Inbox UI. The channel-policy banner
([`app/inbox/components/channel-policy-banner.tsx`](../../app/inbox/components/channel-policy-banner.tsx))
that sits directly above the composer in `conversation-panel.tsx` lost
its bottom border/radius so it visually merges with the composer below
it.

## Why
This redesign was found half-finished, uncommitted, in the working tree
during a 2026-09-27 production-readiness check (not something built in
this task from scratch): the `DropdownMenu` swap was done, but three
working features — the "Draft with Copilot" button, the attach-a-file
button, and the convert-to-task menu — had been commented out along with
their now-unused imports (`COPILOT_NAME`, `Sparkles`,
`ConversationConvertMenu`, `ComposerAttachButton`, plus the `canConvert`
prop and `isSuggesting` state), leaving 6 lint warnings and, more
importantly, three real features missing from the composer with no
visible explanation. Restoring them as plain buttons alongside the new
dropdowns keeps the redesign's UI upgrade while losing nothing a staff
member could do before.

## Data model changes
None.

## Access control changes
None.

## UI surfaces
`app/inbox/components/message-composer.tsx`,
`app/inbox/components/channel-policy-banner.tsx` (both client
components inside the Inbox thread panel).

## Test plan
- Automated: no dedicated unit test exists for this client component
  (consistent with the rest of the composer's sibling components); `tsc
  --noEmit` and `eslint` both clean, and the full repo Vitest suite
  (332 files / 3517 tests) passes unaffected, since nothing here touches
  server-side logic.
- Manual: verified in the browser — the "Mention staff" dropdown lists
  the agency's real staff and inserts the same `@name` mention text as
  before; "Saved replies" and "Attach brochure" dropdowns render and
  insert correctly; "Draft with Copilot", the attach-file button, and
  the "More actions" convert-to-task menu (with its "Create quote" item)
  all render and open without console errors.
- `npm run build` succeeds with no errors.

## Status
Done.
