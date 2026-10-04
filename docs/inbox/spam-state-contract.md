# Inbox spam-state contract (PRD-03)

Decision recorded 2026-10-01: spam is a **conversation-level** state, reversible without any extra column.

## Definition

A conversation is spam when **either**:

- `conversations.lifecycle_status = 'SPAM'`, or
- its linked lead's stage is `SPAM` (the pre-existing rule).

Spam conversations are in the Spam queue and excluded from All and from every other queue. The intelligence gate skips them
(`SKIP_SPAM`).

## Marking and restoring

| Action | Writes | Never changes |
| --- | --- | --- |
| Mark as spam | `lifecycle_status = 'SPAM'` | `state`, owner, lead, messages |
| Restore from spam | `lifecycle_status = 'CLOSED'` if `state = 'CLOSED'`, otherwise `'OPEN'` | `state`, owner, lead, messages |

Restoring writes exactly what the lifecycle was before, because the lifecycle is derived from the chat's own state, so the
round trip returns the chat to where it started.

## Rules

- Permission is the existing `closeConversation` capability. Both actions go through `bulkUpdateConversationsAction`.
- **Fail closed:** if any selected conversation is not the caller's agency's, or any safety fact cannot be read, nothing is changed.
- A conversation is **not marked** when its lead has a booking, when it has an open review (intervention), when it is already
  spam, or when its lead is already spam.
- A conversation is **not restored** while its lead's stage is `SPAM`, because it would stay in Spam. Change the lead's stage in
  Leads first.
- Every write is guarded on the `state` and `lifecycle_status` it was planned against, so a concurrent change is reported as
  skipped, never overwritten.
- One audit event (`SPAM_MARKED` / `SPAM_RESTORED`) is written per changed conversation.
- Bulk sends, payment or Finance changes, document verification, risk resolution and AI proposal approval remain impossible in
  bulk. Tag changes remain deferred (decision D6).
- Spam marking does not delete, send or publish anything, and it does not change what the WhatsApp assistant does with an
  incoming message: it is an organisational state plus Copilot enrichment skipping.

## Release order

Migration `20261222090000_inbox_spam_lifecycle_queues.sql` must be applied **before** this code is released. Without it the
queues ignore `lifecycle_status`, so a marked conversation would stay in the working lists. It has been applied to Manasik OS.

`lifecycle_status` is nullable (legacy rows are NULL), so the queue function reads it as `coalesce(lifecycle_status = 'SPAM', false)`;
a bare comparison would turn NULL rows into NULL spam and remove them from every queue.
