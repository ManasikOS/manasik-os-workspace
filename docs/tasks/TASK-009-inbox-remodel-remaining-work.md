# TASK-009 Inbox Remodel: Remaining Work

## What
The ordered checklist of everything in [TASK-007](TASK-007-inbox-dialog-ux-remodel.md) that is not built yet. Items are built
top to bottom; tick a box only when the code, its tests, typecheck and lint are green. `[-]` means deliberately not built, with the reason
on the line. Nothing here is browser-verified until the last section says so.

## Why
TASK-007 shipped Phases 1–4 with known gaps. This file is the single list of those gaps, in build order: small, self-contained,
no-new-backend items first; items that need a new server action or data next; items that need product decisions or backend fixes last.

## Data model changes
None planned for A–C. D and E may need new columns or tables; each is flagged on its line.

## Access control changes
None for A–C. Any new server action re-checks capability and agency scope.

## UI surfaces
Inbox overlay and `/inbox` page: new-chat dialog, policy banner, attachment cards, rail, panel.

## Checklist

### A. Small, no new backend
- [x] A1. New-chat dialog: "Will link to existing lead {name}" / "No lead yet" line (needs one read-only lookup action by number)
- [x] A2. Reply-window banner: "Draft reply" button when the window is closing (composer exposes its suggest action)
- [x] A3. Voice notes: "Copy transcript" on a transcribed voice message ("Play original" already exists in the bubble). "Create support task" not built: no support-task conversion exists, and "More actions" already covers tasks and cases
- [x] A4. Rail: "Back to the CRM" link (the Inbox is now a standalone page). Closed and Spam are already rail queues. Retention settings link not added: it needs a settings-role check; low value
- [x] A5. Keyboard navigation: J / K next and previous chat as listed, "/" focuses search; never while typing

### B. Needs a small read action
- [x] B1. Panel "History" block: conversation started and every owner change (`conversation_events`, read by `loadInboxHistoryAction`). Not included: "lead created" and "Copilot reply sent", which have no recorded event
- [x] B2. Booked departure: show the booked group's name and payment status with an "Open booking" link (context loader adds the fields)

