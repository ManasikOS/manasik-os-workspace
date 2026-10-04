# Messenger + Instagram — Channels and the Shared AI Agent

Add **Facebook Messenger** and **Instagram Direct** as inbox channels, and make the existing AI agent
(Manasik Copilot) answer on them exactly as it does on WhatsApp — with **one set of agent settings,
knowledge base, tools and guardrails for every channel**.

Status: **Phases 0–4 built and committed (Phase 4 in PR #121). Phase 5 (Instagram, with its own onboarding) committed `06c7d9d` and Phase 6 (voice) committed `9d72ec1`; Phase 7 (analytics and Inbox polish) committed `4ce094c`; Phase 8 (hardening) built 2026-09-19, uncommitted; on branch `meta-messaging-unified-connect`; the three migrations are applied to the live database (2026-09-19). All eight phases are built; what remains is the Dev-mode test against real Meta and App Review.**

Deviations from this plan found while building 0–1:

- **F1 needed no change.** `proxy.ts` already exempts the whole `/api/webhooks` and `/api/cron` prefixes, so the new webhook routes are covered.
- **The agent-side adapter is a separate interface**, `ChannelRuntimeAdapter` in `lib/channels/adapter.ts`, not an edit to `ChannelAdapter` in `lib/inbox/contracts.ts`. The contract describes canonical webhook events and outbox commands; the reply drain needs "resolve connection, read token, send, reflect failure", which is a different shape. A provider will implement both.
- **The staff outbox now also reflects `UNFUNDED`** (previously only a dead token), because both drains share `reflectSendFailure`.
- **Phase 2 — the assistant fails closed on the new channels.** `ingestInboundMessage` takes `agentAllowed`; the Messenger webhook passes `connection.ai_enabled && ai_settings.enabled`. `ai_settings.enabled` is a switch in the AI Agent form that the WhatsApp runtime never reads (only `conversation.ai_enabled` is), so on WhatsApp it currently does nothing. Left as-is; worth a decision.
- **Phase 2 — `conversations.connection_id`** is filled by a database trigger for WhatsApp only, so `upsertConversationForInbound` now takes `connectionId`. Without it Phase 3's staff replies would fail with "no channel connection".
- **Phase 2 — event dedupe is message-level.** `channel_webhook_events` is an audit floor keyed by the body hash; a duplicate delivery is still processed (each message is skipped if its id is stored), so a partial failure followed by Meta's retry recovers the un-processed remainder. The WhatsApp handler drops a duplicate event outright and cannot.
- **Phase 2 — Messenger staff replies are refused** with a clear message until Phase 3 installs the sender (`hasChannelAdapter` guard in `sendStaffMessage`).
- **Phase 3 — provider-neutral Vault functions** (`channel_store_token` / `channel_read_token` / `channel_delete_token`, migration `20261129090100`) instead of reusing `whatsapp_store_token`, which works on any secret but names it "whatsapp_token_…". The Phase 2 handler now reads tokens through `lib/channels/vault.ts`.
- **Phase 3 — one Page per agency.** Connecting a different Page while one is live is refused with "disconnect it first" rather than silently replacing it; a Page already connected to another agency is refused before any call to Meta.
- **Phase 3 — split replies and echoes.** Every part of a split reply echoes with its own id, so `SendReplyResult.partMessageIds` is recorded in `conversation_messages.metadata.part_mids` and echo checks look there too. Without it a multi-part reply could silence the assistant on its own part 1.
- **Phase 3 — `sendTyping` takes `{ to, customerMessageId }`** (Messenger addresses the recipient, WhatsApp a message id).
- **Phase 3 — not done:** the 7-day HUMAN_AGENT window for staff (needs its own App Review feature), the composer's "reply window closed" state (Phase 7), and a partial-send guard: if part 2 of a split reply fails after part 1 was delivered, the error is rethrown and a retry would resend part 1. Only reachable for text over 2000 characters (the AI's own cap is 1200).
- **Phase 4 — a cross-customer lead-linking bug, fixed.** `ensureLeadForConversation` (the assistant's `find_or_create_lead` and the pre-reply lead capture) looked the lead up by `mobile = waIdToMobile(contact_phone)`. On Messenger `contact_phone` is `''`, and once F2 stores `''` for phone-less leads that lookup would have matched ANOTHER customer's placeholder lead and linked this conversation to it. It now uses the lead already linked to the conversation, and only searches by mobile on a channel that has a phone number (`ChannelProfile.identifiesByPhone`). WhatsApp's path is unchanged and pinned by test.
- **Phase 4 — a typed phone number is never used to merge.** The plan (§7) said a single phone match should link the identity to that lead. Building it showed why that is unsafe: anyone could type another person's number into Instagram, be attached to that person's lead, and have the booking tools read that person's bookings back. `capture_contact_number` therefore saves the number only when NO other lead holds it; if one does, it changes nothing, leaves a staff note and an AMBIGUOUS `identity_match_events` row, and tells the customer only that a colleague will confirm. The safe direction — the same person later writing on WhatsApp, where Meta has verified the number — is handled by the existing phone match in `lead-linking`.
- **Phase 4 — typed numbers are limited to nine-digit Sri Lankan numbers**, the only shape `leads.mobile` displays and dials (`+94 …`) and the staff form accepts. A foreign number is refused and the customer handed to staff. Widening this means widening the Leads number model first.
- **Phase 4 — the booking tool refuses to hold seats with no phone number** (`resolveBookingContactPhone`), and the Inbox "Create booking" action refuses a phone-less lead. The Leads table, drawer and Inbox panel show "No phone yet" and hide Call / WhatsApp for such a lead.
- **Phase 4 — `agent_runs.channel` is sent only when it is not WHATSAPP**, so the WhatsApp insert is byte-for-byte unchanged (the live table has drifted from its migrations before; an unknown column fails the whole insert). Pinned by test.
- **Phase 4 — not done:** a campaign send to leads with an empty `mobile` (the campaigns audience code reads `leads.mobile` and was not audited for the empty case), and follow-up scheduling still defaults `follow_up_type` to WHATSAPP_MESSAGE for a new chat lead, which staff cannot act on for a phone-less lead.

- **Phase 5 — Instagram goes through the Facebook Page, not Instagram Business Login.** Meta's docs put Instagram messaging under Facebook Login for Business on the Messenger Platform: the Page access token, `POST /me/messages`, recipient = IGSID, webhook object `instagram` with `entry.id` = the Instagram professional account id. The configuration already carries `instagram_manage_messages`, so this needs no second login, no 60-day token refresh job and (probably) no second app secret. The plan's Instagram Business Login path (graph.instagram.com, F9) is therefore not built; `INSTAGRAM_APP_SECRET` is accepted as an extra signing secret in case Meta signs Instagram deliveries differently. To be settled by the Dev-mode test.
- **Phase 5 — one implementation for the two Page-backed channels.** `lib/channels/page-channel-adapter.ts` is the adapter for both Messenger and Instagram (resolve, split, part ids, typing, dead-token reflection); the Messenger webhook parser, handler, echo reconciliation and name lookup take a `channel` and default to Messenger, so every Messenger test and behaviour is unchanged. Instagram registers in the channel registry; its webhook is `/api/webhooks/instagram`.
- **Phase 5 — Instagram-specific parsing.** An unsent message (`is_deleted`) and an account messaging itself (`is_self`) are ignored; Instagram's read event carries a message id, not a watermark, so the event's own timestamp is used.
- **Phase 6 — voice notes on Messenger and Instagram.** The webhook queues the existing `TRANSCRIBE_AUDIO` job when the agency's one `ai_settings.voice_enabled` switch is on, a transcription key exists, the assistant will actually answer, and the payload carried a URL; otherwise the customer is asked to type, exactly as before. The URL is saved as `metadata.media_url` and `processVoiceMessage` accepts it beside WhatsApp's `media_id`, so the transcription, retry and "never record a number from a voice note" behaviour is the same code. The download (`lib/channels/attachment-download.ts`) treats the URL as untrusted: https on a Meta content host only, redirects re-checked, 5 MB cap while streaming, the Page token sent only if Meta answers 401/403. Whether the URL needs the token at all is still a **Verify** item (§1.1). Quick-reply rendering per channel was already done in Phases 3 and 5.
- **Phase 7 — analytics by channel.** The Assistant performance section has a channel filter (`?channel=WHATSAPP|MESSENGER|INSTAGRAM`, validated against the three values) and a comparison table that is always across every channel: conversations, replies, handled-without-a-person, typical and slowest-1-in-20 reply time, and the share of replies over Meta's 30-second rule (shown as "Not required" for WhatsApp). This is the §14.1 latency check on screen. Replies, conversations, hand-off, latency, cost, leads (by `leads.source`) and held bookings (by their conversation's channel) follow the filter; tool reliability does not, because `agent_tool_calls` has no channel — the screen says so. Rows with no channel count as WhatsApp. The Recent activity list carries a channel badge, and the AI Agent screens no longer say the assistant is WhatsApp-only.
- **Phase 7 — Inbox composer states** (`lib/inbox/composer-state.ts`, tested). On Messenger and Instagram the composer says "Customer must message first" until the customer has written, and "Reply window closed" once 24 hours have passed with no way to reopen it; the box opens on Note, which still works. WhatsApp is left exactly as it was (templates reopen its window). The server-side check in `sendStaffMessage` is unchanged and remains the real guard; the panel re-evaluates every minute. The conversation header now names the channel and says "No phone yet" for a customer who has not given one, and the list shows a channel badge on every row. The channel rail views were already built in Phase 2. **Not done:** campaign attribution from Messenger/Instagram `referral` events (plan §15 item 5 — still needs a decision).
- **Phase 8 — hardening.** (1) `signed_request` verification and two callbacks, `/api/webhooks/meta/deauthorize` and `/data-deletion`, with a stateless signed confirmation code and a status page (`/legal/data-deletion/status`); they disconnect the connections a Meta user made (recorded as `provider_metadata.meta_user_id` from `debug_token`) and delete their tokens, and keep the agency's conversations. No migration was needed. (2) The "which account?" cookie holding a parked login token is now sealed to the agency (HMAC over agency id and Vault reference) for WhatsApp, Messenger and Instagram: previously the cookie was a bare Vault reference the server would read for whoever set it. (3) `ChannelPersistenceError` no longer serialises the whole database error, whose `details` can quote the failing row — for a webhook insert, a customer's message. (4) A static audit test fails the build if any `console.*` in the Meta channel code logs a token, secret, header, OAuth code or signed request. (5) A burst simulation (100 messages × 3 concurrent deliveries, two agencies, Messenger and Instagram) and cross-tenant tests; it uses an in-memory store that enforces uniqueness, not Postgres, and WhatsApp's handler is outside it. (6) Campaign audience eligibility now excludes a lead with no phone number from a WhatsApp campaign (the count would otherwise include Messenger/Instagram-only leads). The announcement send path already refused an empty number. (7) The privacy and data-deletion pages now cover Messenger, Instagram, voice notes and OpenRouter (which carries the AI replies, speech-to-text and knowledge search); the page previously named only Anthropic. **Still a placeholder:** the contact email on both pages, which Meta's reviewer will test. **Not done:** a retention period for `channel_webhook_events`; WhatsApp connections do not record a Meta user, so Meta's deauthorize callback does not disconnect WhatsApp.
- **Separate onboarding per channel (decision, 2026-09-19).** A combined "one Meta login for WhatsApp + Messenger + Instagram" connector was built and then removed at the owner's request. Each channel has its own connect flow and its own Facebook Login for Business configuration: WhatsApp (`META_CONFIG_ID`, `/api/oauth/whatsapp/*`, state `wa_`), Messenger (`META_MESSENGER_CONFIG_ID`, `/api/oauth/messenger/*`, `ms_`), Instagram (`META_INSTAGRAM_CONFIG_ID`, `/api/oauth/instagram/*`, `ig_`). Connecting Messenger does not connect Instagram. Ads and marketing remain a separate integration.
- **Instagram connect** finds the Instagram account from the Page(s) the login shared (`lib/channels/instagram/discover.ts`), asks the agency to choose when more than one, and says how to fix a Page with no linked account. WhatsApp's "finish connection" step moved from the Server Action file to `lib/whatsapp/connect.ts`; its behaviour is unchanged. Disconnecting one Page channel never unsubscribes the Page while the other still uses it, and each connection keeps its own copy of the Page token.
- **`ingestInboundMessage` and `deliverAgentReply` were extracted with dependency injection** so their behaviour is pinned by tests; that is where the WhatsApp characterization lives.

