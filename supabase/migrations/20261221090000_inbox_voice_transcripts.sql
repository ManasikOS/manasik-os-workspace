-- MED-01: persist staff-only voice transcripts. A transcript is a derived,
-- non-authoritative aid for staff. It lives in its own table and is never
-- written into the customer's message body. This migration is additive: it
-- does not alter conversation_messages, message_attachments, or
-- message_media_analyses (whose legacy `transcript` column stays untouched).

-- Composite tenant keys let each foreign key prove the referenced row belongs
-- to the transcript's agency. The UUID primary keys already guarantee
-- uniqueness; these indexes expose it to composite foreign keys.
create unique index if not exists conversation_messages_id_agency_unique
  on public.conversation_messages (id, agency_id);
create unique index if not exists message_attachments_id_agency_unique
  on public.message_attachments (id, agency_id);

create table public.inbox_voice_transcripts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id()
    references public.agencies(id) on delete cascade,

  -- Retention follows the source: deleting the voice attachment or its
  -- message (Inbox retention sweep) deletes the transcript with it.
  attachment_id uuid not null,
  message_id uuid not null,

  status text not null default 'PENDING'
    check (status in ('PENDING','PROCESSING','COMPLETE','LOW_CONFIDENCE','FAILED','SKIPPED')),
  -- Why a transcript is absent. Never contains transcript content.
  failure_reason text
    check (failure_reason is null or failure_reason in (
      'DISABLED','QUOTA_EXCEEDED','UNSUPPORTED_FORMAT','TOO_LONG','TOO_LARGE',
      'NO_SPEECH','PROVIDER_ERROR','TIMEOUT'
    )),

  transcript_text text
    check (transcript_text is null or char_length(transcript_text) <= 20000),
  language text
    check (language is null or (btrim(language) <> '' and char_length(language) <= 16)),
  confidence numeric(3,2)
    check (confidence is null or confidence between 0 and 1),
  provider text,
  model text,
  duration_seconds numeric(8,2)
    check (duration_seconds is null or duration_seconds >= 0),
  attempt_count integer not null default 0
    check (attempt_count between 0 and 10),

  -- Schema-level invariant: a transcript can never be marked authoritative.
  non_authoritative boolean not null default true
    check (non_authoritative),

  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A hold keeps the transcript through retention; deleting a held row (or the
  -- source that would cascade to it) is blocked until the hold is released.
  legal_hold_at timestamptz,
  legal_hold_by uuid references auth.users(id) on delete set null,
  legal_hold_reason text,

  constraint inbox_voice_transcripts_attachment_agency_fk
    foreign key (attachment_id, agency_id)
    references public.message_attachments(id, agency_id)
    on delete cascade,
  constraint inbox_voice_transcripts_message_agency_fk
    foreign key (message_id, agency_id)
    references public.conversation_messages(id, agency_id)
    on delete cascade,

  -- One transcript per voice attachment: retries and concurrent workers
  -- converge on the same row instead of producing duplicates.
  constraint inbox_voice_transcripts_attachment_idempotency
    unique (agency_id, attachment_id),

  -- Lifecycle shape: text only when a transcript exists; a reason only when
  -- none was produced.
  constraint inbox_voice_transcripts_lifecycle_check check (
    (status in ('PENDING','PROCESSING')
      and transcript_text is null and failure_reason is null and completed_at is null)
    or (status in ('COMPLETE','LOW_CONFIDENCE')
      and nullif(btrim(transcript_text), '') is not null
      and confidence is not null
      and failure_reason is null and completed_at is not null)
    or (status in ('FAILED','SKIPPED')
      and transcript_text is null and failure_reason is not null and completed_at is not null)
  ),
  constraint inbox_voice_transcripts_legal_hold_check check (
    (legal_hold_at is null and legal_hold_by is null and legal_hold_reason is null)
    or (legal_hold_at is not null and nullif(btrim(legal_hold_reason), '') is not null)
  )
);

comment on table public.inbox_voice_transcripts is
  'Staff-only, non-authoritative machine transcripts of customer voice notes. Never part of the customer message body and never sent to a customer unless staff explicitly choose to use it.';
comment on column public.inbox_voice_transcripts.non_authoritative is
  'Always true. The transcript is an aid; the original audio is the record.';
comment on column public.inbox_voice_transcripts.failure_reason is
  'Machine reason a transcript is absent. Must never contain transcript content.';

create unique index inbox_voice_transcripts_id_agency_unique
  on public.inbox_voice_transcripts (id, agency_id);
create index inbox_voice_transcripts_agency_message_idx
  on public.inbox_voice_transcripts (agency_id, message_id);
-- The worker's claim path: unfinished work, oldest first, per agency.
create index inbox_voice_transcripts_agency_open_idx
  on public.inbox_voice_transcripts (agency_id, requested_at)
  where status in ('PENDING','PROCESSING');

create trigger inbox_voice_transcripts_set_updated_at
  before update on public.inbox_voice_transcripts
  for each row execute function public.set_updated_at();

create or replace function public.inbox_voice_transcripts_block_held_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.legal_hold_at is not null then
    raise exception 'inbox_voice_transcripts: row is under legal hold'
      using errcode = '23001';
  end if;
  return old;
end;
$$;
revoke execute on function public.inbox_voice_transcripts_block_held_delete() from public, anon, authenticated;

create trigger inbox_voice_transcripts_block_held_delete
  before delete on public.inbox_voice_transcripts
  for each row execute function public.inbox_voice_transcripts_block_held_delete();

-- Staff may read; every write goes through the server-side worker, which uses
-- service_role. There is deliberately no insert/update/delete grant.
alter table public.inbox_voice_transcripts enable row level security;
revoke all on table public.inbox_voice_transcripts from anon, authenticated;
grant select on table public.inbox_voice_transcripts to authenticated;

create policy inbox_voice_transcripts_select
  on public.inbox_voice_transcripts for select to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and (select public.staff_role_in('ADMIN','CEO','MARKETING','OPERATIONS','FINANCE','VISA'))
  );

notify pgrst, 'reload schema';
