# TASK-034 Inbox: delete a conversation

## What
Staff can permanently delete one conversation from the Inbox, like deleting a chat in WhatsApp: **Conversation actions (⋯) → Delete conversation → confirm**. The chat, its messages, notes, drafts and attachments (the stored files too) are removed for good, and the screen moves to the next chat.

## Why
The Inbox could only close a conversation. Closed chats stay forever, along with test chats, mistaken chats and customer data an agency has to erase. The only deletion path was the Meta data-deletion callback.

## Data model changes
None. The schema already decides what a deletion does to everything that points at a conversation:
- Conversation content (messages, notes, drafts, events, handoffs, follow-ups, intelligence, queue membership, signals, voice transcripts, attachments, media analyses) is deleted with it (`ON DELETE CASCADE`).
- Business records (leads, bookings, tasks, quotes, lead notes, finance evidence intake, pilgrims, support requests, WhatsApp charges, assistant runs) are kept and only lose the link to the chat (`ON DELETE SET NULL`).
- The send queue (`outbox_messages`) points at the conversation and its messages with `ON DELETE RESTRICT`, so its rows are deleted first. This is also fixed for the existing Meta data-deletion callback, which shares the same function (`deleteInboxConversations`) and would have failed on any chat that ever had a staff reply.
- The queue counts follow the delete through the `conversations_release_queues` trigger (migration `20270108090000`).
- Files copied out of the Inbox (finance evidence, passport documents) live in their own buckets, so deleting the Inbox copy does not touch them.

No migration, so the schema fingerprint baseline (G15) does not change.

## Access control changes
New capability `deleteConversation` in `lib/access/inbox-access.ts`: **ADMIN only**, because the deletion cannot be undone. To allow other roles, change that one capability; the server action and the menu both read it.

## UI surfaces
- `app/inbox/components/conversation-actions-menu.tsx`: a destructive "Delete conversation" item (shown only with the capability) and a confirmation dialog that says what is deleted and what is kept.
- `app/inbox/components/inbox-refresh-context.tsx`, `inbox-workspace-content.tsx`, `inbox-workspace-controller.tsx`: after a delete the open conversation is dropped from the address and the list is reloaded so the server picks the next chat (a plain refresh would ask for the deleted chat again).

## How it works
`deleteConversationAction` (`app/inbox/actions.ts`) starts with `requireUser()`, checks the capability, validates the id (Zod), confirms through the person's own session that the conversation is one they can see, then runs `deleteConversationPermanently` (`lib/inbox/delete-conversation.ts`) with the service client, which re-checks the agency before deleting. Only ids and counts are logged (`inbox.conversation_deleted`): never message text or contact details. There is no database audit table; the log is the record of who deleted what.

If the customer writes again, a new conversation starts (the old one no longer exists to reopen).

## Test plan
Automated: `lib/inbox/delete-conversation.test.ts` (nothing deleted for another agency's id, send queue cleared before messages and conversation, every delete scoped to the agency, stored files removed, a failed step stops the rest); `lib/access/inbox-access.test.ts` (administrators only).
Manual (browser): delete a chat with messages, a reply and an attachment as ADMIN; the list moves on, the lead and booking made from it remain, the queue counts drop; a non-admin does not see the menu item; deleting the last chat shows the empty state.

## Status
Built and checked (2026-10-04) on the local stack as an administrator: a chat with a customer message was deleted from Conversation actions, the toast said so, the list dropped from 5 to 4 chats and moved to the next one, the address lost the deleted id, and the database held no row of it (neighbouring chats untouched). A live check against the same database also deleted a chat that had a queued send, which the shared deletion function could not do before. Not checked: the non-administrator view (covered by the capability test), and a chat with attachments or a linked lead.
