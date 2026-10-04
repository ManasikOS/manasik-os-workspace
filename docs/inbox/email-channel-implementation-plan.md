# Email as an Inbox Channel (Gmail-like)

Bring email into the **Unified Inbox** as a first-class channel, with Gmail-like staff
capabilities — read incoming mail, see it threaded against a contact, reply/reply-all,
compose new outbound mail, attachments both ways, search, and folder-like organization
(already partly modeled as "queues").

Status: **Phases 0–2 built, applied to Manasik OS (2026-09-28); Phases 3–5 not started.**
Written 2026-09-28 after reading the current Inbox channel architecture (Messenger/Instagram
adapters, `lib/inbox/contracts.ts`, `lib/channels/*`) and the existing outbound-only SMTP
settings feature. Follows
[`../standards/feature-development-workflow.md`](../standards/feature-development-workflow.md).

Deviations found while building:

- **Phase 0** — the SMTP/IMAP Zod schema was extracted to
  [`../../lib/validations/agency-email-settings.ts`](../../lib/validations/agency-email-settings.ts)
  rather than left inline in the `"use server"` actions file — a server-action file can only
  export async functions, so the schema (and its new all-or-nothing IMAP refinement, which is
  real business-rule branching worth testing per
  [`../standards/testing-standards.md`](../standards/testing-standards.md)) needed a home in
  `lib/validations/`, matching this repo's own layering convention.
- **Phase 1** — `resolveConnectionForChannelConnection` needed no "legacy" indirection table the
  way WhatsApp's does (`legacy_whatsapp_integration_id`, because `whatsapp_integrations` predates
  `channel_connections` and isn't keyed by agency alone): email's `channel_connections` row
  already carries everything the adapter needs directly in `provider_metadata`, since Phase 0
  wrote it there and `agency_smtp_settings` is itself one-row-per-agency. Reading
  `agency_smtp_settings` from the adapter at send time was considered and rejected — `sendReply`/
  `sendMedia` take no `db`, so every field they need must already be on the resolved
  `ResolvedChannelConnection`; a new optional `smtpConfig` field was added there for it (same
  pattern as Instagram's own `connectMethod` field).
- **Phase 1** — `OutboundReply`/`OutboundMedia` (`lib/channels/adapter.ts`) now carry optional
  `subject`/`cc`/`bcc`/`inReplyTo`/`references`, but nothing populates them yet:
  `enqueue_inbox_text_message`'s outbox command has no subject/cc/bcc, and
  `authorizeProviderSend`'s returned `command` only carries `{ text, metaTag? }` — Phase 3's
  composer/RPC work must also touch `lib/inbox/outbox/drain.ts`'s call site to actually thread
  them through, not just the composer UI. Until then a GMAIL reply sends as plain text with no
  subject header, which nodemailer accepts.
- **Phase 2** — attachments are persisted directly (bytes already in hand from the IMAP fetch)
  rather than through the shared `persistInboundMediaAttachments` helper, which only knows how to
  record a provider reference and fetch the bytes later. `lib/channels/email/imap-poll.ts` mirrors
  that helper's classification/sensitivity-marking/job-enqueue ordering exactly, using the same
  exported `classifyInboundMedia`/`inboxAttachmentFamily` and `enqueueChannelJob`, so passport/
  receipt review behaves identically once the row exists — see the module's own header comment.
- **Phase 2** — `IngestInboundInput` (`lib/inbox/ingest.ts`) gained an `email?: string | null`
  field, threaded through to `linkConversationToLead`'s existing `email` parameter. This field
  already existed on `LeadLinkInput` and already feeds the identity graph's `EXACT_EMAIL`
  auto-confirm match (`lib/inbox/identity/graph.ts`) — but no caller had ever populated it, so
  every channel's inbound path (not only email's) silently could not use its own auto-confirm
  rule. Channel-neutral and backward compatible: every existing caller omits it and gets `null`,
  unchanged behaviour.
