# Unified Inbox Architecture

> Product position: **“Every pilgrim conversation, booking and follow-up—managed from one place.”**

Status: proposed target architecture. This document describes the design only; it does not implement it.

## 1. Executive decision

Build the Inbox as a channel-neutral conversation platform inside the existing Next.js and Supabase application, not as a collection of channel-specific screens.

The architecture has four stable boundaries:

1. **Provider adapters** translate WhatsApp, Instagram, Messenger, Gmail, and later channels into one canonical event/message contract.
2. **Conversation core** owns identity resolution, threads, messages, assignments, unread state, notes, tasks, audit history, and outbound delivery.
3. **CRM orchestration** links conversations to the existing lead, package, departure-group, booking, pilgrim, payment, and follow-up records. Those modules remain the sources of truth.
4. **Realtime workspace** projects the canonical data into a responsive three-pane inbox and keeps staff clients synchronized with private, tenant-authorized events.

The system accepts that provider webhooks are delivered **at least once**. It produces exactly-once CRM effects through durable event storage, provider-scoped idempotency keys, transactional state changes, and retryable workers.

## 2. Current repository context

### 2.1 What exists now

The current Inbox is a useful WhatsApp human-handoff console:

- `app/inbox/page.tsx` loads up to 100 non-closed conversations and 200 messages for the selected conversation using the session Supabase client and RLS.
- Conversation selection is a shareable `?conversation=` URL parameter.
- `conversation-list.tsx` shows the contact, lead reference, handling state, and last activity.
- `conversation-panel.tsx` renders a text transcript and the WhatsApp AI/staff handoff bar.
- `actions.ts` supports start chat, take control, release to AI, close, and text reply.
- `lib/whatsapp/webhook-handler.ts` verifies signatures, records raw deliveries, resolves the tenant from the connected number, deduplicates provider events, stores inbound messages, and queues AI work.
- `lib/data/whatsapp-repository.ts` consistently scopes service-role operations by `agency_id` and already uses `FOR UPDATE SKIP LOCKED` for worker claims.
- The existing lead agent can find/create a lead by normalized WhatsApp number, recommend live departures, create a held booking, and link it back to the lead.
- The existing schema already supplies lead interest, desired package, selected departure group, booking, traveller, payment, follow-up, staff, consent, and campaign-attribution data.

### 2.2 Constraints and gaps

| Area | Current state | Required target |
|---|---|---|
| Channel model | `conversations.channel` only permits `WHATSAPP`; types and actions are WhatsApp-specific | Provider-neutral core and capability-driven adapters |
| Layout | Two panes: list and transcript | Inbox filter rail, conversation list, workspace, and contextual customer panel |
| Refresh | Server revalidation; no live subscription | Private realtime updates with reconnect recovery |
| Messages | Text UI; one optional `media_path` | Rich parts/attachments, replies, email bodies, voice notes, documents, and delivery events |
| Identity | Conversation stores a phone and optional `lead_id` | Multiple provider identities resolved to the same lead/pilgrim without creating another customer source of truth |
| State | `state` mixes AI ownership, waiting, human control, and closure | Separate lifecycle, assignment, and automation state machines |
| Outbound reliability | Provider send occurs before the CRM message insert | Atomic message + outbox write, asynchronous provider send, retries, and reconciliation |
| Collaboration | Assignment snapshot only | Assignment history, notes, mentions, saved replies, tasks, collision protection, and presence |
| CRM context | Lead reference only | Lead/package/group/booking/traveller/balance/history/follow-up projection |
| Search/work queue | No inbox filters or cursor pagination | Saved views, channel/status/owner/priority filters, full-text search, and cursor pagination |

### 2.3 Existing boundaries to preserve

- Continue using agency-scoped RLS and `capabilitiesForInbox(role)`; the service role is limited to verified webhooks and workers.
- `leads` remains the sales/customer record during enquiry. Do not introduce a competing customer master.
- `departure_group_bookings` remains the booking and seat-capacity source of truth.
- Package and departure availability must always be read live before an offer or booking action.
- Finance remains the source of truth for amount paid and outstanding balance.
- AI never receives credentials, chooses an `agency_id`, or bypasses tool guardrails.
- Provider tokens and app secrets remain server-only in Vault; browser clients never call channel APIs directly.

