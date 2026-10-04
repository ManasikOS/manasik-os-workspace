-- Reports: read-only aggregate views over every module's tables.
--
-- Additive only, safe on top of `20260808090000 … 20260818090000`. Nothing
-- here creates a table that is written to — the Reports module never writes
-- operational data (plan §1). Every view is a straight `select` over rows
-- that already exist and are already governed by that table's RLS policy;
-- a view runs with the querying user's own privileges, so nothing new needs
-- granting.
--
-- One fact view per report category, at the finest grain a report in the
-- category needs (one row per booking / payment / lead / group / commitment
-- / task / pilgrim-journey). Every "Sales", "Finance" etc. report in
-- `docs/modules/reports-module-implementation-plan.md` §Screens is a `group by` /
-- `where` / `sum` over one of these — no report-specific view. Period
-- filtering happens in the application layer (`lib/data/reports-repository.ts`)
-- against each fact's own date column, never in the view.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. report_booking_facts — one row per booking, the Sales/Revenue backbone.
--    booked_at is the only date column: a booking is "sales" the day it was
--    made, not the day the group departs.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.report_booking_facts as
select
  b.id                          as booking_id,
  b.booking_reference,
  b.booking_status,
  b.booked_at,
  b.created_at,
  b.traveller_count,
  b.total_booking_value,
  b.amount_paid,
  b.outstanding_balance,
  b.next_due_at,
  coalesce(b.finance_owner_name, g.finance_owner_name)  as finance_owner_name,
  g.id                          as departure_group_id,
  g.group_name,
  g.group_code,
  g.branch,
  g.journey_type,
  g.departure_date,
  g.group_status,
  g.package_template_id,
  s.package_name_snapshot       as package_name,
  s.package_code_snapshot       as package_code,
  l.id                          as lead_id,
  l.reference                   as lead_reference,
  l.source                      as lead_source,
  l.assigned_to_id              as sales_owner_id,
  l.assigned_to_name            as sales_owner_name
from public.departure_group_bookings b
join public.departure_groups g on g.id = b.departure_group_id
left join public.departure_group_package_snapshots s on s.departure_group_id = g.id
left join public.leads       l  on l.id = b.lead_id;

comment on view public.report_booking_facts is
  'One row per booking — the Sales & Revenue backbone for Reports. booked_at (not departure_date) is the period column.';

create index if not exists departure_group_bookings_booked_at_idx
  on public.departure_group_bookings (booked_at)
  where booking_status <> 'CANCELLED';

-- ─────────────────────────────────────────────────────────────────────────────
-- B. report_payment_facts — one row per completed customer payment. Excludes
--    reversal rows from sums by construction (amount is negative on those,
--    so a plain sum() nets them out correctly) but keeps them visible for a
--    ledger-style report.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.report_payment_facts as
select
  p.id                as payment_id,
  p.payment_reference,
  p.amount,
  p.currency,
  p.paid_at,
  p.method,
  p.status,
  p.reverses_payment_id,
  b.id                as booking_id,
  b.booking_reference,
  g.id                as departure_group_id,
  g.group_name,
  g.group_code,
  g.branch,
  g.journey_type,
  g.package_template_id,
  s.package_name_snapshot        as package_name,
  coalesce(b.finance_owner_name, g.finance_owner_name) as finance_owner_name
from public.payments p
join public.departure_group_bookings b on b.id = p.booking_id
join public.departure_groups g on g.id = p.departure_group_id
left join public.departure_group_package_snapshots s on s.departure_group_id = g.id
where p.status = 'COMPLETED';

comment on view public.report_payment_facts is
  'One row per completed payment (reversals included, negative). paid_at is the period column for every collections report.';

