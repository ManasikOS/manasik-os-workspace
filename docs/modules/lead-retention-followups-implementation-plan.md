# Lead retention: automatic follow-ups, unanswered-handoff alerts, response-time metric

Status: **built (Phases 1–3); migration applied to the dev database; see "Build notes" at the end.** Written so that a fresh session can build it without the conversation that produced it.
Read [`docs/standards/feature-development-workflow.md`](../standards/feature-development-workflow.md) first; this plan follows its layer order
(migration → Zod → access → data → actions/routes → UI → tests → docs).

Related, already built: [`whatsapp-ai-agent-implementation-plan.md`](whatsapp-ai-agent-implementation-plan.md),
[`messenger-instagram-ai-agent-implementation-plan.md`](messenger-instagram-ai-agent-implementation-plan.md),
[`departure-operations-agent-implementation-plan.md`](departure-operations-agent-implementation-plan.md) (the sweep + notification pattern reused here).

---

## 1. What we are building and why

WhatsApp, Messenger and Instagram now bring leads into the Inbox and the AI agent ("Manasik Copilot") answers them. Most remaining lead loss
happens **after** the first reply. An audit of the code found three gaps, in this priority order:

| # | Gap | Effect |
|---|---|---|
| A | Nobody is told when a conversation that needs staff has gone unanswered | Handoffs sit; the customer goes elsewhere |
| B | Nothing follows up a customer who went quiet after the assistant or staff replied | Warm leads decay silently |
| C | No measurement of how fast staff answer, per channel | Cannot see or improve the real bottleneck |

Build order (each phase ships and is useful on its own):

- **Phase 1 — Unanswered-handoff alerts (A)** and **Phase 3 — response-time metric (C)**: no messages go to customers, low risk.
- **Phase 2 — Quiet-lead follow-ups (B)**: sends real messages to customers; built behind a feature switch and a dry-run mode.