- **Phase 2** — cursor advance is per-message, not per-batch (the plan's wording said "the batch");
  each message's UID only advances the stored `channel_connections.sync_cursor` once that specific
  message is durably ingested, so a crash mid-poll resumes from the last one that actually
  committed. A message with no usable `From` address is treated as a permanent, skippable failure
  (its UID still advances — retrying it forever would never succeed); a database/ingestion failure
  is treated as transient and stops the tick without advancing past that UID, so the next tick
  retries it.
- **Phase 2** — on first connect (or a UIDVALIDITY change), the poller does not import any
  existing mail: it records the mailbox's current `uidNext` as the cursor and returns, so
  connecting a mailbox with years of history never floods the Inbox with old conversations. Only
  mail that arrives after that point is ever ingested.
- **Phase 2** — new dependencies: `imapflow` (IMAP client, ships its own types) and `mailparser`
  (MIME parsing, paired with `@types/mailparser`).

Related, and not repeated here:
[`architecture.md`](architecture.md) (the Inbox's deterministic-core rule and resolved
decisions this plan does not reopen),
[`../modules/messenger-instagram-ai-agent-implementation-plan.md`](../modules/messenger-instagram-ai-agent-implementation-plan.md)
(the channel-adapter pattern this plan reuses),
[`../modules/inbox-architecture.md`](../modules/inbox-architecture.md) (the channel-neutral
Inbox platform — connections, identities, canonical messages, outbox, realtime).

---

## 0. The decision in one page

```text
Channel      = the existing agency SMTP mailbox, read via IMAP polling and sent via nodemailer.
Conversation = one per contact (sender email address), same model as WhatsApp — not one per
               email subject-thread. The subject is shown per message; the wire-level
               In-Reply-To/References headers still thread correctly in the customer's own
               mail client.
Agent        = never autonomous on email in this scope. Staff-facing Gmail parity only.
```

The agency already has a working, agency-scoped **outbound-only SMTP** integration
(`app/(main)/management/settings/email/`, `agency_smtp_settings` table,
`sendSmtpTestEmail` using nodemailer) used today only for a manual "send test email" and
for EMAIL-channel communication templates. It is not wired into the Inbox at all — there
is no inbound email, no email conversations, and no way to reply to an email from the
CRM.

### Why this is smaller than it looks

The codebase's own architects already anticipated an email channel while building the
generic multi-channel foundation, and left real seams unused:

- `conversations.channel` / `channel_connections.provider` / `contact_identities.provider`
  CHECK constraints already allow `'GMAIL'` (migration `20260916073247_unified_inbox_core.sql`).
- `lib/inbox/queues.ts` already has an `EMAIL` rail queue; `channelDisplayName`/`CHANNEL_ICON`
  in `app/inbox/components/conversation-panel.tsx` already map `GMAIL → "Email"` / `Mail` icon.
- `lib/inbox/identity.ts::normalizeEmail` and `lib/inbox/identity/graph.ts` already treat an
  exact email match to an existing lead as `EXACT_IDENTITY` (auto-confirm) — same tier as an
  exact phone match. Zero changes needed.
- `lib/inbox/contracts.ts::OutboxCommand` already carries `subject`, `cc`, `bcc`,
  `replyToProviderMessageId`; `ChannelCapabilities` already declares `canSetSubject`/`canUseCcBcc`.
- `message_attachments`, `message_delivery_events`, `outbox_messages` are fully
  provider-neutral; `app/inbox/components/inbox-message-media.tsx` renders any attachment by
  mime type already, with zero channel branching.
- `sendSmtpTestEmail` (`app/(main)/management/settings/email/actions.ts`) is ~90% of a working
  send adapter: nodemailer transport construction, Vault password read via
  `whatsapp_read_secret` (already provider-generic despite the name), and SMTP error-code
  mapping are all directly reusable.
- `channel_connections.sync_cursor` exists specifically for a polling cursor — unused today,
  built for exactly this.

What's genuinely missing: an inbound transport (none exists — SMTP is send-only), the
`gmailChannelAdapter` implementing `ChannelRuntimeAdapter`, a `channel_connections` row
bridging to `agency_smtp_settings`, threading semantics for email, and composer UI for
subject/cc/bcc/compose-new.

### Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Keep the channel/provider code `GMAIL`**, but it means *generic SMTP+IMAP email*, not the Gmail API. Renaming would touch the DB CHECK constraints, `contracts.ts`, icons, queue mapping and several tests for no functional gain. | It's already live in schema/tests/UI as a placeholder; reusing it is the smaller, safer change (the same principle the Messenger/Instagram plan's own deviations log used elsewhere). |
| D2 | **One Inbox conversation per contact (sender email address)**, exactly like WhatsApp — not one conversation per email subject-thread the way Gmail's own UI groups mail. | Confirmed with the requester. Matches the existing conversation list, queue, assignment ("MINE") and SLA model, which assume one open conversation per contact. A per-subject-thread model would require a contact to have several simultaneously-open conversations, which nothing in the Inbox supports today. The **subject is still shown per message** (Gmail-style, inside the one contact conversation), and outbound replies still carry correct `In-Reply-To`/`References` headers so the *customer's* mail client threads correctly — only this CRM's own grouping is per-contact. |
| D3 | **Inbound transport: IMAP polling of the agency's own mailbox**, on a cron, reusing the same credentials as the existing SMTP settings. | Confirmed with the requester. The agency's mailbox is real infrastructure they already send from; polling it directly (vs. a webhook-based provider like SendGrid/Mailgun inbound-parse, which needs a dedicated receiving address and DNS/MX changes) reads their actual inbox with no extra setup, and reuses `channel_connections.sync_cursor`, already built for this. |
| D4 | **No autonomous AI auto-reply on email in this scope.** Manasik Copilot's manual "draft a reply" assist (if channel-neutral already) stays available; the AI is never given `AI_ACTIVE` handling on a GMAIL conversation. | The ask is entirely about staff-facing Gmail-like Inbox UX (read/thread/reply/compose/attach), not an autonomous email-answering bot — a materially riskier, separately-scoped decision (`lib/channels/profile.ts` already explicitly excludes Gmail from `isAgentChannel`, and this plan keeps it that way). |
| D5 | **v1 sends and stores plain text**, rendering inbound HTML mail sanitized and read-only; no rich-text (WYSIWYG) compose editor in this scope. | shadcn has no rich-text component, and Gmail-parity's core value (read, thread, reply, attach, search) doesn't need WYSIWYG. Flagged as a possible later phase, not required for the feature to work end to end. |

---

## Phase 0 — Schema and connection bridge

**Migration**
[`supabase/migrations/20261212090000_email_channel_foundation.sql`](../../supabase/migrations/20261212090000_email_channel_foundation.sql),
applied to Manasik OS and verified with a rolled-back transaction (SMTP-only save leaves the
connection `NOT_CONNECTED`; adding IMAP on a second save without re-sending the password flips it
to `CONNECTED` with no duplicate row):

- [x] Added `imap_host text`, `imap_port integer`, `imap_security text check in ('STARTTLS','TLS')` to
      `agency_smtp_settings` (nullable — a null `imap_host` means "SMTP configured, inbound not
      enabled yet"). Reuse the existing `username`/`password_ref` for IMAP auth — every mainstream
      provider (Gmail, Office 365, cPanel/Zimbra, Fastmail) uses the same mailbox credentials for
      both protocols, so no second password/Vault secret is needed.
- [x] Extended `save_agency_smtp_settings(...)` to accept the IMAP fields, and to **upsert a
      matching `channel_connections` row**
      (`provider = 'GMAIL'`, `agency_id`, `status = 'CONNECTED'` once `imap_host` is set else
      `'NOT_CONNECTED'`, `display_name = from_email`, `credential_ref = password_ref::text`,
      `provider_metadata = jsonb_build_object('host',...,'port',...,'security',...,'imapHost',...,'imapPort',...,'imapSecurity',...,'username',...,'fromName',...,'fromEmail',...,'replyTo',...)`).
      Required because `outbox_messages.connection_id` is a hard FK to
      `channel_connections(id, agency_id)` — outbound email cannot flow through the existing
      outbox drain without this row, exactly the same bridge WhatsApp uses via
      `legacy_whatsapp_integration_id`. Added `channel_connections_gmail_agency_unique` (agency_id,
      provider) where provider = 'GMAIL' as the upsert's own conflict target, since email is
      one-connection-per-agency like `agency_smtp_settings` itself, not the Meta providers'
      global-account gate.
- [x] No new table for the IMAP cursor: use the existing `channel_connections.sync_cursor` text
      column (Phase 2 will store `{"uidValidity": ..., "lastUid": ...}` there as JSON).
- [x] **Verified, no migration needed:** `conversation_messages_external_id_unique`
      (`agency_id, external_message_id`, migration `20260825090000`) already exists and is
      provider-neutral — Phase 2's inbound-email dedupe (keyed by the RFC 5322 `Message-ID`
      header) reuses it via `on conflict do nothing`, the same pattern WhatsApp already uses
      (`ingest_inbound_message_atomic`, SC1).

**UI** (built): `app/(main)/management/settings/email/email-settings.tsx` gained a "Receiving
mail (IMAP)" sub-section under the existing "Custom SMTP" form (IMAP host/port + an encryption
select, all optional); `actions.ts` reads/writes the three new columns. The inline Zod schema
was extracted to
[`lib/validations/agency-email-settings.ts`](../../lib/validations/agency-email-settings.ts)
(see the deviation note above), with `agency-email-settings.test.ts` covering the all-or-nothing
IMAP rule and the hostname-format check. No new settings page.

