-- Reports previously exposed supplier_cost_mixed_currency without the group
-- contract currency, so portfolio KPIs could label SAR + LKR as one amount.
-- Keep the legacy field for compatibility and add explicit currency buckets.

create or replace view public.report_group_facts as
select
  g.id as departure_group_id,
  g.group_name, g.group_code, g.branch, g.journey_type, g.group_status,
  g.sales_status, g.departure_date, g.return_date, g.capacity,
  g.booked_seats, g.held_seats, g.available_seats,
  (select count(*) from public.departure_group_bookings bk
    where bk.departure_group_id = g.id and bk.booking_status = 'WAITLIST') as waitlisted_count,
  g.readiness_score, g.readiness_status, g.finance_owner_name,
  g.operations_owner_name, g.visa_owner_name, g.primary_guide_name,
  g.package_template_id, snap.package_name_snapshot as package_name,
  s.expected_revenue, s.collected_amount, s.outstanding_amount,
  s.overdue_amount, s.refund_pending_amount,
  (select coalesce(sum(c.amount), 0) from public.supplier_commitments c
    where c.departure_group_id = g.id and c.status <> 'CANCELLED') as supplier_cost_mixed_currency,
  (select count(*) from public.departure_group_readiness_items ri
    where ri.departure_group_id = g.id and ri.status in ('AT_RISK', 'BLOCKED')) as blocker_count,
  case when g.capacity > 0 then round(100.0 * g.booked_seats / g.capacity, 1) else 0 end as occupancy_percent,
  coalesce(pr.currency, 'LKR') as currency,
  coalesce(sc.supplier_cost_by_currency, '{}'::jsonb) as supplier_cost_by_currency
from public.departure_groups g
left join public.departure_group_payment_summaries s on s.departure_group_id = g.id
left join public.departure_group_package_snapshots snap on snap.departure_group_id = g.id
left join public.departure_group_pricing pr on pr.departure_group_id = g.id
left join lateral (
  select jsonb_object_agg(x.currency, x.total) as supplier_cost_by_currency
  from (
    select c.currency, sum(c.amount) as total
    from public.supplier_commitments c
    where c.departure_group_id = g.id and c.status <> 'CANCELLED'
    group by c.currency
  ) x
) sc on true
where g.archived = false;

