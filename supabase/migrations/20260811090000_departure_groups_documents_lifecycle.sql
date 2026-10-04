-- Departure Groups — real document records, a visa stage machine, derived
-- readiness and a complete group lifecycle.
--
-- Every statement is additive or a widening, so this is safe on a database that
-- already has 20260809090000 and 20260810090000 applied, and safe to run twice.
--
-- What this migration corrects, in the order it appears below:
--
--   1. Traveller documents existed only as two integers on the pilgrim row
--      (`documents_completed` / `documents_required`). The package template
--      defines each requirement by name, category, the stage it is due at and
--      the role that verifies it — all of which was discarded except the array
--      length. "4 / 8 documents" was therefore unresolvable: nothing recorded
--      *which* four, who verified them, or why one was sent back. One row per
--      pilgrim per requirement restores that, and the two counters become
--      derived caches of it.
--   2. `Passport Validity (Minimum 6 Months)` is a required document on every
--      Umrah template, but the pilgrim row carried a passport *number* and no
--      expiry date, so the check could never actually be performed.
--   3. `Emergency Contact & Next of Kin` is likewise a required document, and
--      `departure_group_pilgrims.emergency_contact_status` existed to track it
--      — but with nowhere to put the contact, no code ever wrote the column and
--      every pilgrim read "Missing" forever.
--   4. Visa states `DOCUMENTS_PENDING`, `UNDER_REVIEW` and `REJECTED` were
--      declared and rendered but unreachable: no code path assigned them, and
--      there was no way to record a refusal at all. The columns a refusal needs
--      are added here; the transitions are in `departure-groups-documents.ts`.
--   5. Readiness items were pure manual checkboxes, so the Readiness tab could
--      report "Makkah Hotel Booking Confirmed ✅ / 100% ready" while the
--      Overview derived "Makkah hotel confirmation is missing" from the actual
--      accommodation row. `auto_source` marks the items that are facts about
--      other rows, so they are computed rather than asserted.
--   6. `group_status` has seven values but only `READY_TO_DEPART` and
--      `CANCELLED` were ever written — a group could never depart or complete.
--      The timestamps the remaining transitions need are added here.
--   7. Seat holds recorded an expiry that nothing ever swept, so held seats
--      leaked capacity permanently. A held booking also had no path to
--      `CONFIRMED`, and a waitlisted one no path to a released seat.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Per-pilgrim document records
--
-- `requirement_id` points into the group snapshot's
-- `traveller_requirements_snapshot` array rather than a table, matching how
-- transport and readiness already reference their template origin. The name,
-- category, stage and verifying role are copied onto the row so the checklist
-- stays printable and auditable even if the snapshot is later unavailable.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_group_pilgrim_documents (
  id                  uuid primary key default gen_random_uuid(),
  departure_group_id  uuid not null
                        references public.departure_groups (id) on delete cascade,
  pilgrim_id          uuid not null
                        references public.departure_group_pilgrims (id) on delete cascade,
  -- Points into the snapshot's traveller_requirements array, not a table.
  requirement_id      text not null,
  name                text not null default '',
  category            text not null default 'Other',
  required            boolean not null default true,
  -- Which gate this document blocks. Parsed from the template's free-text
  -- `requiredByStage` at copy time so the gate is a value, not a string match.
  required_by_stage   text not null default 'ON_BOOKING'
                        check (required_by_stage in ('ON_BOOKING', 'BEFORE_VISA_SUBMISSION',
                                                     'BEFORE_FINAL_PAYMENT', 'BEFORE_DEPARTURE')),
  verified_by_role    text not null default 'OPERATIONS'
                        check (verified_by_role in ('ADMIN', 'OPERATIONS', 'VISA',
                                                    'FINANCE', 'GUIDE', 'MARKETING')),
  status              text not null default 'NOT_SUBMITTED'
                        check (status in ('NOT_SUBMITTED', 'SUBMITTED', 'VERIFIED',
                                          'REJECTED', 'NOT_APPLICABLE')),
  -- Object path inside the `pilgrim-documents` storage bucket. Never a public
  -- URL: these are passports and NICs, read through a signed URL on demand.
  file_path           text,
  file_name           text,
  file_size_bytes     integer check (file_size_bytes is null or file_size_bytes >= 0),
  rejection_reason    text,
  submitted_at        timestamptz,
  verified_at         timestamptz,
  verified_by         uuid references auth.users (id) on delete set null,
  verified_by_name    text,
  notes               text,
  created_at          timestamptz not null default now(),

  -- One row per requirement per pilgrim; re-copying a template is idempotent.
  constraint departure_group_pilgrim_documents_unique
    unique (pilgrim_id, requirement_id),
  -- A refusal without a reason is not actionable by the traveller chasing it.
  constraint departure_group_pilgrim_documents_rejection_has_reason
    check (status <> 'REJECTED' or coalesce(btrim(rejection_reason), '') <> '')
);

