-- Messenger channel foundation (Phase 2 of docs/modules/messenger-instagram-ai-agent-implementation-plan.md).
--
-- Additive only. WhatsApp tables and behaviour are untouched.
--   A. channel_webhook_events — raw, append-only audit floor for Messenger/Instagram deliveries.
--   B. channel_connections    — per-connection AI switch (default OFF for new channels), credential expiry
--                               (Instagram tokens last 60 days), and a GLOBAL tenant gate: one Page / IG account
--                               can be connected to exactly one agency.
--   C. agent_jobs             — a new RECONCILE_ECHO kind (the Messenger echo race, plan F6).

-- ─────────────────────────────────────────────────────────────────────────────
-- A. channel_webhook_events
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.channel_webhook_events (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null check (provider in ('MESSENGER', 'INSTAGRAM')),
  agency_id          uuid references public.agencies (id),   -- null when the Page/account matched no connection
  connection_id      uuid references public.channel_connections (id) on delete set null,
  -- sha256 of the raw body: a byte-identical redelivery collapses to one audit row. Message-level idempotency
  -- lives on conversation_messages.external_message_id, so a redelivery never double-processes.
  external_event_id  text not null,
  payload            jsonb not null,
  signature_valid    boolean not null,
  received_at        timestamptz not null default now(),
  processed_at       timestamptz,
  error              text,
  constraint channel_webhook_events_provider_event_unique unique (provider, external_event_id)
);

comment on table public.channel_webhook_events is
  'Every Messenger/Instagram webhook delivery, verbatim. agency_id is null when the account id in the payload matched no connected channel — recorded, never processed. Written only by the service role.';

create index if not exists channel_webhook_events_agency_idx
  on public.channel_webhook_events (agency_id, received_at desc);
create index if not exists channel_webhook_events_received_idx
  on public.channel_webhook_events (received_at desc);

alter table public.channel_webhook_events enable row level security;
revoke all on table public.channel_webhook_events from anon, authenticated;
grant select on table public.channel_webhook_events to authenticated;

drop policy if exists channel_webhook_events_select on public.channel_webhook_events;
create policy channel_webhook_events_select on public.channel_webhook_events
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'));
-- No insert/update/delete policy: only the service-role webhook writes here.

-- ─────────────────────────────────────────────────────────────────────────────
-- B. channel_connections additions
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.channel_connections
  add column if not exists ai_enabled boolean not null default false,
  add column if not exists credential_expires_at timestamptz;

comment on column public.channel_connections.ai_enabled is
  'Whether the AI assistant may reply on this connection. Defaults OFF for a new Messenger/Instagram connection (Meta requires disclosing automation, so the agency opts in). Consulted by the Messenger/Instagram webhooks; WhatsApp is still governed by conversation.ai_enabled.';
comment on column public.channel_connections.credential_expires_at is
  'When the stored token stops working. Null = does not expire (Messenger Page token). Instagram long-lived tokens last 60 days and must be refreshed before then.';

-- Existing WhatsApp connections keep behaving as they do today.
update public.channel_connections set ai_enabled = true where provider = 'WHATSAPP';

-- The tenant gate is global: a webhook carries only the Page / account id, so that id must resolve to exactly
-- one agency. (WhatsApp's phone_number_id is globally unique for the same reason.) A second agency claiming an
-- id already connected elsewhere must fail loudly, not quietly split the inbox.
create unique index if not exists channel_connections_meta_account_global_unique
  on public.channel_connections (provider, provider_account_id)
  where provider in ('MESSENGER', 'INSTAGRAM')
    and provider_account_id is not null
    and status <> 'DISCONNECTED';

-- ─────────────────────────────────────────────────────────────────────────────
-- C. agent_jobs — RECONCILE_ECHO
-- ─────────────────────────────────────────────────────────────────────────────
-- A Messenger/Instagram "echo" fires for messages our own app sent through the API as well as for a person
-- typing in the Page inbox. The AI reply's row is saved after the send returns, so an echo can arrive first.
-- The webhook therefore defers an unrecognised echo by a few seconds; this job then treats it as a person only
-- if it is still unknown.
alter table public.agent_jobs drop constraint if exists agent_jobs_kind_check;
alter table public.agent_jobs
  add constraint agent_jobs_kind_check
  check (kind in ('PROCESS_INBOUND', 'TRANSCRIBE_AUDIO', 'EMBED_DOCUMENT', 'RECONCILE_ECHO'));