Written 2026-09-19 after reading Meta's Messenger Platform and Instagram Platform documentation
(§1) and the current code (§2). Follows
[`feature-development-workflow.md`](../standards/feature-development-workflow.md).

Related, and not repeated here:
[`inbox-architecture.md`](inbox-architecture.md) (channel-neutral Inbox — this plan is its
Instagram/Messenger adapters),
[`whatsapp-ai-agent-implementation-plan.md`](whatsapp-ai-agent-implementation-plan.md) (the agent's
design and guardrails),
[`../architecture/whatsapp-multi-tenant-connection.md`](../architecture/whatsapp-multi-tenant-connection.md)
(one Meta app, Tech Provider model).

---

## 0. The decision in one page

```text
Channel      = a transport + a profile.  It carries text/media and declares its own limits.
Agent        = ONE agent per agency.     Same ai_settings, same knowledge, same tools, same guardrails.
Conversation = channel-neutral.          conversations.channel says where it lives; nothing else branches on it.
```

| # | Decision | Why |
|---|---|---|
| **D1** | **No per-channel agent settings.** `ai_settings` is already one row per agency and already channel-agnostic. It stays that way. The only per-channel controls are an on/off switch per connection and the channel's *own* technical limits, which come from code (`ChannelProfile`), not from a form. | The requirement is "common for every channel". Per-channel persona/tone/behaviour would create three drifting agents. |
| **D2** | **Instagram uses Instagram Business Login** (`graph.instagram.com`, no Facebook Page needed). Messenger uses **Facebook Login for Business** (Page token). They are two separate connections and two separate providers. | Many agency Instagram accounts are not linked to a Facebook Page; requiring one blocks onboarding. Identity, tokens, limits and policy differ enough that merging them would hide real differences. |
| **D3** | **Adapters, not forks.** Both channels implement the existing `ChannelAdapter` contract ([`lib/inbox/contracts.ts`](../../lib/inbox/contracts.ts)). The agent loop, prompt, tools and guardrails are made channel-neutral **once**, and WhatsApp is moved onto the same seam first. | `drain.ts`, `runtime.ts`, `guardrails.ts` and the outbox each contain WhatsApp-only code today (§2.2). Copying them twice triples every future fix. |
| **D4** | **Refactor WhatsApp behind the seam before adding a channel**, with characterization tests. | WhatsApp is live. The new channels must not be the reason it regresses. |
| **D5** | **Reuse the plumbing that already exists:** `channel_connections`, `contact_identities`, `agent_jobs`, `outbox_messages`, Vault, `linkConversationToLead`, `agent_runs`. Add one table (`channel_webhook_events`), a few columns, and nothing that duplicates them. | The Unified Inbox migration (`20260916073247`) built the neutral foundation for exactly this. |
| **D6** | **New channels ship with the agent OFF per connection**, and the agency turns it on. WhatsApp stays on. | Meta's policy requires automation disclosure and a 30-second response (§1.4). An agency should opt in knowingly. |
| **D7** | **Replies are split by byte length, not blocked.** Instagram caps text at **1000 bytes**; Sinhala/Tamil/Arabic are 2–3 bytes per character, so 1000 bytes is roughly 330 characters. The current guardrail *blocks* replies over 1200 characters, which on Instagram would silently drop most non-English answers. | See F5. |