comment on table public.departure_group_pilgrim_documents is
  'One row per pilgrim per traveller requirement copied from the group snapshot. The pilgrim''s documents_completed / documents_required counters are derived from these rows.';

create index if not exists departure_group_pilgrim_documents_pilgrim_idx
  on public.departure_group_pilgrim_documents (pilgrim_id);
create index if not exists departure_group_pilgrim_documents_group_idx
  on public.departure_group_pilgrim_documents (departure_group_id, status);
-- The Visa team's working queue: what is outstanding, by the gate it blocks.
create index if not exists departure_group_pilgrim_documents_stage_idx
  on public.departure_group_pilgrim_documents (departure_group_id, required_by_stage)
  where status in ('NOT_SUBMITTED', 'SUBMITTED', 'REJECTED');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 & 3. The traveller facts the documents are checked against
--
-- Passport expiry makes the six-month validity rule computable instead of a
-- checkbox someone ticks from memory; the emergency contact columns give
-- `emergency_contact_status` something to be derived from.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.departure_group_pilgrims
  add column if not exists passport_expiry               date,
  add column if not exists passport_issue_country        text,
  add column if not exists date_of_birth                 date,
  add column if not exists emergency_contact_name        text,
  add column if not exists emergency_contact_phone       text,
  add column if not exists emergency_contact_relationship text;

comment on column public.departure_group_pilgrims.passport_expiry is
  'Required to evaluate the six-month validity rule against the group''s return date.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. What a visa decision needs to record
--
-- `visa_issue_note` already existed but carried both "here is why it was sent
-- back" and "here is a note about the issued visa". A refusal is a distinct
-- event with its own timestamp and reason.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.departure_group_pilgrims
  add column if not exists visa_reviewed_at    timestamptz,
  add column if not exists visa_rejected_at    timestamptz,
  add column if not exists visa_rejection_reason text,
  add column if not exists visa_file_path      text,
  add column if not exists visa_expiry_date    date;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Readiness items that are facts about other rows, not assertions
--
-- `auto_source` names the rule that computes the item. A null means the item is
-- genuinely manual (catering confirmed, briefing held) and keeps the old
-- behaviour exactly.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.departure_group_readiness_items
  add column if not exists auto_source text
    check (auto_source is null or auto_source in (
      'FLIGHT_OUTBOUND_CONFIRMED',
      'FLIGHT_TICKETED',
      'HOTEL_MAKKAH_CONFIRMED',
      'HOTEL_MADINAH_CONFIRMED',
      'TRANSPORT_ARRIVAL_CONFIRMED',
      'TRANSPORT_INTERCITY_CONFIRMED',
      'TRANSPORT_DEPARTURE_CONFIRMED',
      'PAYMENTS_COLLECTED_IN_FULL',
      'DOCUMENTS_ALL_VERIFIED',
      'VISAS_ALL_APPROVED',
      'ROOMING_COMPLETE',
      'GUIDE_ASSIGNED',
      'MANIFEST_READY'
    ));

comment on column public.departure_group_readiness_items.auto_source is
  'When set, the item''s status is derived from live operational rows on every read and cannot be ticked by hand. Null means a genuinely manual item.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. The rest of the group lifecycle
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.departure_groups
  add column if not exists ready_at            timestamptz,
  add column if not exists departed_at         timestamptz,
  add column if not exists completed_at        timestamptz,
  add column if not exists closed_at           timestamptz,
  add column if not exists cancelled_at        timestamptz,
  add column if not exists cancellation_reason text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Seat holds