- [x] **Exit:** an agency can save IMAP host/port/security alongside SMTP; the RPC upserts a
      `channel_connections` row with `provider = 'GMAIL'` and `status = 'CONNECTED'` — verified
      both by a rolled-back live-DB transaction and by `npm run typecheck && npm run lint && npm
      test` (3621/3622 passing; the one failure is a pre-existing, unrelated missing local
      Playwright browser binary).

## Phase 1 — The `gmailChannelAdapter`

New `lib/channels/email/` directory, mirroring `lib/channels/whatsapp-adapter.ts` and the
Messenger/Instagram folders. Built and merged into this working tree; see the deviations above
for how `resolveConnectionForChannelConnection` and the new `smtpConfig` field ended up shaped:

- [x] `lib/channels/email/adapter.ts` — implements `ChannelRuntimeAdapter`
      (`lib/channels/adapter.ts`):
  - `resolveConnection`/`resolveConnectionForChannelConnection` read the `channel_connections`
    row written in Phase 0 and shape a `ResolvedChannelConnection` (`accountId` = the from-email
    address, `credentialRef` = the Vault password ref, `displayAddress` = from-email).
  - `readToken` reads the password via the existing `whatsapp_read_secret` RPC (already
    provider-generic despite its name — reused as-is, per `sendSmtpTestEmail`'s pattern).
  - `sendReply`/`sendMedia` build a nodemailer transport exactly like `sendSmtpTestEmail` does
    today (same STARTTLS/TLS, timeout and `disableFileAccess`/`disableUrlAccess` settings), then
    `sendMail({ from, to, cc, bcc, subject, text, inReplyTo, references, attachments })`.
    `OutboundReply`/`OutboundMedia` (`lib/channels/adapter.ts`) need `subject?`, `cc?`, `bcc?`,
    `inReplyTo?`, `references?` added — today only `OutboxCommand` in `contracts.ts` carries
    them; this is the one place those fields must be threaded through to the adapter call.
  - `classifyError` reuses `sendSmtpTestEmail`'s existing SMTP error-code table (`EAUTH →
    TOKEN_DEAD`, `ECONNECTION`/`ESOCKET`/`ETIMEDOUT` → `UNKNOWN`, `EENVELOPE`/`EMESSAGE` →
    `UNKNOWN`, nothing maps to `RATE_LIMITED`/`OUTSIDE_SERVICE_WINDOW` — email has no reply
    window).
  - `fetchAttachment` is **not needed as a lazy fetch** — see Phase 2 (the IMAP poll already
    holds the full message bytes, so attachments are uploaded to storage directly during
    ingestion, unlike WhatsApp's fetch-after-webhook model). Implement it anyway as a thin
    "reconnect and refetch by UID+partId" fallback only if a later re-analysis needs the
    original bytes again.
  - `reflectSendFailure`/`reflectSendSuccess` update `channel_connections.status`/`last_error`,
    same shape as the WhatsApp adapter. `fetchAttachment` was left unimplemented (optional on
    the interface) — deferred to Phase 2, which needs it for a different reason than WhatsApp's
    lazy-fetch model (see the deviation note).
- [x] Registered: `lib/channels/registry.ts` → `ADAPTERS.GMAIL = gmailChannelAdapter`. This
      single line turns on `hasChannelAdapter("GMAIL")`, unblocking `sendStaffMessage` for email
      conversations (`app/inbox/actions.ts` needed no change — it already refuses a channel with
      no adapter).
- [x] `lib/channels/profile.ts` — added `EMAIL_PROFILE` (`identifiesByPhone: false`,
      `businessCanStartConversation: true`, `replyWindowHours: Infinity`,
      `requiresAutomationDisclosure: false`, `supportsQuickReplies: false`,
      `supportsHumanAgentTag: false`). Per D4, `isAgentChannel` was rewritten as an explicit
      `WHATSAPP | MESSENGER | INSTAGRAM` check so adding `GMAIL` to the `PROFILES` map (needed so
      the composer/outbox can read its profile) can never accidentally widen the agent's own
      channel list — the two are now independent, where before they were the same lookup.
- [x] `lib/inbox/attachments/staff-attachment.ts::channelAcceptsAttachment` — added a `GMAIL`
      case (accepts both `image` and `document` kinds, no Meta-style restriction).
- [x] **Exit:** a staff reply on a GMAIL conversation is sent by the adapter and the outbox
      drain no longer throws "No adapter is installed for GMAIL." — verified by
      `lib/channels/email/adapter.test.ts` (13 tests: connection shaping, token read, send/media
      send via a mocked nodemailer transport, error classification, failure reflection) and the
      updated `whatsapp-adapter.test.ts`/`profile.test.ts`/`staff-attachment.test.ts` registry
      assertions. Full `typecheck`/`lint`/`test`: 3636/3637 passing (the one failure is the same
      pre-existing, unrelated local Playwright browser binary noted in Phase 0).

## Phase 2 — Inbound: IMAP poll → canonical ingestion

- [x] New dependencies: `imapflow` (IMAP client) and `mailparser` + `@types/mailparser` (MIME
      parsing) — both well-maintained, no native bindings.
- [x] `lib/channels/email/imap-poll.ts`:
  - `pollAgencyMailbox(db, agencyId)`: connects via `imapflow` using the connection's decrypted
    password, opens `INBOX`, reads the stored cursor from `channel_connections.sync_cursor`,
    fetches messages with UID greater than the cursor (bounded, at most 50 per tick), parses each
    with `mailparser` to get `from`, `cc`, `bcc`, `subject`, `text`, `html`, `messageId`,
    `inReplyTo`, `references`, `attachments[]` (already-decoded `Buffer`s + filename + mime
    type).
  - **Deviation:** calls `ingestInboundMessage()` directly with an `IngestInboundInput`
    (`provider: "GMAIL"`, `externalConversationId` = the sender's address per D2,
    `agentAllowed: false` per D4, `email` = the sender's address, `metadata` carrying
    `subject`/`cc`/`bcc`/`in_reply_to`/`references`/`html`) rather than going through a
    `CanonicalInboundMessage` — that is what every existing webhook handler already does
    (`ingestInboundMessage`'s own parameter is `IngestInboundInput`, not the wider
    `CanonicalChannelEvent` union in `contracts.ts`), so this matches the real pattern rather than
    the plan's more abstract sketch.
  - Identity resolution, lead-linking (`lib/inbox/lead-linking.ts`), conversation upsert and
    downstream `BULK`-lane job enqueue all happen through the one existing, tested
    `ingestInboundMessage` pipeline, not a parallel one.
  - Uploads each attachment's already-in-hand bytes straight to the `inbox-attachments` bucket
    and inserts its `message_attachments` row with `storage_path` already set (see the deviation
    note above for why this bypasses `persistInboundMediaAttachments`) — passport/receipt review
    enqueues exactly as it does for every other channel, with zero changes to
    `lib/inbox/media/handlers.ts`.
  - Cursor advance is per-message (see the deviation note above), and the first poll of a mailbox
    bootstraps forward from "now" rather than importing existing mail.
- [x] New cron route `app/api/cron/inbox-email-poll/route.ts`, and migration
      `20261213090000_em2_inbox_email_poll_cron.sql` (applied to Manasik OS, verified scheduled
      and active) extends `invoke_cron_route`'s allow-list and schedules it every 2 minutes,
      mirroring `inbox-lanes`'s own migration exactly. One agency's failure never blocks another's
      — each is polled in its own try/catch inside a shared wall-clock budget.
- [x] **Exit (verified 2026-09-28 by test, not yet by a live mailbox):**
      `lib/channels/email/imap-poll.test.ts` (13 tests) covers connection resolution, IMAP
      auth-failure reflection, cursor bootstrap (no backfill, UIDVALIDITY-change re-bootstrap),
      normal multi-message polling with per-message cursor advance, a permanently-unparseable
      message being skipped-and-advanced-past versus a transient failure stopping without
      advancing, and attachment acceptance/rejection (size cap, video). The `ingestInboundMessage`
      email-forwarding behaviour is covered separately in `lib/inbox/ingest.test.ts`. Full
      `typecheck`/`lint`/`test`: 3651/3652 passing (the one failure is the same pre-existing,
      unrelated local Playwright browser binary noted in Phase 0). **Not done:** a real inbound
      email against a live test mailbox — needs a deployed build and a named test account, per
      this repo's own recurring "needs a live/signed-in environment" pattern for exit criteria.

## Phase 3 — Composer and conversation UI

- [ ] **New, found while building Phase 1:** `enqueue_inbox_text_message`'s outbox `command`
      jsonb carries only `provider_thread_id`/`content` today, and
      `lib/inbox/outbound/authorize-provider-send.ts`'s `command` return value only carries
      `{ text, metaTag? }` — neither reaches `adapter.sendReply` with a subject/cc/bcc even
      though `OutboundReply` can now hold them (Phase 1). The RPC needs new optional
      parameters, and `lib/inbox/outbox/drain.ts`'s `deliverRow` needs to merge
      `row.command.subject`/`cc`/`bcc`/`reply_to_provider_message_id` into the call alongside
      `authorization.command`, the same way it already merges `metaTag`.
- [ ] `app/inbox/types.ts`: add `subject`, `cc`, `bcc` (string arrays) to `InboxMessage`
      (sourced from `conversation_messages.metadata`, not new columns — matches the existing
      `metadata.part_mids` precedent for Messenger).
- [ ] `app/inbox/components/message-composer.tsx`: when `capabilities.canSetSubject` /
      `canUseCcBcc` are true for the active conversation's channel (new fields on
      `InboxCapabilities`/derived from `getChannelProfile`), show a collapsed "Cc/Bcc" toggle
      and a Subject field (subject pre-filled from the thread's last inbound subject, editable
      only when composing brand-new outbound mail). Both are optional `InputGroup`s per the UI
      standard.
- [ ] `app/inbox/components/conversation-panel.tsx`: add a `GMAIL` branch alongside the existing
      `WHATSAPP`/`MESSENGER`/`INSTAGRAM` ones for the reply-window/template gating block
      (around line 367) — email has no reply window, so this branch is just "always allowed" —
      and a fourth channel-logo-overlay case next to the existing three (around lines 342-348).
- [ ] A new "Compose email" entry point (per D3/`businessCanStartConversation: true` for email —
      unlike Messenger/Instagram, staff *can* start one): reuse the existing "New chat" flow's
      shape (`lib/inbox/new-chat-lead-match.ts`) with an email variant — recipient address
      (validated), subject, body — that creates the `conversations` row (`channel = 'GMAIL'`,
      `external_conversation_id` = the recipient address) and the `contact_identities` row up
      front, then enqueues the first outbound send through the same `outbox_messages` path as a
      reply.
- [ ] Inbound HTML body rendering: sanitize server-side (strip `<script>`/`<style>`/event
      handlers) before storing the sanitized HTML in `metadata.html`; render it in a scrollable,
      read-only block in the message bubble, distinct from `InboxMessageMedia` (which stays
      untouched — it already renders attachments by mime type generically, no changes needed
      there per D5's v1 plain-text-compose / sanitized-HTML-read scope).
- [ ] **Exit:** a staff member replies with Cc/Bcc and a subject from the composer; a new
      "Compose email" starts a fresh conversation to an address with no prior history.

## Phase 4 — Search, folders, read/unread

- [ ] **Search**: reuse `lib/inbox/search-query.ts` as-is — it is already channel-neutral;
      verify it covers `subject`/body text for email (extend its query if it only searches
      `content` today).
- [ ] **Folders/labels**: map onto the **existing queue/rail system**, not a new label model —
      the `EMAIL` channel queue (`lib/inbox/queues.ts`) already gives a Gmail-like "Email"
      folder in the rail; `NEEDS_REPLY`/`WAITING_CUSTOMER`/`RESOLVED`/`SPAM` already give
      Inbox/Sent-equivalent/Archived/Spam-equivalent groupings without inventing a parallel
      folder system.
- [ ] **Read/unread, archive, spam**: reuse the existing `lifecycle_status`
      (`OPEN`/`CLOSED`/`SPAM`) and existing per-staff read-state mechanism (whatever already
      marks a WhatsApp conversation read) — verify it is channel-neutral (it should be, since
      it's keyed by conversation, not channel) rather than building a second one for email.
- [ ] **Exit:** searching by subject or body finds an email conversation; the Email rail queue
      and existing lifecycle-status views correctly include/exclude email conversations.

## Phase 5 — Security, tests, entitlements

- [ ] Validate every recipient/from address with the existing email Zod pattern
      (`app/(main)/management/settings/email/actions.ts`'s schema) before it reaches nodemailer,
      on both the compose-new and reply paths — never trust a client-supplied address
      unvalidated.
- [ ] Never render un-sanitized inbound HTML (Phase 3) — add a focused test asserting a
      `<script>` or `onerror=` payload in a fixture email never survives sanitization.
- [ ] Tests per [`../standards/testing-standards.md`](../standards/testing-standards.md)
      (Vitest) for the business-rule branching this phase introduces: IMAP cursor
      advance-only-after-durable-write and idempotent re-poll (mirrors `SC1`'s
      fault-injection style), exact-email identity auto-confirm already has coverage in
      `identity/graph.test.ts` — add an email-specific fixture there instead of duplicating the
      matrix; `gmailChannelAdapter.classifyError` mapping; composer subject/cc/bcc validation;
      cross-agency isolation for the new `channel_connections`/`agency_smtp_settings` reads.
- [ ] Entitlement: per the existing plan-tier table (`implementation-plan.md`'s pricing table —
      Email is already listed as a Professional-tier channel add-on), gate the new "Compose
      email" UI and the cron poll behind `resolveInboxFeatureAvailability` the same way other
      optional surfaces are gated (`FIX9`), rather than making email universally available
      regardless of plan.
- [ ] `npm run lint && npm run typecheck && npm run test` must all pass; manual browser
      verification of the golden path (connect SMTP+IMAP, receive a test email into the Inbox,
      reply, see it threaded, send a new compose, attach a file both ways) before calling any
      slice done, per
      [`../standards/feature-development-workflow.md`](../standards/feature-development-workflow.md)
      §5.
- [ ] **Exit:** lint/typecheck/test all green; a downgraded (non-Professional) agency cannot
      use the email channel; a fixture XSS payload never renders.

---

## Verification plan

1. `npm run typecheck && npm run lint && npm run test` after each phase.
2. Manual, in-browser, using a real test mailbox (not a production one): save SMTP+IMAP
   settings → send a real email to that mailbox from outside → confirm it appears in the Inbox
   under the Email queue within one poll cycle, correctly identity-matched or creating a new
   lead → reply from the Inbox → confirm the external mailbox receives it, correctly threaded
   (`In-Reply-To`/`References`) → attach a file both directions → compose a brand-new email to
   an address with no prior history → confirm search finds it by subject and body.
3. Cross-agency isolation check: two agencies, two mailboxes, confirm agency A's poll never
   writes into agency B's conversations (same style as the existing Messenger/Instagram
   burst-simulation test in Phase 8 of that plan).