## 3. Product information architecture

The app sidebar remains outside the Inbox. Inside `/inbox`, use a three-pane shell:

```text
┌─────────────────┬────────────────────────┬──────────────────────────────────────────────┐
│ Inbox views     │ Conversation list      │ Conversation workspace                       │
│                 │                        │ ┌──────────────────────┬───────────────────┐ │
│ All             │ Customer + avatar      │ │ Header + timeline    │ Customer context  │ │
│ Unassigned      │ Channel + preview      │ │ Notes / messages     │ Lead / package    │ │
│ Assigned to me  │ Owner + unread         │ │ Composer + Copilot   │ Booking / payment │ │
│ WhatsApp        │ Priority + journey     │ │                      │ Tasks / history   │ │
│ Instagram       │ Response SLA           │ └──────────────────────┴───────────────────┘ │
│ Messenger       │                        │                                              │
│ Email           │                        │ Context becomes a drawer at narrower widths  │
│ Closed / Spam   │                        │                                              │
└─────────────────┴────────────────────────┴──────────────────────────────────────────────┘
```

This resolves the apparent four-column requirement by treating customer context as a subpanel of the workspace. On tablets the filter rail collapses; on mobile the list, conversation, and context become separate navigable views.

### 3.1 Conversation workspace

- One chronological timeline for channel messages, internal notes, assignment changes, lead/booking milestones, and system events.
- Channel-aware composer driven by adapter capabilities: text, attachment types, templates, reply/reply-all, subject, CC/BCC, service-window state, and maximum sizes.
- Draft persistence per conversation and staff member.
- Internal notes are visually and structurally separate from outbound messages; notes can never enter a provider outbox.
- Saved replies support channel/language tags and variables whose rendered preview must be confirmed before sending.
- “Create booking” opens the existing booking flow as a sheet/modal with conversation and lead context; success links the booking and appends a timeline event without leaving the Inbox.
- Copilot suggestions are drafts, never invisible sends. Each suggestion identifies the CRM facts used and is regenerated if those facts become stale.

### 3.2 Customer context projection

The panel is a read model, not a new source of truth:

- Identity: name, phone, email, social handles, preferred language, consent/contactability.
- Sales: lead reference, owner, stage, temperature, package interest, preferred period, selected departure group.
- Booking: booking reference/status, travellers, seat-hold expiry, blockers.
- Finance: booking currency, total, amount paid, balance, next milestone. Permission-sensitive amounts remain hidden from roles that cannot view finance.
- Relationship: previous conversations across channels, notes, tasks, and follow-ups.

## 4. Logical architecture

```text
WhatsApp / Instagram / Messenger / Gmail / future provider
                         │ signed webhook, push notification, or sync cursor
                         ▼
              Provider-specific HTTP endpoint
                         │ verify → resolve connection → persist raw event → ACK fast
                         ▼
             Durable normalized-event work queue
                         │ claim with SKIP LOCKED; bounded retry/dead-letter
                         ▼
┌──────────────────────────────── Conversation Core ────────────────────────────────┐
│ provider adapter → canonical event → identity resolver → conversation resolver     │
│ → message/event transaction → unread/SLA projection → automation dispatcher        │
└──────────────────────────────────────┬───────────────────────────────────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
              CRM orchestration   Outbound outbox    Realtime broadcast
              lead/package/       provider adapter   private agency/thread
              booking/follow-up   delivery updates   topics
                    │                  │                  │
                    └──────────────────┴──────────────────┘
                                       ▼
                              Next.js Inbox workspace
```

Webhook endpoints do no AI work and no heavy provider fetches before acknowledging. A Gmail Pub/Sub notification is a cursor notification, not the email itself; the Gmail adapter advances `historyId` and retrieves the changed messages asynchronously.

## 5. Canonical domain model

Names below are targets; exact migrations should be reviewed against the generated local schema before implementation.

### 5.1 Connection and ingestion

| Table | Purpose / important fields |
|---|---|
| `channel_connections` | One agency connection: `provider`, `external_account_id`, display identity, status, capability snapshot, Vault credential refs, sync cursor, webhook health, token expiry. A provider-specific details JSON is permitted only for non-queryable metadata. |
| `channel_webhook_events` | Append-only raw envelope: connection, provider event ID, signature result, headers/body, received/processed timestamps, error. Unique `(provider, connection_id, external_event_id)`. Payload retention/redaction policy is mandatory. |
| `channel_jobs` | Durable normalized processing jobs with kind, payload, status, attempts, run time, locks, and last error. Dead jobs are visible to administrators. |