### C. Needs a new server action
- [x] C1. "Assign visa officer" on a passport: `loadVisaOfficersAction` + `assignVisaOfficerForPassportAction` (officer must be active staff whose role does visa work; writes the visa module's own fields and an ASSIGNED history row; capability `assignVisaOfficer`)
- [x] C2. Passport "Review fields": edit the read passport number and expiry, then `applyPassportDetailsAction` writes them through the traveller record's own updater (capability `reviewPassportFields`). The read name is not editable here: a traveller's name is not changed from a photo

### D. Needs data or a rollout decision
- [x] D1. Seat-hold departure state: a `HELD` booking shows "Seat hold" with a countdown from `seat_hold_expires_at`, or "Hold expired" once it passes (no migration; the context loader reads the existing column)
- [x] D2a. Routing reason: when routing picks an owner it writes an `OWNER_ASSIGNED_BY_ROUTING` conversation event (step and reason), and History shows "Assigned to X by routing: {reason}". Best effort; never undoes the assignment
- [-] D2b. "Copilot is drafting…": not built. Jobs are keyed by payload, not indexed for this lookup, and not broadcast in realtime, so the label could go stale and mislead staff
- [ ] D3. Grouped queue rail as the default (not started: you chose D4; this stays a rollout decision): per-agency flag `inbox_queues_v2`, a migration/rollout decision
- [x] D4a. Deeper search: typing still filters the loaded chats at once; after 350 ms the server searches every conversation (name, number, lead reference, lead name, package; first 50) and those matches replace the list. A result outside the loaded list opens like any other. Text is normalised (`lib/inbox/search-query.ts`) before it reaches a filter
- [x] D4b. Bulk actions: "Select conversations", then give the selection to a colleague (or Unassigned) or close it. At most 50; the server checks every chat, skips closed or already-owned ones, and reports how many changed. Assign writes an audit row per chat and one notice to the new owner
- [x] D4c. Saved views: a private "Saved views" menu in the list header (open one, save the current queue + search, remove). At most 20 each. **Needs migration `20261203090000_inbox_saved_views.sql` applied first**; until then the menu says saved views are not available

### E. Backend fixes that gate Admin AI settings (Phase 3.2)
- [x] E1. One effective autonomy policy: the older WhatsApp assistant switch now authorises ordinary generated replies only while nobody has ever set the Inbox reply level (`legacyAssistantMayAuthorise`; "ever set" = an audit row from `set_inbox_autonomy_level`). An explicit choice, including L0 (stored as disabled), is the single policy. **Behaviour change:** an agency whose admin once saved L0 and relied on the older switch will stop getting automatic replies
- [x] E2. `max_turns_per_conversation` now counts every assistant reply in the conversation (not the 20-message window), so the default of 40 can trigger. When it does, the chat goes to staff with the note "The assistant handed this chat to staff after N replies, which is its limit for one conversation."
- [x] E3. `escalate_after_failed_turns` removed from the Admin form and the save action (a failed turn hands off at once, so an "after N" setting would promise something that does not happen). The database column stays, unused
- [x] E4. Quiet-lead follow-ups only send while the agency is open, by the same working-hours calendar and timezone as the reply targets; unset hours mean always open. A held-back nudge is sent by the next sweep that runs while open
- [x] E5. A customer writing to a closed chat writes a `CUSTOMER_REOPENED` conversation event; History shows "Reopened by the customer"
- [x] E6. Admin AI settings wording: Observe only / Draft replies / Safe automatic replies / Lead intake assistant, each with a plain description, and the "always human-only" list shown with ticks (11 items, exactly what the code refuses). L0–L3 and the internal modes stay in the code

### F. Not building
- [-] F1. "Attach" as a button: brochure links stay a select; no user need found
- [-] F2. "Take over anyway": sending is never blocked, so the button would add a click and nothing else
- [-] F3. "View evidence" on offers: an offer has no source message to show; the "Why this matches" list covers it

### G. Verification (needs a signed-in browser session)
The step-by-step script is [`docs/runbooks/inbox-remodel-verification.md`](../runbooks/inbox-remodel-verification.md).
- [ ] G1. Tab through the overlay and the `/inbox` page; check focus, screen reader order and status not shown by colour alone
- [ ] G2. Check at 320 / 768 / 1024 / 1440 px, light and dark, reduced motion
- [ ] G3. Check the `/inbox` page height, the address sync, and a notification click while on `/inbox`
- [ ] G4. Save a real passport to Documents and confirm the checklist item, storage object and audit event
- [ ] G5. Assign a chat and confirm the notice and the `OWNER_CHANGED` row
- [ ] G6. Open the PR, squash `d55e3d8` into the next commit, tick `docs/inbox/checklist.md` where a slice applies

## Test plan
Each new rule is a pure function in `lib/inbox/` with a Vitest test. `npm run lint`, `npm run typecheck` and `npm run test` must pass before
a box is ticked. Section G is manual.

## Status
**Migrations applied 2026-09-25 to the Manasik OS Supabase project** (`klognjpwmqwlgeibvanf`): `sc1_atomic_inbound_persistence`,
`sc2_typed_inbox_realtime_events`, `sc2_message_sequence_assignment`, `sc3_conversation_version`, `sc5_scoped_inbox_broadcasts`,
`detach_source_messages_on_conversation_delete` and `inbox_saved_views`. They are recorded in the project's migration history
under versions `20260925041420` to `20260925042011`, not under the local file names. Verified after applying: saved views has RLS
on with 3 policies and no anon access; the message sequence and conversation version triggers exist; the SC5 scoped triggers
replaced the agency-wide one; no message lacks a sequence number; the atomic ingest function is service-role only. SC1 to SC3
objects already existed there (applied earlier outside the migration history), so those three ran as no-op re-applications.

In progress. Sections A, B, C, D (except D3) and E are built (unit-tested, typecheck and lint green, not browser-verified). The Inbox moved to
`app/inbox` with its own layout (uncommitted work on branch `upgrade-inbox`); this file's paths follow that move. D needs product decisions and E needs backend work; both are next.
