# Unified Inbox Implementation Plan

> Product position: **“Every pilgrim conversation, booking and follow-up—managed from one place.”**

Status: proposed delivery plan. No implementation is included in this change.

This plan implements the target in [architecture.md](./architecture.md) incrementally while keeping the current WhatsApp Inbox operational.

## 1. Delivery principles

- Ship vertical slices behind agency feature flags; do not pause the working WhatsApp path for a big-bang rewrite.
- Add canonical fields/tables first, backfill, dual-read/dual-write for a bounded period, cut over, then remove legacy constraints/code.
- Build provider-neutral contracts and domain services before adding Instagram, Messenger, or Gmail.
- All schema additions are tenant-scoped, RLS-protected, indexed, auditable, and tested for cross-tenant isolation.
- Webhooks only verify, persist, and acknowledge. Workers perform normalization, provider fetches, AI, media, and CRM effects.
- Remote sends go through a transactional outbox.
- Each phase has an observable rollout, rollback path, and definition of done.

## 2. Workstreams and ownership boundaries

| Workstream | Primary deliverables |
|---|---|
| Conversation core | Schema, repositories, identity resolution, conversation/message services, state machines |
| Channel platform | Adapter contracts, connections, webhooks, queues, outbox, provider health |
| Inbox experience | Three-pane shell, list/read models, transcript, composer, context panel, accessibility/responsiveness |
| CRM workflow | Lead match/create, journey projection, package/departure recommendation, create-booking handoff, tasks |
| Realtime/collaboration | Private Broadcast topics, reconnect reconciliation, presence/typing, drafts, notes/mentions |
| Copilot | Channel-neutral context, safe tools, suggestions, provenance, evaluation and automation controls |
| Security/operations | RLS, Vault, attachments, audit, retention, metrics, alerts, runbooks and load tests |

## 3. Phase 0 — baseline, contracts, and decisions

Goal: freeze behavior and remove ambiguity before changing persistent state.

### Tasks

- Capture fixture-based behavior for the current WhatsApp webhook, conversation state transitions, start-chat template flow, staff send, AI suppression during human control, delivery statuses, and campaign attribution.
- Inventory current production row counts, webhook volume, message volume/day, largest conversations, RLS policies, Supabase project settings, Realtime limits, storage limits, and cron cadence.
- Record architecture decisions for:
  - canonical provider/channel identifiers;
  - conversation lifecycle and automation states;
  - contact identity match/merge policy;
  - transactional outbox and idempotency keys;
  - email thread mapping;
  - attachment retention/scanning;
  - realtime topic authorization;
  - lead journey projection instead of replacing the existing lead stage enum.
- Define Zod/TypeScript canonical contracts for channel event, provider identity, thread, message content parts, attachment, delivery event, capability set, and outbox command.
- Define feature flags: `unified_inbox_core`, `unified_inbox_ui`, `inbox_realtime`, `gmail_channel`, `meta_social_channels`, and `inbox_copilot` per agency.
- Agree product rules: response SLAs, auto-assignment, working hours, spam, close/reopen, autonomous AI scope, and staff override.

### Exit criteria

- Existing WhatsApp happy paths and retry/idempotency cases are covered by tests.
- Canonical contracts can represent current WhatsApp text/template/interactive/media events and Gmail email/thread semantics without provider-specific fields leaking into UI/domain services.
- Product and security owners approve the state, identity, retention, and AI decisions.

## 4. Phase 1 — additive database foundation

Goal: introduce the provider-neutral data model without breaking existing reads or writes.

### Migration sequence

Create migrations using the Supabase CLI at implementation time; do not hand-invent filenames.

1. `channel_connections` and `channel_webhook_events`.
2. `contact_identities` and `identity_match_events`.
3. Add nullable canonical columns to `conversations` and `conversation_messages`; retain the current WhatsApp check/state during dual operation.
4. Add `message_attachments`, `message_delivery_events`, `conversation_events`, `conversation_notes`, `note_mentions`, `conversation_drafts`, `saved_replies`, tags, and `outbox_messages`.
5. Add `channel_jobs` or generalize the existing queue only after job compatibility is proven.
6. Add indexes, RLS, grants, security-invoker read models/RPCs, audit triggers, and realtime broadcast triggers/policies.