`whatsapp_integrations`, `whatsapp_webhook_events`, and `agent_jobs` remain operational during migration. WhatsApp is moved behind the adapter contract before these legacy tables are retired or converted into compatibility views.

### 5.2 Identity without a second customer master

| Table | Purpose / important fields |
|---|---|
| `contact_identities` | Search/index record for a provider subject: `agency_id`, `provider`, `external_subject_id`, normalized phone/email where applicable, display/profile data, `lead_id`, optional `pilgrim_id`, verification/confidence, first/last seen. |
| `identity_match_events` | Immutable record of automatic/manual match, merge, split, confidence, actor, and evidence. |

Identity uniqueness must be provider-aware. A WhatsApp `wa_id`, Instagram scoped user ID, Messenger PSID, and Gmail address are not interchangeable. Phone/email normalization creates match candidates; it does not silently merge conflicting records.

Resolution order:

1. Exact existing provider identity.
2. Exact verified normalized phone or email in the same agency.
3. One unambiguous existing lead/pilgrim match.
4. Otherwise create an unresolved identity and, for a genuine new enquiry, create a lead through the domain service.
5. Multiple candidates require staff resolution and block destructive CRM automation.

### 5.3 Conversations and messages

Evolve the current tables rather than creating a parallel inbox:

| Entity | Target changes |
|---|---|
| `conversations` | Add `connection_id`, `contact_identity_id`, `external_thread_id`, optional subject, `lifecycle_status` (`OPEN/CLOSED/SPAM`), `handling_mode` (`AI_ACTIVE/AI_PAUSED/HUMAN_REQUESTED/HUMAN_ACTIVE`), priority, first/last message timestamps, waiting-since, SLA due time, last-message preview, version, linked booking/group/package where useful. Preserve `lead_id`. |
| `conversation_messages` | Add direction, client idempotency key, external thread ID, provider timestamps, reply reference, sender identity, normalized body formats, edit/delete flags, send attempt count, and stable per-conversation sequence. Keep actor kind and delivery state. |
| `message_attachments` | Zero-to-many typed parts with storage path, provider media ID, filename, MIME type, size, checksum, scan status, dimensions/duration, and expiry. |
| `message_delivery_events` | Append-only sent/delivered/read/bounced/failed events with provider code and timestamp; project the latest state onto the message for fast rendering. |
| `conversation_events` | Append-only audit/timeline for assignment, status, priority, merge, lead, package, booking, and automation changes. |
| `conversation_notes` / `note_mentions` | Internal collaboration; independent from provider messages and outbox. |
| `conversation_drafts` | One draft per staff/conversation/channel mode, with optimistic version. |
| `saved_replies` | Agency-owned, optionally team/private, language/channel applicability and safe variable definitions. |
| `conversation_tags` | Join to agency-managed tags. |
| `outbox_messages` | Atomic outbound command, provider payload reference, idempotency key, attempts, scheduling/lock/error, and terminal status. |

Do not keep one database row per email recipient as a separate conversation. Gmail threads map to one conversation; individual email messages keep From/To/CC/BCC metadata and attachments.

### 5.4 Workflow state separation

Current `state` conflates separate concerns. The target model uses:

- `lifecycle_status`: `OPEN`, `CLOSED`, `SPAM`.
- `handling_mode`: `AI_ACTIVE`, `AI_PAUSED`, `HUMAN_REQUESTED`, `HUMAN_ACTIVE`.
- `assigned_to_id`: nullable staff owner; assignments are audited.
- `priority`: `LOW`, `NORMAL`, `HIGH`, `URGENT`.
- `waiting_since` and `sla_due_at`: derived queue urgency.

Closing a conversation does not erase its owner or AI history. New inbound activity may reopen `CLOSED`, but never automatically reopens `SPAM`. Human control always suppresses autonomous replies.

### 5.5 Pilgrim journey projection

The requested five-stage journey is a consistent Inbox projection over existing domain fields, not a replacement for the richer lead enum:

| Inbox journey | Existing source-of-truth condition |
|---|---|
| New enquiry | Lead in `NEW_LEAD` or `CONTACTED` and no selected package |
| Qualified | Lead in `QUALIFIED` or later, without a selected package/group |
| Package selected | `desired_package_id` or `selected_departure_group_id` exists; no active booking |
| Booking started | Linked booking exists in `HELD`/draft-equivalent or lead is `DEPOSIT_PENDING` |
| Confirmed | Linked booking is `CONFIRMED`; lead is `BOOKED` |

A single domain service performs stage/link transitions so Inbox, Leads, Bookings, and automation cannot drift.

## 6. Provider adapter contract

Each integration implements the same server-only interface. The core never imports a WhatsApp/Gmail/Meta client directly.

```ts
interface ChannelAdapter {
  provider: ChannelProvider;
  verifyWebhook(request: RawWebhookRequest, connection?: ChannelConnection): Promise<VerificationResult>;
  eventIdentity(request: RawWebhookRequest): ProviderEventIdentity;
  normalizeWebhook(event: StoredWebhookEvent, connection: ChannelConnection): Promise<CanonicalChannelEvent[]>;
  backfill(connection: ChannelConnection, cursor?: string): Promise<BackfillPage>;
  send(command: OutboxCommand, connection: ChannelConnection): Promise<ProviderSendResult>;
  fetchAttachment(ref: ProviderAttachmentRef, connection: ChannelConnection): Promise<AttachmentStream>;
  markRead?(command: MarkReadCommand, connection: ChannelConnection): Promise<void>;
  capabilities(connection: ChannelConnection): ChannelCapabilities;
}
```

Canonical events include `message.received`, `message.status`, `message.edited`, `message.deleted`, `thread.updated`, `identity.updated`, and `connection.health_changed`.

Capabilities, not provider-name conditionals, drive the composer. Examples: free text permitted, reply window expiry, templates required, subject/CC supported, allowed MIME types, attachment limit, reactions, read receipts, and typing indicators.

### 6.1 Initial adapters

- **WhatsApp:** wrap the existing signature, client, template, billing, service-window, and campaign-attribution code. Preserve current provider IDs and idempotency behavior.
- **Instagram and Messenger:** share Meta Graph authentication/webhook infrastructure but remain distinct providers because identity scope, permissions, capabilities, and policy rules differ.
- **Gmail:** OAuth/Vault connection, mailbox watch, Google Cloud Pub/Sub push endpoint, `history.list` cursor advancement, MIME parsing, thread mapping, label filtering, and watch renewal. A stale history cursor triggers bounded full resynchronization.
- **Future adapters:** Outlook email, website chat, SMS, and voice can enter through the same normalized contract without changing Inbox components or CRM workflow services.

## 7. Critical workflows

### 7.1 Inbound message

1. Verify the provider signature/token and resolve exactly one `channel_connection` and agency.
2. Persist the raw event using the provider idempotency key.
3. Return the provider-required success response quickly.
4. Worker claims the event and adapter emits canonical events.
5. Resolve provider identity, then the lead/pilgrim candidate.
6. Resolve or create the provider thread/conversation.
7. In one transaction: insert message/attachments/events, update conversation preview/unread/waiting state, and enqueue enrichment/automation work.
8. Broadcast a small private realtime invalidation event after commit.
9. Run intent/package/lead automation asynchronously; append results as audited domain events.

### 7.2 February Umrah enquiry

For “Can you send me details about your February Umrah package?”:

1. Match exact provider identity, then verified normalized phone/email.
2. Link an existing lead/pilgrim or create a `NEW_LEAD` owned by the configured sales queue.
3. Extract `journey=UMRAH`, `period=February`, package-information intent, and language with confidence/evidence.
4. Query published packages and sellable departure groups live; never invent price or availability.
5. Store the interest fields and suggest ranked options with reason, price source, freshness, and any missing qualification question.
6. Staff chooses/edit/sends a draft, or Copilot sends only if that agency/channel/action is explicitly configured for autonomous replies.
7. Progress the derived journey from new enquiry through confirmed using domain-service transitions.
8. “Create booking” revalidates capacity, opens the existing booking flow in context, creates a held/started booking, links it, and refreshes the panel/timeline without navigation.