Suggested order of work: Phase 1 → Phase 3 → Phase 2. (Phase 3's data is what proves Phase 1 works, and Phase 2 is the riskiest.)

### Out of scope (do not build here)

- Payment / deposit links in chat (needs a payment gateway decision for the agency's country first).
- Re-engagement broadcasts / campaign sending, review and referral requests.
- Voice calling (separate research: WhatsApp Calling API needs a 2,000-recipient daily messaging limit; see the conversation summary).
- Profile pictures (Meta refuses the lookup until App Review; the Inbox uses coloured initials).
- Messenger "Human Agent" tag / one-time-notification for messaging outside the 24-hour window (possible later; needs Meta review).
- Push, email or WhatsApp alerts *to staff*. v1 uses the in-app notification bell only.

---

## 2. Verified facts about the current system (read these before designing anything)

Everything below was checked in the code or the live database (project `klognjpwmqwlgeibvanf`). Re-verify anything you depend on.

### 2.1 Conversations, leads, messages
- `conversations` has: `state` (`AI_ACTIVE`, `AI_RESUMED`, `HUMAN_REQUESTED`, `HUMAN_ACTIVE`, `CLOSED`), `ai_enabled`, `assigned_to_id`, `assigned_to_name`,
  `service_window_expires_at`, `last_inbound_at`, `last_outbound_at`, `last_activity_at`, `unread_count`, `channel` (`WHATSAPP` | `MESSENGER` | `INSTAGRAM` | `GMAIL`),
  `lead_id`, `external_conversation_id`, `contact_name`.
- `messages` rows have `role`, `actor_kind` ∈ `CUSTOMER | AI | STAFF | SYSTEM`, `message_type`, `content`, `metadata`.
- `leads` has (see `lib/types/leads.ts`): `stage`, `assigned_to_id`, `last_contacted_at`, `first_response_at`, `next_follow_up_at`, `follow_up_type`
  (`CALL | WHATSAPP_MESSAGE | SEND_QUOTE | SEND_BROCHURE | IN_PERSON_VISIT | DEPOSIT_REMINDER`), `follow_up_owner_id`, `follow_up_attempts`, `postponed_until`,
  `lost_reason` (10 reasons), `campaign_id`, `utm_*`.
- `LeadStage`: `NEW_LEAD, CONTACTED, QUALIFIED, PROPOSAL_SENT, NEGOTIATION, DEPOSIT_PENDING, BOOKED, LOST, POSTPONED, DUPLICATE, SPAM`.
  `CLOSED_STAGES` (exported from `lib/types/leads.ts`) = `BOOKED, LOST, POSTPONED, DUPLICATE, SPAM`. Use it; do not re-list.
- `leads.first_response_at` is only set when staff log a contact manually (`lib/data/leads.ts` ~line 760). It is **not** derived from Inbox messages, so it cannot be
  used for Phase 3 as is.
- Lead ↔ conversation linking already exists and handles cross-channel duplicates (`lib/inbox/lead-linking.ts`, `lead-link-decision.ts`): exact provider identity, then a single exact phone match.

### 2.2 Channel rules (Meta), already encoded in `lib/channels/profile.ts`
- `replyWindowHours = 24` on all three channels. After 24 h from the customer's last message:
  - **WhatsApp**: only an approved **template** can be sent (`whatsapp_templates` table; sending code in `lib/whatsapp/client.ts` `sendTemplate`).
  - **Messenger / Instagram**: **nothing can be sent** (`businessCanStartConversation = false`, no template). `lib/inbox/composer-state.ts` already encodes this for staff.
- `requiresAutomationDisclosure` is true on Messenger and Instagram.
- **Meta Development-mode restriction** (verified live): while the Meta app is in Development mode, sends to any account without an app role fail with Graph error code 10
  ("Cannot message users who are not admins, developers or testers…"). This applies to follow-ups too. Test with a **tester** account (the "Mohamed Shafaath" account works). A failed
  assistant send already writes a system note into the conversation (`lib/agent/whatsapp/reply-delivery.ts`, `lib/channels/send-failure-explanation.ts`).
- Only WhatsApp customers have a phone number (`identifiesByPhone`).

### 2.3 Sending a message from the server
- `deliverAgentReply` in `lib/agent/whatsapp/reply-delivery.ts` sends an assistant text through a `ChannelRuntimeAdapter` (`lib/channels/adapter.ts`, `page-channel-adapter.ts`, registry).
  It resolves the connection, splits text per channel (Instagram is byte-limited), records the assistant message, and on failure writes the system note. **Reuse it for in-window nudges** on all three channels.
- Sending a WhatsApp **template** currently lives inside the Server Action in `app/inbox/actions.ts` (around lines 94–145: loads `whatsapp_templates`, counts body variables via
  `lib/whatsapp/template-params.ts`, calls `sendTemplate`). It runs under a staff session. Phase 2 needs it from a cron (no session) → **extract the core into `lib/`** (see §6.2) and make the action call it.
- Assistant gating is fail-closed: `agentAllowed = channel_connections.ai_enabled && ai_settings.enabled`. New channels default `ai_enabled = false`. Follow-ups must respect both, plus `conversations.ai_enabled`.

### 2.4 Background work
- Cron is **pg_cron in Supabase** calling `public.invoke_cron_route('<path>')` (migration `20260927090000_cron_jobs.sql`), which uses `pg_net` and a Vault-held `CRON_SECRET`.
  Live jobs: `whatsapp-agent-jobs-drain` (every minute), `departure-ops-jobs-drain` (*/15), `release-seat-holds` (hourly), `whatsapp-billing-sync` (04:00), `whatsapp-health-check` (03:00). `vercel.json` has **no** crons.
- **Gotcha:** `invoke_cron_route` has a hard-coded allow-list of paths. A new cron route must be added by `create or replace function` in your migration, then scheduled with `cron.schedule` (mirror section C of that migration: unschedule first, swallow "job not found").
- Cron routes authenticate with `Authorization: Bearer $CRON_SECRET` (see `app/api/cron/agent-jobs/route.ts`). `proxy.ts` `MACHINE_ROUTES` already lets `/api/cron/*` through without a session.
- `agent_jobs.kind` is constrained live to `PROCESS_INBOUND, TRANSCRIBE_AUDIO, EMBED_DOCUMENT, RECONCILE_ECHO`. **Do not add kinds to `agent_jobs`.** The departure-operations agent hit table drift there (its plan's "F-DRIFT") and used its own
  table plus a sweep. This feature is a periodic sweep, not a per-event queue, so it needs no job kind: the sweep computes candidates from current state.

### 2.5 Staff notifications
- Table `staff_notifications` (migration `20261001090000_staff_notifications.sql`): `kind` is constrained live to **only** `PROPOSAL_PENDING`; columns are group/proposal-shaped (`departure_group_id`, `proposal_id`). RLS: each person reads/updates only their own rows;
  **no client insert policy**; rows are written server-side with the admin client (`lib/data/staff-notifications.ts`, `notifyProposalPending`, which also shows how recipients are chosen by role, e.g. `["ADMIN","CEO"]`).
- The bell UI is `components/notification-bell.tsx` / `header-notification-bell.tsx`; the list is read in `app/(main)/layout.tsx` via `lib/data/staff-notifications.ts`. Mark-read actions: `app/(main)/notifications-actions.ts`.
  The bell currently links to a departure group / proposal, so it needs a conversation link (§4.3).

### 2.6 Settings
- `ai_settings` is one row per agency and **common to every channel** (decision D1 of the Messenger/Instagram plan: no channel column). Relevant existing columns:
  `enabled`, `handoff_enabled`, `working_hours` (jsonb — check its shape in `lib/agent/whatsapp/prompt.ts` and the AI Agent settings form before using it), `out_of_hours_message`, `default_lead_owner_id`, `voice_enabled`.
- The settings UI is under `app/(main)/management/ai-agent` (and the Settings dialog). New settings go there.
- Existing consent helper: `lib/ai/trust/consent-gate.ts` (pure; `ConsentFacts` = `consentStatus`, `doNotContact`, `contactableChannels`). Outbound marketing-style nudges must pass it.

### 2.7 Already present (do not rebuild)
Lost reasons and Mark Lost dialog; funnel / source / team / lost-analysis reports (`lib/data/reports-sales.ts`); campaign attribution on leads; the "Follow-up Today" and "Overdue" Inbox views driven by `next_follow_up_at` (`lib/inbox/lead-defaults.ts`);
the stalled-lead **insight** (`lib/insights/generators/stalled-leads.ts`, 7 days, dashboard only, sends nothing); the handoff tool (`lib/agent/whatsapp/tools/handoff.ts`); channel analytics (`lib/agent/whatsapp/analytics.ts`).

---

## 3. Design decisions (with recommendations — confirm the open ones with the user before coding)

| ID | Decision | Recommendation |
|---|---|---|
| D1 | Sweep vs per-event queue | **Sweep** (a cron route that scans current state), one ledger table for idempotency. No `agent_jobs` changes. |
| D2 | Where settings live | New columns on `ai_settings` (agency-wide, all channels), edited on the AI Agent settings page. Default **off**. |
| D3 | What "quiet" means | The **customer** wrote at least once, **we** spoke last (AI or staff), and the customer has been silent for the configured delay. Timing is measured from `last_inbound_at`, never from our own last message. |
| D4 | Who nudges | Only conversations the assistant owns (`AI_ACTIVE`/`AI_RESUMED`). If staff own it (`HUMAN_ACTIVE`), do **not** auto-message; leave it to the lead's manual follow-up date (optionally raise an in-app reminder later). |
| D5 | Nudge wording | v1: **fixed, agency-editable text** with `{name}` placeholder. v2 (later): AI-written line, passed through `guardrails.ts`. Fixed text is predictable, free and cannot hallucinate a price. |
| D6 | Outside the 24 h window | WhatsApp: send the agency's chosen **approved template**. Messenger/Instagram: **skip** and record `WINDOW_CLOSED` (Meta forbids it). Default delays keep the first two nudges inside the window. |
| D7 | Staff alerts channel | In-app bell only (v1). |
| D8 | Failure handling | A failed nudge is recorded `FAILED`, not retried automatically, and the sequence stops for that customer message. Errors are logged without tokens/PII. |
| D9 | Rollout | Feature switch `followups_enabled` (default false) **and** a `followups_dry_run` mode that writes ledger rows (`DRY_RUN`) but sends nothing; run dry-run first. |

Open questions for the user (ask before building Phase 2):
1. Are default delays **3 h, 22 h, 72 h** acceptable? (The 72 h nudge only reaches WhatsApp, via template.)
2. Should a WhatsApp template be created/approved for the 72 h nudge? (Meta approval takes time; category will likely be Marketing and is billed per message.)
3. Alert thresholds for Phase 1: **15 min** to notify the assigned agent, **60 min** to escalate to Admin/CEO. Confirm or adjust.
4. Should nudges also cover `DEPOSIT_PENDING` leads with different wording? (v1: same wording for all open stages.)

---

## 4. Data model (one migration; RLS in the same file)

Migration file name: timestamp later than the newest existing (`20261130090000_…` at time of writing) — check `ls supabase/migrations | tail`. Apply with `supabase db push` (CLI already linked; history is clean).

### 4.1 `ai_settings` — new columns
```sql
alter table public.ai_settings
  add column if not exists followups_enabled            boolean not null default false,
  add column if not exists followups_dry_run            boolean not null default true,
  add column if not exists followup_delays_hours        integer[] not null default '{3,22,72}',
  add column if not exists followup_message_text        text not null default
    'Hi {name}, just checking in — would you like me to help with anything else about your trip? I''m happy to answer questions or connect you with our team.',
  add column if not exists followup_whatsapp_template_id uuid references public.whatsapp_templates (id) on delete set null,
  add column if not exists handoff_alert_minutes        integer not null default 15,
  add column if not exists handoff_escalation_minutes   integer not null default 60;

alter table public.ai_settings
  add constraint ai_settings_followup_delays_check
    check (array_length(followup_delays_hours, 1) between 1 and 3
           and 1 <= all (followup_delays_hours)),
  add constraint ai_settings_handoff_alert_check
    check (handoff_alert_minutes between 1 and 1440
           and handoff_escalation_minutes >= handoff_alert_minutes and handoff_escalation_minutes <= 10080);
```
Also enforce in Zod that delays are strictly increasing. Column-level grants: check how `ai_settings` is granted to `authenticated` (this project uses column-level grants on some tables — `channel_connections` had none for
`authenticated` and that broke the UI once). Make sure the settings page can read/write the new columns through its existing path.

### 4.2 `conversation_followups` — ledger (idempotency + audit + dry-run)
```sql
create table public.conversation_followups (
  id                 uuid primary key default gen_random_uuid(),
  agency_id          uuid not null default public.current_agency_id() references public.agencies (id),
  conversation_id    uuid not null references public.conversations (id) on delete cascade,
  lead_id            uuid references public.leads (id) on delete set null,
  kind               text not null check (kind in ('QUIET_NUDGE','HANDOFF_ALERT','HANDOFF_ESCALATION')),
  sequence           integer not null default 1,          -- nudge number 1..3; 1 for alerts
  anchor_message_id  uuid not null references public.messages (id) on delete cascade, -- the customer message the timing was measured from
  channel            text not null,
  status             text not null check (status in ('CLAIMED','SENT','SKIPPED','FAILED','DRY_RUN')),
  skip_reason        text,                                -- WINDOW_CLOSED, CONSENT, STAFF_OWNS, LEAD_CLOSED, NO_TEMPLATE, …
  external_message_id text,
  created_at         timestamptz not null default now(),
  unique (conversation_id, kind, sequence, anchor_message_id)
);
create index conversation_followups_agency_created_idx on public.conversation_followups (agency_id, created_at desc);
alter table public.conversation_followups enable row level security;
-- select: same agency AND the viewer has Inbox access. No insert/update/delete policy — rows are written by the cron with the admin client.
```
Claim-by-insert: the sweep inserts the row (`CLAIMED`) **before** sending; the unique constraint makes concurrent/overlapping cron runs safe, then updates the row to `SENT`/`FAILED`. A new customer message creates a new `anchor_message_id`, which restarts the sequence naturally.

### 4.3 `staff_notifications` — extend
```sql
alter table public.staff_notifications drop constraint staff_notifications_kind_check;
alter table public.staff_notifications
  add constraint staff_notifications_kind_check
    check (kind in ('PROPOSAL_PENDING','HANDOFF_WAITING','HANDOFF_ESCALATED')),
  add column conversation_id uuid references public.conversations (id) on delete cascade;
```
(Confirm the live constraint name with `select conname from pg_constraint where conrelid = 'public.staff_notifications'::regclass;` — it was `staff_notifications_kind_check`.)
Notification rows for conversations have `departure_group_id`/`proposal_id` null. Update `StaffNotificationRow`, the bell components and `lib/data/staff-notifications.ts` so a conversation notification links to the Inbox conversation
(check how the Inbox selects a conversation from the URL before building the link).

### 4.4 Cron
In the same migration: `create or replace function public.invoke_cron_route` with `'/api/cron/lead-followups'` added to the allow-list (copy the full existing function body from `20260927090000_cron_jobs.sql`, change only the list), then schedule `lead-followups-sweep` every 10 minutes
(`*/10 * * * *`) the same idempotent way that migration schedules its jobs.

---

## 5. Phase 1 — Unanswered-handoff alerts

**Goal:** when a customer is waiting on staff, tell the assigned person after `handoff_alert_minutes`, and Admin/CEO after `handoff_escalation_minutes`.

**Who is "waiting":** `conversations.state IN ('HUMAN_REQUESTED','HUMAN_ACTIVE')` and there is a customer message after the last staff/AI outbound (`last_inbound_at > coalesce(last_outbound_at, '-infinity')`). Measure from the **first unanswered customer message**
(earliest `CUSTOMER` message newer than `last_outbound_at`), not `last_inbound_at` — otherwise a customer who keeps messaging keeps postponing the alert. That message's id is the ledger `anchor_message_id`.

**Recipients:** `conversations.assigned_to_id`; else `ai_settings.default_lead_owner_id`; else staff with role in `["ADMIN","CEO"]`. Escalation goes to `["ADMIN","CEO"]` (reuse the role-selection logic in `notifyProposalPending`; extract a shared helper rather than copying).

**Idempotency:** one `HANDOFF_ALERT` and one `HANDOFF_ESCALATION` per `(conversation, anchor message)` via the ledger. When staff reply, the anchor changes on the next unanswered message, so alerts re-arm.

**Notification text (plain words, per AGENTS.md):** `"{contact name} is waiting for a reply on {Channel} — {N} min"`. Escalation: `"Still waiting: {contact name} on {Channel} for {N} min"`.

**Files to create/change**
- `lib/followups/handoff-waiting.ts` — pure: `findWaitingConversations(rows, now, thresholds)` and `recipientsFor(...)`; unit tested.
- `lib/data/conversation-followups-repository.ts` — claim/complete ledger rows (admin client).
- `lib/data/staff-notifications.ts` — add `notifyConversationWaiting(...)`; extend the row type and reader.
- `app/api/cron/lead-followups/route.ts` — auth like `agent-jobs`; loops **per agency** (never one cross-tenant query), runs Phase 1 then Phase 2, returns a small summary JSON. Budget ≤ 50 s.
- Bell components: render the new kinds and link to the conversation.
- Settings UI: two number inputs (alert / escalation minutes) on the AI Agent settings page.

**Working hours:** alerts are in-app, so send them regardless of hours (staff see them when they open the CRM). Do not suppress.

**Acceptance:** with a HUMAN_REQUESTED conversation whose last customer message is 20 min old and unanswered, one notification appears for the assignee; at 65 min one escalation appears for Admin/CEO; a staff reply stops further alerts; running the cron twice creates no duplicates.

---

## 6. Phase 2 — Quiet-lead follow-ups

### 6.1 Eligibility (all must hold; otherwise record `SKIPPED` with the reason, or skip silently for cheap pre-filters)
1. `ai_settings.enabled` and `followups_enabled`; `channel_connections.status = 'CONNECTED'` and `ai_enabled`; `conversations.ai_enabled`.
2. `conversations.state IN ('AI_ACTIVE','AI_RESUMED')` (D4). Not `CLOSED`.
3. `last_inbound_at IS NOT NULL` and `last_outbound_at > last_inbound_at` (we spoke last).
4. Linked lead exists, `lead.stage NOT IN CLOSED_STAGES`, and `postponed_until` is null or past.
5. Consent: run the person's consent facts through `lib/ai/trust/consent-gate.ts` for the channel; `doNotContact` blocks everything.
6. Sequence: `k` = number of nudges already recorded for this anchor + 1; `k ≤ followup_delays_hours.length`; `now − last_inbound_at ≥ delays[k−1]`.
7. **Window rule** (D6): if `now` is within 60 minutes of `service_window_expires_at` or past it → WhatsApp: use the template path; Messenger/Instagram: skip `WINDOW_CLOSED` and stop the sequence for this anchor. Keep the 60-minute margin as a named constant.
8. Do not send during the agency's quiet period: read `working_hours` and only send inside it (if the shape allows), otherwise wait for the next sweep. If `working_hours` is empty, send any time.
9. Never more than one nudge per conversation per sweep, and never two within the same 2 hours.

Stop conditions are automatic: a new customer message creates a new anchor (sequence restarts); staff taking over changes `state` (rule 2); closing/losing the lead (rule 4).

### 6.2 Sending
- **In window (all channels):** build text from `followup_message_text` (replace `{name}` with the first name, fallback to "there"), then call `deliverAgentReply` with `adapter` from the channel registry. Record the message with `metadata.source = 'quiet_followup'` and `actor_kind = 'AI'` so the Inbox shows it as an assistant message. Confirm `deliverAgentReply` lets the caller set metadata; if not, add an optional `metadata` field (do not fork the function).
  Do **not** add automation-disclosure text on top: the disclosure already happened at thread start; for a lapse > 24 h WhatsApp uses a template.
- **WhatsApp outside window:** extract the template-sending core out of `app/inbox/actions.ts` into `lib/whatsapp/send-template-message.ts` (`sendApprovedTemplate({ db, agencyId, conversation, templateId, values })`), make the Server Action call it, and call it from the sweep with `followup_whatsapp_template_id`. If no template is configured → `SKIPPED / NO_TEMPLATE`.
- After a successful send update the ledger (`SENT`, `external_message_id`), `conversations.last_outbound_at`, and increment `leads.follow_up_attempts`; **do not** overwrite a manually set `next_follow_up_at` and **do not** set `first_response_at`/`last_contacted_at` (a bot nudge is not a human contact).
- In `followups_dry_run`: write the ledger row as `DRY_RUN` with what would have been sent, send nothing.

### 6.3 Files
- `lib/followups/quiet-lead-eligibility.ts` — **pure** decision function `decideQuietLeadNudge(input) → {action:'SEND'|'SKIP'|'WAIT', ...}`. All business rules live here; heavily tested.
- `lib/followups/quiet-lead-sweep.ts` — loads candidates for one agency (bounded query, limit per run, oldest first), calls the decision function, claims, sends, records.
- `lib/whatsapp/send-template-message.ts` — extracted template sender.
- `lib/validations/followups.ts` — Zod for the settings (delays increasing, 1–3 entries, each 1–720 h; text ≤ 500 chars and must not be empty; alert/escalation ranges).
- Settings UI: a "Follow-ups" section on the AI Agent settings page — switch, dry-run switch, delays (up to 3 hour inputs), message text, WhatsApp template picker (approved templates only), with plain-language help text that states the Messenger/Instagram 24-hour limit.
- Inbox: show nudges as normal assistant messages; the small "quiet follow-up" origin can come from `metadata.source`.

### 6.4 Candidate query (sketch — refine with the real column/policy names)
```sql
select c.id, c.agency_id, c.channel, c.lead_id, c.last_inbound_at, c.service_window_expires_at, l.stage, l.postponed_until
from conversations c
join leads l on l.id = c.lead_id
where c.agency_id = $1
  and c.state in ('AI_ACTIVE','AI_RESUMED') and c.ai_enabled
  and c.last_inbound_at is not null and c.last_outbound_at > c.last_inbound_at
  and c.last_inbound_at < now() - interval '1 hour'          -- cheapest lower bound; exact delay checked in code
  and l.stage <> all ($closed_stages)
order by c.last_inbound_at asc
limit 200;
```
Add an index if the plan shows a scan (`conversations (agency_id, state, last_inbound_at)`), justified by `explain`, not assumed.

**Acceptance:** dry-run shows the ledger rows a real run would create and sends nothing; live run on a tester Messenger account sends nudge 1 once the delay has passed (the delay minimum is 1 hour, so to test without waiting, backdate `last_inbound_at` and `last_outbound_at` on a scratch tester conversation), never a second one for the same anchor, stops when the customer replies, and stops when a human takes over.

---

## 7. Phase 3 — Staff response-time metric

`leads.first_response_at` is manual-only, so compute from messages.

- Definition: for each run of unanswered `CUSTOMER` messages, response time = time from the **first** unanswered customer message to the next outbound message; report separately for `STAFF` replies and `AI` replies, per channel.
  Exclude `CLOSED` conversations and messages received outside working hours only if the user asks (default: include, and show it as-is).
- `lib/inbox/response-time.ts` — pure `buildResponseTimeStats(messages, targets)` → median, p90, and % answered within target (default target 15 min = `handoff_alert_minutes`); unit tested with edge cases (multiple customer messages before a reply, no reply yet, reply by AI then staff).
- Data: a bounded query over the last 30 days (`messages` by `agency_id, created_at`), like the existing pattern in `lib/agent/whatsapp/analytics.ts`. If it is slow, replace with a SQL function using `lag()`/`lead()` window functions.
- UI: a "Response time by channel" card on the existing AI Agent analytics surface (TASK-002 area) — shadcn `Card`/`Table` only, existing design tokens, no new colours; and (optional) a column in the Reports → Sales & Leads team performance table. Use plain labels: "Median wait", "Slowest 10%", "Answered within 15 minutes".

**Acceptance:** numbers match hand-computed values for a fixture conversation; a conversation with no reply yet shows in "Waiting now", not in the median.

---

## 8. Access and security checklist (do not skip)

- Cron route: `CRON_SECRET` bearer only; **no** user data in the response; every DB query scoped by `agency_id`; the sweep iterates agencies rather than running one global query.
- New table has RLS in the same migration; only server code (admin client) writes it. Read policy checks agency **and** Inbox access.
- Settings changes require the same capability as other AI Agent settings edits (look up the existing key in `lib/access/module-capability-keys.ts` / `lib/access/` and reuse it; add a key only if none fits).
- Zod-validate settings at the Server Action boundary; the nudge text is customer-visible, so cap length and strip control characters.
- Never log tokens or full message bodies; log ids and reasons. Use the redaction patterns already enforced by `lib/channels/redaction-audit.test.ts` (it scans source files — new files must pass it).
- Consent and `doNotContact` are checked **at send time**, not just at selection time.
- Meta policy: do not send follow-ups on Messenger/Instagram outside the 24-hour window under any code path (a unit test must prove it); WhatsApp outside-window sends must use an approved template only.
- Run the security checklist in `docs/security/security-guidelines.md` §10 before the PR.

## 9. Testing plan (Vitest; mock `server-only`; inject dependencies like the existing tests)

- `decideQuietLeadNudge`: each eligibility rule (one test per rule), the sequence logic, the window margin on each channel, the 60-minute/2-hour spacing, template vs free text, dry-run, closed stage, postponed lead, consent block, staff-owned conversation, empty `working_hours`.
- Window safety: property-style test that no input produces a Messenger/Instagram SEND when `now ≥ service_window_expires_at − margin`.
- `findWaitingConversations`: first-unanswered-message anchor, re-arming after a reply, recipient fallback order, escalation roles.
- Ledger repository: a second claim for the same `(conversation, kind, sequence, anchor)` returns "already claimed" (use the fake-supabase pattern).
- Cron route: 401 without/with wrong secret; per-agency isolation (agency A's settings never affect agency B).
- `sendApprovedTemplate` extraction: the existing inbox action behaves identically (keep/extend its current tests).
- `response-time.ts`: fixtures listed in §7.
- Zod: delays must be increasing, 1–3 entries; text bounds.
- Update the redaction audit if it needs to know about new files (run it; it fails loudly).
- Before the PR: `npm run lint`, `npm run typecheck`, `npm run test` (repo baseline at the end of the Messenger/Instagram work: 92+ files, 798+ tests passing, `tsc` clean, eslint 0 errors).

## 10. Manual verification (after each phase)

1. Local dev (`npm run dev` serves HTTPS) with the dev database. For live Meta behaviour use a **tester** account only — non-testers get Graph error 10 while the app is in Development mode.
2. Phase 1: create a HUMAN_REQUESTED conversation, wait or backdate; check the bell for the assignee and, later, Admin/CEO; reply as staff; confirm alerts stop.
3. Phase 2: enable dry-run first, inspect `conversation_followups`; then enable live on the test agency with a tester account. Confirm Messenger nudge 3 (72 h) is skipped as `WINDOW_CLOSED` and WhatsApp uses the template.
4. Phase 3: compare the card's numbers with a hand count on 3–4 conversations.
5. Check the empty, permission-denied and error states of every new UI piece in the browser (per the workflow doc).

## 11. Rollout and documentation

- Ship with `followups_enabled = false` and `followups_dry_run = true`. Turn on for the internal test agency, review a few days of dry-run rows, then enable live.
- Update this plan if the build diverges. Add a short runbook `docs/runbooks/lead-followups-operations.md` (how to pause: switch off `followups_enabled`; how to read `conversation_followups`; how to add a cron path).
- Add this doc to `docs/modules/README.md`'s list if that index is maintained by hand (it currently describes modules in prose only).
- Do **not** commit unrelated working-tree changes; stage only files you created for this feature.

## 12. Environment gotchas learned on this project

- Files may use CRLF line endings: when scripting multi-line edits, normalise `\r\n` first, or use the Edit tool.
- Migrations: `supabase db push` (CLI v2.34.3). Column-level grants matter on this database — after adding columns/tables check the `authenticated` role can read what the UI reads.
- Supabase MCP `execute_sql` works on project `klognjpwmqwlgeibvanf`; Vercel MCP has runtime logs (team `team_1ZO8Gl44AKLQdUJCbhxILukK`, project `hajj-umrah-crm`).
- UI rules from `AGENTS.md`: shadcn components only, `InputGroup` + `InputGroupAddon align="block-start"` + `InputGroupInput` for inputs, unique specific component/function names, plain-language text, do not change colours.
- Server code that touches the admin client or tokens must `import "server-only"`; pure decision modules should stay import-free so they are unit-testable (like `lib/inbox/composer-state.ts`).

---

## 13. Build notes (where the build differs from the plan)

- **Table name:** messages live in `conversation_messages`, not `messages`; the ledger's `anchor_message_id` references it.
- **Working hours (§6.1 rule 8) not implemented:** `ai_settings.working_hours` has no defined shape and nothing writes it, so the sweep treats it as "no restriction" (`withinWorkingHours: true` in `lib/followups/quiet-lead-sweep.ts`). Add the check there once a shape exists.
- **Consent:** a free-text nudge inside the window is blocked only by `do_not_contact` / `OPTED_OUT`; a WhatsApp **template** (outside the window) also needs WHATSAPP in `contactable_channels` (`checkConsent`). `contactable_channels` defaults to empty, so requiring it in-window would have blocked every customer.
- **Template variables:** the sweep fills one variable (the customer's first name), so the settings page lists only approved templates with at most one variable, and saving re-checks that.
- **Template extraction:** `lib/whatsapp/send-template-message.ts` (`sendApprovedTemplate`) now sends the template for `startWhatsAppChat`; it only sends, and the caller records the message.
- **`deliverAgentReply`** gained an optional `metadata` field (used for `source: "quiet_followup"`).
- **Skips:** only terminal skips (`WINDOW_CLOSED`, `NO_TEMPLATE`, `CONSENT`, `CONVERSATION_CHANGED`) are written to the ledger; the rest (staff owns, lead closed…) are silent waits.
- **Alerts** only look at conversations whose last customer message is within 7 days (the longest escalation time the settings allow).
- **Response time (Phase 3):** `lib/inbox/response-time.ts` + `lib/data/response-time.ts`, shown as a card under "Assistant performance". The optional Reports → team performance column was not built.
- **Indexes added:** `conversations (agency_id, state, last_inbound_at)` (partial, AI states) and `conversation_messages (agency_id, created_at desc)`; not yet justified by `explain` on production-sized data.
- **Not verified in a browser:** the settings form, response-time card and bell rendering were type-checked and built but not exercised in the browser (login required). Do the checks in §10 before enabling.
- Operations: [`docs/runbooks/lead-followups-operations.md`](../runbooks/lead-followups-operations.md).