--
-- `hold_released_at` records that the sweeper — not a person — took the seats
-- back, so a traveller who reappears can be told what happened and when.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.departure_group_bookings
  add column if not exists hold_released_at  timestamptz,
  add column if not exists confirmed_at      timestamptz,
  add column if not exists waitlist_position integer
    check (waitlist_position is null or waitlist_position > 0);

-- Promoting the longest-waiting booking first requires a stable order.
create index if not exists departure_group_bookings_waitlist_idx
  on public.departure_group_bookings (departure_group_id, waitlist_position)
  where booking_status = 'WAITLIST';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Private storage for traveller documents
--
-- Passports, NICs and vaccination certificates are traveller PII. The bucket is
-- private; the application hands out short-lived signed URLs to roles with
-- `viewSensitiveTravellerData`. Objects are keyed
-- `<departure_group_id>/<pilgrim_id>/<document_id>-<filename>`.
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pilgrim-documents',
  'pilgrim-documents',
  false,
  10 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Same posture as the module's tables: any signed-in staff member may work the
-- bucket, and which roles may actually see a traveller's file is enforced in
-- the application layer by `lib/access/departure-groups-access.ts`.
do $$
declare
  policy_name text;
  policy_names text[] := array[
    'staff read pilgrim documents',
    'staff upload pilgrim documents',
    'staff update pilgrim documents',
    'staff delete pilgrim documents'
  ];
begin
  foreach policy_name in array policy_names loop
    execute format('drop policy if exists %I on storage.objects', policy_name);
  end loop;

  execute $p$
    create policy "staff read pilgrim documents" on storage.objects
      for select to authenticated using (bucket_id = 'pilgrim-documents')
  $p$;
  execute $p$
    create policy "staff upload pilgrim documents" on storage.objects
      for insert to authenticated with check (bucket_id = 'pilgrim-documents')
  $p$;
  execute $p$
    create policy "staff update pilgrim documents" on storage.objects
      for update to authenticated
      using (bucket_id = 'pilgrim-documents')
      with check (bucket_id = 'pilgrim-documents')
  $p$;
  execute $p$
    create policy "staff delete pilgrim documents" on storage.objects
      for delete to authenticated using (bucket_id = 'pilgrim-documents')
  $p$;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Row Level Security for the new table
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.departure_group_pilgrim_documents enable row level security;

drop policy if exists "staff read departure_group_pilgrim_documents"
  on public.departure_group_pilgrim_documents;
drop policy if exists "staff write departure_group_pilgrim_documents"
  on public.departure_group_pilgrim_documents;

create policy "staff read departure_group_pilgrim_documents"
  on public.departure_group_pilgrim_documents
  for select to authenticated using (true);

create policy "staff write departure_group_pilgrim_documents"
  on public.departure_group_pilgrim_documents
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Backfill: give existing pilgrims their document rows
--
-- Rows are expanded from each group's frozen snapshot, so a pilgrim booked
-- before this migration ends up with exactly the checklist their group was
-- sold with. The old `documents_completed` count carried no identity, so it
-- cannot say *which* documents were done — the first N by template order are
-- marked verified, which reproduces the count the operator has been looking at
-- without inventing verification evidence that was never captured.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.departure_group_pilgrim_documents (
  departure_group_id, pilgrim_id, requirement_id, name, category, required,
  required_by_stage, verified_by_role, status, verified_at, notes
)
select
  p.departure_group_id,
  p.id,
  coalesce(nullif(req.value ->> 'id', ''), 'req-' || req.ordinality::text),
  coalesce(req.value ->> 'name', 'Requirement ' || req.ordinality::text),
  coalesce(nullif(req.value ->> 'category', ''), 'Other'),
  coalesce((req.value ->> 'required')::boolean, true),
  case
    when req.value ->> 'required_by_stage' ilike '%visa%'   then 'BEFORE_VISA_SUBMISSION'
    when req.value ->> 'required_by_stage' ilike '%final%'  then 'BEFORE_FINAL_PAYMENT'
    when req.value ->> 'required_by_stage' ilike '%depart%' then 'BEFORE_DEPARTURE'
    else 'ON_BOOKING'
  end,
  case upper(coalesce(req.value ->> 'verified_by_role', 'OPERATIONS'))
    when 'ADMIN'     then 'ADMIN'
    when 'VISA'      then 'VISA'
    when 'FINANCE'   then 'FINANCE'
    when 'GUIDE'     then 'GUIDE'
    when 'MARKETING' then 'MARKETING'
    else 'OPERATIONS'
  end,
  case when req.ordinality <= p.documents_completed then 'VERIFIED' else 'NOT_SUBMITTED' end,
  case when req.ordinality <= p.documents_completed then now() else null end,
  case
    when req.ordinality <= p.documents_completed
    then 'Carried over from the pre-migration document count; no per-document evidence was captured.'
    else null
  end
