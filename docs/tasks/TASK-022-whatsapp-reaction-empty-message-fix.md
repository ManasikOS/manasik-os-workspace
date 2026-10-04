# TASK-022 A WhatsApp reaction was landing in the Inbox as an empty message

## What
Tapping an emoji reaction on a WhatsApp message was being stored and
shown in the Inbox as a new, empty message — on **both** sides of a
conversation, via two separate code paths that both needed the fix:

1. **A customer's reaction** (the originally reported case) — dropped in
   [`storableInboundMessageIds`](../../lib/whatsapp/inbound-ingest.ts)
   (used by the raw-event reconciler) and
   [`ingestWhatsAppInboundMessages`](../../lib/whatsapp/inbound-ingest.ts)
   (the live webhook path).
2. **Staff reacting from their own phone**, in the WhatsApp Business app
   itself (coexistence) — echoed back to us via `message_echoes` and
   inserted as a "staff" message by
   [`handleWebhookDelivery`](../../lib/whatsapp/webhook-handler.ts)'s
   `message_echoes` loop. This is almost certainly what the report ("reacting
   to a message from phone") actually meant, and the first pass of this fix
   (case 1 only) missed it entirely, because it never touches that loop.

Both loops now call a new shared `isReactionMessage()` predicate and skip
the entry before it ever reaches `extractMessageText`/`extractMessageType`
or a store/insert call.

## Why
Meta's Cloud API delivers a tapped reaction — a customer's, or the
agency's own from the WhatsApp Business app — as its own webhook entry:
a real `id` and `from`/`to`, but `type: "reaction"` and a
`reaction: { message_id, emoji }` payload instead of `text`/`image`/etc.
Neither `extractMessageText` nor `extractMessageType` (in
[`lib/whatsapp/inbound-ingest.ts`](../../lib/whatsapp/inbound-ingest.ts))
recognised that type, so both silently fell through to their defaults —
`""` and `"TEXT"` — and `isUnsupportedWhatsAppMessage` doesn't catch it
either (it only checks for `video`/`sticker`/a disallowed `document`
mime type). The reaction therefore sailed through as a normal, storable
message with no text: an empty bubble in the conversation thread.

The `message_echoes` loop in `webhook-handler.ts` calls
`insertMessage`/`extractMessageText`/`extractMessageType` directly and
independently of `inbound-ingest.ts`'s functions — it is not a call site
of `storableInboundMessageIds` or `ingestWhatsAppInboundMessages`, so
fixing only those two (as the first pass of this task did) left this
path completely unfixed. That is why the bug was reported as still
present after that first commit.

Messenger already drops reactions for the same reason (see
[`lib/channels/messenger/webhook.ts`](../../lib/channels/messenger/webhook.ts):
"reactions, referrals, opt-ins, handovers: intentionally ignored until a
phase needs them") — this brings WhatsApp in line with that existing
precedent rather than inventing a new convention. A reaction is not a
message anyone needs to answer or redo, so it is dropped silently: no
Inbox row, no notice.

## Data model changes
None. `lib/types/whatsapp.ts` gained an optional `reaction?: { message_id?:
string; emoji?: string }` field on both the `messages` and `message_echoes`
webhook shapes, matching what Meta actually sends (documentation only —
nothing reads it yet).

## Access control changes
None.

## UI surfaces
None directly — the effect is that reactions (customer or staff) no
longer create a visible message row in
`app/inbox/components/conversation-panel.tsx`'s thread.

## Test plan
- Automated: [`lib/whatsapp/inbound-ingest.test.ts`](../../lib/whatsapp/inbound-ingest.test.ts) —
  asserts `storableInboundMessageIds` excludes a `type: "reaction"` entry
  while still including an ordinary text message, that
  `extractMessageText`/`extractMessageType` resolve a reaction to `""`/
  `"TEXT"` as a defensive belt-and-braces check, and that the new shared
  `isReactionMessage()` predicate (used by both the inbound-message loop
  and the `message_echoes` loop) is correct on both shapes. This is the
  first test file for this module; writing it surfaced that Vitest
  couldn't previously load `lib/whatsapp/inbound-ingest.ts` at all,
  because it transitively imports `lib/ai/transcription.ts`, which does
  `import "server-only"` — a package that isn't actually installed
  (Next.js's bundler resolves it specially; see the pre-existing
  `worker/server-only-stub.ts` used for the same reason in the worker
  build). Added the same stub as a `server-only` alias in
  `vitest.config.mts` so this and any future test touching
  server-only-gated modules can run.
  `handleWebhookDelivery` itself (where the `message_echoes` loop lives)
  has no test coverage before or after this change — it needs a mocked
  Supabase admin client and signature verification that no existing test
  sets up; the shared `isReactionMessage()` predicate it now calls is
  covered directly instead.
- Existing suite: full repo Vitest run passes (333 files / 3522 tests).
  `npm run lint` and `tsc --noEmit` both clean for the changed files.
- Manual: not reproduced against a live WhatsApp delivery for this task
  (would need an actual reaction sent from a phone against the webhook,
  for both the customer-reaction and staff-reaction-from-phone cases);
  verified instead by tracing the exact code path a reaction payload
  takes through both `ingestWhatsAppInboundMessages` and the
  `message_echoes` loop, today vs. after the fix.

## Status
Done — pending the reporter confirming a real reaction (from either
side) no longer shows up as an empty message.