### Backfill

- Create a `channel_connections` row for every current WhatsApp integration while retaining the original credential refs.
- Populate `connection_id`, `external_thread_id`, lifecycle, handling mode, last activity, and message direction from current rows.
- Create WhatsApp `contact_identities` using `(agency_id, WHATSAPP, wa_id)` and link existing `lead_id` values.
- Backfill a deterministic conversation message order.
- Write reconciliation queries proving row counts, tenant ownership, provider IDs, linked leads, and latest message/activity are unchanged.

### Security tasks

- Enable RLS on every exposed table before grants.
- Add agency and capability predicates for read/write; include `USING` and `WITH CHECK` for updates.
- Revoke sensitive functions from `PUBLIC`, `anon`, and `authenticated` unless explicitly needed.
- Keep `SECURITY DEFINER` functions outside the exposed API where practical, set `search_path`, validate `auth.uid()` for user-called functions, and grant narrowly.
- Add explicit Data API grants if project settings do not auto-expose new tables.
- Run schema/security advisors and a two-agency RLS matrix in CI.

### Exit criteria

- Current Inbox still works with the flag off.
- Backfill and rollback scripts are rehearsed on a production-like copy.
- All old WhatsApp rows have valid canonical links with zero cross-agency mismatch.
- New tables are inaccessible to unauthorized roles and tenants.

## 5. Phase 2 — conversation core and WhatsApp adapter

Goal: prove the reusable backend by running the existing channel through it.

### Package structure

```text
lib/inbox/
  contracts/
  adapters/
    registry.ts
    whatsapp/
  identity/
  conversations/
  messages/
  outbox/
  workflows/
  realtime/
  observability/
lib/data/inbox-repository.ts
```

### Tasks

- Implement the `ChannelAdapter` registry and wrap existing WhatsApp signature, normalization, media, template, send, billing, and connection-health logic.
- Implement a shared ingestion service:
  - verified connection resolution;
  - raw event idempotent insert;
  - canonical normalization;
  - identity/conversation resolution;
  - transactional message/conversation/event update;
  - job scheduling.
- Move lead matching/creation behind a channel-neutral `resolveOrCreateEnquiryLead` domain service. Preserve WhatsApp normalization and campaign attribution behavior.
- Implement the state services for lifecycle, handling mode, assignment, unread/read, priority, and SLA.
- Implement the transactional outbound command and worker. Generate a client send idempotency key and never call a provider inside the browser/server-action transaction.
- Keep legacy sends available behind a kill switch until new outbox reconciliation is stable.
- Update the AI `AgentContext.channel` and tool boundary to use canonical channels while preserving WhatsApp-specific service-window constraints through capabilities.

### Test matrix

- Duplicate inbound webhook and duplicate status webhook.
- Duplicate staff submit, worker retry after provider success, provider timeout with unknown outcome, and permanent provider rejection.
- New, linked, ambiguous, merged, and split identity.
- Closed conversation reopened by inbound; spam not reopened.
- Human active suppresses AI; release resumes only when allowed.
- Media/template/interactive message normalization.
- Two agencies with identical external contact IDs remain isolated.

### Exit criteria

- A feature-flagged agency handles WhatsApp end to end exclusively through the adapter/core/outbox.
- Reconciliation shows no missing/duplicate provider or CRM messages.
- Kill switch can return the agency to the legacy read/send path without data loss.

## 6. Phase 3 — Inbox read models and three-pane UI

Goal: deliver the unified workspace on canonical data before adding more channels.

### Route and component design

```text
app/inbox/
  page.tsx                         server shell and initial query
  actions.ts                      capability-checked commands only
  components/
    inbox-shell.tsx
    inbox-view-rail.tsx
    conversation-list.tsx
    conversation-list-item.tsx
    conversation-workspace.tsx
    message-timeline.tsx
    message-item/
    composer/
    customer-context-panel.tsx
    internal-note-composer.tsx
    assignment-control.tsx
    create-booking-sheet.tsx
    saved-replies-picker.tsx
    copilot-suggestions.tsx
```

### Tasks

