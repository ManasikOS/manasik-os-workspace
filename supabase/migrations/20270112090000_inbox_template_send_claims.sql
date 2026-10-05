-- BUG-3 of docs/progress/2026-10-05-inbox-security-and-bug-audit.md: a billable WhatsApp template is sent straight to Meta from a Server Action, before
-- any database row exists, and with no idempotency key. A double click, a retried request or a second tab sent it twice and billed twice; and when the
-- CRM write failed after the send, nothing recorded that the customer had been messaged.
--
-- One row per send attempt. The browser makes a key for each attempt; the server inserts the row BEFORE calling Meta (the unique index makes the
-- second request lose), marks it SENT with Meta's message id straight after the send (before the conversation or message rows are written, so the
-- send is on record even if those fail), and marks it FAILED when nothing was sent. A repeat of the same key then returns the first result instead
-- of sending again.
--
-- Server-only, like outbox_messages: row-level security on, no policy, no privilege for the client roles. Rows are written with the service key.
-- Rollback: drop table public.inbox_template_send_claims. Idempotent.

create table if not exists public.inbox_template_send_claims (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references public.agencies (id) on delete cascade,
  idempotency_key     uuid not null,
  staff_id            uuid,
  status              text not null default 'SENDING' check (status in ('SENDING', 'SENT', 'FAILED')),
  conversation_id     uuid,
  external_message_id text,
  error               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint inbox_template_send_claims_key_unique unique (agency_id, idempotency_key)
);

comment on table public.inbox_template_send_claims is
  'One row per staff-started WhatsApp template send (BUG-3). Inserted before Meta is called so a repeat of the same key cannot send twice. Server-only.';

create index if not exists inbox_template_send_claims_created_idx on public.inbox_template_send_claims (created_at);

alter table public.inbox_template_send_claims enable row level security;
revoke all on table public.inbox_template_send_claims from anon, authenticated;
