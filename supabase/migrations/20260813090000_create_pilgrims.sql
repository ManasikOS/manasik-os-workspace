-- Pilgrims: the individual-traveller master record.
--
-- Lead (interested person) -> Booking (commercial reservation)
--   -> Pilgrim (individual traveller) -> Departure Group (actual journey)
--
-- `departure_group_pilgrims` already carries every journey-scoped fact (seat,
-- flight, room, visa, documents, payment status) but no *person* — its
-- `pilgrim_id` column has been nullable and unconstrained since it was created
-- ("FK added once the shared pilgrims table exists", see
-- 20260809090000_create_departure_groups.sql:331). This migration adds that
-- table, backfills one `pilgrims` row per existing enrolment, then constrains
-- the FK — turning `departure_group_pilgrims` into the enrolment/journey row
-- it always was, without touching its seven referencing tables.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. pilgrims — the person, stable across every journey they ever take
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pilgrims (
  id                     uuid primary key default gen_random_uuid(),
  reference              text not null unique,              -- PL-YYYY-NNNN

  full_name              text not null,
  preferred_name         text,
  gender                 text not null default 'MALE'
                           check (gender in ('MALE', 'FEMALE')),
  date_of_birth          date,
  nationality            text not null default 'Sri Lankan',
  national_id            text,
  country_of_residence   text not null default 'Sri Lanka',
  city                   text not null default '',
  preferred_language     text not null default 'English',
  photo_path             text,                              -- pilgrim-documents bucket key

  whatsapp_number        text not null default '',
  mobile_number          text,
  email                  text,
  preferred_channel      text not null default 'WHATSAPP'
                           check (preferred_channel in ('WHATSAPP', 'CALL', 'EMAIL', 'SMS', 'IN_PERSON')),

  passport_number        text,
  passport_expiry        date,
  passport_issue_country text,

  emergency_contact_name         text,
  emergency_contact_relationship text,
  emergency_contact_phone        text,
  emergency_contact_alt_phone    text,

  origin_lead_id         uuid references public.leads (id) on delete set null,
  portal_user_id         uuid references auth.users (id) on delete set null,
  portal_invited_at      timestamptz,

  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.pilgrims is
  'The individual traveller, independent of any one journey. departure_group_pilgrims is the per-journey enrolment row that points back here.';

create unique index if not exists pilgrims_passport_idx
  on public.pilgrims (upper(passport_number)) where passport_number is not null;
create index if not exists pilgrims_whatsapp_idx on public.pilgrims (whatsapp_number);
create index if not exists pilgrims_name_idx     on public.pilgrims (lower(full_name));
create index if not exists pilgrims_reference_idx on public.pilgrims (reference);

-- ─────────────────────────────────────────────────────────────────────────────
-- B. pilgrim_medical_records — optional, access-controlled, one row per person
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pilgrim_medical_records (
  pilgrim_id             uuid primary key references public.pilgrims (id) on delete cascade,
  mobility_support       boolean not null default false,
  wheelchair_required    boolean not null default false,
  dietary_requirement    text,
  allergy_information    text,
  medication_note        text,
  accessibility_note     text,
  special_assistance     text,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users (id) on delete set null
);

comment on table public.pilgrim_medical_records is
  'Optional. Never exposed broadly — guides see only the practical instruction, never the underlying note. Every read is audited via pilgrim_activity_logs.is_sensitive_access.';

-- ─────────────────────────────────────────────────────────────────────────────
-- C. pilgrim_support_requests
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pilgrim_support_requests (
  id                 uuid primary key default gen_random_uuid(),
  pilgrim_id         uuid not null references public.pilgrims (id) on delete cascade,
  departure_group_id uuid references public.departure_groups (id) on delete set null,
  title              text not null,
  detail             text,
  category           text not null default 'OTHER'
                       check (category in ('MOBILITY', 'MEDICAL', 'DIETARY', 'FLIGHT', 'ROOMING',
                                           'DOCUMENT', 'PAYMENT', 'OTHER')),
  priority           text not null default 'NORMAL'
                       check (priority in ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  status             text not null default 'OPEN'
                       check (status in ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED')),
  assigned_role      text not null default 'OPERATIONS'
                       check (assigned_role in ('ADMIN', 'OPERATIONS', 'VISA', 'FINANCE', 'GUIDE', 'MARKETING')),
  raised_by_portal   boolean not null default false,
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz
);

create index if not exists pilgrim_support_requests_pilgrim_idx
  on public.pilgrim_support_requests (pilgrim_id, status);
create index if not exists pilgrim_support_requests_open_idx
  on public.pilgrim_support_requests (status) where status in ('OPEN', 'IN_PROGRESS');

-- ─────────────────────────────────────────────────────────────────────────────
-- D. pilgrim_activity_logs — append-only. No update/delete policy is ever
--    granted (see RLS below), which is what makes the timeline immutable at
--    the database level rather than by convention.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pilgrim_activity_logs (
  id                  uuid primary key default gen_random_uuid(),
  pilgrim_id          uuid not null references public.pilgrims (id) on delete cascade,
  departure_group_id  uuid references public.departure_groups (id) on delete set null,
  actor_id            uuid references auth.users (id) on delete set null,
  actor_name_snapshot text not null default 'System',
  actor_role          text,
  action_type         text not null default '',
  entity_type         text not null default 'PILGRIM'
                        check (entity_type in ('PILGRIM', 'DOCUMENT', 'VISA', 'PAYMENT', 'ROOM',
                                               'FLIGHT', 'SUPPORT', 'MEDICAL', 'PORTAL', 'NOTE', 'STATUS')),
  entity_id           uuid,
  before_value        jsonb,
  after_value          jsonb,
  message             text not null default '',
  is_system           boolean not null default false,
  -- Set true when the row records someone *viewing* a sensitive field
  -- (medical, passport) rather than editing it — the half of "who viewed or
  -- edited" that is normally forgotten.
  is_sensitive_access boolean not null default false,
  created_at          timestamptz not null default now()
);

comment on table public.pilgrim_activity_logs is
  'Immutable, append-only per-person timeline. Group-scoped activity stays in departure_group_activity_logs; this is what lets a person''s history survive across journeys.';

create index if not exists pilgrim_activity_idx
  on public.pilgrim_activity_logs (pilgrim_id, created_at desc);
create index if not exists pilgrim_activity_group_idx
  on public.pilgrim_activity_logs (departure_group_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- E. pilgrim_payment_milestones — the Payments tab's line items
--
-- departure_group_bookings only carries running totals for the whole booking;
-- a family of four sharing one booking needs a per-person breakdown to render
-- "Booking Deposit — Paid · 10 July" against *this* traveller. Expanded from
-- the group's payment_schedule_snapshot at booking time.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pilgrim_payment_milestones (
  id             uuid primary key default gen_random_uuid(),
  pilgrim_id     uuid not null references public.pilgrims (id) on delete cascade,
  booking_id     uuid not null references public.departure_group_bookings (id) on delete cascade,
  label          text not null,
  sequence       integer not null default 0,
  amount         numeric(14, 2) not null default 0 check (amount >= 0),
  due_at         timestamptz,
  paid_amount    numeric(14, 2) not null default 0 check (paid_amount >= 0),
  paid_at        timestamptz,
  proof_path     text,
  recorded_by    uuid references auth.users (id) on delete set null,
  recorded_by_name text,
  note           text,
  created_at     timestamptz not null default now(),

  constraint pilgrim_payment_milestones_seq unique (pilgrim_id, booking_id, sequence)
);

create index if not exists pilgrim_payment_milestones_pilgrim_idx
  on public.pilgrim_payment_milestones (pilgrim_id);
create index if not exists pilgrim_payment_milestones_booking_idx
  on public.pilgrim_payment_milestones (booking_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- F. Backfill: give every existing enrolment a person
--
-- One `pilgrims` row per `departure_group_pilgrims` row with no person yet.
-- References are numbered by insertion order within this backfill; the
-- application's `nextPilgrimReference()` takes over for everything after.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  rec record;
  n integer := 0;
  new_pilgrim_id uuid;
begin
  for rec in
    select * from public.departure_group_pilgrims where pilgrim_id is null order by id
  loop
    n := n + 1;
    insert into public.pilgrims (
      reference, full_name, whatsapp_number, mobile_number, passport_number,
      passport_expiry, passport_issue_country, date_of_birth,
      emergency_contact_name, emergency_contact_phone, emergency_contact_relationship
    ) values (
      'PL-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 4, '0'),
      nullif(rec.full_name_snapshot, ''),
      coalesce(rec.phone_snapshot, ''),
      rec.phone_snapshot,
      rec.passport_number_snapshot,
      rec.passport_expiry,
      rec.passport_issue_country,
      rec.date_of_birth,
      rec.emergency_contact_name,
      rec.emergency_contact_phone,
      rec.emergency_contact_relationship
    )
    returning id into new_pilgrim_id;

    update public.departure_group_pilgrims
      set pilgrim_id = new_pilgrim_id
      where id = rec.id;
  end loop;
end $$;

-- Now that every row has a person, the FK the original migration anticipated:
alter table public.departure_group_pilgrims
  drop constraint if exists departure_group_pilgrims_pilgrim_fk;
alter table public.departure_group_pilgrims
  add constraint departure_group_pilgrims_pilgrim_fk
    foreign key (pilgrim_id) references public.pilgrims (id) on delete restrict;
-- `restrict`, not `cascade`: a group being deleted must never erase a person.
alter table public.departure_group_pilgrims
  alter column pilgrim_id set not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- G. Journey-lifecycle status + replacement/move audit trail on the enrolment row
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.departure_group_pilgrims
  add column if not exists journey_status text not null default 'PENDING_DETAILS'
    check (journey_status in ('PENDING_DETAILS', 'ONBOARDING', 'DOCUMENTS_PENDING', 'VISA_PROCESSING',
                              'PAYMENT_PENDING', 'PREPARING', 'READY_TO_TRAVEL', 'TRAVELLED',
                              'COMPLETED', 'CANCELLED')),
  add column if not exists relationship_to_primary text not null default 'SELF'
    check (relationship_to_primary in ('SELF', 'SPOUSE', 'CHILD', 'PARENT', 'SIBLING', 'OTHER')),
  add column if not exists replaced_by_pilgrim_id uuid references public.pilgrims (id) on delete set null,
  add column if not exists replaces_pilgrim_id    uuid references public.pilgrims (id) on delete set null,
  add column if not exists cancellation_reason    text,
  add column if not exists cancelled_at           timestamptz,
  add column if not exists moved_from_group_id    uuid references public.departure_groups (id) on delete set null;

create index if not exists departure_group_pilgrims_journey_status_idx
  on public.departure_group_pilgrims (journey_status);

-- Portal visibility per document, and the due date the spec's checklist row needs
alter table public.departure_group_pilgrim_documents
  add column if not exists visible_in_portal boolean not null default true,
  add column if not exists due_at             timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- H. pilgrim_journey_rows — the read shape the Pilgrims module consumes
--
-- One row per enrolment (a person travelling twice appears twice, once per
-- journey), joined with the person, booking and group facts a list/profile
-- screen needs. Nothing here is written directly — every field is owned by an
-- underlying table.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.pilgrim_journey_rows as
select
  p.id                    as pilgrim_id,
  p.reference             as pilgrim_reference,
  p.full_name,
  p.preferred_name,
  p.gender,
  p.city,
  p.photo_path,
  p.whatsapp_number,
  p.mobile_number,
  p.email,
  p.passport_number,
  p.passport_expiry,
  p.national_id,
  p.date_of_birth,
  p.nationality,

  e.id                    as journey_id,
  e.journey_status,
  e.seat_status,
  e.flight_status,
  e.visa_status,
  e.visa_submitted_at,
  e.payment_status,
  e.room_assignment_status,
  e.room_id,
  e.documents_completed,
  e.documents_required,
  e.document_completion_percent,
  e.relationship_to_primary,
  e.emergency_contact_status,
  e.emergency_contact_name,
  e.emergency_contact_phone,
  e.emergency_contact_relationship,

  b.id                    as booking_id,
  b.booking_reference,
  b.primary_contact_name,
  b.primary_contact_phone,
  b.total_booking_value,
  b.amount_paid,
  b.outstanding_balance,
  b.next_due_at,

  g.id                    as departure_group_id,
  g.group_name,
  g.group_code,
  g.journey_type,
  g.departure_date,
  g.return_date,
  g.branch,
  g.primary_guide_name

from public.pilgrims p
join public.departure_group_pilgrims e on e.pilgrim_id = p.id
join public.departure_group_bookings  b on b.id = e.booking_id
join public.departure_groups          g on g.id = e.departure_group_id;

comment on view public.pilgrim_journey_rows is
  'One row per pilgrim per journey. The Pilgrims list and profile read this instead of joining the four underlying tables themselves.';

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at maintenance — reuses the trigger function from the packages migration
-- ─────────────────────────────────────────────────────────────────────────────
drop trigger if exists pilgrims_set_updated_at on public.pilgrims;
create trigger pilgrims_set_updated_at
  before update on public.pilgrims
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
--
-- Same posture as every other module: authenticated staff read/write, with
-- column/row-level nuance enforced in the application layer
-- (`lib/access/pilgrims-access.ts`) until real role claims exist. Activity is
-- the one deliberate exception — insert and select only, so immutability is a
-- database guarantee, not a convention.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  tbl text;
  tables text[] := array[
    'pilgrims',
    'pilgrim_medical_records',
    'pilgrim_support_requests',
    'pilgrim_payment_milestones'
  ];
begin
  foreach tbl in array tables loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists "staff read %s"   on public.%I', tbl, tbl);
    execute format('drop policy if exists "staff write %s"  on public.%I', tbl, tbl);
    execute format(
      'create policy "staff read %s" on public.%I for select to authenticated using (true)',
      tbl, tbl
    );
    execute format(
      'create policy "staff write %s" on public.%I for all to authenticated using (true) with check (true)',
      tbl, tbl
    );
  end loop;
end $$;

alter table public.pilgrim_activity_logs enable row level security;
drop policy if exists "staff read pilgrim_activity_logs"   on public.pilgrim_activity_logs;
drop policy if exists "staff insert pilgrim_activity_logs" on public.pilgrim_activity_logs;
create policy "staff read pilgrim_activity_logs"
  on public.pilgrim_activity_logs for select to authenticated using (true);
create policy "staff insert pilgrim_activity_logs"
  on public.pilgrim_activity_logs for insert to authenticated with check (true);
-- Deliberately no update/delete policy: the timeline cannot be edited or erased.
