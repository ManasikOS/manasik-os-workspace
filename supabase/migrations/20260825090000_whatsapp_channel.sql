-- WhatsApp channel — the transport layer only: what number is connected, the
-- raw events Meta sends, the durable conversation record, and the queue that
-- lets the webhook return 200 in milliseconds while the AI turn runs after.
--
-- See docs/modules/whatsapp-ai-agent-implementation-plan.md §5.1/§6. Every table here
-- is agency-scoped (20260824090000 must be applied first) except
-- whatsapp_integrations.phone_number_id, which is deliberately GLOBAL — a
-- phone number belongs to exactly one WABA, and a second agency claiming an
-- already-connected number is a takeover attempt that must fail loudly
-- rather than silently succeed per-agency (D2b).
--
-- Safe on a database with 20260808…20260824 applied.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. whatsapp_integrations — one row per connected WhatsApp Business number.
--
-- Never stores a usable secret. The per-WABA access token Embedded Signup
-- returns lives in Supabase Vault; credential_ref points at it and
-- credential_hint is a masked tail for the UI only (D4). This mirrors, and
-- is kept in lockstep with, the existing `integration_connections` status
-- card so the Settings > Integrations screen never disagrees with itself.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_integrations (
  id                     uuid primary key default gen_random_uuid(),
  agency_id              uuid not null references public.agencies (id),
  provider               text not null default 'META' check (provider = 'META'),

  business_account_id    text,                     -- WABA id
  phone_number_id        text,                      -- unique below; null until connected
  display_phone_number   text,
  business_name          text,
  quality_rating         text,
  messaging_limit_tier   text,

  credential_ref         text,                      -- Supabase Vault secret id — never the token
  credential_hint        text,                       -- masked tail only, e.g. '…4f2a'

  status                 text not null default 'NOT_CONNECTED'
                           check (status in ('NOT_CONNECTED', 'CONNECTED', 'UNFUNDED', 'ERROR', 'DISCONNECTED')),
  verified_at            timestamptz,
  last_error             text,
  connected_by           uuid references auth.users (id) on delete set null,
  connected_by_name      text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint whatsapp_integrations_one_per_agency unique (agency_id)
);

comment on table public.whatsapp_integrations is
  'One connected WhatsApp Business number per agency, via Meta Embedded Signup v4. Never stores a usable secret — see D4.';

-- Global: a phone number belongs to exactly one WABA. Partial index so
-- multiple NOT_CONNECTED rows (phone_number_id still null) never collide.
create unique index if not exists whatsapp_integrations_phone_number_unique
  on public.whatsapp_integrations (phone_number_id)
  where phone_number_id is not null;

drop trigger if exists whatsapp_integrations_set_updated_at on public.whatsapp_integrations;
create trigger whatsapp_integrations_set_updated_at
  before update on public.whatsapp_integrations
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- B. whatsapp_webhook_events — raw, append-only. The audit floor: every byte
--    Meta ever sent us, whether or not it turned out to be processable.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_webhook_events (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid references public.agencies (id),   -- nullable: unresolved phone_number_id (D2)
  external_event_id   text not null,
  payload             jsonb not null,
  signature_valid     boolean not null,
  received_at         timestamptz not null default now(),
  processed_at        timestamptz,
  error                text,

  constraint whatsapp_webhook_events_external_id_unique unique (external_event_id)
);

comment on table public.whatsapp_webhook_events is
  'Every inbound WhatsApp webhook delivery, verbatim. agency_id is null when the phone_number_id in the payload matched no connected integration (F8/D2) — the event is still recorded, just never enqueued.';

create index if not exists whatsapp_webhook_events_agency_id_idx
  on public.whatsapp_webhook_events (agency_id);
create index if not exists whatsapp_webhook_events_received_at_idx
  on public.whatsapp_webhook_events (received_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- C. conversations — the durable WhatsApp thread with one contact.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.conversations (
  id                          uuid primary key default gen_random_uuid(),
  agency_id                   uuid not null references public.agencies (id),
  channel                     text not null default 'WHATSAPP' check (channel = 'WHATSAPP'),
  external_conversation_id    text not null,                   -- the wa_id
  lead_id                     uuid references public.leads (id) on delete set null,
  contact_name                text not null default '',
  contact_phone                text not null default '',

  state                       text not null default 'AI_ACTIVE'
                                check (state in ('AI_ACTIVE', 'HUMAN_REQUESTED', 'HUMAN_ACTIVE', 'AI_RESUMED', 'CLOSED')),
  ai_enabled                  boolean not null default true,
  assigned_to_id               uuid references public.staff_profiles (id) on delete set null,
  assigned_to_name             text,

  service_window_expires_at    timestamptz,                    -- F7: refreshed on every inbound

  last_inbound_at              timestamptz,
  last_outbound_at             timestamptz,
  unread_count                 integer not null default 0 check (unread_count >= 0),

  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),

  constraint conversations_external_id_unique unique (agency_id, channel, external_conversation_id)
);

