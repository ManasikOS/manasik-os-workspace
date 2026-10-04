# TASK-016 Conversation-ownership write hardening

## What
Two related hardening fixes to [`app/inbox/actions.ts`](../../app/inbox/actions.ts)
found in the same 2026-09-27 stress-test pass as TASK-015:

1. **Compare-and-swap on conversation ownership writes.** `assignConversationAction`
   and `bulkUpdateConversationsAction` now guard their `UPDATE` with the
   exact `state`/`assigned_to_id` they read moments earlier, instead of a
   plain `WHERE agency_id = ? AND id = ?`.
2. **Explicit agency scope on `prepareStaffAttachmentUpload`'s conversation
   read**, matching the rest of the file's "belt and suspenders" convention
   of scoping every query by `agency_id` even though RLS already enforces it.

## Why
- **Lost-update race (finding #2):** both actions compute a patch from a
  `SELECT` taken at the top, then write with no guard on what might have
  changed since. Two staff members concurrently assigning the same
  conversation (one via a single assign, one via a bulk view; or two
  bulk actions racing) could have the second writer silently overwrite the
  first's ownership change — last-write-wins — while the audit trail and
  returned counts still reported success as if nothing had conflicted.
  Fixing this also happens to make the `conversation_events` audit row's
  "from" snapshot provably accurate: it can now only be written for a
  row the guard confirmed hadn't changed since the read.
- **Missing defense-in-depth filter (finding #3):**
  `prepareStaffAttachmentUpload`'s conversation lookup at
  [`app/inbox/actions.ts`](../../app/inbox/actions.ts) selected by `id`
  alone, relying solely on RLS to keep it agency-scoped. Not exploitable
  today, but it was the one path in the file with no code-level backstop
  if that RLS policy is ever loosened — every other query in this file
  scopes by `agency_id` explicitly for exactly that reason.

## Data model changes
None.

## Access control changes
None — both changes tighten existing checks; no new capability, role, or
permitted action is introduced.

## UI surfaces
None. Server Actions only (`app/inbox/actions.ts`); a lost race now
surfaces as a plain refusal message ("Someone else changed this
conversation just now. Refresh and try again.") on `assignConversationAction`,
and as an extra row counted under `skipped` on `bulkUpdateConversationsAction` —
no new UI was added to distinguish it from any other skip reason.

## Test plan
- Automated: [`app/inbox/assign-and-bulk-actions.test.ts`](../../app/inbox/assign-and-bulk-actions.test.ts)
  (new file) exercises both actions against a fake Supabase client that can
  simulate a guarded write matching zero rows:
  - `assignConversationAction` succeeds and the write includes the CAS
    filters when nothing raced it; it returns a refusal (no silent
    overwrite) when another writer already changed the row.
  - `bulkUpdateConversationsAction` assigns every row when nothing raced;
    when one of several rows lost the race, it is counted under `skipped`
    and the rest are still written.
  - [`app/inbox/actions.protection.test.ts`](../../app/inbox/actions.protection.test.ts)
    gained a case asserting `prepareStaffAttachmentUpload`'s conversation
    read is filtered by `agency_id`, not just `id`.
- Existing suite: full inbox Vitest run (`app/inbox`, `lib/inbox`,
  `lib/data/inbox-*`, `lib/ai/surfaces/inbox`, `lib/access/inbox-access.ts`)
  passes unchanged otherwise.
- Manual: none required for either fix — both are server-side query/guard
  changes with no new UI surface.

## Status
Done.