- Replace the fixed 100-row query with a typed cursor-paginated Inbox repository/read model.
- Add view rail and URL-addressable filters: all, unassigned, mine, each enabled channel, closed, spam; plus priority, owner, unread, package/group, journey stage, SLA, and search.
- Build a virtualizable/infinite conversation list showing the requested avatar, channel, latest message, owner, unread, priority/status, package/group, and response age.
- Build a paginated rich timeline for text, image, PDF, voice, attachment, email, delivery failure, system event, and internal note.
- Implement a capability-driven composer with persistent drafts, optimistic pending state, retry, and visible channel limits.
- Add the customer context panel using permission-aware read projections.
- Add take/assign/release/close/reopen/spam actions with optimistic version checks.
- Add saved replies, notes, `@mentions`, and task/follow-up creation.
- Meet keyboard and accessibility requirements: focus order, screen-reader labels, shortcuts that do not conflict with typing, color-independent states, and live announcements for new messages.
- Implement responsive transitions: collapsible view rail, context drawer, list/workspace navigation on small screens.

### Exit criteria

- Staff can complete the full WhatsApp workflow without leaving the new Inbox.
- Direct links preserve view, conversation, and relevant filters.
- List/message pagination remains stable while new messages arrive.
- Read-only roles cannot expose composer/actions or sensitive context via network calls.

## 7. Phase 4 — realtime and staff collaboration

Goal: make the Inbox live without treating WebSocket delivery as durable state.

### Tasks

- Add private Broadcast topics for agency list and individual conversation invalidations.
- Add Realtime authorization policies based on agency membership and Inbox access; do not create custom realtime-schema objects.
- Implement a client subscription manager that:
  - authenticates private channels;
  - deduplicates versions/events;
  - invalidates/refetches affected records;
  - reconnects with backoff;
  - refetches since the last cursor after reconnect, tab focus, or network restoration.
- Add Presence for viewers and typing. Presence is advisory and expires automatically.
- Send/read actions update UI optimistically but reconcile to authoritative DB status.
- Add assignment/version collision messages and draft preservation when another user takes control.
- Instrument join failure, disconnected duration, event-to-render latency, and gap recovery.

### Exit criteria

- Two staff sessions see inbound/outbound, delivery state, assignment, notes, and unread changes without manual refresh.
- A disconnected session converges after reconnect with no duplicate timeline items or lost unread state.
- A user from another agency cannot subscribe to or infer a topic.

## 8. Phase 5 — CRM journey and create-booking workflow

Goal: make the Inbox the working surface for enquiry-to-booking conversion.

### Tasks

- Implement the derived five-step journey projection:
  `New enquiry → Qualified → Package selected → Booking started → Confirmed`.
- Add a domain service for safe lead transitions, desired package/group selection, ownership, and activity logging.
- Implement channel-neutral intent extraction with evidence/confidence for journey, travel month, group size, language, budget, and room preference.
- Reuse the existing live package/departure matching service; expose freshness, capacity, price source, and reasons.
- Add package cards/actions to the conversation workspace and update the lead only through the domain service.
- Add “Create booking” as an in-context sheet using existing booking validation, capacity recheck, traveller collection, and atomic booking creation.
- On success, link conversation/lead/booking, append a timeline event, update journey/context, and create the appropriate follow-up—without route navigation.
- Surface previous conversations across identities/channels and unresolved identity warnings.
- Add response and conversion analytics without duplicating finance or booking facts.

### Acceptance scenario

Given “Can you send me details about your February Umrah package?” the system must:

1. resolve or create the lead exactly once;
2. store February/Umrah intent with evidence;
3. return only published, sellable live options;
4. produce an editable suggested reply;
5. allow staff to select a package/group;
6. open and complete a held/started booking in context;
7. show confirmed only after the canonical booking reaches `CONFIRMED`.

### Exit criteria

- The acceptance scenario passes for existing lead, new lead, ambiguous identity, no matching package, sold-out group, and capacity-race cases.
- Leads, booking, finance, and Inbox displays agree after every transition.

## 9. Phase 6 — Gmail adapter

Goal: validate that the architecture supports a structurally different channel.

### Tasks