comment on table public.conversations is
  'One row per WhatsApp contact per agency. state drives who may reply — see docs/modules/whatsapp-ai-agent-implementation-plan.md §10.';

create index if not exists conversations_agency_id_idx on public.conversations (agency_id);
create index if not exists conversations_state_idx on public.conversations (agency_id, state);
create index if not exists conversations_lead_id_idx on public.conversations (lead_id);
create index if not exists conversations_last_inbound_idx on public.conversations (agency_id, last_inbound_at desc);

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- D. conversation_messages — every message, in or out.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.conversation_messages (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null references public.agencies (id),
  conversation_id       uuid not null references public.conversations (id) on delete cascade,

  external_message_id   text,                                  -- F8: Meta's message id, for idempotency
  role                  text not null check (role in ('user', 'assistant', 'staff', 'system', 'tool')),
  actor_kind            text not null check (actor_kind in ('CUSTOMER', 'AI', 'STAFF', 'SYSTEM')),
  actor_id              uuid,
  actor_name_snapshot   text,

  content               text not null default '',
  message_type          text not null default 'TEXT'
                          check (message_type in ('TEXT', 'AUDIO', 'IMAGE', 'DOCUMENT', 'TEMPLATE', 'INTERACTIVE', 'SYSTEM')),
  media_path            text,                                  -- Supabase Storage path, Phase 10 (voice)

  delivery_status       text not null default 'PENDING'
                          check (delivery_status in ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED')),
  delivery_error        text,

  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

comment on table public.conversation_messages is
  'Every WhatsApp message, in or out. external_message_id is unique per agency so a Meta webhook redelivery never creates a duplicate (F8).';

create unique index if not exists conversation_messages_external_id_unique
  on public.conversation_messages (agency_id, external_message_id)
  where external_message_id is not null;
create index if not exists conversation_messages_conversation_id_idx
  on public.conversation_messages (conversation_id, created_at);
create index if not exists conversation_messages_agency_id_idx
  on public.conversation_messages (agency_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- E. agent_jobs — the queue. A Postgres table drained by the cron route
--    (D5); no Redis, no worker process — this repository has neither today.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.agent_jobs (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies (id),
  kind           text not null check (kind in ('PROCESS_INBOUND', 'TRANSCRIBE_AUDIO', 'EMBED_DOCUMENT')),
  payload        jsonb not null default '{}'::jsonb,

  status         text not null default 'QUEUED'
                   check (status in ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'DEAD')),
  attempts       integer not null default 0 check (attempts >= 0),
  max_attempts   integer not null default 3 check (max_attempts > 0),
  last_error     text,

  run_after      timestamptz not null default now(),
  locked_at      timestamptz,
  locked_by      text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.agent_jobs is
  'Work queue for AI turns, transcription and embedding. Claimed by the cron drain route with SKIP LOCKED — see §6.3 of the plan.';

create index if not exists agent_jobs_claim_idx on public.agent_jobs (status, run_after);
create index if not exists agent_jobs_agency_id_idx on public.agent_jobs (agency_id);

drop trigger if exists agent_jobs_set_updated_at on public.agent_jobs;
create trigger agent_jobs_set_updated_at
  before update on public.agent_jobs
  for each row execute function public.set_updated_at();

-- `SKIP LOCKED` has no PostgREST/supabase-js equivalent, so claiming due
-- jobs safely under concurrent cron invocations has to be a stored
-- procedure. security definer so the service-role caller (which has no
-- session, and therefore no RLS-visible agency) can see and lock jobs
-- across every agency in one pass — exactly what a shared queue drain needs.
create or replace function public.claim_agent_jobs(p_worker_id text, p_limit integer)
returns setof public.agent_jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
    update public.agent_jobs
    set status = 'RUNNING', locked_at = now(), locked_by = p_worker_id
    where id in (
      select id from public.agent_jobs
      where status = 'QUEUED' and run_after <= now()
      order by run_after
      limit p_limit
      for update skip locked
    )
    returning *;
end;
$$;

comment on function public.claim_agent_jobs(text, integer) is
  'Claims up to p_limit due agent_jobs with FOR UPDATE SKIP LOCKED, so overlapping cron invocations never process the same job twice. See docs/modules/whatsapp-ai-agent-implementation-plan.md §6.3.';

-- Postgres grants EXECUTE to PUBLIC by default, and `authenticated` inherits
-- from PUBLIC — without this revoke, any signed-in staff member could call
-- this RPC directly (it is auto-exposed over PostgREST) and claim jobs
-- across every agency, since it deliberately bypasses RLS. Only the
-- service-role client (which already bypasses RLS entirely and is what the
-- cron drain route uses) may call it.
revoke all on function public.claim_agent_jobs(text, integer) from public, authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- F. Row Level Security.
--
-- Read: ADMIN, CEO, MARKETING, OPERATIONS, FINANCE, VISA. GUIDE has no
-- Inbox access, matching every other module's posture toward that role.
-- Write (conversations/messages): ADMIN, MARKETING, OPERATIONS — the roles
-- with an actual reason to reply to a customer.
-- whatsapp_webhook_events and agent_jobs are written only by the
-- service-role client (the webhook, the cron drain) and never by
-- `authenticated` — no write policy is granted for that role.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.whatsapp_integrations enable row level security;
alter table public.whatsapp_webhook_events enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.agent_jobs enable row level security;

drop policy if exists "staff read whatsapp_integrations" on public.whatsapp_integrations;
create policy "staff read whatsapp_integrations" on public.whatsapp_integrations
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));

drop policy if exists "staff write whatsapp_integrations" on public.whatsapp_integrations;
create policy "staff write whatsapp_integrations" on public.whatsapp_integrations
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN'));

drop policy if exists "staff read whatsapp_webhook_events" on public.whatsapp_webhook_events;
create policy "staff read whatsapp_webhook_events" on public.whatsapp_webhook_events
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'));

drop policy if exists "staff read conversations" on public.conversations;
create policy "staff read conversations" on public.conversations
  for select to authenticated
  using (agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA'));

drop policy if exists "staff write conversations" on public.conversations;
create policy "staff write conversations" on public.conversations
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS'));

drop policy if exists "staff read conversation_messages" on public.conversation_messages;
create policy "staff read conversation_messages" on public.conversation_messages
  for select to authenticated
  using (agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA'));

drop policy if exists "staff insert conversation_messages" on public.conversation_messages;
create policy "staff insert conversation_messages" on public.conversation_messages
  for insert to authenticated
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS'));

drop policy if exists "staff read agent_jobs" on public.agent_jobs;
create policy "staff read agent_jobs" on public.agent_jobs
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'));

-- ─────────────────────────────────────────────────────────────────────────────
-- G. Supabase Vault wrappers — where the per-agency WABA access token
--    actually lives (D4). The `vault` schema is not exposed over PostgREST,
--    so these `security definer` functions in `public` are the only way
--    application code reaches it, and — like `claim_agent_jobs` above —
--    they are revoked from every role except service_role: a wrapper that
--    can decrypt any secret in the project must never be callable by a
--    signed-in staff member's session client.
--
-- Requires the `supabase_vault` extension, enabled by default on every
-- Supabase project since it ships with the platform.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.whatsapp_store_token(p_agency_id uuid, p_token text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_secret_name text := 'whatsapp_token_' || p_agency_id::text;
  v_existing_id uuid;
  v_secret_id uuid;
begin
  select id into v_existing_id from vault.secrets where name = v_secret_name;

  if v_existing_id is not null then
    perform vault.update_secret(v_existing_id, p_token);
    v_secret_id := v_existing_id;
  else
    v_secret_id := vault.create_secret(p_token, v_secret_name, 'WhatsApp Cloud API token for one agency');
  end if;

  return v_secret_id::text;
end;
$$;

create or replace function public.whatsapp_read_token(p_credential_ref text)
returns text
language sql security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_credential_ref::uuid
$$;

comment on function public.whatsapp_store_token(uuid, text) is
  'Writes (or rotates) one agency''s WhatsApp access token into Supabase Vault; returns the secret id to store as whatsapp_integrations.credential_ref. service_role only.';
comment on function public.whatsapp_read_token(text) is
  'Decrypts one agency''s WhatsApp access token by its Vault secret id, for the outbound send path. service_role only.';

revoke all on function public.whatsapp_store_token(uuid, text) from public, authenticated, anon;
revoke all on function public.whatsapp_read_token(text) from public, authenticated, anon;
