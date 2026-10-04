# WhatsApp supported message types

WhatsApp customer messages accept only `text`, `document`, `image`, and `audio`.
Documents retain the existing file-type checks. All other message types,
including contacts, locations, videos, stickers, orders, interactive replies,
and unknown future types, use the existing unsupported-message notice.

Rejected messages are not stored as Inbox messages and do not queue AI work.
The live webhook sends at most one refusal per sender per delivery, after
acknowledging Meta. The raw-event reconciler excludes rejected messages from
its missing-message check. Emoji reactions remain silently ignored.

Unsupported WhatsApp Business app echoes are also excluded from the Inbox;
staff activity does not trigger a refusal to the customer.

The customer notice lists the supported alternatives: text message, document,
image, or audio message. Previously stored empty messages are not deleted.

Regression coverage: `lib/inbox/media/unsupported-notice.test.ts` and
`lib/whatsapp/inbound-ingest.test.ts` verify rejection, replay exclusion,
per-sender notice deduplication, and no persistence or AI work for rejected messages.