- Add Google OAuth connection flow with refresh token in Vault, minimal scopes, connection health, revoke/disconnect, and audit.
- Configure mailbox `watch`, Google Cloud Pub/Sub push verification, per-connection `historyId`, and scheduled watch renewal before expiration.
- On notification: persist/ack Pub/Sub, enqueue sync, call `history.list`, fetch changed messages, parse MIME safely, map Gmail thread ID to conversation, and advance cursor transactionally.
- Handle invalid/expired history cursor with bounded full synchronization and a visible connection health state.
- Normalize plain/HTML body, quoted text, signature, recipients, subject, inline files, and attachments. Sanitize HTML before display.
- Implement send/reply/reply-all with thread headers and outbound outbox; avoid auto-creating conversations for irrelevant sent/system mail via label/filter policy.
- Reconcile sent mail so a provider copy does not duplicate the local pending message.
- Add Gmail-specific consent, recipient, bounce, and attachment tests.

### Exit criteria

- Incoming and outgoing email appears in the same workspace/read model as WhatsApp.
- Push retries, cursor gaps, watch renewal, reply threading, and sent-mail reconciliation are proven.
- Gmail can be disabled independently without affecting the core or WhatsApp.

## 10. Phase 7 — Instagram and Messenger adapters

Goal: add Meta social messaging through the stable adapter contract.

### Tasks

- Extend the Meta connection model for Page/Instagram account identity, permissions, webhook subscription, token lifecycle, app review status, and account health.
- Share signature/raw-webhook infrastructure with WhatsApp but implement distinct adapters and capability sets.
- Normalize Instagram-scoped and Messenger PSID identities without assuming they match each other or a WhatsApp number.
- Support the approved message/media/reply types and policy windows available to each connected account at implementation time.
- Add manual identity linking and ambiguity resolution UI for social profiles.
- Add provider review/evidence, privacy, deletion callback, and operational runbooks.

### Exit criteria

- Both channels pass the same adapter contract suite and core ingestion/outbox tests.
- No Inbox component contains a provider-specific send branch outside capability-driven renderers.

## 11. Phase 8 — Manasik Copilot

Goal: provide safe, explainable assistance across channels.

### Tasks

- Build a channel-neutral conversation context assembler with role/PII redaction and bounded recent history/summary.
- Add suggestions for reply, qualification question, package match, lead stage, follow-up, and handoff.
- Show supporting CRM facts, freshness, and confidence; staff can accept, edit, dismiss, or regenerate.
- Record suggestion-to-send edit delta and outcome for quality evaluation.
- Gate autonomous replies by agency, provider, message class, working hours, confidence, and risk. Default new channels to suggestion-only.
- Require staff for payment promises, refunds, complaints, visa/medical topics, identity ambiguity, and final booking confirmation.
- Add offline evaluations for hallucinated packages/prices, stale availability, prompt injection from inbound messages/attachments, PII leakage, and incorrect tenant/tool arguments.

### Exit criteria

- Copilot cannot perform a domain write except through approved typed tools.
- Suggested package/price/availability claims are traceable to current CRM facts.
- Agency administrators can disable AI globally or per channel immediately.

## 12. Phase 9 — hardening, scale, and rollout

### Performance and resilience

- Load test bursty webhook ingestion, queue/outbox drains, long conversations, list filters, search, attachment upload/download, and concurrent realtime clients.
- Verify indexes with representative `EXPLAIN (ANALYZE, BUFFERS)` on a production-like dataset.
- Add job/outbox dead-letter tooling, safe replay, provider reconciliation, stale-lock release, and runbooks.
- Test provider outage, rate limit, invalid token, watch expiry, delayed status, duplicate event, out-of-order event, and database/realtime interruption.

### Security and privacy

- Run schema advisors, RLS tests for every role/agency, secret/log scanning, webhook forgery tests, attachment malware/quarantine tests, and HTML sanitization tests.
- Validate export, retention, purge, legal hold, disconnect, token revocation, and provider data-deletion callbacks.
- Threat-model IDOR/BOLA, service-role scoping, malicious provider payloads, note-to-outbound leakage, prompt injection, SSRF through attachments/URLs, and formula/script content in exported data.

### Rollout stages

1. Internal/test agency, shadow ingestion and reconciliation.
2. One low-volume WhatsApp agency on canonical core, legacy UI.
3. New UI for that agency.
4. Realtime and workflow features.
5. Increasing WhatsApp cohort with kill switch.
6. Gmail pilot.
7. Meta social pilot after provider approvals.
8. Default-on only after SLO and support thresholds hold.