---

## 1. What Meta's documentation says

Sources were fetched 2026-09-19. **Confirmed** = stated in the page; **Verify** = not found in the
pages read, or known from memory only — check against Meta before building on it (each has a phase
gate in §10).

### 1.1 Messenger Platform

| Topic | Finding | Status |
|---|---|---|
| Webhook object | `page`. Fields: `messages`, `messaging_postbacks`, `message_deliveries`, `message_reads`, `message_reactions`, plus `message_echoes` | Confirmed |
| Event shape | `entry[].messaging[]` with `sender.id`, `recipient.id`, `timestamp`, `message.mid`, `message.text`, `message.attachments[]`; postbacks carry `postback` instead of `message` | Confirmed |
| Signature | `X-Hub-Signature-256: sha256=<HMAC-SHA256 of raw body, app secret>`; GET handshake with `hub.mode/verify_token/challenge` | Confirmed (same as WhatsApp) |
| Identity | **PSID, page-scoped** — one person has a different id on every Page | Confirmed |
| Send | `POST https://graph.facebook.com/v25.0/{PAGE_ID}/messages`; `messaging_type` = `RESPONSE` / `UPDATE` / `MESSAGE_TAG` | Confirmed |
| Window | **24 hours** from the customer's last message. Outside it: only tagged messages | Confirmed |
| Human Agent tag | A human may reply for **7 days** after the customer's last message. Three legacy tags (`CONFIRMED_EVENT_UPDATE`, `ACCOUNT_UPDATE`, `POST_PURCHASE_UPDATE`) stopped working on 2026-04-27 — **only `HUMAN_AGENT` is usable** | Confirmed |
| Permissions | `pages_messaging`, `pages_manage_metadata` (subscribe a Page), `pages_show_list` | Confirmed |
| Page subscription | `POST /{page-id}/subscribed_apps` with `subscribed_fields`; needs a Page token from someone able to manage the Page; `DELETE` to unsubscribe | Confirmed |
| Profile lookup | `GET /{PSID}?fields=first_name,last_name,profile_pic`; needs **Advanced Access to "Business Asset User Profile Access"**; fails for accounts created with a phone number (error `2018218`); only after the person messaged/opted in | Confirmed |
| Sender actions | `typing_on`, `typing_off`, `mark_seen`; no fixed duration documented | Confirmed |
| Bot policy | Must disclose automation at thread start / after a long lapse / on human→bot switch; a bot flagged *automated* must respond to **any** input within **30 seconds** | Confirmed |
| Facebook Login for Business | Uses a `config_id` instead of scopes; tokens can be a **Business Integration System User token, non-expiring by default**; Tech Providers need Advanced Access via App Review | Confirmed |
| Text length limit, quick-reply limits | Believed 2000 characters / 13 quick replies, 20-char titles | **Verify** |
| Error code for "outside window" | Not read | **Verify** |
| Rate limits | Docs point to a separate page | **Verify** |

### 1.2 Instagram Platform

| Topic | Finding | Status |
|---|---|---|
| Two login models | **Instagram Login** → `graph.instagram.com`, Instagram user token, **no Facebook Page**, scopes `instagram_business_basic` + `instagram_business_manage_messages`. **Facebook Login** → `graph.facebook.com`, Page-linked account, `instagram_manage_messages` | Confirmed |
| Accounts | **Professional accounts only** (Business or Creator) | Confirmed |
| Webhook object | `instagram`, configured at the **app** level; app must be **Live** or Meta sends nothing | Confirmed |
| Fields | `messages`, `messaging_postbacks`, `messaging_seen`, `message_reactions`, `message_echoes`; also `messaging_optins`, `messaging_referrals` | Confirmed |
| Subscribing an account | `POST graph.instagram.com/me/subscribed_apps?subscribed_fields=...` — an account receives nothing until this is called | Confirmed |
| Event shape | `entry[].id` = the professional account id; `messaging[]` with `sender.id` (**IGSID**), `recipient.id`, `message.mid`, `is_echo`, `is_self` | Confirmed |
| Send | `POST graph.instagram.com/<IG_ID>/messages` (or `/me/messages`) | Confirmed |
| Window | **24 hours**; `HUMAN_AGENT` tag extends it by **7 days** | Confirmed |
| Content | Text (**UTF-8, under 1000 bytes**), links, images, audio, video, PDFs, stickers, reactions, templates. Images 8 MB; audio/video/PDF 25 MB | Confirmed |
| Not supported | Group messaging. Messages in the inactive *Requests* folder older than 30 days do not appear via API | Confirmed |
| OAuth | Authorize at `https://www.instagram.com/oauth/authorize`; code valid **1 hour**, single use; short-lived token via `POST api.instagram.com/oauth/access_token`; long-lived (**60 days**) via `graph.instagram.com/access_token` (`ig_exchange_token`, needs the app secret server-side) | Confirmed |
| Refresh | `graph.instagram.com/refresh_access_token` (`ig_refresh_token`); token must be **≥ 24 h old** and unexpired; **a token not refreshed within 60 days dies permanently** | Confirmed |
| Profile lookup | `GET graph.instagram.com/v25.0/<IGSID>?fields=name,username,profile_pic,...` after the person messaged; fails if they blocked the business | Confirmed |
| Which secret signs IG webhooks — the Meta app secret or the separate **Instagram app secret** shown under Instagram → API setup | Docs say "App Secret" without saying which | **Verify** (§F9) |
| Echo fields that distinguish *our* API sends from a human typing in the Instagram app | Not read | **Verify** (§F6) |
| Typing indicator / mark-seen on Instagram | Not confirmed | **Verify** |
| Whether attachment URLs (voice notes) need the access token to download | Not read | **Verify** |
| The Instagram-side "Allow access to messages" privacy toggle a business must switch on for connected tools | Known from memory, not in the pages read | **Verify** — onboarding copy depends on it |

### 1.3 What is *not* the same as WhatsApp

| | WhatsApp | Messenger | Instagram |
|---|---|---|---|
| Customer identity | Phone number (`wa_id`) | PSID, per Page, **no phone** | IGSID, per account, **no phone** |
| Reply window | 24 h, then templates | 24 h, then `HUMAN_AGENT` (7 d, staff only) | 24 h, then `HUMAN_AGENT` (7 d, staff only) |
| Outbound cost | Billed per template/category | Free | Free |
| Business can start a chat | Yes (template) | **No** — customer must message first | **No** |
| Text limit | 4096 chars | ~2000 chars (verify) | **1000 bytes** |
| Token | Per-WABA business token | Page token (non-expiring via FBL for Business) | **60-day, must be refreshed** |
| Buttons | Interactive reply buttons (≤3) | Quick replies / buttons | Quick replies / buttons |
| Tenant key in webhook | `phone_number_id` | Page id (`entry.id`) | IG account id (`entry.id`) |