### 7.3 Outbound message

1. Server action verifies user, tenant, capability, assignment policy, consent/contactability, channel rules, and optimistic conversation version.
2. In one transaction, create the canonical message as `PENDING` and an `outbox_messages` command with a client idempotency key.
3. Return immediately and show an optimistic/pending bubble.
4. Worker claims the outbox command, rechecks connection/channel constraints, calls the adapter, and stores the provider message ID.
5. Provider status webhooks append delivery events and update the projected status.
6. Retry only retryable classes with backoff/jitter. Permanent errors are visible with safe retry or channel-switch actions.

This avoids the current “provider accepted the send but the CRM failed to save it” window.

### 7.4 Assignment and collision control

- Claim/reassign is an atomic update using `version` or a conditional owner check.
- Composer shows who is viewing/typing through ephemeral Presence/Broadcast.
- A send is rejected if the conversation version/owner changed since the draft opened, unless the role has an explicit override.
- Auto-assignment is a policy service (round-robin, channel/team, language, working hours, workload) and records its reasoning.

## 8. Realtime design

Use Supabase Realtime **Broadcast from database** for durable row-change notifications; current Supabase guidance recommends Broadcast over Postgres Changes for scalability and security. Use private topics:

- `agency:<agency-id>:inbox` for list invalidations/counters.
- `agency:<agency-id>:conversation:<conversation-id>` for message/status/timeline invalidations.
- Presence on the conversation topic for viewers/typing only; presence is never authoritative state.

Database triggers broadcast small IDs/versions after changes. Clients refetch the authoritative RLS-filtered row/read model, which limits PII in event payloads and makes reconnect recovery straightforward.

Realtime authorization must tie the authenticated user to the agency and Inbox capability. Policies on `realtime.messages` are permitted, but no custom objects should be created in the locked `realtime` schema. On disconnect/reconnect, refetch conversation/list changes since the last cursor; realtime is a latency optimization, not the durable event store.

## 9. Query and read-model strategy

Do not grow `page.tsx` into a large multi-table select.

- Add `lib/data/inbox-repository.ts` with typed, cursor-based list/detail methods.
- Use a security-invoker `inbox_conversation_list` view or an RPC that returns only display fields and computed SLA/journey data. Verify grants because new Supabase tables may not be automatically exposed to the Data API.
- Query list pages by `(last_activity_at, id)` cursor, never offset at scale.
- Load the newest message page first; fetch older pages by `(provider_timestamp, sequence, id)` cursor.
- Full-text search indexes normalized message text and contact fields. Attachment OCR/transcripts enter a separate search document only after scanning and redaction.
- Counts for left views are projected incrementally or queried by indexed predicates; never issue one unbounded count per view on every render.

Recommended indexes include agency first: list activity/status, assignee/status/activity, channel/status/activity, unread, SLA due, identity external key, message conversation/order, provider message ID, outbox due status, and webhook provider event ID.

## 10. Security, privacy, and tenancy

- Every exposed table has RLS. Policies combine `agency_id = current_agency_id()` with role/capability rules; `TO authenticated` alone is insufficient.
- Update policies have both `USING` and `WITH CHECK`; session-client mutations never accept an agency ID from the browser.
- Service-role repositories require an explicit `agencyId` and provider connection predicate for every query.
- Provider credentials live in Vault and are accessed only by narrowly granted server/worker functions. Never store or log access/refresh tokens in event payloads.
- Webhooks verify raw bytes/signatures before processing. Unknown connections are audited and dropped, never guessed.
- Attachments use private storage paths containing agency/conversation scope, signed short-lived downloads, MIME/size validation, malware scanning, and quarantine.
- Finance, passports, medical/visa data, and message exports are capability-redacted. Copilot receives the minimum relevant fields.
- Consent and contactability are checked immediately before outbound sends; transactional replies and marketing templates remain distinct.
- Audit immutable events for view/export of sensitive conversations, assignment, merge/split, note, send, AI proposal, lead-stage, and booking actions.
- Define retention per raw webhook, message, attachment, deleted provider content, AI context, and audit requirements. Support legal hold and tenant export/deletion workflows.

## 11. Copilot boundary