from public.departure_group_pilgrims p
join public.departure_group_package_snapshots s
  on s.departure_group_id = p.departure_group_id
cross join lateral jsonb_array_elements(s.traveller_requirements_snapshot)
  with ordinality as req(value, ordinality)
on conflict (pilgrim_id, requirement_id) do nothing;

-- Re-derive the counters from the rows that now exist, so the cache and its
-- source agree from the first read.
update public.departure_group_pilgrims p
set
  documents_required = d.required_count,
  documents_completed = d.verified_count,
  document_completion_percent =
    case when d.required_count = 0 then 100
         else round((d.verified_count::numeric / d.required_count) * 100)::int
    end
from (
  select
    pilgrim_id,
    count(*) filter (where required and status <> 'NOT_APPLICABLE') as required_count,
    count(*) filter (where required and status = 'VERIFIED')        as verified_count
  from public.departure_group_pilgrim_documents
  group by pilgrim_id
) d
where d.pilgrim_id = p.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Backfill: tag the readiness items that are derivable
--
-- Matched on the template labels the checklist ships with. An item whose label
-- was edited simply stays manual, which is the safe direction.
-- ─────────────────────────────────────────────────────────────────────────────
update public.departure_group_readiness_items
set auto_source = case
  when label ilike '%flight route confirmed%'      then 'FLIGHT_OUTBOUND_CONFIRMED'
  when label ilike '%ticket pnr%'                  then 'FLIGHT_TICKETED'
  when label ilike '%makkah hotel%'                then 'HOTEL_MAKKAH_CONFIRMED'
  when label ilike '%madinah hotel%'               then 'HOTEL_MADINAH_CONFIRMED'
  when label ilike '%airport arrival transport%'   then 'TRANSPORT_ARRIVAL_CONFIRMED'
  when label ilike '%intercity transport%'         then 'TRANSPORT_INTERCITY_CONFIRMED'
  when label ilike '%airport departure transport%' then 'TRANSPORT_DEPARTURE_CONFIRMED'
  when label ilike '%payment threshold%'           then 'PAYMENTS_COLLECTED_IN_FULL'
  when label ilike '%passport & docs verified%'    then 'DOCUMENTS_ALL_VERIFIED'
  when label ilike '%visa%approved%'               then 'VISAS_ALL_APPROVED'
  when label ilike '%rooming%'                     then 'ROOMING_COMPLETE'
  when label ilike '%guide assigned%'              then 'GUIDE_ASSIGNED'
  when label ilike '%mutawwif%'                    then 'GUIDE_ASSIGNED'
  when label ilike '%manifest%'                    then 'MANIFEST_READY'
  else null
end
where auto_source is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Backfill: emergency contact status, now that it has a source
-- ─────────────────────────────────────────────────────────────────────────────
update public.departure_group_pilgrims
set emergency_contact_status = case
  when coalesce(btrim(emergency_contact_name), '') <> ''
   and coalesce(btrim(emergency_contact_phone), '') <> ''
  then 'COMPLETE'
  when coalesce(btrim(emergency_contact_name), '') <> ''
    or coalesce(btrim(emergency_contact_phone), '') <> ''
  then 'INCOMPLETE'
  else 'MISSING'
end;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. Backfill: stamp lifecycle timestamps for groups already in a state
-- ─────────────────────────────────────────────────────────────────────────────
update public.departure_groups
set ready_at = coalesce(ready_at, updated_at)
where group_status = 'READY_TO_DEPART' and ready_at is null;

update public.departure_groups
set cancelled_at = coalesce(cancelled_at, updated_at)
where group_status = 'CANCELLED' and cancelled_at is null;