Two consequences drive the design: **staff cannot start a conversation** on these channels (no
"New chat" — the composer only replies), and **there is no phone number**, so a lead created from
these channels has nothing to dedupe on until the agent obtains one (§7).

### 1.4 Policy the agent must honour

- **Disclose automation** at the start of a thread, after a long lapse, and when handing a chat back
  from a human to the AI. The frozen preamble gains a per-channel disclosure rule (§5).
- **Answer every input within 30 s** if the Page/account is flagged automated. Today the AI runs as
  a queued job; median turn latency must be measured against 30 s on these channels before the
  "automated" flag is claimed in App Review (§8).
- **The AI only ever replies inside the 24-hour window.** The 7-day `HUMAN_AGENT` tag is for people,
  is gated by its own App Review feature, and the AI never uses it.

---

## 2. What exists today

### 2.1 Reusable as-is

| Piece | Where | Notes |
|---|---|---|
| Neutral contracts | [`lib/inbox/contracts.ts`](../../lib/inbox/contracts.ts) | `ChannelProvider` already lists `INSTAGRAM`, `MESSENGER`; `ChannelAdapter`, `ChannelCapabilities`, `OutboxCommand` defined |
| Connections | `channel_connections` (`20260916073247`) | Provider, account id, status, Vault `credential_ref`, capability snapshot |
| Identity | `contact_identities` + `identity_match_events`; [`lead-linking.ts`](../../lib/inbox/lead-linking.ts) | Already takes `provider: INSTAGRAM \| MESSENGER`; maps `INSTAGRAM`/`FACEBOOK` lead sources |
| Conversations/messages | `conversations`, `conversation_messages` | `channel` CHECK already permits both; `unique (agency_id, channel, external_conversation_id)` |
| Outbox | `outbox_messages`, [`lib/inbox/outbox/drain.ts`](../../lib/inbox/outbox/drain.ts), `enqueue_inbox_text_message` | Staff sends already flow here; drain rejects non-WhatsApp on purpose |
| Job queue | `agent_jobs`, `claim_agent_jobs` (`SKIP LOCKED`) | Payload is `{conversationId, messageId}` — already channel-neutral |
| Agent settings | `ai_settings` (one row/agency), `behaviour` jsonb, knowledge base | No channel column |
| Telemetry | `agent_runs`, `agent_tool_calls` | No channel column yet (§4) |
| Inbox UI | `inbox-view-rail.tsx`, `conversation-list.tsx` | Already mention instagram/messenger; `views.ts` only implements `whatsapp` (`views.ts:35`) |
| Site legal pages | `app/legal/{privacy,data-deletion}` | Meta requires these URLs for Login |

### 2.2 WhatsApp-coupled code that must become channel-neutral

| File | Coupling | Change |
|---|---|---|
| [`lib/agent/whatsapp/drain.ts`](../../lib/agent/whatsapp/drain.ts) | Reads `whatsapp_integrations`, `readWhatsAppToken`, calls `sendText`/`sendInteractiveButtons`/`sendTypingIndicator`/`downloadMedia` directly; writes `ERROR`/`UNFUNDED` to `whatsapp_integrations`; appends a "Call us" line | Route through `getAdapter(provider)`; connection status via `channel_connections`; Call-Now becomes a WhatsApp adapter rendering detail |
| [`lib/agent/whatsapp/runtime.ts`](../../lib/agent/whatsapp/runtime.ts) | Model routing and tool loop are neutral, but history mapping and quick-reply choice assume WhatsApp | Take a `ChannelProfile`; otherwise unchanged |
| [`lib/agent/whatsapp/context.ts`](../../lib/agent/whatsapp/context.ts) | `channel: "whatsapp" \| "web" \| "voice"`, hardcoded `"whatsapp"` | `channel: ChannelProvider` from the conversation row; add `profile` |
| [`lib/agent/whatsapp/prompt.ts`](../../lib/agent/whatsapp/prompt.ts) | Preamble says "the WhatsApp assistant … over WhatsApp" | Parameterise on channel display name; add disclosure rule |
| [`lib/agent/whatsapp/guardrails.ts`](../../lib/agent/whatsapp/guardrails.ts) | `MAX_REPLY_CHARS = 1200`; window check hardcoded to "24h WhatsApp service window" | Limits and window wording from `ChannelProfile`; long replies are split, not blocked (D7) |
| [`lib/agent/whatsapp/lead-capture.ts`](../../lib/agent/whatsapp/lead-capture.ts) | `source: "WHATSAPP"`, `preferred_channel: "WHATSAPP"` | Map from channel |
| [`lib/agent/whatsapp/quick-replies.ts`](../../lib/agent/whatsapp/quick-replies.ts) | WhatsApp button model | Adapter renders `QuickReply[]` natively per channel |
| [`lib/whatsapp/webhook-handler.ts`](../../lib/whatsapp/webhook-handler.ts) | Ingestion steps (conversation → lead link → message → job) are neutral in shape but inline | Extract `ingestInboundMessage()` shared by all three webhooks |
| [`lib/data/whatsapp-repository.ts`](../../lib/data/whatsapp-repository.ts) | `upsertConversationForInbound` hardcodes `channel: "WHATSAPP"` and `contact_phone = waId` | Add `channel`, `connectionId`, `identity` parameters |
| [`lib/inbox/outbox/drain.ts:68`](../../lib/inbox/outbox/drain.ts) | `if (connection.provider !== "WHATSAPP") throw` | Adapter registry |
| [`app/inbox/actions.ts:583`](../../app/inbox/actions.ts) | `sendStaffMessage` window check is `channel === "WHATSAPP"` only | Use `ChannelCapabilities.replyWindow`; no "New chat" for these channels |
| [`lib/whatsapp/client.ts`](../../lib/whatsapp/client.ts) | `graphFetch` (retry/backoff/error body) is private and host-fixed | Extract to `lib/meta/graph.ts` with a host parameter |
| Analytics / billing | `whatsapp_message_charges` is WhatsApp-only | These channels have no per-message charge; AI cost stays; add a channel dimension |

---

## 3. Target architecture

```text
Meta Webhooks (one Meta app — ours)
  object=whatsapp_business_account ─▶ /api/webhooks/whatsapp   (exists)
  object=page                      ─▶ /api/webhooks/messenger  (new)
  object=instagram                 ─▶ /api/webhooks/instagram  (new)
        │  verify signature over raw bytes → resolve connection (tenant gate) → record raw event → 200
        ▼
  lib/meta/          shared: signature, handshake, graphFetch(host), error classes, token helpers
  lib/channels/<p>/  adapter per provider: normalize webhook, send, capabilities, profile, connect
        ▼
  lib/inbox/ingest.ts  ingestInboundMessage()  — ONE path:
        upsert conversation → resolve identity → link/create lead → insert message (idempotent on mid)
        → enqueue agent_jobs PROCESS_INBOUND  (only if agent allowed on this connection + conversation)
        ▼
  agent_jobs drain (lib/agent/…/drain.ts)
        buildAgentContext(channel, profile) → runAgentTurn  (same prompt, tools, guardrails, knowledge)
        → guardrails(profile) → splitForChannel(profile) → getAdapter(provider).send()
```

- **One agent.** `runAgentTurn` is called identically for all three channels. The only channel input
  is a `ChannelProfile` (limits + disclosure + rendering), a pure value from code.
- **One tenant gate per webhook.** Messenger resolves `entry.id` (Page id), Instagram resolves
  `entry.id` (IG account id), each against `channel_connections.provider_account_id`. Unknown →
  recorded and dropped with `200`, never guessed (same rule as WhatsApp D2).
