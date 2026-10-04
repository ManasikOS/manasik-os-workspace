-- Unified Inbox core — additive provider-neutral foundation.
--
-- This migration deliberately preserves the existing WhatsApp inbox and its
-- tables. It introduces the reusable connection/identity/collaboration/outbox
-- boundaries and maps existing WhatsApp data into them. No existing read or
-- send path is changed by this migration.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Provider-neutral connections
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.channel_connections (
  id                              uuid primary key default gen_random_uuid(),
  agency_id                       uuid not null default public.current_agency_id()
                                    references public.agencies (id),
  provider                        text not null check (provider in (
                                    'WHATSAPP', 'INSTAGRAM', 'MESSENGER', 'GMAIL',
                                    'WEB_CHAT', 'SMS', 'OTHER'
                                  )),
  provider_account_id             text,
  display_name                    text not null default '',
  status                          text not null default 'NOT_CONNECTED' check (status in (
                                    'NOT_CONNECTED', 'PENDING', 'CONNECTED', 'DEGRADED',
                                    'DISCONNECTED', 'ERROR', 'RESTRICTED'
                                  )),
  credential_ref                  text,
  refresh_credential_ref          text,
  capability_snapshot             jsonb not null default '{}'::jsonb,
  provider_metadata               jsonb not null default '{}'::jsonb,
  sync_cursor                     text,
  last_inbound_at                 timestamptz,
  last_outbound_at                timestamptz,
  health_checked_at               timestamptz,
  last_error                      text,
  legacy_whatsapp_integration_id  uuid unique references public.whatsapp_integrations (id) on delete set null,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

comment on table public.channel_connections is
  'One provider connection per agency identity. Credential references point to Vault; usable provider secrets never live in this table.';

create unique index if not exists channel_connections_provider_account_agency_unique
  on public.channel_connections (agency_id, provider, provider_account_id)
  where provider_account_id is not null;
create unique index if not exists channel_connections_id_agency_unique
  on public.channel_connections (id, agency_id);
create index if not exists channel_connections_agency_provider_idx
  on public.channel_connections (agency_id, provider, status);

drop trigger if exists channel_connections_set_updated_at on public.channel_connections;
create trigger channel_connections_set_updated_at
  before update on public.channel_connections
  for each row execute function public.set_updated_at();

-- Each existing WhatsApp integration becomes a generic connection. The source
-- table already exists before this migration; later WhatsApp migrations may
-- enrich it but are not required here.
insert into public.channel_connections (
  agency_id,
  provider,
  provider_account_id,
  display_name,
  status,
  credential_ref,
  provider_metadata,
  legacy_whatsapp_integration_id
)
select
  wi.agency_id,
  'WHATSAPP',
  wi.phone_number_id,
  coalesce(nullif(wi.business_name, ''), nullif(wi.display_phone_number, ''), 'WhatsApp'),
  case
    when wi.status = 'CONNECTED' then 'CONNECTED'
    when wi.status = 'ERROR' then 'ERROR'
    when wi.status = 'DISCONNECTED' then 'DISCONNECTED'
    when wi.status = 'UNFUNDED' then 'DEGRADED'
    else 'NOT_CONNECTED'
  end,
  wi.credential_ref,
  jsonb_strip_nulls(jsonb_build_object(
    'phone_number_id', wi.phone_number_id,
    'display_phone_number', wi.display_phone_number,
    'business_account_id', wi.business_account_id
  )),
  wi.id
from public.whatsapp_integrations wi
on conflict (legacy_whatsapp_integration_id) do update
set
  provider_account_id = excluded.provider_account_id,
  display_name = excluded.display_name,
  status = excluded.status,
  credential_ref = excluded.credential_ref,
  provider_metadata = excluded.provider_metadata,
  updated_at = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Cross-channel identity index. This is not a second customer master:
-- `leads` and `pilgrims` remain the CRM sources of truth.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.contact_identities (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null default public.current_agency_id()
                          references public.agencies (id),
  provider              text not null check (provider in (
                          'WHATSAPP', 'INSTAGRAM', 'MESSENGER', 'GMAIL',
                          'WEB_CHAT', 'SMS', 'OTHER'
                        )),
  external_subject_id   text not null,
  normalized_phone      text,
  normalized_email      text,
  display_name          text not null default '',
  profile_data          jsonb not null default '{}'::jsonb,
  lead_id               uuid,
  pilgrim_id            uuid,
  match_confidence      text not null default 'UNRESOLVED' check (match_confidence in (
                          'UNRESOLVED', 'EXACT_IDENTITY', 'VERIFIED_CONTACT',
                          'STAFF_CONFIRMED', 'AMBIGUOUS'
                        )),
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint contact_identities_external_subject_agency_unique
    unique (agency_id, provider, external_subject_id),
  constraint contact_identities_lead_fkey
    foreign key (lead_id)
    references public.leads (id) on delete set null,
  constraint contact_identities_pilgrim_fkey
    foreign key (pilgrim_id)
    references public.pilgrims (id) on delete set null
);

comment on table public.contact_identities is
  'Provider-specific contact identity index. It links external identities to existing leads/pilgrims but is not a competing customer record.';

create unique index if not exists contact_identities_id_agency_unique
  on public.contact_identities (id, agency_id);
create index if not exists contact_identities_agency_phone_idx
  on public.contact_identities (agency_id, normalized_phone)
  where normalized_phone is not null;
create index if not exists contact_identities_agency_email_idx
  on public.contact_identities (agency_id, lower(normalized_email))
  where normalized_email is not null;
create index if not exists contact_identities_agency_lead_idx
  on public.contact_identities (agency_id, lead_id)
  where lead_id is not null;

drop trigger if exists contact_identities_set_updated_at on public.contact_identities;
create trigger contact_identities_set_updated_at
  before update on public.contact_identities
  for each row execute function public.set_updated_at();

-- The deployed database may predate the optional `(id, agency_id)` unique-key
-- retrofit on `leads`/`pilgrims`. Their UUID primary keys still guarantee that
-- linked records exist; this trigger additionally guarantees the linked row is
-- in the same agency without making this migration depend on that retrofit.
create or replace function public.assert_contact_identity_tenant()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.lead_id is not null and not exists (
    select 1 from public.leads lead
    where lead.id = new.lead_id and lead.agency_id = new.agency_id
  ) then
    raise exception 'contact identity lead must belong to the same agency';
  end if;

  if new.pilgrim_id is not null and not exists (
    select 1 from public.pilgrims pilgrim
    where pilgrim.id = new.pilgrim_id and pilgrim.agency_id = new.agency_id
  ) then
    raise exception 'contact identity pilgrim must belong to the same agency';
  end if;

  return new;
end;
$$;

drop trigger if exists contact_identities_assert_tenant on public.contact_identities;
create trigger contact_identities_assert_tenant
  before insert or update of agency_id, lead_id, pilgrim_id on public.contact_identities
  for each row execute function public.assert_contact_identity_tenant();

create table if not exists public.identity_match_events (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null default public.current_agency_id()
                          references public.agencies (id),
  contact_identity_id   uuid not null,
  action                text not null check (action in ('LINKED', 'UNLINKED', 'MERGED', 'SPLIT', 'AMBIGUOUS')),
  previous_lead_id      uuid,
  next_lead_id          uuid,
  previous_pilgrim_id   uuid,
  next_pilgrim_id       uuid,
  confidence            text,
  evidence              jsonb not null default '{}'::jsonb,
  actor_id              uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  constraint identity_match_events_identity_agency_fkey
    foreign key (contact_identity_id, agency_id)
    references public.contact_identities (id, agency_id) on delete cascade
);

create index if not exists identity_match_events_identity_idx
  on public.identity_match_events (contact_identity_id, created_at desc);

-- Existing WhatsApp conversations gain a stable generic identity. This is
-- idempotent and uses the current external conversation ID (`wa_id`).
insert into public.contact_identities (
  agency_id,
  provider,
  external_subject_id,
  normalized_phone,
  display_name,
  lead_id,
  match_confidence,
  first_seen_at,
  last_seen_at
)
select
  c.agency_id,
  'WHATSAPP',
  c.external_conversation_id,
  nullif(regexp_replace(c.contact_phone, '[^0-9]', '', 'g'), ''),
  c.contact_name,
  c.lead_id,
  case when c.lead_id is null then 'UNRESOLVED' else 'EXACT_IDENTITY' end,
  c.created_at,
  coalesce(c.last_inbound_at, c.last_outbound_at, c.updated_at)
from public.conversations c
where c.channel = 'WHATSAPP'
on conflict (agency_id, provider, external_subject_id) do update
set
  normalized_phone = coalesce(excluded.normalized_phone, public.contact_identities.normalized_phone),
  display_name = coalesce(nullif(excluded.display_name, ''), public.contact_identities.display_name),
  lead_id = coalesce(public.contact_identities.lead_id, excluded.lead_id),
  last_seen_at = greatest(public.contact_identities.last_seen_at, excluded.last_seen_at),
  updated_at = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Extend the existing conversation/message model in place.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.conversations
  add column if not exists connection_id uuid,
  add column if not exists contact_identity_id uuid,
  add column if not exists external_thread_id text,
  add column if not exists lifecycle_status text,
  add column if not exists handling_mode text,
  add column if not exists priority text not null default 'NORMAL',
  add column if not exists last_activity_at timestamptz,
  add column if not exists last_message_preview text not null default '',
  add column if not exists waiting_since timestamptz,
  add column if not exists sla_due_at timestamptz,
  add column if not exists version integer not null default 1 check (version > 0);

alter table public.conversations
  drop constraint if exists conversations_channel_check;
alter table public.conversations
  add constraint conversations_channel_check check (channel in (
    'WHATSAPP', 'INSTAGRAM', 'MESSENGER', 'GMAIL', 'WEB_CHAT', 'SMS', 'OTHER'
  ));
alter table public.conversations
  drop constraint if exists conversations_lifecycle_status_check;
alter table public.conversations
  add constraint conversations_lifecycle_status_check check (lifecycle_status in ('OPEN', 'CLOSED', 'SPAM'));
alter table public.conversations
  drop constraint if exists conversations_handling_mode_check;
alter table public.conversations
  add constraint conversations_handling_mode_check check (handling_mode in (
    'AI_ACTIVE', 'AI_PAUSED', 'HUMAN_REQUESTED', 'HUMAN_ACTIVE'
  ));
alter table public.conversations
  drop constraint if exists conversations_priority_check;
alter table public.conversations
  add constraint conversations_priority_check check (priority in ('LOW', 'NORMAL', 'HIGH', 'URGENT'));

update public.conversations c
set
  connection_id = cc.id,
  contact_identity_id = ci.id,
  external_thread_id = coalesce(c.external_thread_id, c.external_conversation_id),
  lifecycle_status = coalesce(c.lifecycle_status, case when c.state = 'CLOSED' then 'CLOSED' else 'OPEN' end),
  handling_mode = coalesce(c.handling_mode, case
    when c.state in ('AI_ACTIVE', 'AI_RESUMED') then 'AI_ACTIVE'
    when c.state = 'HUMAN_REQUESTED' then 'HUMAN_REQUESTED'
    when c.state = 'HUMAN_ACTIVE' then 'HUMAN_ACTIVE'
    else 'AI_PAUSED'
  end),
  last_activity_at = coalesce(c.last_activity_at, greatest(c.last_inbound_at, c.last_outbound_at), c.updated_at),
  waiting_since = case
    when c.waiting_since is not null then c.waiting_since
    when c.state = 'HUMAN_REQUESTED' then coalesce(c.last_inbound_at, c.updated_at)
    else null
  end
from public.channel_connections cc,
  public.contact_identities ci
where c.channel = 'WHATSAPP'
  and cc.legacy_whatsapp_integration_id is not null
  and cc.agency_id = c.agency_id
  and ci.agency_id = c.agency_id
  and ci.provider = 'WHATSAPP'
  and ci.external_subject_id = c.external_conversation_id;

alter table public.conversations
  add constraint conversations_connection_agency_fkey
    foreign key (connection_id, agency_id)
    references public.channel_connections (id, agency_id) on delete set null (connection_id);
alter table public.conversations
  add constraint conversations_contact_identity_agency_fkey
    foreign key (contact_identity_id, agency_id)
    references public.contact_identities (id, agency_id) on delete set null (contact_identity_id);

create unique index if not exists conversations_id_agency_unique
  on public.conversations (id, agency_id);
create index if not exists conversations_inbox_list_idx
  on public.conversations (agency_id, lifecycle_status, last_activity_at desc, id desc);
create index if not exists conversations_inbox_assignee_idx
  on public.conversations (agency_id, assigned_to_id, lifecycle_status, last_activity_at desc, id desc);
create index if not exists conversations_inbox_channel_idx
  on public.conversations (agency_id, channel, lifecycle_status, last_activity_at desc, id desc);
create index if not exists conversations_contact_identity_idx
  on public.conversations (agency_id, contact_identity_id)
  where contact_identity_id is not null;

alter table public.conversation_messages
  add column if not exists direction text,
  add column if not exists client_idempotency_key text,
  add column if not exists external_thread_id text,
  add column if not exists provider_sent_at timestamptz,
  add column if not exists reply_to_message_id uuid,
  add column if not exists sender_identity_id uuid,
  add column if not exists content_parts jsonb not null default '[]'::jsonb,
  add column if not exists sequence_number bigint;

alter table public.conversation_messages
  drop constraint if exists conversation_messages_direction_check;
alter table public.conversation_messages
  add constraint conversation_messages_direction_check check (direction in ('INBOUND', 'OUTBOUND', 'INTERNAL', 'SYSTEM'));

update public.conversation_messages m
set
  direction = coalesce(m.direction, case
    when m.actor_kind = 'CUSTOMER' then 'INBOUND'
    when m.actor_kind in ('AI', 'STAFF') then 'OUTBOUND'
    else 'SYSTEM'
  end),
  provider_sent_at = coalesce(m.provider_sent_at, m.created_at),
  content_parts = case
    when m.content_parts = '[]'::jsonb and m.content <> '' then jsonb_build_array(jsonb_build_object('type', 'text', 'text', m.content))
    else m.content_parts
  end;

with numbered as (
  select id, row_number() over (partition by conversation_id order by created_at, id) as sequence_number
  from public.conversation_messages
)
update public.conversation_messages m
set sequence_number = numbered.sequence_number
from numbered
where m.id = numbered.id and m.sequence_number is null;

create unique index if not exists conversation_messages_id_agency_unique
  on public.conversation_messages (id, agency_id);

alter table public.conversation_messages
  add constraint conversation_messages_client_idempotency_agency_unique
    unique (agency_id, client_idempotency_key);
alter table public.conversation_messages
  add constraint conversation_messages_reply_to_agency_fkey
    foreign key (reply_to_message_id, agency_id)
    references public.conversation_messages (id, agency_id) on delete set null (reply_to_message_id);
alter table public.conversation_messages
  add constraint conversation_messages_sender_identity_agency_fkey
    foreign key (sender_identity_id, agency_id)
    references public.contact_identities (id, agency_id) on delete set null (sender_identity_id);

create unique index if not exists conversation_messages_conversation_sequence_unique
  on public.conversation_messages (conversation_id, sequence_number)
  where sequence_number is not null;
create index if not exists conversation_messages_inbox_order_idx
  on public.conversation_messages (agency_id, conversation_id, provider_sent_at, sequence_number, id);

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Collaboration, rich message parts, delivery audit, and durable outbox.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.message_attachments (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null default public.current_agency_id()
                          references public.agencies (id),
  message_id            uuid not null,
  provider_media_id     text,
  storage_path          text,
  filename              text,
  mime_type             text not null default 'application/octet-stream',
  byte_size             bigint check (byte_size is null or byte_size >= 0),
  checksum_sha256       text,
  scan_status           text not null default 'PENDING' check (scan_status in ('PENDING', 'CLEAN', 'QUARANTINED', 'FAILED')),
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  constraint message_attachments_message_agency_fkey
    foreign key (message_id, agency_id)
    references public.conversation_messages (id, agency_id) on delete cascade
);

create index if not exists message_attachments_message_idx
  on public.message_attachments (message_id, created_at);

create table if not exists public.message_delivery_events (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null default public.current_agency_id()
                          references public.agencies (id),
  message_id            uuid not null,
  provider_event_id     text,
  status                text not null check (status in ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED')),
  provider_code         text,
  detail                jsonb not null default '{}'::jsonb,
  occurred_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  constraint message_delivery_events_message_agency_fkey
    foreign key (message_id, agency_id)
    references public.conversation_messages (id, agency_id) on delete cascade,
  constraint message_delivery_events_provider_event_agency_unique
    unique (agency_id, provider_event_id)
);

create index if not exists message_delivery_events_message_idx
  on public.message_delivery_events (message_id, occurred_at desc);

create table if not exists public.conversation_events (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null default public.current_agency_id()
                          references public.agencies (id),
  conversation_id       uuid not null,
  kind                  text not null,
  actor_kind            text not null check (actor_kind in ('CUSTOMER', 'AI', 'STAFF', 'SYSTEM')),
  actor_id              uuid references auth.users (id) on delete set null,
  data                  jsonb not null default '{}'::jsonb,
  occurred_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  constraint conversation_events_conversation_agency_fkey
    foreign key (conversation_id, agency_id)
    references public.conversations (id, agency_id) on delete cascade
);

create index if not exists conversation_events_timeline_idx
  on public.conversation_events (conversation_id, occurred_at, id);

create table if not exists public.conversation_notes (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null default public.current_agency_id()
                          references public.agencies (id),
  conversation_id       uuid not null,
  body                  text not null check (length(trim(body)) > 0),
  author_id             uuid not null references auth.users (id) on delete restrict,
  author_name_snapshot  text not null default '',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint conversation_notes_conversation_agency_fkey
    foreign key (conversation_id, agency_id)
    references public.conversations (id, agency_id) on delete cascade
);

drop trigger if exists conversation_notes_set_updated_at on public.conversation_notes;
create trigger conversation_notes_set_updated_at
  before update on public.conversation_notes
  for each row execute function public.set_updated_at();

create index if not exists conversation_notes_timeline_idx
  on public.conversation_notes (conversation_id, created_at, id);
create unique index if not exists conversation_notes_id_agency_unique
  on public.conversation_notes (id, agency_id);

create table if not exists public.note_mentions (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null default public.current_agency_id()
                          references public.agencies (id),
  note_id               uuid not null,
  mentioned_user_id     uuid not null references auth.users (id) on delete cascade,
  created_at            timestamptz not null default now(),
  constraint note_mentions_note_agency_fkey
    foreign key (note_id, agency_id)
    references public.conversation_notes (id, agency_id) on delete cascade,
  constraint note_mentions_unique unique (note_id, mentioned_user_id)
);

create table if not exists public.saved_replies (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null default public.current_agency_id()
                          references public.agencies (id),
  title                 text not null check (length(trim(title)) > 0),
  body                  text not null check (length(trim(body)) > 0),
  language              text,
  providers             text[] not null default '{}',
  is_private            boolean not null default false,
  owner_id              uuid references auth.users (id) on delete cascade,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint saved_replies_private_owner_check check ((not is_private) or owner_id is not null)
);

drop trigger if exists saved_replies_set_updated_at on public.saved_replies;
create trigger saved_replies_set_updated_at
  before update on public.saved_replies
  for each row execute function public.set_updated_at();

create index if not exists saved_replies_agency_idx
  on public.saved_replies (agency_id, is_private, title);

create table if not exists public.conversation_drafts (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null default public.current_agency_id()
                          references public.agencies (id),
  conversation_id       uuid not null,
  author_id             uuid not null references auth.users (id) on delete cascade,
  body                  text not null default '',
  content_parts         jsonb not null default '[]'::jsonb,
  version               integer not null default 1 check (version > 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint conversation_drafts_conversation_agency_fkey
    foreign key (conversation_id, agency_id)
    references public.conversations (id, agency_id) on delete cascade,
  constraint conversation_drafts_author_conversation_unique unique (conversation_id, author_id)
);

drop trigger if exists conversation_drafts_set_updated_at on public.conversation_drafts;
create trigger conversation_drafts_set_updated_at
  before update on public.conversation_drafts
  for each row execute function public.set_updated_at();

create table if not exists public.outbox_messages (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null references public.agencies (id),
  connection_id         uuid not null,
  conversation_id       uuid not null,
  message_id            uuid not null,
  idempotency_key       uuid not null,
  command               jsonb not null default '{}'::jsonb,
  status                text not null default 'QUEUED' check (status in ('QUEUED', 'RUNNING', 'SENT', 'FAILED', 'DEAD', 'CANCELLED')),
  attempts              integer not null default 0 check (attempts >= 0),
  max_attempts          integer not null default 5 check (max_attempts > 0),
  run_after             timestamptz not null default now(),
  locked_at             timestamptz,
  locked_by             text,
  last_error            text,
  provider_message_id   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint outbox_messages_connection_agency_fkey
    foreign key (connection_id, agency_id)
    references public.channel_connections (id, agency_id) on delete restrict,
  constraint outbox_messages_conversation_agency_fkey
    foreign key (conversation_id, agency_id)
    references public.conversations (id, agency_id) on delete restrict,
  constraint outbox_messages_message_agency_fkey
    foreign key (message_id, agency_id)
    references public.conversation_messages (id, agency_id) on delete restrict,
  constraint outbox_messages_idempotency_agency_unique unique (agency_id, idempotency_key)
);

drop trigger if exists outbox_messages_set_updated_at on public.outbox_messages;
create trigger outbox_messages_set_updated_at
  before update on public.outbox_messages
  for each row execute function public.set_updated_at();

create index if not exists outbox_messages_claim_idx
  on public.outbox_messages (status, run_after)
  where status = 'QUEUED';
create index if not exists outbox_messages_conversation_idx
  on public.outbox_messages (agency_id, conversation_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- E. RLS and grants. Inbox readers may see collaboration data; only the
-- existing customer-facing roles may create notes, replies, and drafts.
-- Webhook/outbox records are server-worker-only.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.channel_connections enable row level security;
alter table public.contact_identities enable row level security;
alter table public.identity_match_events enable row level security;
alter table public.message_attachments enable row level security;
alter table public.message_delivery_events enable row level security;
alter table public.conversation_events enable row level security;
alter table public.conversation_notes enable row level security;
alter table public.note_mentions enable row level security;
alter table public.saved_replies enable row level security;
alter table public.conversation_drafts enable row level security;
alter table public.outbox_messages enable row level security;

revoke all on table public.channel_connections, public.contact_identities,
  public.identity_match_events, public.message_attachments,
  public.message_delivery_events, public.conversation_events,
  public.conversation_notes, public.note_mentions, public.saved_replies,
  public.conversation_drafts, public.outbox_messages from anon, authenticated;

grant select on table public.contact_identities, public.message_attachments,
  public.message_delivery_events, public.conversation_events,
  public.conversation_notes, public.note_mentions, public.saved_replies
  to authenticated;
grant insert on table public.conversation_notes, public.note_mentions,
  public.saved_replies, public.conversation_drafts to authenticated;
grant select, update, delete on table public.conversation_drafts to authenticated;
grant update, delete on table public.conversation_notes, public.saved_replies to authenticated;

create policy channel_connections_select on public.channel_connections
  for select to authenticated
  using (
    agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS')
  );

create policy contact_identities_select on public.contact_identities
  for select to authenticated
  using (
    agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA')
  );

create policy identity_match_events_select on public.identity_match_events
  for select to authenticated
  using (
    agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS')
  );

create policy message_attachments_select on public.message_attachments
  for select to authenticated
  using (
    agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA')
  );

create policy message_delivery_events_select on public.message_delivery_events
  for select to authenticated
  using (
    agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA')
  );

create policy conversation_events_select on public.conversation_events
  for select to authenticated
  using (
    agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA')
  );

create policy conversation_notes_select on public.conversation_notes
  for select to authenticated
  using (
    agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA')
  );
create policy conversation_notes_insert on public.conversation_notes
  for insert to authenticated
  with check (
    agency_id = public.current_agency_id()
    and author_id = (select auth.uid())
    and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS')
  );
create policy conversation_notes_update on public.conversation_notes
  for update to authenticated
  using (
    agency_id = public.current_agency_id()
    and author_id = (select auth.uid())
    and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS')
  )
  with check (
    agency_id = public.current_agency_id()
    and author_id = (select auth.uid())
    and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS')
  );
create policy conversation_notes_delete on public.conversation_notes
  for delete to authenticated
  using (
    agency_id = public.current_agency_id()
    and (author_id = (select auth.uid()) or public.staff_role_in('ADMIN'))
    and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS')
  );

create policy note_mentions_select on public.note_mentions
  for select to authenticated
  using (
    agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA')
  );
create policy note_mentions_insert on public.note_mentions
  for insert to authenticated
  with check (
    agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS')
    and exists (
      select 1 from public.conversation_notes n
      where n.id = note_id
        and n.agency_id = public.current_agency_id()
        and n.author_id = (select auth.uid())
    )
  );

create policy saved_replies_select on public.saved_replies
  for select to authenticated
  using (
    agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA')
    and (not is_private or owner_id = (select auth.uid()))
  );
create policy saved_replies_insert on public.saved_replies
  for insert to authenticated
  with check (
    agency_id = public.current_agency_id()
    and (owner_id is null or owner_id = (select auth.uid()))
    and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS')
  );
create policy saved_replies_update on public.saved_replies
  for update to authenticated
  using (
    agency_id = public.current_agency_id()
    and (not is_private or owner_id = (select auth.uid()))
    and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS')
  )
  with check (
    agency_id = public.current_agency_id()
    and (owner_id is null or owner_id = (select auth.uid()))
    and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS')
  );
create policy saved_replies_delete on public.saved_replies
  for delete to authenticated
  using (
    agency_id = public.current_agency_id()
    and (owner_id = (select auth.uid()) or public.staff_role_in('ADMIN'))
    and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS')
  );

create policy conversation_drafts_select on public.conversation_drafts
  for select to authenticated
  using (
    agency_id = public.current_agency_id()
    and author_id = (select auth.uid())
    and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS')
  );
create policy conversation_drafts_insert on public.conversation_drafts
  for insert to authenticated
  with check (
    agency_id = public.current_agency_id()
    and author_id = (select auth.uid())
    and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS')
  );
create policy conversation_drafts_update on public.conversation_drafts
  for update to authenticated
  using (
    agency_id = public.current_agency_id()
    and author_id = (select auth.uid())
    and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS')
  )
  with check (
    agency_id = public.current_agency_id()
    and author_id = (select auth.uid())
    and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS')
  );
create policy conversation_drafts_delete on public.conversation_drafts
  for delete to authenticated
  using (
    agency_id = public.current_agency_id()
    and author_id = (select auth.uid())
    and public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS')
  );

-- Outbox rows are never exposed to authenticated clients. Server workers use
-- the service role and must scope every operation by agency/connection.