-- ─────────────────────────────────────────────────────────────────────────────
-- C. report_milestone_facts — booking payment milestones, for the
--    receivables aging report. Grain: one row per milestone, not per
--    booking, so "31+ days overdue" buckets the specific unpaid instalment
--    rather than the whole booking (plan reuses finance's F4 fix).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.report_milestone_facts as
select
  m.id                as milestone_id,
  m.booking_id,
  m.label,
  m.milestone_type,
  m.amount,
  m.paid_amount,
  greatest(m.amount - m.paid_amount, 0)  as outstanding_amount,
  m.due_at,
  m.waived,
  b.booking_reference,
  g.id                as departure_group_id,
  g.group_name,
  g.branch,
  coalesce(b.finance_owner_name, g.finance_owner_name) as finance_owner_name
from public.booking_payment_milestones m
join public.departure_group_bookings b on b.id = m.booking_id
join public.departure_groups g on g.id = m.departure_group_id
where not m.waived and m.paid_amount < m.amount;

comment on view public.report_milestone_facts is
  'Unsettled milestones only, for the Receivables Aging report''s Not Due / 1-7 / 8-30 / 31+ buckets (bucketed in the application layer against reportNowIso).';

-- ─────────────────────────────────────────────────────────────────────────────
-- D. report_lead_facts — one row per lead, current-state snapshot. There is
--    no `lead_stage_events` history table yet, so stage-to-stage conversion
--    and average time-in-stage cannot be computed from this alone — the
--    funnel report renders current stage *counts* only until that table
--    exists (a documented gap, not silently approximated).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.report_lead_facts as
select
  l.id                    as lead_id,
  l.reference,
  l.stage,
  l.temperature,
  l.source,
  l.journey_type,
  l.estimated_value_lkr,
  l.assigned_to_id        as sales_owner_id,
  l.assigned_to_name      as sales_owner_name,
  l.created_at,
  l.first_response_at,
  l.last_contacted_at,
  l.next_follow_up_at,
  l.lost_reason,
  l.postponed_until,
  l.selected_departure_group_id,
  l.booking_id,
  b.total_booking_value,
  b.branch                as booking_branch
from public.leads l
left join (
  select bk.id, bk.total_booking_value, g.branch
  from public.departure_group_bookings bk
  join public.departure_groups g on g.id = bk.departure_group_id
) b on b.id = l.booking_id;

comment on view public.report_lead_facts is
  'One row per lead, current-state only (no stage-history table exists yet — funnel report shows stage counts, not stage-to-stage conversion).';

-- ─────────────────────────────────────────────────────────────────────────────
-- E. report_group_facts — one row per departure group: readiness, capacity,
--    occupancy and profitability. Reuses departure_group_payment_summaries
--    rather than re-deriving group money (same reasoning as the Finance
--    module's F7 — one writer, one reader, never two definitions).
--
--    Supplier cost is summed from supplier_commitments directly rather than
--    the legacy hotel/transport-only figure on payment_summaries, matching
--    finance_supplier_payable_rows (plan F7). Currencies are NOT converted —
--    a group with SAR supplier costs against LKR revenue renders a margin
--    that mixes currencies. Flagged, not solved, exactly as Finance plan
--    F12/D1 flags it for the same underlying data.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.report_group_facts as
select
  g.id                       as departure_group_id,
  g.group_name,
  g.group_code,
  g.branch,
  g.journey_type,
  g.group_status,
  g.sales_status,
  g.departure_date,
  g.return_date,
  g.capacity,
  g.booked_seats,
  g.held_seats,
  g.available_seats,
  (select count(*) from public.departure_group_bookings bk
     where bk.departure_group_id = g.id and bk.booking_status = 'WAITLIST') as waitlisted_count,
  g.readiness_score,
  g.readiness_status,
  g.finance_owner_name,
  g.operations_owner_name,
  g.visa_owner_name,
  g.primary_guide_name,
  g.package_template_id,
  snap.package_name_snapshot as package_name,
  s.expected_revenue,
  s.collected_amount,
  s.outstanding_amount,
  s.overdue_amount,
  s.refund_pending_amount,
  (select coalesce(sum(c.amount), 0) from public.supplier_commitments c
     where c.departure_group_id = g.id and c.status <> 'CANCELLED')        as supplier_cost_mixed_currency,
  (select count(*) from public.departure_group_readiness_items ri
     where ri.departure_group_id = g.id and ri.status in ('AT_RISK', 'BLOCKED'))  as blocker_count,
  case when g.capacity > 0
    then round(100.0 * g.booked_seats / g.capacity, 1)
    else 0
  end                        as occupancy_percent
from public.departure_groups g
left join public.departure_group_payment_summaries s on s.departure_group_id = g.id
left join public.departure_group_package_snapshots snap on snap.departure_group_id = g.id
where g.archived = false;

comment on view public.report_group_facts is
  'One row per departure group — readiness, capacity/occupancy and profitability. supplier_cost_mixed_currency is not FX-converted (plan F12/D1, carried from Finance).';

-- ─────────────────────────────────────────────────────────────────────────────
-- F. report_pilgrim_compliance_facts — one row per pilgrim journey
--    enrolment: documents, visa, passport risk. Reuses the same join
--    `pilgrim_journey_rows` already performs rather than re-deriving it.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.report_pilgrim_compliance_facts as
select
  e.id                       as journey_id,
  p.id                       as pilgrim_id,
  p.reference                as pilgrim_reference,
  p.full_name,
  p.passport_number,
  p.passport_expiry,
  e.seat_status,
  e.visa_status,
  e.visa_submitted_at,
  e.payment_status,
  e.documents_completed,
  e.documents_required,
  e.document_completion_percent,
  g.id                       as departure_group_id,
  g.group_name,
  g.group_code,
  g.branch,
  g.journey_type,
  g.departure_date,
  g.visa_owner_name          as group_visa_owner_name,
  (g.departure_date - current_date)::integer as days_to_departure,
  case when p.passport_expiry is null then null
    else (p.passport_expiry - current_date)::integer
  end                        as passport_days_remaining
from public.departure_group_pilgrims e
join public.pilgrims p on p.id = e.pilgrim_id
join public.departure_groups g on g.id = e.departure_group_id
where e.seat_status <> 'CANCELLED' and g.group_status <> 'CANCELLED';

comment on view public.report_pilgrim_compliance_facts is
  'One row per pilgrim journey enrolment — document completion, visa status, passport validity risk, for Pilgrim & Compliance reports.';

-- ─────────────────────────────────────────────────────────────────────────────
-- G. report_supplier_facts — one row per supplier commitment: confirmation
--    performance and payables. Reuses finance_supplier_payable_rows' join
--    shape (plan F7) rather than a new payable model.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.report_supplier_facts as
select
  c.id                       as commitment_id,
  c.reference_code,
  c.service_category,
  c.service_label,
  c.status                   as commitment_status,
  c.amount,
  c.amount_paid,
  greatest(coalesce(c.amount, 0) - c.amount_paid, 0)  as outstanding_amount,
  c.currency,
  c.payment_due_at,
  c.service_start_date,
  c.confirmed_at,
  c.owner_name,
  c.created_at,
  -- On time: confirmed on/before the service actually needed it. Late:
  -- confirmed after. Pending/overdue derived in the application layer
  -- against reportNowIso, not stored, so "today" always matches the KPI row.
  case
    when c.confirmed_at is not null and c.service_start_date is not null
      then c.confirmed_at::date <= c.service_start_date
    when c.confirmed_at is not null then true
    else null
  end                        as confirmed_on_time,
  s.id                       as supplier_id,
  s.name                     as supplier_name,
  s.supplier_code,
  g.id                       as departure_group_id,
  g.group_name,
  g.group_code,
  g.branch
from public.supplier_commitments c
join public.suppliers s on s.id = c.supplier_id
join public.departure_groups g on g.id = c.departure_group_id;

comment on view public.report_supplier_facts is
  'One row per supplier commitment — confirmation performance and payables for Supplier & Operations reports.';

-- ─────────────────────────────────────────────────────────────────────────────
-- H. report_task_facts — one row per departure-group task: guide/staff
--    workload and operational task completion, sliced by category.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.report_task_facts as
select
  t.id                       as task_id,
  t.title,
  t.category,
  t.status,
  t.owner_id,
  t.owner_name,
  t.due_at,
  g.id                       as departure_group_id,
  g.group_name,
  g.group_code,
  g.branch
from public.departure_group_tasks t
join public.departure_groups g on g.id = t.departure_group_id;

comment on view public.report_task_facts is
  'One row per departure-group task — guide/staff workload and operational task completion by category.';
