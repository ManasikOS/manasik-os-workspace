-- Visa Operations — the agency-wide visa application queue.
--
-- The visa state machine, its transitions and its readiness derivation already
-- exist on `departure_group_pilgrims` (see 20260809090000 and 20260811090000).
-- What is missing is everything cross-group: an owner per application, an
-- application reference distinct from the issued visa number, a submission
-- batch, a real issue record with a separate verification step, and an
-- append-only timeline. This migration adds those, plus the single read shape
-- (`visa_application_rows`) the Visa page consumes instead of joining five
-- tables by hand.
--
-- Additive only. Safe on a database that already has 20260809090000,
-- 20260811090000, 20260813090000 and 20260814090000 applied.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. The application gets an identity, an owner, a reference, a batch and a
--    real issue record — recording is not verifying.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.departure_group_pilgrims
  add column if not exists visa_type                  text,
  add column if not exists visa_application_reference text,
  add column if not exists visa_assigned_to           uuid references auth.users (id) on delete set null,
  add column if not exists visa_assigned_to_name      text,
  add column if not exists visa_assigned_at            timestamptz,
  add column if not exists visa_batch_id               uuid,
  add column if not exists visa_issue_date             date,
  add column if not exists visa_entry_type             text
    check (visa_entry_type is null or visa_entry_type in ('SINGLE', 'MULTIPLE')),
  add column if not exists visa_valid_until             date,
  add column if not exists visa_verified_at             timestamptz,
  add column if not exists visa_verified_by             uuid references auth.users (id) on delete set null,
  add column if not exists visa_verified_by_name        text,
  add column if not exists visa_evidence_source          text,
  add column if not exists visa_status_checked_at        timestamptz,
  add column if not exists visa_last_update_at           timestamptz,
  add column if not exists visa_priority_score           integer not null default 0;

comment on column public.departure_group_pilgrims.visa_application_reference is
  'The reference the file was lodged under, entered manually — no portal integration is implied. Distinct from visa_id, which is the issued visa number.';
comment on column public.departure_group_pilgrims.visa_verified_at is
  'Recording an issued visa (visa_id, dates) is not the same as staff verifying the evidence. Group readiness counts only verified issues as green.';

create index if not exists dgp_visa_assigned_idx on public.departure_group_pilgrims (visa_assigned_to)
  where visa_status not in ('APPROVED');
create index if not exists dgp_visa_batch_idx on public.departure_group_pilgrims (visa_batch_id)
  where visa_batch_id is not null;
create index if not exists dgp_visa_ref_idx on public.departure_group_pilgrims (visa_application_reference)
  where visa_application_reference is not null;
create index if not exists dgp_visa_expiry_idx on public.departure_group_pilgrims (visa_expiry_date)
  where visa_expiry_date is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Submission batches — the module's most important capability.
--
-- Membership is the FK on the enrolment row, not a join table: an application
-- belongs to at most one open batch at a time. A resubmission moves it to a
-- new batch; passage through prior batches is history and lives in the event
-- log (C), not here.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.visa_submission_batches (
  id                   uuid primary key default gen_random_uuid(),
  departure_group_id   uuid not null references public.departure_groups (id) on delete cascade,
  batch_reference       text not null,
  visa_type             text,
  sequence_number       integer not null default 1,
  status                 text not null default 'DRAFT'
                          check (status in ('DRAFT', 'SUBMITTED', 'PARTIALLY_RESOLVED', 'CLOSED', 'CANCELLED')),
  owner_id               uuid references auth.users (id) on delete set null,
  owner_name             text,
  submission_deadline    timestamptz,
  submitted_at           timestamptz,
  closed_at              timestamptz,
  notes                  text,
  created_by             uuid references auth.users (id) on delete set null,
  created_by_name        text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (departure_group_id, batch_reference)
);

create index if not exists visa_batches_group_idx on public.visa_submission_batches (departure_group_id, status);
create index if not exists visa_batches_open_idx on public.visa_submission_batches (submission_deadline)
  where status in ('DRAFT', 'SUBMITTED', 'PARTIALLY_RESOLVED');

alter table public.departure_group_pilgrims
  drop constraint if exists departure_group_pilgrims_visa_batch_fkey;
alter table public.departure_group_pilgrims
  add constraint departure_group_pilgrims_visa_batch_fkey
  foreign key (visa_batch_id) references public.visa_submission_batches (id) on delete set null;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists visa_submission_batches_set_updated_at on public.visa_submission_batches;
create trigger visa_submission_batches_set_updated_at
  before update on public.visa_submission_batches
  for each row execute function public.set_updated_at();

alter table public.visa_submission_batches enable row level security;

drop policy if exists visa_submission_batches_select on public.visa_submission_batches;
create policy visa_submission_batches_select on public.visa_submission_batches
  for select to authenticated using (true);