### Exit criteria

- Alerts, dashboards, support playbooks, data repair tools, and rollback procedures are exercised.
- SLOs hold under expected peak plus safety margin.
- Legacy WhatsApp writes/read paths can be removed with a final reconciliation and explicit migration approval.

## 13. Testing strategy

| Layer | Required coverage |
|---|---|
| Contract | Every adapter passes the same canonical fixture suite |
| Unit | Normalization, identity matching, state transitions, SLA, journey projection, capability rules, retry classification |
| Database | Constraints, indexes, functions, trigger/outbox atomicity, idempotency, RLS role/tenant matrix |
| Integration | Signed webhook → raw event → job → message → broadcast; send command → outbox → provider → delivery event |
| End-to-end | Staff filters/claims/replies/notes/mentions/creates booking; two-browser collaboration; reconnect recovery |
| Provider sandbox | WhatsApp, Gmail, Instagram, Messenger happy/error/retry flows |
| Security | Forged/replayed webhook, cross-tenant IDs/topics, token exposure, unsafe HTML/media, unauthorized finance/context |
| AI evaluation | Wrong package/price, stale capacity, risky action, ambiguity, prompt injection, multilingual response |
| Load | Queue burst, hot agency, hot conversation, list/search pagination, realtime fan-out |

Every provider fixture contains raw payload, expected connection/agency, canonical events, message projection, identity outcome, CRM effects, and expected acknowledgement/retry behavior.

## 14. Operational dashboards and product measures

### Platform health

- Webhook acknowledgment/error/signature/duplicate rates.
- Connection/token/watch status and last successful inbound/outbound.
- Queue/outbox depth, oldest age, retries, dead jobs, reconciliation mismatches.
- Ingestion-to-visible, send-accept, provider-accept, and delivery latency.
- Realtime join/reconnect/gap-recovery metrics.

### Inbox outcomes

- New enquiries, unassigned conversations, first-response SLA, median customer wait, resolution/reopen rate.
- Channel volume and delivery failure rate.
- Lead match/create/ambiguity rate.
- Package suggestion acceptance, journey progression, held and confirmed booking conversion.
- Follow-up completion and stale conversation rate.
- Copilot suggestion acceptance, edit distance, handoff, and correction rate.

Metrics are scoped by agency and permission; finance values are never exposed through general Inbox analytics to unauthorized roles.

## 15. Definition of done

The unified Inbox is complete when:

- WhatsApp, Gmail, Instagram, and Messenger use the same canonical conversation/message services and adapter contract.
- A new channel can be added by implementing an adapter, connection UI, provider renderer if needed, and contract fixtures—without changing lead/booking workflow logic or the base Inbox shell.
- Staff have All, Unassigned, Mine, channel, Closed, and Spam views with cursor pagination and search.
- Messages, rich attachments, internal notes, mentions, saved replies, assignments, priorities, unread state, and delivery status update in realtime and recover after disconnect.
- The customer context panel accurately shows permission-filtered lead, package, departure, booking, traveller, balance, history, task, and follow-up data.
- The February Umrah workflow resolves/creates one lead, detects intent, recommends live options, supports a staff/Copilot reply, progresses the journey, and creates a booking in context.
- Inbound retries and staff double submits cannot create duplicate messages, leads, bookings, or provider sends.
- RLS and realtime authorization tests prove tenant isolation; credentials and sensitive data remain server-only and role-filtered.
- Monitoring, replay/reconciliation, retention, disconnect, incident, and rollback runbooks are production-ready.

## 16. Recommended first implementation slice

The first shippable slice should be deliberately narrow:

1. Add canonical contracts, connection/identity links, lifecycle/handling fields, events, and outbox additively.
2. Put current WhatsApp behind the adapter and transactional outbox.
3. Build the three-pane UI with WhatsApp text/template/media, filters, context panel, notes, and create-booking action.
4. Add private realtime invalidations and reconnect refetch.
5. Pilot with one agency and reconcile every provider/CRM message.

Only after that slice is stable should Gmail and Meta social channels be added. That sequencing proves reusability against the working channel first and prevents each new integration from cementing a different backend shape.

