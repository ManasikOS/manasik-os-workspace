-- Documents Operations — the agency-wide document queue.
--
-- Every read of `departure_group_pilgrim_documents` before this migration was
-- scoped to one pilgrim or one group. There was no query that answered
-- "every outstanding document across every active group", so the Documents
-- page could not exist without joining four tables by hand on every render.
-- `document_queue_rows` fixes that; everything else here gives a document row
-- an owner, a deadline, an expiry and a place for the AI Document Agent to
-- record what it found.
--
-- Additive only. Safe on a database that already has 20260811090000 and
-- 20260813090000 applied.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. The document row gets an identity, an owner, a deadline and an expiry
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.departure_group_pilgrim_documents
  add column if not exists document_type text not null default 'OTHER'
    check (document_type in ('PASSPORT_BIO','PASSPORT_ADDITIONAL','PASSPORT_PHOTO','NATIONAL_ID',
                             'VISA_COPY','INSURANCE','VACCINATION','MEDICAL','EMERGENCY_CONTACT',
                             'PAYMENT_PROOF','FLIGHT_TICKET','HOTEL_VOUCHER','OTHER')),
  add column if not exists assigned_to        uuid references auth.users (id) on delete set null,
  add column if not exists assigned_to_name   text,
  add column if not exists assigned_at        timestamptz,
  add column if not exists expires_at         date,
  add column if not exists last_activity_at   timestamptz not null default now(),
  add column if not exists priority_score     integer not null default 0,
  add column if not exists ai_analysis_id     uuid,
  add column if not exists ai_verdict         text
    check (ai_verdict is null or ai_verdict in ('PASS','WARNING','BLOCKED','ERROR')),
  add column if not exists ai_confidence      numeric(5,2);

comment on column public.departure_group_pilgrim_documents.document_type is
  'Stable machine key for the requirement, independent of the free-text name a package author typed. Drives both the derivable-document rules and the AI pipeline.';

create index if not exists dgpd_assigned_idx on public.departure_group_pilgrim_documents (assigned_to)
  where status in ('NOT_SUBMITTED','SUBMITTED','REJECTED');
create index if not exists dgpd_due_idx on public.departure_group_pilgrim_documents (due_at)
  where status <> 'VERIFIED' and status <> 'NOT_APPLICABLE';
create index if not exists dgpd_expiry_idx on public.departure_group_pilgrim_documents (expires_at)
  where expires_at is not null;
create index if not exists dgpd_ai_idx on public.departure_group_pilgrim_documents (ai_verdict)
  where ai_verdict in ('WARNING','BLOCKED');

-- ─────────────────────────────────────────────────────────────────────────────
-- B. AI findings — one row per analysis run, never overwritten
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.document_ai_analyses (
  id                 uuid primary key default gen_random_uuid(),
  document_id        uuid not null
                       references public.departure_group_pilgrim_documents (id) on delete cascade,
  file_path          text not null,
  file_checksum      text,
  model_id           text not null,
  pipeline_version   text not null default 'v1',

  status             text not null default 'QUEUED'
                       check (status in ('QUEUED','RUNNING','COMPLETE','FAILED','SKIPPED')),

  detected_type      text,
  type_confidence    numeric(5,2) check (type_confidence between 0 and 100),

  verdict            text not null default 'PENDING'
                       check (verdict in ('PENDING','PASS','WARNING','BLOCKED','ERROR')),
  confidence         numeric(5,2) check (confidence between 0 and 100),
  recommended_action text
                       check (recommended_action is null or recommended_action in
                         ('VERIFY','REQUEST_BETTER_COPY','REJECT','MANUAL_REVIEW','NOT_APPLICABLE')),
  recommendation_reason text,

  extracted          jsonb not null default '{}'::jsonb,
  checks             jsonb not null default '[]'::jsonb,
  drafted_message    text,

  input_tokens       integer,
  output_tokens      integer,
  error_message      text,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz
);

comment on table public.document_ai_analyses is
  'One row per AI analysis run against one uploaded file. Immutable — a re-upload writes a new row rather than overwriting the old verdict, so history and duplicate detection both work.';