Copilot consumes a channel-neutral `ConversationContext`: recent messages, safe customer/lead context, live package/departure facts, allowed tools, language, and channel constraints.

- Intent extraction stores structured evidence/confidence separately from the message.
- Recommendations are deterministic candidates from live CRM data; the model may explain/rank but cannot invent availability or price.
- Draft replies carry source fact versions. A stale package/group/booking version forces regeneration/review.
- Autonomous sending is an agency feature flag plus channel/action allowlist; high-risk finance, refunds, complaints, visa/medical, ambiguous identity, and booking confirmation require human handoff.
- Internal notes, hidden financial fields, other-tenant data, raw tokens, and unscanned attachment contents never enter prompts.
- Prompt/tool version, model, latency, cost, citations/facts used, decision, edit delta, send actor, and outcome are recorded for evaluation.

## 12. Reliability and observability

Target service objectives for the production design:

- Valid webhook acknowledged within provider deadlines; target p95 under 500 ms before deferred work.
- Accepted inbound event visible to staff p95 under 2 seconds, excluding provider delay and large-media retrieval.
- Staff send command durably accepted p95 under 750 ms; provider delivery tracked independently.
- No duplicate message, lead, booking, or external send from webhook/worker retries.
- Zero cross-agency reads in automated tenancy tests.

Metrics and alerts:

- Webhook signature failures, unknown connection, duplicate rate, ack latency.
- Queue depth/oldest age, attempt count, dead jobs, outbox age and terminal failures.
- Inbound-to-visible, first response, customer wait, resolution, reopen, handoff, and assignment times.
- Connection health/token/watch expiry, Gmail cursor age, Meta permissions, WhatsApp service window.
- Realtime connected clients, authorization/join failures, reconnect gaps.
- Lead match ambiguity, lead creation, package suggestion acceptance, booking conversion, Copilot edit/send rates.

Use correlation IDs across raw event → normalized event → conversation/message → job/outbox → provider request. Redact PII and credentials from structured logs.

## 13. Key architecture decisions

1. **One canonical Inbox core, many adapters.** UI/domain code does not branch on provider except through capabilities.
2. **Extend existing conversations/messages.** Avoid a second transcript and an expensive dual-write permanent state.
3. **Leads/bookings remain authoritative.** Identity records index external addresses; they are not a parallel CRM.
4. **Transactional outbox for outbound delivery.** A browser request never directly owns a remote send.
5. **At-least-once in, idempotent effects.** Exactly-once transport is not assumed.
6. **Database state is authoritative; realtime is an invalidation layer.** Reconnect and missed events are recoverable.
7. **Separate lifecycle, assignment, and automation states.** This eliminates invalid mixed states.
8. **Provider capabilities drive composer behavior.** New channels do not require redesigning the workspace.
9. **Backward-compatible migration first.** WhatsApp continues operating while the generic core is introduced behind flags.

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Duplicate webhooks/sends | Provider event unique keys, client send keys, transactional outbox, provider reconciliation |
| Cross-channel false identity merge | Exact identity first, confidence/evidence, ambiguity queue, reversible merge/split audit |
| Webhook timeouts | Persist-and-ack; all fetch/AI/media work in workers |
| Message ordering drift | Provider timestamp + stable sequence + received timestamp/id tie-breaker |
| Two staff reply simultaneously | Assignment/version precondition, presence warning, atomic send command |
| Realtime gap | Cursor refetch on reconnect/focus; durable DB remains source of truth |
| Gmail watch/cursor expiry | Scheduled renewal, health alert, bounded full sync on invalid history cursor |
| Provider policy divergence | Adapter capability/rule snapshot and provider-specific preflight validation |
| AI hallucinated offer | Live deterministic candidates, fact versions, tool-only writes, human approval controls |
| Large table/list degradation | Cursor pagination, agency-first indexes, compact read model, archive/retention plan |

## 15. External references checked for this design

- [Supabase: Subscribing to database changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)
- [Supabase: Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Supabase breaking change: realtime schema locked down](https://supabase.com/changelog/realtime-schema-locked-down-against-modification)
- [Gmail: Configure push notifications](https://developers.google.com/workspace/gmail/api/guides/push)
- [Gmail: Synchronize clients](https://developers.google.com/workspace/gmail/api/guides/sync)
- [Gmail: `users.watch`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch)

