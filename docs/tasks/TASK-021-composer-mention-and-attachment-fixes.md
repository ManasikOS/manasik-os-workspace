# TASK-021 Composer mention removal + attachment "doesn't belong" fix

## What
Two more fixes from the same message-composer deep dive as TASK-020:

1. **Mentioning a staff member in Internal note had no way to undo it.**
   `app/inbox/components/message-composer.tsx`'s "Mentioning @X" line is
   now a row of removable pills (each with an ✕), not plain text — click
   one to drop that person from the note and its "@name" text.
2. **A staff attachment refused with *"That upload doesn't belong to
   this conversation. Attach the file again."* even for a freshly
   uploaded, correct file.** `isStagedPathFor`'s `idSchema` in
   [`lib/inbox/attachments/staff-attachment.ts`](../../lib/inbox/attachments/staff-attachment.ts)
   used `z.string().uuid()`, which (Zod v4) enforces RFC 4122
   version/variant nibbles and rejects a syntactically valid Postgres
   uuid that doesn't conform — exactly what this environment's seed
   agency id, `00000000-0000-0000-0000-000000000001`, is. Switched to
   `z.string().guid()`, which accepts any correctly-shaped uuid without
   the stricter version/variant check.

## Why
- **Mention removal:** `mentionedUserIds` only ever grew
  (`setMentionedUserIds((ids) => [...ids, staff.id])`); nothing in the
  UI ever called it with a filtered-down array, so a mis-click had no
  undo short of clearing the whole note and starting over.
- **Attachment refusal:** confirmed directly against the database
  (`select agency_id from staff_profiles where email = ...`) that this
  test agency's real id is `00000000-0000-0000-0000-000000000001` — a
  value Postgres stores and returns without complaint, but whose version
  nibble (`0`) isn't 1–8, so Zod v4's `.uuid()` rejects it while
  `.guid()` accepts it. Reproduced live: staged a real PNG, sent it, and
  watched it come back "Not sent" with exactly this message before the
  fix, then re-verified the identical flow (plus the user's own
  independently-attempted `Resume.pdf`, sent from their own browser tab
  against the same running dev server) both delivered successfully
  after the fix, with no other code change.

## What was checked and found to be a separate, non-code issue
"Draft with Copilot" refusing was the TASK-020 L0-autonomy gate — the
user asked to raise this test agency to L1 for real testing purposes,
which was done through the actual `saveInboxAutonomyLevel` settings
action (Manage → Manasik Copilot → "What the assistant may do on its
own" → Draft replies → Save), not a raw database edit, so it went
through the real eligibility/audit path. Verified in the database
afterward: `ai_surface_settings` for this agency's `INBOX_REPLY` surface
now reads `enabled: true, mode: "PROPOSE", level: "L1"`. Confirmed live
in the browser: Copilot now proceeds past the old L0 refusal; the one
conversation tested against then hit a *different*, correct refusal —
"This lead has opted out of contact" — which is the consent gate working
as intended for that specific lead's data, not a bug.

Also noticed in passing (logged, not fixed here — out of scope for this
task and unrelated to the composer): a hydration-mismatch console error
on `/management/ai-agent` from a `<button>` nested inside another
`<button>` in the app sidebar's user-menu dropdown. It made that page's
"Saving…" button appear to hang after a save, even though the save
itself completed successfully server-side (verified directly in the
database). Worth a follow-up task if it recurs elsewhere.

## Data model changes
None.

## Access control changes
None.

## UI surfaces
`app/inbox/components/message-composer.tsx` (mention pills).

## Test plan
- Automated:
  [`lib/inbox/attachments/staff-attachment.test.ts`](../../lib/inbox/attachments/staff-attachment.test.ts)
  gained a case asserting `isStagedPathFor` accepts a seed-style agency
  id whose version nibble isn't RFC 4122-conformant. No automated test
  added for the mention-removal UI (this repo's Vitest setup has no
  jsdom/component-render environment, per `vitest.config.mts` — same
  constraint noted in TASK-020).
- Existing suite: full repo Vitest run passes unchanged
  (332 files / 3518 tests).
- Manual: reproduced both bugs live against the real dev database
  before fixing, then re-verified after — mention pills render and
  correctly remove on click; a real PNG attachment now sends
  successfully end-to-end (and the user's own independently-staged
  `Resume.pdf`, sent from a separate browser session against the same
  server, also now shows delivered).

## Status
Done.