create index if not exists document_ai_analyses_doc_idx
  on public.document_ai_analyses (document_id, created_at desc);
create index if not exists document_ai_analyses_open_idx
  on public.document_ai_analyses (verdict, confidence)
  where status = 'COMPLETE' and verdict in ('WARNING','BLOCKED');
create index if not exists document_ai_analyses_checksum_idx
  on public.document_ai_analyses (file_checksum) where file_checksum is not null;

alter table public.departure_group_pilgrim_documents
  drop constraint if exists departure_group_pilgrim_documents_ai_analysis_fk;
alter table public.departure_group_pilgrim_documents
  add constraint departure_group_pilgrim_documents_ai_analysis_fk
    foreign key (ai_analysis_id) references public.document_ai_analyses (id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Reviews, overrides and rework — append-only audit trail
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.document_review_events (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null
                    references public.departure_group_pilgrim_documents (id) on delete cascade,
  actor_id        uuid references auth.users (id) on delete set null,
  actor_name      text not null default 'System',
  actor_role      text,
  action          text not null
                    check (action in ('REQUESTED','UPLOADED','AI_ANALYSED','ASSIGNED','DRAFT_SAVED',
                                      'VERIFIED','REJECTED','REWORK_REQUESTED','WAIVED',
                                      'REMINDER_SENT','AI_OVERRIDDEN','EXPIRY_FLAGGED')),
  from_status     text,
  to_status       text,
  reason_code     text,
  note            text,
  overrode_ai_analysis_id uuid references public.document_ai_analyses (id) on delete set null,
  override_reason text,
  created_at      timestamptz not null default now()
);

comment on table public.document_review_events is
  'Append-only. Every staff action on a document — including every time a staff decision overrides an AI finding — is logged here and never edited.';

create index if not exists document_review_events_doc_idx
  on public.document_review_events (document_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- D. RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.document_ai_analyses enable row level security;
drop policy if exists "staff read document_ai_analyses" on public.document_ai_analyses;
drop policy if exists "staff write document_ai_analyses" on public.document_ai_analyses;
create policy "staff read document_ai_analyses" on public.document_ai_analyses
  for select to authenticated using (true);
create policy "staff write document_ai_analyses" on public.document_ai_analyses
  for all to authenticated using (true) with check (true);

alter table public.document_review_events enable row level security;
drop policy if exists "staff read document_review_events" on public.document_review_events;
drop policy if exists "staff insert document_review_events" on public.document_review_events;
create policy "staff read document_review_events" on public.document_review_events
  for select to authenticated using (true);
create policy "staff insert document_review_events" on public.document_review_events
  for insert to authenticated with check (true);
-- No update, no delete policy: immutable by omission, same as pilgrim_activity_logs.

-- ─────────────────────────────────────────────────────────────────────────────
-- E. document_queue_rows — the read shape the Documents module consumes
--
-- One row per document requirement per pilgrim, joined to the person and the
-- group it blocks. `d.pilgrim_id` on the base table references the
-- *enrolment* (`departure_group_pilgrims.id`), not the person — the person is
-- one hop further through `pilgrims`. This view is the one place that join is
-- written; nothing else in the module should join these tables by hand.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.document_queue_rows as
select
  d.id                    as document_id,
  d.departure_group_id,
  d.requirement_id, d.name, d.category, d.document_type,
  d.required, d.required_by_stage, d.verified_by_role,
  d.status, d.file_path, d.file_name, d.file_size_bytes, d.rejection_reason, d.notes,
  d.submitted_at, d.verified_at, d.verified_by_name,
  d.due_at, d.expires_at, d.visible_in_portal, d.last_activity_at, d.priority_score,
  d.assigned_to, d.assigned_to_name,
  d.ai_verdict, d.ai_confidence, d.ai_analysis_id,

  p.id                    as pilgrim_id,
  p.reference             as pilgrim_reference,
  p.full_name, p.whatsapp_number, p.passport_number, p.passport_expiry,

  e.id                    as journey_id,
  e.seat_status, e.visa_status, e.journey_status,
  e.documents_completed, e.documents_required, e.document_completion_percent,

  g.id                    as group_id,
  g.group_name, g.group_code, g.journey_type, g.departure_date, g.return_date,
  g.branch, g.group_status
from public.departure_group_pilgrim_documents d
join public.departure_group_pilgrims e on e.id = d.pilgrim_id
join public.pilgrims               p on p.id = e.pilgrim_id
join public.departure_groups       g on g.id = d.departure_group_id
where e.seat_status <> 'CANCELLED'
  and g.group_status <> 'CANCELLED';

comment on view public.document_queue_rows is
  'One row per document requirement per pilgrim, joined to the person and the group it blocks. The Documents Operations page reads this instead of joining four tables itself.';

-- ─────────────────────────────────────────────────────────────────────────────
-- F. Backfill: document_type from the requirement name
--
-- Uses the same keyword matches `derivableRuleFor()` and the package builder's
-- default catalogue already imply, so existing rows land on a sensible type
-- rather than the OTHER default.
-- ─────────────────────────────────────────────────────────────────────────────
update public.departure_group_pilgrim_documents
set document_type = case
  when name ilike '%passport%valid%' or name ilike '%valid%6%month%'      then 'PASSPORT_ADDITIONAL'
  when name ilike '%passport%'                                           then 'PASSPORT_BIO'
  when name ilike '%photo%'                                              then 'PASSPORT_PHOTO'
  when name ilike '%nic%' or name ilike '%national id%' or name ilike '%identity card%' then 'NATIONAL_ID'
  when name ilike '%visa%'                                               then 'VISA_COPY'
  when name ilike '%insurance%'                                          then 'INSURANCE'
  when name ilike '%vaccin%' or name ilike '%meningitis%'                then 'VACCINATION'
  when name ilike '%medical%'                                            then 'MEDICAL'
  when name ilike '%emergency%contact%' or name ilike '%next of kin%'    then 'EMERGENCY_CONTACT'
  when name ilike '%deposit%' or name ilike '%payment%'                  then 'PAYMENT_PROOF'
  when name ilike '%ticket%'                                             then 'FLIGHT_TICKET'
  when name ilike '%hotel%voucher%'                                      then 'HOTEL_VOUCHER'
  else 'OTHER'
end
where document_type = 'OTHER';

-- ─────────────────────────────────────────────────────────────────────────────
-- G. Backfill: due_at from required_by_stage against the group's departure date
--
-- Mirrors the offsets in `lib/data/documents-copy.ts` — kept in application
-- code as the single place an agency can retune them, but the initial
-- population happens once, here, for every row created before this migration.
-- ─────────────────────────────────────────────────────────────────────────────
update public.departure_group_pilgrim_documents d
set due_at = case d.required_by_stage
  when 'ON_BOOKING'                 then coalesce(b.created_at, d.created_at) + interval '3 days'
  when 'BEFORE_VISA_SUBMISSION'     then (g.departure_date::timestamptz - interval '21 days')
  when 'BEFORE_FINAL_PAYMENT'       then (g.departure_date::timestamptz - interval '14 days')
  when 'BEFORE_DEPARTURE'           then (g.departure_date::timestamptz - interval '7 days')
  else d.due_at
end
from public.departure_groups g,
     public.departure_group_bookings b
where d.departure_group_id = g.id
  and b.id = (
    select e.booking_id from public.departure_group_pilgrims e where e.id = d.pilgrim_id
  )
  and d.due_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- H. Backfill: expiry for passport-linked rows, and last_activity_at for all
-- ─────────────────────────────────────────────────────────────────────────────
update public.departure_group_pilgrim_documents d
set expires_at = e.passport_expiry
from public.departure_group_pilgrims e
where e.id = d.pilgrim_id
  and d.document_type in ('PASSPORT_BIO', 'PASSPORT_ADDITIONAL')
  and d.expires_at is null
  and e.passport_expiry is not null;

update public.departure_group_pilgrim_documents
set last_activity_at = coalesce(verified_at, submitted_at, created_at)
where last_activity_at = created_at;
