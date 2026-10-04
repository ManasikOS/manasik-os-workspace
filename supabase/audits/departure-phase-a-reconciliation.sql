-- Run only after inventory confirms this schema. No data repair or fixture inserts.
-- Run under an authorized audit role: ordinary staff RLS can hide mismatches.
-- Counts are candidate discrepancies, not instructions to automatically change money.
-- No mixed-currency sums across bookings; results are counts by tenant and check.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '60s';

with
milestones as (
  select booking_id, count(*) filter (where not waived) as active_count,
    coalesce(sum(amount) filter (where not waived), 0) as amount
  from public.booking_payment_milestones group by booking_id
),
pilgrim_milestones as (
  select booking_id, count(*) as row_count
  from public.pilgrim_payment_milestones
  group by booking_id
),
travelling_pilgrims as (
  select booking_id, count(*) as pilgrim_count
  from public.departure_group_pilgrims
  where coalesce(payment_status, '') <> 'REFUND_PENDING'
  group by booking_id
),
ledger as (
  -- Reversed originals and their REVERSED contra entries are both excluded.
  -- They net to zero. Include COMPLETED receipts and negative REFUNDED payouts.
  select booking_id, sum(amount) as amount, count(distinct currency) as currencies
  from public.payments where status in ('COMPLETED', 'REFUNDED') group by booking_id
),
charges as (
  select booking_id, sum(round(amount * quantity, 2)) as amount
  from public.departure_group_pilgrim_charges
  where voided_at is null and (not requires_approval or approved_at is not null)
  group by booking_id
),
refunds as (
  select booking_id, sum(amount) as amount from public.refund_requests
  where status in ('PENDING_APPROVAL', 'APPROVED') group by booking_id
),
seat_counts as (
  select departure_group_id,
    coalesce(sum(traveller_count) filter (where booking_status in ('CONFIRMED','DEPOSIT_PENDING')), 0) as booked,
    coalesce(sum(traveller_count) filter (where booking_status = 'HELD'), 0) as held
  from public.departure_group_bookings group by departure_group_id
),
invoice_lines as (
  select invoice_id, sum(line_total) as amount from public.invoice_line_items group by invoice_id
),
issues as (
  select b.agency_id, 'missing_active_milestones' as check_name, b.id as entity_id
  from public.departure_group_bookings b left join milestones m on m.booking_id = b.id
  where b.booking_status not in ('CANCELLED','WAITLIST') and b.total_booking_value > 0 and coalesce(m.active_count, 0) = 0
  union all
  select b.agency_id, 'missing_pilgrim_payment_projection', b.id
  from public.departure_group_bookings b
  join travelling_pilgrims tp on tp.booking_id = b.id
  left join pilgrim_milestones pm on pm.booking_id = b.id
  where b.booking_status not in ('CANCELLED','WAITLIST')
    and coalesce(pm.row_count, 0) = 0
  union all
  select b.agency_id, 'schedule_value_mismatch', b.id from public.departure_group_bookings b
  join milestones m on m.booking_id = b.id
  where b.booking_status not in ('CANCELLED','WAITLIST') and m.amount <> b.total_booking_value
  union all
  select b.agency_id, 'booking_ledger_mismatch', b.id from public.departure_group_bookings b
  left join ledger l on l.booking_id = b.id
  where coalesce(l.currencies, 0) <= 1 and b.amount_paid <> coalesce(l.amount, 0)
  union all
  select b.agency_id, 'multiple_payment_currencies', b.id from public.departure_group_bookings b
  join ledger l on l.booking_id = b.id where l.currencies > 1
  union all
  select b.agency_id, 'billable_charge_mismatch', b.id from public.departure_group_bookings b
  left join charges c on c.booking_id = b.id
  where b.booking_status <> 'CANCELLED' and b.total_booking_value <> coalesce(c.amount, 0)
  union all
  select b.agency_id, 'cancelled_booking_has_debt', b.id from public.departure_group_bookings b
  where b.booking_status = 'CANCELLED' and b.outstanding_balance > 0
  union all
  select b.agency_id, 'refund_flag_request_mismatch', b.id from public.departure_group_bookings b
  left join refunds r on r.booking_id = b.id
  where (coalesce(r.amount, 0) > 0) is distinct from (exists (
    select 1 from public.departure_group_pilgrims p where p.booking_id = b.id and p.payment_status = 'REFUND_PENDING'))
  union all
  select b.agency_id, 'refund_exceeds_held_money', b.id from public.departure_group_bookings b
  join refunds r on r.booking_id = b.id where r.amount > b.amount_paid
  union all
  select b.agency_id, 'cancellation_refund_projection_mismatch', b.id
  from public.departure_group_bookings b
  left join refunds r on r.booking_id = b.id
  where b.booking_status = 'CANCELLED'
    and round(coalesce(b.cancellation_refund_amount, 0), 2) <> round(coalesce(r.amount, 0), 2)
  union all
  select g.agency_id, 'seat_counter_mismatch', g.id from public.departure_groups g
  left join seat_counts s on s.departure_group_id = g.id
  where g.booked_seats <> coalesce(s.booked, 0) or g.held_seats <> coalesce(s.held, 0)
    or coalesce(s.booked, 0) + coalesce(s.held, 0) > g.capacity
  union all
  select a.agency_id, 'room_counter_mismatch', r.id from public.departure_group_rooms r
  join public.departure_group_accommodations a on a.id = r.accommodation_id
  where r.assigned_pilgrim_count <> (select count(*) from public.departure_group_room_assignments x where x.room_id = r.id)
    or r.assigned_pilgrim_count > r.occupancy_capacity
  union all
  select g.agency_id, 'outbound_ticket_counter_candidate', f.id from public.departure_group_flights f
  join public.departure_groups g on g.id = f.departure_group_id
  where f.direction = 'OUTBOUND' and f.seats_ticketed <> (
    select count(*) from public.departure_group_pilgrims p
    join public.departure_group_bookings b on b.id = p.booking_id
    where p.departure_group_id = g.id and p.flight_status = 'TICKETED'
      and not p.excluded_from_group_flight and b.booking_status not in ('CANCELLED','WAITLIST','HELD'))
  union all
  select i.agency_id, 'invoice_header_line_mismatch', i.id from public.invoices i
  join invoice_lines l on l.invoice_id = i.id where i.amount <> l.amount
  union all
  select i.agency_id, 'invoice_without_lines', i.id from public.invoices i
  left join invoice_lines l on l.invoice_id = i.id where l.invoice_id is null and i.amount <> 0
  union all
  select b.agency_id, 'payment_group_or_tenant_mismatch', p.id from public.payments p
  join public.departure_group_bookings b on b.id = p.booking_id
  where p.departure_group_id is distinct from b.departure_group_id or p.agency_id is distinct from b.agency_id
  union all
  select b.agency_id, 'milestone_group_or_tenant_mismatch', m.id from public.booking_payment_milestones m
  join public.departure_group_bookings b on b.id = m.booking_id
  where m.departure_group_id is distinct from b.departure_group_id or m.agency_id is distinct from b.agency_id
  union all
  select b.agency_id, 'invoice_group_or_tenant_candidate', i.id from public.invoices i
  join public.departure_group_bookings b on b.id = i.booking_id
  where i.departure_group_id is distinct from b.departure_group_id or i.agency_id is distinct from b.agency_id
  union all
  select b.agency_id, 'refund_group_or_tenant_mismatch', r.id from public.refund_requests r
  join public.departure_group_bookings b on b.id = r.booking_id
  where r.departure_group_id is distinct from b.departure_group_id or r.agency_id is distinct from b.agency_id
  union all
  select p.agency_id, 'allocation_booking_mismatch', a.id from public.payment_allocations a
  join public.payments p on p.id = a.payment_id join public.booking_payment_milestones m on m.id = a.milestone_id
  where m.booking_id is distinct from p.booking_id or m.agency_id is distinct from p.agency_id
  union all
  select p.agency_id, 'allocation_exceeds_payment', p.id from public.payments p
  where p.status = 'COMPLETED' and p.amount < (
    select coalesce(sum(a.amount), 0) from public.payment_allocations a where a.payment_id = p.id)
), checks(check_name) as (
  values ('missing_active_milestones'),('missing_pilgrim_payment_projection'),('schedule_value_mismatch'),('booking_ledger_mismatch'),
    ('multiple_payment_currencies'),('billable_charge_mismatch'),('cancelled_booking_has_debt'),
    ('refund_flag_request_mismatch'),('refund_exceeds_held_money'),('seat_counter_mismatch'),
    ('cancellation_refund_projection_mismatch'),
    ('room_counter_mismatch'),('outbound_ticket_counter_candidate'),('invoice_header_line_mismatch'),
    ('invoice_without_lines'),('payment_group_or_tenant_mismatch'),('milestone_group_or_tenant_mismatch'),
    ('invoice_group_or_tenant_candidate'),('refund_group_or_tenant_mismatch'),
    ('allocation_booking_mismatch'),('allocation_exceeds_payment')
), tenants as (select distinct agency_id from public.departure_groups)
select now() as captured_at, t.agency_id, c.check_name, count(i.entity_id) as candidate_count
from tenants t cross join checks c left join issues i on i.agency_id is not distinct from t.agency_id and i.check_name = c.check_name
group by t.agency_id, c.check_name order by t.agency_id, c.check_name;
rollback;