drop policy if exists visa_submission_batches_write on public.visa_submission_batches;
create policy visa_submission_batches_write on public.visa_submission_batches
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- C. The visa audit trail — append-only, mirroring document_review_events.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.visa_application_events (
  id                  uuid primary key default gen_random_uuid(),
  journey_id           uuid not null references public.departure_group_pilgrims (id) on delete cascade,
  departure_group_id   uuid not null references public.departure_groups (id) on delete cascade,
  batch_id             uuid references public.visa_submission_batches (id) on delete set null,
  actor_id             uuid references auth.users (id) on delete set null,
  actor_name           text not null default 'System',
  actor_role           text,
  action                text not null
                         check (action in ('READINESS_CHANGED', 'ASSIGNED', 'BATCH_ADDED', 'BATCH_REMOVED',
                                           'REFERENCE_RECORDED', 'SUBMITTED', 'STATUS_CHECKED', 'MOVED_UNDER_REVIEW',
                                           'REWORK_REQUESTED', 'RESUBMITTED', 'ISSUE_RECORDED', 'ISSUE_VERIFIED',
                                           'ISSUE_AMENDED', 'REJECTED', 'EXPIRY_FLAGGED', 'REMINDER_DRAFTED',
                                           'ESCALATED', 'NOTE_ADDED')),
  from_status          text,
  to_status             text,
  issue_type            text,
  note                  text,
  evidence_path         text,
  created_at            timestamptz not null default now()
);

create index if not exists visa_events_journey_idx on public.visa_application_events (journey_id, created_at desc);
create index if not exists visa_events_group_idx on public.visa_application_events (departure_group_id, created_at desc);

alter table public.visa_application_events enable row level security;

drop policy if exists visa_application_events_select on public.visa_application_events;
create policy visa_application_events_select on public.visa_application_events
  for select to authenticated using (true);

drop policy if exists visa_application_events_insert on public.visa_application_events;
create policy visa_application_events_insert on public.visa_application_events
  for insert to authenticated with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- D. visa_application_rows — the read shape the Visa page consumes.
--
-- The unit is the enrolment (`departure_group_pilgrims.id`), not the person —
-- one person travelling twice has two applications. This is the only place
-- these five tables are joined by hand; nothing else in the module should
-- repeat it.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.visa_application_rows as
select
  e.id                    as journey_id,
  e.departure_group_id,
  e.booking_id,
  e.seat_status,
  e.journey_status,
  e.visa_status,
  e.visa_type,
  e.visa_application_reference,
  e.visa_submitted_at, e.visa_reviewed_at, e.visa_rejected_at, e.visa_rejection_reason,
  e.visa_id, e.visa_issue_note, e.visa_file_path,
  e.visa_issue_date, e.visa_expiry_date, e.visa_valid_until, e.visa_entry_type,
  e.visa_verified_at, e.visa_verified_by_name, e.visa_evidence_source,
  e.visa_assigned_to, e.visa_assigned_to_name, e.visa_assigned_at,
  e.visa_batch_id, e.visa_status_checked_at, e.visa_last_update_at, e.visa_priority_score,
  e.documents_completed, e.documents_required, e.document_completion_percent,
  e.emergency_contact_status,
  e.passport_expiry       as enrolment_passport_expiry,

  p.id                    as pilgrim_id,
  p.reference              as pilgrim_reference,
  p.full_name, p.whatsapp_number, p.passport_number, p.date_of_birth, p.nationality,

  b.booking_reference,
  b.outstanding_balance,

  bt.batch_reference, bt.sequence_number as batch_sequence,
  bt.status as batch_status, bt.submission_deadline, bt.owner_name as batch_owner_name,

  g.id                    as group_id,
  g.group_name, g.group_code, g.journey_type, g.departure_date, g.return_date,
  g.branch, g.group_status, g.visa_owner_name as group_visa_owner_name,

  (select count(*) from public.departure_group_pilgrim_documents d
    where d.pilgrim_id = e.id
      and d.required
      and d.status <> 'VERIFIED' and d.status <> 'NOT_APPLICABLE'
      and d.required_by_stage in ('ON_BOOKING', 'BEFORE_VISA_SUBMISSION'))    as gating_outstanding,
  (select count(*) from public.departure_group_pilgrim_documents d
    where d.pilgrim_id = e.id and d.required and d.status = 'REJECTED')       as rejected_documents

from public.departure_group_pilgrims e
join public.pilgrims                 p  on p.id  = e.pilgrim_id
join public.departure_group_bookings b  on b.id  = e.booking_id
join public.departure_groups         g  on g.id  = e.departure_group_id
left join public.visa_submission_batches bt on bt.id = e.visa_batch_id
where e.seat_status <> 'CANCELLED'
  and g.group_status <> 'CANCELLED';

comment on view public.visa_application_rows is
  'One row per visa application (= one enrolment), joined to the person, booking, batch and group. The Visa Operations page reads this instead of joining five tables itself.';

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Backfills
-- ─────────────────────────────────────────────────────────────────────────────

-- visa_type from the group's journey_type.
update public.departure_group_pilgrims e
set visa_type = case g.journey_type
  when 'UMRAH' then 'Umrah Visa'
  when 'HAJJ'  then 'Hajj Visa'
  else null
end
from public.departure_groups g
where g.id = e.departure_group_id
  and e.visa_type is null;

-- visa_last_update_at from whichever visa timestamp is most recent.
-- `departure_group_pilgrims` has no `created_at` column, so an application
-- with no visa activity yet falls back to now() at backfill time.
update public.departure_group_pilgrims
set visa_last_update_at = coalesce(visa_rejected_at, visa_reviewed_at, visa_submitted_at, now())
where visa_last_update_at is null;

-- Every existing APPROVED visa was recorded by a human under the old
-- one-step flow, so treating it as verified is accurate — leaving it null
-- would show the entire back catalogue as unverified on day one.
update public.departure_group_pilgrims
set visa_verified_at = visa_reviewed_at,
    visa_verified_by_name = 'Migrated (pre-verification workflow)'
where visa_status = 'APPROVED'
  and visa_id is not null
  and visa_verified_at is null;