- **The webhook never calls the model.** Same rule, same reason (Meta's timeout and retry behaviour).

---

## 4. One set of agent settings

`ai_settings` is already the single source: `enabled`, `agent_name`, `persona_instructions`,
`languages`, `tone`, `behaviour`, `lead_capture_enabled`, `booking_enabled`, `handoff_enabled`,
`voice_enabled`, `seat_hold_hours`, `max_turns_per_conversation`, `escalate_after_failed_turns`,
`out_of_hours_message`, the knowledge base, `default_lead_owner_id`. **All of it applies to every
channel unchanged.** No column is added to `ai_settings`.

What is per-channel, and why it is *not* a setting:

| Concern | Where it lives | Reason |
|---|---|---|
| Agent on/off for this connection | `channel_connections.ai_enabled` (new, default `false` for new providers) | An operational switch, not a personality. Conversation-level `ai_enabled` already exists and still wins |
| Max text length, byte vs character, split rule | `ChannelProfile` (code) | Set by the platform, not the agency |
| Automation disclosure wording | `ChannelProfile` (code) + one preamble rule | Required by Meta policy, not optional |
| Quick replies / buttons rendering | Adapter | Platform-specific |
| Reply window length | `ChannelCapabilities` | Platform-specific |
| Voice-note support | `ChannelProfile.supportsInboundAudio` AND `ai_settings.voice_enabled` | The agency switch stays common; the platform decides feasibility |

```ts
// lib/channels/profile.ts
export interface ChannelProfile {
  provider: ChannelProvider;
  displayName: "WhatsApp" | "Messenger" | "Instagram";
  maxTextUnit: "chars" | "bytes";
  maxTextSize: number;            // 4096 / ~2000 / 1000
  preferredReplyChars: number;    // soft target the prompt is told (chat-length, not the hard cap)
  replyWindowHours: 24;
  requiresAutomationDisclosure: boolean;
  supportsQuickReplies: boolean;
  supportsInboundAudio: boolean;
  customerCanBeStartedByBusiness: boolean;   // false for Messenger/Instagram
}
```

`agent_runs` gains `channel` (nullable, backfilled `WHATSAPP`) so the Overview/Analytics screens can
slice by channel without a second table. The analytics screens stay one screen with a channel filter.

---

## 5. Findings

| # | Finding | Impact | Fix |
|---|---|---|---|
| **F1** | `proxy.ts` machine-route allow-list must include the two new webhook paths, and the cron/OAuth callbacks. An unauthenticated Meta POST is redirected to `/login` otherwise | Blocking | Add `/api/webhooks/messenger`, `/api/webhooks/instagram` to `MACHINE_ROUTES` (or confirm `/api/webhooks` prefix already covers them) |
| **F2** | **No phone number.** `leads.mobile` is `text not null` (documented as a 9-digit subscriber number, `20260812100000_create_leads.sql:42`), and `lead-linking.ts:195` falls back to `mobile ?? input.externalSubjectId` — a 16-digit IGSID would be stored as a phone number, appear in Leads, and could later collide with a real dedupe key | Data corruption | Store `''` when no phone is known (matches `conversations.contact_phone default ''`), show "No phone yet" in Leads/Inbox, never use an external id as a mobile. Migration: confirm no format CHECK on `mobile`. `lead-linking` and `lead-capture` stop the fallback |
| **F3** | `leads.preferred_channel` CHECK is `('WHATSAPP','CALL','EMAIL','SMS','IN_PERSON')`; `lead-linking.ts:197` sets `WHATSAPP` for everything that is not Gmail | A person who only ever used Instagram is recorded as preferring WhatsApp — the follow-up automations then pick the wrong channel | Extend the CHECK with `INSTAGRAM`, `MESSENGER`; map from provider; update `lib/types/leads.ts`, `lib/validations/leads.ts` |
| **F4** | `leads.source` already allows `FACEBOOK` and `INSTAGRAM`; `lead-linking.ts` maps them; `lead-capture.ts:139` (the AI's own lead creation) hardcodes `WHATSAPP` | Agent-created leads from these channels are mis-attributed | Map from the conversation's channel |
| **F5** | **Instagram's 1000-*byte* limit versus a 1200-*character* guardrail.** A Sinhala or Tamil reply of 400 characters is ~1200 bytes and would be rejected by Meta; the current guardrail *blocks* over-long replies, so the customer gets silence | Most non-English replies fail on Instagram | Byte-aware `splitForChannel()`: split on paragraph, then sentence boundary, send as sequential messages; the guardrail's hard cap becomes a *total* cap (e.g. 3 parts). Tell the model the soft target in the prompt |
| **F6** | **Echo ambiguity.** WhatsApp coexistence echoes are always a human. On Messenger and Instagram, `message_echoes`/`is_echo` also fire for messages *our own app* sent via the API. Our outbound row is inserted `PENDING` with no `external_message_id` and patched after the send returns, so an echo can arrive before the id is saved → looks like an unknown human message → conversation flips to `HUMAN_ACTIVE` → the AI goes silent on its own reply | Random, hard-to-reproduce AI silences | (1) Dedupe echoes on `mid` first. (2) Use the echo's app id where present (Messenger includes it — **verify Instagram**) to recognise our own sends. (3) Defer echo handling ~10 s via a delayed job so the send can save its id, then treat only *still-unknown* echoes as human. (4) Test the race explicitly |
| **F7** | **Instagram token expires in 60 days and cannot be revived once lapsed.** Refresh requires the token to be ≥ 24 h old | An agency's Instagram silently dies two months after connecting | Store `credential_expires_at`; a daily job refreshes tokens with < 15 days left, marks `DEGRADED` on failure and `ERROR` on expiry; the Inbox and Integrations screens show it; alert the agency admin 7 days ahead |
| **F8** | **The customer must message first.** There is no `startWhatsAppChat` equivalent. `sendStaffMessage` and the new-chat dialog assume a business can open a thread | Staff tries to message an Instagram lead and gets a Meta error | `ChannelCapabilities.customerCanBeStartedByBusiness=false` hides "New chat" for these providers; Leads "message on Instagram" offers only existing threads |
| **F9** | Instagram Login apps have an **Instagram app ID/secret separate from the Meta app's**; the Instagram webhook docs say only "App Secret" | Wrong secret → every Instagram webhook is rejected as forged (or, worse, an unsigned check is loosened to make it work) | `verifyMetaSignature(raw, header, secrets[])` accepts a list; configure `META_APP_SECRET` and `INSTAGRAM_APP_SECRET`; **confirm empirically in the first Dev-mode test which one signs** and drop the other. Never fall back to "skip verification" |
| **F10** | Meta only sends Instagram webhooks when the **app is Live**, and only for accounts that were **subscribed** (`/me/subscribed_apps`) | "Works in test, nothing arrives in production" | Onboarding step 6 (§6.2) subscribes and reads the subscription back; `WEBHOOK_VERIFIED` is set by the first real signed event, as WhatsApp already does (`markWebhookVerified`) |
| **F11** | Names and avatars need **Advanced Access** (Messenger: Business Asset User Profile Access; Instagram: consent after the person messages). Until granted, `contact_name` has nothing to show | Inbox rows read "Instagram user 1784…" | Fallback label `"<Provider> customer"`; profile lookup is best-effort and non-blocking; name is refreshed on later messages |
| **F12** | Messenger profile lookup fails for accounts created with a phone number (`2018218`) | A real customer with no name | Treat as a normal "unknown name", not an error |
| **F13** | `conversations.service_window_expires_at` is named for WhatsApp but the semantics ("when free-text replies stop being allowed") are identical for these channels | Confusing name, no functional problem | Reuse the column; document in the migration comment; do **not** rename (churn across RLS, views, tests) |
| **F14** | `contacts` from different channels for the same human are separate `contact_identities` | Same person = 3 leads if nothing links them | The agent asks for a phone number (§7); identity resolution then links by normalized phone through the **existing** `decideLeadLink` rules (exact identity → one unambiguous phone match → else staff review). Never auto-merge on name |
| **F15** | Facebook Login for Business with a **system-user token** may not return Pages from `/me/accounts` the way a user token does | Connect flow lists no Pages | Follow the WhatsApp precedent: `debug_token` → `granular_scopes` target ids → `GET /{page-id}?fields=name,access_token`; **verify in Dev mode before building the picker** |
| **F16** | Meta App Review is calendar time and gates Advanced Access (Messenger, Instagram, profile, Human Agent) | Blocks any real agency other than the app's own roles | Start on day one; Dev-mode + app roles (Standard Access) covers build and QA (§9) |

---

## 6. Connecting the accounts

Both flows copy the shape of the WhatsApp connect: a **full-page redirect**, a `state` cookie for
CSRF, a thin callback route, and the work done in a Server Action. No Facebook JS SDK.

### 6.1 Messenger — `app/api/oauth/messenger/{start,callback}`

1. Redirect to `https://www.facebook.com/<version>/dialog/oauth` with `config_id=META_MESSENGER_CONFIG_ID`,
   `response_type=code`, `override_default_response_type=true`, `state`.
   The Facebook Login for Business configuration grants `pages_messaging`, `pages_manage_metadata`,
   `pages_show_list` on the Pages the person selects.
2. Callback exchanges the code (server-side, app secret), identifies the granted Page ids (F15).
3. If several Pages were granted, the agency **chooses one** — reuse the WhatsApp "choose which
   account" component pattern.
4. `GET /{page-id}?fields=name,access_token`; store the **Page token in Vault** →
   `channel_connections.credential_ref`.
5. `POST /{page-id}/subscribed_apps` with `messages, messaging_postbacks, message_deliveries,
   message_reads, message_reactions, message_echoes`; read the subscription back.
6. Upsert `channel_connections` (`provider = MESSENGER`, `provider_account_id = page_id`,
   `display_name = page name`, `status = CONNECTED`, `ai_enabled = false`).
7. **Disconnect** = `DELETE subscribed_apps`, delete the Vault secret, `status = DISCONNECTED`. Conversations stay.

### 6.2 Instagram — `app/api/oauth/instagram/{start,callback}`

1. Redirect to `https://www.instagram.com/oauth/authorize` with `client_id=INSTAGRAM_APP_ID`,
   `redirect_uri`, `response_type=code`, `scope=instagram_business_basic,instagram_business_manage_messages`,
   `state`. (`enable_fb_login` left at default.)
2. Callback: code → `api.instagram.com/oauth/access_token` (short-lived + `user_id`) →
   `graph.instagram.com/access_token` (`ig_exchange_token`, long-lived 60 days).
3. `GET /me?fields=user_id,username,name,account_type` — reject non-professional accounts with a
   plain-language message ("Switch this Instagram account to a Business or Creator account first").
4. Store the token in Vault; record `credential_expires_at = now + 60d` (F7).
5. `POST /me/subscribed_apps?subscribed_fields=messages,messaging_postbacks,messaging_seen,message_reactions`
   (add `message_echoes` once F6 is verified); read back.
6. Upsert `channel_connections` (`provider = INSTAGRAM`, `provider_account_id = IG_ID`, `ai_enabled = false`).
7. Onboarding copy tells the agency to switch on **Allow access to messages** in Instagram (verify wording, §1.2).
8. **Refresh job** (F7) and **disconnect** as above. Disconnect also handles Meta's *deauthorize*
   callback and the existing data-deletion page.

### 6.3 Integrations screen

`app/(main)/management/settings/integrations/` gains two cards beside WhatsApp, each with
**Connect / Reconnect / Disconnect**, the connection status from `channel_connections`, a per-channel
**"Let the assistant reply on this channel"** switch (D6), and the token-expiry line for Instagram.
Cards use the existing status vocabulary (`CONNECTED`, `DEGRADED`, `ERROR`, `DISCONNECTED`).

---

## 7. Identity and leads without a phone number

```text
Inbound Instagram DM (IGSID 1784…)
  → contact_identities (provider=INSTAGRAM, external_subject_id=IGSID)   exact identity match first
  → no lead yet → create a minimal lead: source=INSTAGRAM, preferred_channel=INSTAGRAM, mobile=''  (F2, F3)
  → the agent's normal lead-capture tools run — plus one new question:
       "What's the best WhatsApp/phone number to reach you on?"
  → when a number is captured: normalize (lib/agent/whatsapp/phone.ts) → decideLeadLink
       0 matches → set lead.mobile
       1 match   → link this identity to that lead (the same person already known from WhatsApp)   ← cross-channel
       2+        → AMBIGUOUS: stays unlinked, staff resolves in Inbox
```

- The number the customer *types* is unverified. It is recorded as `VERIFIED_CONTACT` only when the
  existing rules already accept that confidence; otherwise a staff member confirms. Numbers from a
  typed message are never auto-merged into someone else's lead.
- `update_lead` gains no new power — capturing a phone goes through the existing tool and the
  existing repository, so agent writes stay within decision D7 of the WhatsApp plan.
- Consent: Messenger/Instagram have no Meta-side opt-in ledger in `consent_and_contactability`; the
  customer messaging first is the basis for *replying*, and nothing here enables marketing sends.

---

## 8. The agent, channel-neutral

The agent's logic does not change. These are the seams (file-level list is §2.2):

1. **`getAdapter(provider)`** — a registry returning the `ChannelAdapter`. Implemented for
   `WHATSAPP` (wrapping current code), `MESSENGER`, `INSTAGRAM`.
2. **Extended adapter contract** — the existing contract has `send`, `normalizeWebhook`,
   `capabilities`. Add: `sendTyping?`, `markRead?`, `fetchAttachment?`, `classifyError(error)`,
   `profile`. `classifyError` returns a shared union (`TOKEN_DEAD`, `OUTSIDE_WINDOW`, `RATE_LIMITED`,
   `UNFUNDED`, `RECIPIENT_UNREACHABLE`, `UNKNOWN`) so `drain.ts` has one error path instead of one per provider.
3. **Send path** — AI replies call `adapter.send()` directly (as they do today for WhatsApp);
   staff replies keep going through the outbox, which now dispatches via the same adapter. Two
   callers, one adapter — no duplicated send/retry logic. Moving AI replies onto the outbox is the
   later convergence in `inbox-architecture.md` §7.3 and is **out of scope** here (it would touch the
   live WhatsApp reply path for no channel-enabling benefit).
4. **Prompt** — `buildSystemPrompt(ctx)` takes the channel display name; the preamble's WhatsApp
   references become `${profile.displayName}`. When `requiresAutomationDisclosure`, one rule is
   appended: *"On your first reply in a conversation, and after a gap of more than a day, say briefly
   that you are the agency's automated assistant and that a person can take over."* The rule is in
   the **stable** prefix, so prompt caching is unaffected (per-channel variants add at most two cache
   entries per agency).
5. **Guardrails** — `checkOutboundReply` takes the profile: the window check reports the channel's
   name; length is measured in the profile's unit; over the soft target the reply is split (F5).
   The number-must-come-from-a-tool rule is unchanged and applies to every channel.
6. **Quick replies** — `chooseQuickReplies` output is a neutral `QuickReply[]`; each adapter renders
   (WhatsApp interactive buttons; Messenger/Instagram quick replies — limits **verify**). The
   "Call us" line stays a WhatsApp rendering detail.
7. **Typing / read** — `sendTyping` where the platform supports it (Messenger `typing_on`/`mark_seen`);
   Instagram after verification; absent → skipped, never an error.
8. **Voice** — Messenger and Instagram deliver voice notes as audio attachments. The existing
   `TRANSCRIBE_AUDIO` job, `processVoiceMessage` retry/fallback and the "never record a name or number
   from a voice note" rule are reused; only `downloadAudio` moves behind `adapter.fetchAttachment`
   (token requirement **verify**). Ships after text.
9. **Human handoff** — unchanged (`transfer_to_staff`, `HUMAN_ACTIVE` suppresses enqueue). Echo
   handling implements F6.
10. **Response-time budget** — Meta's 30-second rule: the drain's `after()` kick already targets
    sub-second start; measure end-to-end p95 per channel from `agent_runs.latency_ms` before flagging
    the Page/account as automated.

---

## 9. Data model changes

One migration per concern, RLS in the same migration (repo rule). Names follow the existing
`YYYYMMDDHHMMSS_` convention; numbers assigned at build time.

```text
M1  channel_webhook_events                                   -- raw, append-only audit floor
      id, provider, connection_id (nullable until resolved), agency_id (nullable),
      external_event_id, payload jsonb, signature_valid boolean,
      received_at, processed_at, error
      unique (provider, external_event_id)                   -- redelivery idempotency
      RLS: select ADMIN/CEO in own agency; NO write policy (service role only)

M2  channel_connections additions
      ai_enabled boolean not null default false              -- D6; backfill WHATSAPP rows to true
      credential_expires_at timestamptz                      -- F7
      unique (provider, provider_account_id)
        where provider in ('MESSENGER','INSTAGRAM') and status <> 'DISCONNECTED'
                                                             -- tenant gate is global, like phone_number_id
      (existing RLS unchanged)

M3  leads
      preferred_channel CHECK += 'INSTAGRAM','MESSENGER'     -- F3
      confirm no format CHECK on mobile; allow ''            -- F2

M4  agent_runs
      channel text                                           -- nullable; backfill 'WHATSAPP'
      index (agency_id, channel, created_at)
```

No change to `conversations` columns: `channel`, `external_conversation_id` (PSID/IGSID),
`connection_id`, `contact_identity_id`, `service_window_expires_at`, `state`, `ai_enabled` already
exist. `conversation_messages` needs nothing: `content_parts`, `direction`, `external_message_id`
(unique per agency) exist. Attachments use the existing `message_attachments`.

**Vault:** Page token and Instagram token stored per connection, same helpers as
[`lib/whatsapp/vault.ts`](../../lib/whatsapp/vault.ts) (generalised to `lib/channels/vault.ts`; the
WhatsApp path keeps working through it).

**RLS impact:** none of M2–M4 opens new read paths. `channel_webhook_events` and tokens are
service-role only. Add cross-tenant tests (§11).

**Access control:** `capabilitiesForInbox`/`capabilitiesForAiAgent` are unchanged — channels are not
a permission dimension. Connecting/disconnecting a channel and toggling `ai_enabled` are ADMIN-only,
the same as WhatsApp connect today.

---

## 10. Phases

Each phase is independently shippable. The **Meta track** (§13) starts on day one and runs in
parallel; Dev mode with app roles is enough for phases 0–5.

| Phase | Scope | Done when |
|---|---|---|
| **0 — Groundwork** | `lib/meta/` extracted from `lib/whatsapp/` (`graphFetch(host)`, signature with secret list, handshake, error base); `proxy.ts` machine routes (F1); `ChannelProfile` + adapter contract extension + `getAdapter()` with WhatsApp registered; `ChannelProvider` types | `npm run typecheck` green; WhatsApp behaviour byte-for-byte unchanged (existing `client.test.ts`, `signature` tests pass) |
| **1 — WhatsApp onto the seam** (D4) | `ingestInboundMessage()` extracted from `webhook-handler.ts`; `upsertConversationForInbound` takes `channel`; `drain.ts` sends/classifies via the adapter; `context.channel` real; guardrails/prompt take the profile; outbox drain uses the registry. **Characterization tests written first** | A recorded WhatsApp webhook fixture produces identical rows and an identical outbound call before and after; the WhatsApp go-live checklist ([`whatsapp-go-live-plan.md`](whatsapp-go-live-plan.md)) still passes manually |
| **2 — Messenger in** | M1, M2; `/api/webhooks/messenger` (verify, tenant gate on Page id, record, ingest); Messenger normalizer; profile lookup (best-effort, F11/F12); echo handling with the F6 deferral; `views.ts` `messenger` view | A Dev-mode Page message lands as a conversation + message under the right agency; a replayed webhook creates nothing; an unknown Page id is dropped with 200; a forged signature is 401 |
| **3 — Messenger out + connect** | §6.1 connect flow, Page picker, Vault, subscribe/readback, disconnect; Messenger `send`, `sendTyping`, error classification, byte-aware splitter; `sendStaffMessage` window via capabilities; Integrations card | Staff replies from the Inbox and it arrives; disconnect stops delivery; a send outside 24 h returns a clear message, not a Meta error |
| **4 — Agent on Messenger** | Prompt disclosure rule; per-connection `ai_enabled` switch; M4; lead mapping (F3/F4) + F2 fix; phone-capture question; cross-channel link test | With the switch on, the agent answers "what's available in March?" from live departures using the agency's own settings and knowledge; with it off, messages land as human-requested; latency p95 recorded against 30 s |
| **5 — Instagram in + out** | M2 refresh column; `/api/webhooks/instagram` with F9 secret resolution; normalizer; §6.2 connect; `graph.instagram.com` client; **1000-byte splitter proven on Sinhala/Tamil fixtures (F5)**; token refresh job (F7); Integrations card | A DM to a test professional account gets an AI reply split correctly; a Tamil reply over 1000 bytes arrives as ordered parts; a token 10 days from expiry is refreshed by the job |
| **6 — Voice + quick replies** | Attachment fetch for audio, transcription through the existing job; quick-reply rendering per channel | A voice note on either channel is answered through the same runtime; the "never record a number from a voice note" rule holds |
| **7 — Analytics + Inbox polish** | Channel filter on AI analytics; Inbox channel badges/views/composer capability states ("Reply window closed", "Customer must message first"); per-channel handoff-rate and latency | Overview shows agent metrics sliced by channel from real rows |
| **8 — Hardening** | Cross-tenant pass on both webhooks; burst test (100 messages, two agencies, three channels) for duplicate replies; deauthorize/data-deletion callbacks; redaction audit; runbook | No duplicate reply, no cross-agency row, no token in any log |

---

## 11. Testing

Per [`testing-standards.md`](../standards/testing-standards.md) — business-rule branching gets a Vitest test:

- **Signature:** valid/invalid/missing header per object; the secret-list resolution (F9).
- **Tenant gate:** known Page / IG account → agency; unknown → dropped; a Page id claimed by two agencies is impossible (unique index) and tested.
- **Idempotency:** the same `mid` twice inserts once and enqueues once.
- **Echo race (F6):** own-send echo before the id is saved must **not** flip to `HUMAN_ACTIVE`; a genuinely unknown echo does, after the deferral.
- **Splitter (F5):** ASCII, Sinhala, Tamil, Arabic, emoji, a single 2000-byte sentence, exactly 1000 bytes, 1001 bytes; never splits a surrogate pair or grapheme; total-cap behaviour.
- **Guardrails:** unchanged rules still apply on both new channels; window wording per channel.
- **Identity:** IGSID-only lead has `mobile = ''`; captured phone that matches one lead links; two leads → `AMBIGUOUS`; an external id is never written to `mobile` (F2).
- **Adapter contract test:** one shared suite run against all three adapters (send success, each error class, window expiry).
- **Token refresh:** refresh < 15 days; not < 24 h old; failure → `DEGRADED`; expiry → `ERROR`.
- **RLS:** two agencies, each cannot read the other's `channel_connections` / `channel_webhook_events` / conversations.
- **Manual (browser):** connect, disconnect, reconnect, expired token banner, agent on/off switch, human takeover then release, staff reply outside the window.

`npm run lint`, `npm run typecheck`, `npm run test` all pass before a PR.

---

## 12. Configuration

Added to `.env.example`, same commentary style:

```bash
# ── Messenger ────────────────────────────────────────────────────────────────
META_MESSENGER_CONFIG_ID=          # Facebook Login for Business configuration (Pages assets)
MESSENGER_VERIFY_TOKEN=            # our own random string for the `page` webhook handshake

# ── Instagram (Instagram API with Instagram Login) ───────────────────────────
INSTAGRAM_APP_ID=                  # NOT the Meta app id — shown under Instagram → API setup
INSTAGRAM_APP_SECRET=              # server-side only; token exchange (and maybe webhook signing — F9)
INSTAGRAM_VERIFY_TOKEN=            # our own random string for the `instagram` webhook handshake
```

`META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION`, `CRON_SECRET` already exist. Note
`META_GRAPH_VERSION` defaults to `v21.0` in code while the Messenger and Instagram pages document
`v25.0` — set it explicitly in every environment before Phase 2.

Without these variables a channel is inert and its card reads "Not configured" — same degrade-gracefully
posture as WhatsApp.

---

## 13. The Meta track (critical path — calendar time, not code)

Started on day one, owned by a named person. Reuses the Tech Provider registration and business
verification already done for WhatsApp.

| Item | Needed for | Notes |
|---|---|---|
| Add **Messenger** and **Instagram (Instagram Login)** products to the existing Meta app | Everything | Configure the `page` and `instagram` webhook objects with their own callback URLs and verify tokens; app must be **Live** for Instagram webhooks (F10) |
| Advanced Access: `pages_messaging`, `pages_manage_metadata`, `pages_show_list` | Messenger for other agencies | Screencast of the full connect + reply flow |
| Advanced Access: `instagram_business_basic`, `instagram_business_manage_messages` | Instagram for other agencies | Screencast per permission |
| **Business Asset User Profile Access** | Customer names/photos | Without it, F11 fallback labels are permanent |
| **Human Agent** feature | Staff replies days 2–7 | Optional for launch; gate the composer on it |
| Data-deletion + deauthorize callbacks | App Review / Login | Pages exist (`app/legal/data-deletion`); confirm a callback route, Phase 8 |
| Runbook | Repeatability | `docs/runbooks/meta-messaging-app-review-submission.md`, modelled on `whatsapp-app-review-submission.md` |

**Until approval,** development and QA use Dev mode with the Meta app's own admins/testers and
Standard Access on accounts they own (Instagram docs: Standard Access for owned accounts). That is
enough to finish Phases 0–5 end to end.

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| WhatsApp regresses during the refactor | Phase 1 is its own phase, behind characterization tests, and ships before any new channel code |
| The agent answers on a new channel before the agency intended | `channel_connections.ai_enabled` defaults `false` (D6) |
| Own-message echoes silence the AI (F6) | Dedupe on `mid`, app-id check, deferred handling, dedicated test |
| Instagram connection dies in 60 days (F7) | Refresh job, expiry field, visible status, 7-day warning |
| Non-English replies rejected by Instagram (F5) | Byte-aware splitter + Sinhala/Tamil fixtures |
| Wrong webhook secret weakens verification (F9) | Secret *list*, empirical confirmation, never skip verification |
| Duplicate/cross-channel leads | Exact identity → unambiguous phone → staff review; no name-based merge |
| Bot misses the 30-second rule | Measure p95 per channel before claiming "automated"; the disclosure + handoff already exist |
| Meta changes an API version/field | Version in `META_GRAPH_VERSION`; adapters isolate provider shapes; contract tests |

---

## 14.1 Checking Meta's 30-second rule

An automated Messenger/Instagram account must answer any input within 30 seconds. `agent_runs.channel` and `latency_ms` record every turn; the check before claiming the "automated" flag in App Review is:

```sql
select channel,
       count(*)                                                        as turns,
       percentile_cont(0.5)  within group (order by latency_ms)        as p50_ms,
       percentile_cont(0.95) within group (order by latency_ms)        as p95_ms,
       round(100.0 * avg((latency_ms > 30000)::int), 1)                as pct_over_30s
from public.agent_runs
where agency_id = '<agency uuid>' and created_at > now() - interval '7 days'
group by channel;
```

`latency_ms` is the model turn only. End-to-end (Meta delivers → customer sees the reply) also includes the job wait and the send, so treat p95 well under 30 s here as a necessary, not sufficient, condition. Phase 7 puts this on the Analytics screen.

---

## 15. Open questions (need an answer from the business)

1. **Do the agencies' Instagram accounts already run as professional accounts?** If most are personal, onboarding needs a guided switch step (the connect flow rejects personal accounts, §6.2).
2. **Human Agent tag:** do staff routinely reply after 24 hours? If yes, the Human Agent App Review feature moves from optional to launch-critical.
3. **Automated-bot flag on Messenger/Instagram:** claiming it brings the 30-second rule; not claiming it means Meta may treat the inbox as human-operated. Recommendation: claim it after Phase 4 latency numbers are in.
4. **Comments and story replies** (Instagram comment-to-DM, story mentions) are **out of scope** here — they need `instagram_business_manage_comments` and separate policy. Worth a follow-up plan if campaigns rely on them.
5. **Facebook Page posts/ads → Messenger click-to-message attribution:** WhatsApp already resolves campaign attribution from opening-message text/QR. Messenger/Instagram send `referral` events (`messaging_referrals`); mapping those to campaigns is a natural Phase 7 addition — confirm it is wanted.
6. **Meta app structure:** one Meta app for WhatsApp + Messenger + Instagram (assumed here) versus a separate app for Instagram. One app keeps App Review and the webhook secret story simpler; confirm nothing in the current app's settings prevents adding the products.

---

## 16. Documentation to update when built

- [`inbox-architecture.md`](inbox-architecture.md) §6.1 — mark Instagram/Messenger adapters as built.
- [`whatsapp-ai-agent-implementation-plan.md`](whatsapp-ai-agent-implementation-plan.md) — add a pointer: the agent is now multi-channel; `lib/agent/whatsapp/` naming is historical.
- [`../architecture/whatsapp-multi-tenant-connection.md`](../architecture/whatsapp-multi-tenant-connection.md) — add the Messenger/Instagram rows or link a sibling doc.
- [`../runbooks/`](../runbooks/README.md) — the Meta messaging App Review runbook (§13).
- [`../../.env.example`](../../.env.example) — §12.

A note on naming: the agent code lives under `lib/agent/whatsapp/`. Renaming it (e.g. to
`lib/agent/inbox/`) is deliberately **not** part of this plan — it is a large mechanical diff that
would bury the real changes. Do it as a separate, behaviour-free commit after Phase 4 if wanted.
