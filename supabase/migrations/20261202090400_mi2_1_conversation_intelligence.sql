-- MI2.1 — the intelligence projection tables (G1, G2). docs/inbox/implementation-plan.md MI2.1, Architecture §5.1–5.4, §5.8.
--
--   conversation_intelligence       one upserted row per conversation: "what is true now", read by the whole UI
--   conversation_signals            append-only typed observations, each pointing at the message that caused it
--   conversation_interventions      the compact "human review required" demand (a signal is an observation; this is a demand)
--   conversation_queue_membership   derived queue rows. Created here EMPTY; MI2.2 adds the function that fills it.
--   + the §5.8 column additions to conversations and conversation_messages
--
-- Every code list below mirrors lib/inbox/intelligence/contracts.ts; extend both together.
--
-- Tenant isolation is enforced by the database, not only by queries: every child row carries a COMPOSITE foreign key to
-- (id, agency_id), so a row can never reference another agency's conversation, message or staff member even if
-- application code passes the wrong id. RLS is on in this same migration; reads follow the conversations policy
-- (ADMIN, CEO, MARKETING, OPERATIONS, FINANCE, VISA), and there is NO write policy for `authenticated` — only
-- server code on service_role writes these tables.
--
-- Deviation from Architecture §5.4: conversation_queue_membership's primary key is (agency_id, queue_code,
-- conversation_id), with priority_rank in a separate descending index. A conversation is in a queue at most once, and
-- priority_rank changes (SLA breach) — a mutable column in the primary key would make every re-rank a key change.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Composite-FK targets
-- ─────────────────────────────────────────────────────────────────────────────
create unique index if not exists staff_profiles_id_agency_unique on public.staff_profiles (id, agency_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. §5.8 additions to existing tables
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.conversations
  add column if not exists composing_by uuid,
  add column if not exists composing_at timestamptz,
  add column if not exists human_agent_window_expires_at timestamptz,
  add column if not exists intelligence_state text;

alter table public.conversations drop constraint if exists conversations_intelligence_state_check;
alter table public.conversations
  add constraint conversations_intelligence_state_check
  check (intelligence_state is null or intelligence_state in ('PENDING', 'FRESH', 'STALE', 'SKIPPED', 'FAILED'));

alter table public.conversations drop constraint if exists conversations_composing_by_fkey;
alter table public.conversations
  add constraint conversations_composing_by_fkey
  foreign key (composing_by, agency_id) references public.staff_profiles (id, agency_id);

comment on column public.conversations.intelligence_state is
  'Denormalised from conversation_intelligence.state by trigger so the list can say "Copilot is reading this" without a join. NULL = never evaluated.';

alter table public.conversation_messages
  add column if not exists redaction_state text not null default 'NONE',
  add column if not exists sensitive_kinds text[] not null default '{}';

alter table public.conversation_messages drop constraint if exists conversation_messages_redaction_state_check;
alter table public.conversation_messages
  add constraint conversation_messages_redaction_state_check check (redaction_state in ('NONE', 'MASKED'));

comment on column public.conversation_messages.sensitive_kinds is
  'Marked at ingest, before any model sees the message: e.g. PASSPORT, BANK_DETAILS. Empty for ordinary text.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. conversation_intelligence (Architecture §5.1)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.conversation_intelligence (
  conversation_id           uuid primary key,
  agency_id                 uuid not null default public.current_agency_id() references public.agencies (id),

  intent_code               text check (intent_code is null or intent_code in (
                              'PACKAGE_ENQUIRY', 'PRICE_REQUEST', 'BOOKING_REQUEST', 'PAYMENT_CLAIM', 'DOCUMENT_ISSUE',
                              'VISA_QUERY', 'ITINERARY_QUERY', 'COMPLAINT', 'CANCELLATION', 'GROUP_ENQUIRY', 'FAQ', 'SPAM', 'OTHER')),
  intent_confidence         numeric(3, 2) check (intent_confidence is null or (intent_confidence >= 0 and intent_confidence <= 1)),
  travel_intent             jsonb,
  urgency                   text not null default 'NORMAL' check (urgency in ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  commercial_stage          text not null default 'UNQUALIFIED' check (commercial_stage in (
                              'UNQUALIFIED', 'QUALIFYING', 'READY_TO_RECOMMEND', 'QUOTE_SENT', 'BOOKING_READY', 'BOOKED', 'LOST')),
  sentiment                 text not null default 'NEUTRAL' check (sentiment in ('POSITIVE', 'NEUTRAL', 'CONCERNED', 'ANGRY', 'DISTRESSED')),
  estimated_value_cents     bigint check (estimated_value_cents is null or estimated_value_cents >= 0),
  estimated_value_currency  text check (estimated_value_currency is null or char_length(estimated_value_currency) = 3),
  risk_level                text not null default 'NONE' check (risk_level in ('NONE', 'REVIEW', 'BLOCK')),
  next_action_code          text not null default 'NO_ACTION' check (next_action_code in (
                              'DRAFT_REPLY', 'ASK_QUALIFYING_QUESTION', 'OPEN_DEPARTURE_GROUP', 'CREATE_QUOTE', 'SEND_BROCHURE',
                              'HOLD_SEATS', 'CREATE_BOOKING', 'REQUEST_DOCUMENTS', 'VERIFY_PAYMENT', 'REVIEW_IDENTITY_MATCH',
                              'ESCALATE_TO_HUMAN', 'ASSIGN_OWNER', 'FOLLOW_UP_LATER', 'RESOLVE_CONVERSATION', 'NO_ACTION')),
  language_code             text,
  summary                   text,
  open_questions            jsonb not null default '[]'::jsonb,
  matched_offer             jsonb,

  -- RULES or LLM: staff always see which. `note` says why when a model was expected but a rule answered.
  source                    text not null default 'RULES' check (source in ('RULES', 'LLM')),
  state                     text not null default 'PENDING' check (state in ('PENDING', 'FRESH', 'STALE', 'SKIPPED', 'FAILED')),
  note                      text,

  -- A bump invalidates every row without a migration; the fingerprint is the idempotency and cache key (§8.3).
  pipeline_version          integer not null default 1 check (pipeline_version > 0),
  input_fingerprint         text not null default 'pending' check (char_length(input_fingerprint) > 0),
  computed_at               timestamptz not null default now(),
  stale_at                  timestamptz,
  ai_run_id                 uuid references public.ai_runs (id) on delete set null,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  foreign key (conversation_id, agency_id) references public.conversations (id, agency_id) on delete cascade
);

comment on table public.conversation_intelligence is
  'One upserted row per conversation: the intelligence projection every Inbox screen reads. Written by the pipeline (service_role) only.';

create index if not exists conversation_intelligence_agency_stage_idx on public.conversation_intelligence (agency_id, commercial_stage);
create index if not exists conversation_intelligence_agency_intent_idx on public.conversation_intelligence (agency_id, intent_code);
create index if not exists conversation_intelligence_agency_risk_idx
  on public.conversation_intelligence (agency_id, risk_level) where risk_level <> 'NONE';
create index if not exists conversation_intelligence_stale_idx
  on public.conversation_intelligence (agency_id, state) where state in ('PENDING', 'STALE', 'FAILED');

drop trigger if exists conversation_intelligence_set_updated_at on public.conversation_intelligence;
create trigger conversation_intelligence_set_updated_at
  before update on public.conversation_intelligence
  for each row execute function public.set_updated_at();

-- Keep conversations.intelligence_state in step, so there is exactly one source of truth (this row's state).
create or replace function public.sync_conversation_intelligence_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
     set intelligence_state = new.state
   where id = new.conversation_id
     and agency_id = new.agency_id
     and intelligence_state is distinct from new.state;
  return new;
end;
$$;

revoke all on function public.sync_conversation_intelligence_state() from public, anon, authenticated;

drop trigger if exists conversation_intelligence_sync_state on public.conversation_intelligence;
create trigger conversation_intelligence_sync_state
  after insert or update of state on public.conversation_intelligence
  for each row execute function public.sync_conversation_intelligence_state();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. conversation_signals (Architecture §5.2) — append-only
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.conversation_signals (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null default public.current_agency_id() references public.agencies (id),
  conversation_id  uuid not null,
  signal_code      text not null check (signal_code in (
                     'INSTALMENT_INTEREST', 'GROUP_BOOKING_12_PLUS', 'PRE_RAMADAN_DEADLINE', 'SEAT_RESERVATION_INTENT',
                     'PAYMENT_CLAIM_UNVERIFIED', 'BANK_DETAIL_MISMATCH', 'STALE_PRICE_QUOTED', 'GROUP_FULL_REQUESTED',
                     'PASSPORT_EXPIRY_RISK', 'WINDOW_CLOSING_SOON', 'CONCURRENT_COMPOSER', 'LOW_CONFIDENCE_DRAFT',
                     'SENSITIVE_DOC_RECEIVED', 'MINOR_OR_ASSISTANCE_NEEDED', 'UNRECORDED_BOOKING_CLAIM', 'REFUND_REQUEST',
                     'DISTRESS_LANGUAGE', 'COMPLAINT_ESCALATION', 'FRAUD_CONCERN', 'MEDICAL_URGENCY',
                     'RELIGIOUS_RULING_REQUEST', 'SLA_BREACHED')),
  message_id       uuid,
  detector         text not null check (detector in ('RULE', 'MODEL')),
  confidence       numeric(3, 2) not null default 1 check (confidence >= 0 and confidence <= 1),
  evidence         jsonb not null default '[]'::jsonb,
  superseded_at    timestamptz,
  created_at       timestamptz not null default now(),

  foreign key (conversation_id, agency_id) references public.conversations (id, agency_id) on delete cascade,
  -- Deleting a message must not delete the fact that a signal fired, only the pointer to it (PG15+ column list).
  foreign key (message_id, agency_id) references public.conversation_messages (id, agency_id) on delete set null (message_id)
);

comment on table public.conversation_signals is
  'Append-only typed observations, each pointing at the message that caused it — what makes every owner-panel number drillable. Superseded, never deleted.';

-- A replay must not double-record the same live signal for the same message.
create unique index if not exists conversation_signals_live_uidx
  on public.conversation_signals (conversation_id, signal_code, coalesce(message_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where superseded_at is null;
create index if not exists conversation_signals_conversation_idx
  on public.conversation_signals (agency_id, conversation_id, created_at desc) where superseded_at is null;
create index if not exists conversation_signals_code_idx
  on public.conversation_signals (agency_id, signal_code, created_at desc) where superseded_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. conversation_interventions (Architecture §5.3)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.conversation_interventions (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null default public.current_agency_id() references public.agencies (id),
  conversation_id       uuid not null,

  kind                  text not null check (kind in (
                          'PAYMENT_CLAIM', 'BANK_DETAIL_MISMATCH', 'STALE_PRICE', 'GROUP_FULL', 'PASSPORT_EXPIRY', 'REFUND_REQUEST',
                          'DISTRESSED_CUSTOMER', 'COMPLAINT', 'FRAUD_CONCERN', 'MEDICAL_URGENCY', 'RELIGIOUS_RULING',
                          'SENSITIVE_DOCUMENT', 'ASSISTANCE_NEEDED', 'UNRECORDED_BOOKING', 'SLA_BREACH')),
  severity              text not null check (severity in ('REVIEW', 'BLOCK')),
  headline              text not null check (char_length(headline) > 0),
  guidance              text not null check (char_length(guidance) > 0),
  required_action_code  text not null check (required_action_code in (
                          'DRAFT_REPLY', 'ASK_QUALIFYING_QUESTION', 'OPEN_DEPARTURE_GROUP', 'CREATE_QUOTE', 'SEND_BROCHURE',
                          'HOLD_SEATS', 'CREATE_BOOKING', 'REQUEST_DOCUMENTS', 'VERIFY_PAYMENT', 'REVIEW_IDENTITY_MATCH',
                          'ESCALATE_TO_HUMAN', 'ASSIGN_OWNER', 'FOLLOW_UP_LATER', 'RESOLVE_CONVERSATION', 'NO_ACTION')),
  assigned_role         text,
  assigned_to_id        uuid,

  status                text not null default 'OPEN' check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED')),
  resolved_by           uuid,
  resolution_note       text,
  source_signal_ids     uuid[] not null default '{}',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  resolved_at           timestamptz,

  foreign key (conversation_id, agency_id) references public.conversations (id, agency_id) on delete cascade,
  foreign key (assigned_to_id, agency_id) references public.staff_profiles (id, agency_id),
  foreign key (resolved_by, agency_id) references public.staff_profiles (id, agency_id),

  -- Closing one is a decision someone answers for: it needs a note, a time, and an actor.
  constraint conversation_interventions_closed_needs_note check (
    status not in ('RESOLVED', 'DISMISSED')
    or (resolved_at is not null and resolved_by is not null and char_length(btrim(coalesce(resolution_note, ''))) > 0)
  )
);

comment on table public.conversation_interventions is
  'A demand for human review, distinct from the signals that caused it. While a PAYMENT_CLAIM intervention is open, no Copilot surface may draft a payment confirmation (enforced by the protection gate, MI4.2).';

-- One live intervention per (conversation, kind): re-detection updates it, it never stacks fifty cards.
create unique index if not exists conversation_interventions_open_uidx
  on public.conversation_interventions (conversation_id, kind) where status in ('OPEN', 'ACKNOWLEDGED');
-- The protection-gate query: "does this conversation have an open intervention?"
create index if not exists conversation_interventions_open_idx
  on public.conversation_interventions (agency_id, conversation_id) where status in ('OPEN', 'ACKNOWLEDGED');
create index if not exists conversation_interventions_role_idx
  on public.conversation_interventions (agency_id, assigned_role, created_at desc) where status in ('OPEN', 'ACKNOWLEDGED');

drop trigger if exists conversation_interventions_set_updated_at on public.conversation_interventions;
create trigger conversation_interventions_set_updated_at
  before update on public.conversation_interventions
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. conversation_queue_membership (Architecture §5.4) — filled by MI2.2
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.conversation_queue_membership (
  agency_id        uuid not null default public.current_agency_id() references public.agencies (id),
  queue_code       text not null check (queue_code in (
                     'ALL', 'MINE', 'UNASSIGNED', 'NEEDS_REPLY', 'WAITING_CUSTOMER', 'WAITING_TEAM', 'RESOLVED',
                     'NEW_ENQUIRIES', 'QUALIFIED', 'BOOKING_READY', 'QUOTE_SENT', 'PAYMENT_DISCUSSIONS',
                     'DOCUMENTS', 'VISA_ISSUES', 'DEPARTURE_CHANGES', 'GROUP_CHANGES', 'COMPLAINTS', 'ESCALATIONS',
                     'NEARING_DEADLINE', 'SLA_BREACHED', 'WHATSAPP', 'INSTAGRAM', 'MESSENGER')),
  conversation_id  uuid not null,
  entered_at       timestamptz not null default now(),
  priority_rank    integer not null default 0,

  primary key (agency_id, queue_code, conversation_id),
  foreign key (conversation_id, agency_id) references public.conversations (id, agency_id) on delete cascade
);

comment on table public.conversation_queue_membership is
  'Derived, indexed queue rows — the one definition of every queue predicate lives in refresh_conversation_queues() (MI2.2). Never written by application code.';

-- The list/count access path: one indexed range per queue, highest priority first.
create index if not exists conversation_queue_membership_list_idx
  on public.conversation_queue_membership (agency_id, queue_code, priority_rank desc, entered_at desc, conversation_id);
create index if not exists conversation_queue_membership_conversation_idx
  on public.conversation_queue_membership (conversation_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Row Level Security — same read roles as conversations; no write policy for authenticated
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.conversation_intelligence enable row level security;
alter table public.conversation_signals enable row level security;
alter table public.conversation_interventions enable row level security;
alter table public.conversation_queue_membership enable row level security;

drop policy if exists "staff read conversation_intelligence" on public.conversation_intelligence;
create policy "staff read conversation_intelligence" on public.conversation_intelligence
  for select to authenticated
  using (agency_id = public.current_agency_id()
         and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA'));

drop policy if exists "staff read conversation_signals" on public.conversation_signals;
create policy "staff read conversation_signals" on public.conversation_signals
  for select to authenticated
  using (agency_id = public.current_agency_id()
         and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA'));

drop policy if exists "staff read conversation_interventions" on public.conversation_interventions;
create policy "staff read conversation_interventions" on public.conversation_interventions
  for select to authenticated
  using (agency_id = public.current_agency_id()
         and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA'));

drop policy if exists "staff read conversation_queue_membership" on public.conversation_queue_membership;
create policy "staff read conversation_queue_membership" on public.conversation_queue_membership
  for select to authenticated
  using (agency_id = public.current_agency_id()
         and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA'));
