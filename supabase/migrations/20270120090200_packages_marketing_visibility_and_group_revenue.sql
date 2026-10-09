-- TASK-043 Phase 1, steps 4 (PKG-03) and the finance part of PKG-12. Both were reproduced on staging on 2026-10-09
-- (docs/progress/2026-10-09-packages-phase0-verification.md, tests T1, T1b, T4).
--
--   1. MARKETING may read only packages that are Open for Sale or that it owns. Until now that rule existed only in TypeScript (canRoleViewPackage) and in
--      a SQL predicate driven by arguments the caller supplied, so a MARKETING session reading the table or calling list_packages_with_usage(null, null)
--      got every draft in the agency. The rule now lives in the SELECT policy, where it cannot be skipped. Every other role that could read before still can.
--   2. package_versions and package_activity_logs held a published package's full content and history for MARKETING too. Their read policies now also
--      require that the caller can read the package itself (the subquery runs with the caller's own row security), so they can never reveal more
--      than the package list does.
--   3. list_packages_with_usage no longer takes its visibility from p_role / p_current_user_id. The parameters stay (so existing callers keep working) but are
--      ignored; row security decides what each caller sees.
--   (The SELECT policy and the view also require the viewModule / viewInternalFinance package capability, see 20270120090050.)
--   4. departure_group_payment_summaries returned revenue, collected, outstanding, overdue and supplier-payable figures for every group a caller could see,
--      including MARKETING. Its only consumer is the package page's Departure Groups tab. The view now returns rows only for ADMIN, CEO and FINANCE, the
--      roles whose capability sets include viewing finance (lib/access/departure-groups-access.ts viewFinance, lib/access/packages-access.ts
--      viewInternalFinance). The column list, order and query are otherwise unchanged.
--
-- Changes no table data and no column. Idempotent.
-- Rollback: recreate the policies and the view from 20270119090000, 20261007090000, 20261006090000, 20261010090000 and 20261003090000.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. packages: SELECT
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "staff read packages" on public.packages;
create policy "staff read packages" on public.packages
  for select to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and (select public.has_package_capability('viewModule'))
    and (
      public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'FINANCE', 'VISA')
      or (
        public.staff_role_in('MARKETING')
        and (status = 'Open for Sale' or owner_id = (select auth.uid()))
      )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. package_versions and package_activity_logs follow the package
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "staff read package versions" on public.package_versions;
create policy "staff read package versions" on public.package_versions
  for select to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'FINANCE', 'MARKETING', 'VISA')
    and exists (select 1 from public.packages p where p.id = package_versions.package_id)
  );

drop policy if exists "staff read package activity" on public.package_activity_logs;
create policy "staff read package activity" on public.package_activity_logs
  for select to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'FINANCE', 'MARKETING', 'VISA')
    and exists (select 1 from public.packages p where p.id = package_activity_logs.package_id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. list_packages_with_usage: row security decides, not the arguments
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.list_packages_with_usage(
  p_role text default null,
  p_current_user_id uuid default null
) returns table (
  id                                uuid,
  title                             text,
  internal_code                     text,
  description                       text,
  journey_type                      text,
  category                          text,
  package_category                  text,
  branch                            text,
  status                            text,
  visibility                        text,
  featured                          boolean,
  duration                          text,
  days                              integer,
  nights                            integer,
  max_pilgrims                      integer,
  default_capacity                  integer,
  cancellation_policy               text,
  itinerary_days                    integer,
  payment_milestones_count          integer,
  transport_requirements_count      integer,
  inclusions_count                  integer,
  exclusions_count                  integer,
  included_services_count           integer,
  document_requirements_count       integer,
  group_readiness_checklist_count   integer,
  archived_at                       timestamptz,
  created_at                        timestamptz,
  updated_at                        timestamptz,
  owner_id                          uuid,
  group_count                       bigint,
  live_group_count                  bigint,
  seats_booked                      bigint,
  seats_capacity                    bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id, p.title, p.internal_code, p.description, p.journey_type, p.category,
    p.package_category, p.branch, p.status, p.visibility, p.featured,
    p.duration, p.days, p.nights, p.max_pilgrims, p.default_capacity,
    p.cancellation_policy, p.itinerary_days, p.payment_milestones_count,
    p.transport_requirements_count, p.inclusions_count, p.exclusions_count,
    p.included_services_count, p.document_requirements_count,
    p.group_readiness_checklist_count, p.archived_at, p.created_at, p.updated_at,
    p.owner_id,
    coalesce(u.group_count, 0)::bigint       as group_count,
    coalesce(u.live_group_count, 0)::bigint  as live_group_count,
    coalesce(u.seats_booked, 0)::bigint      as seats_booked,
    coalesce(u.seats_capacity, 0)::bigint    as seats_capacity
  from public.packages p
  left join public.package_usage u on u.package_id = p.id
  order by p.updated_at desc;
$$;

comment on function public.list_packages_with_usage(text, uuid) is
  'The packages the caller may read, with usage counts. security invoker: row security on packages decides visibility (including the MARKETING rule). p_role and p_current_user_id are accepted for compatibility and ignored.';

revoke execute on function public.list_packages_with_usage(text, uuid) from public, anon;
grant execute on function public.list_packages_with_usage(text, uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. departure_group_payment_summaries: finance roles only
--    (query identical to 20261003090000 apart from the final WHERE)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.departure_group_payment_summaries as
select
  g.id as departure_group_id,
  coalesce(b.expected_revenue,      0) as expected_revenue,
  coalesce(b.collected_amount,      0) as collected_amount,
  coalesce(b.outstanding_amount,    0) as outstanding_amount,
  coalesce(b.overdue_amount,        0) as overdue_amount,
  coalesce(p.refund_pending_amount, 0) as refund_pending_amount,
  coalesce(c.payables_due,          0) as supplier_payables_due
from public.departure_groups g
left join lateral (
  select
    sum(total_booking_value)                                                    as expected_revenue,
    sum(amount_paid)                                                            as collected_amount,
    sum(outstanding_balance)                                                    as outstanding_amount,
    sum(case when next_due_at < now() then outstanding_balance else 0 end)      as overdue_amount
  from public.departure_group_bookings
  where departure_group_id = g.id and booking_status <> 'CANCELLED'
) b on true
left join lateral (
  select sum(bk.outstanding_balance) as refund_pending_amount
  from public.departure_group_pilgrims pg
  join public.departure_group_bookings bk on bk.id = pg.booking_id
  where pg.departure_group_id = g.id and pg.payment_status = 'REFUND_PENDING'
) p on true
left join lateral (
  select sum(sc.amount - sc.amount_paid) as payables_due
  from public.supplier_commitments sc
  where sc.departure_group_id = g.id
    and sc.status not in ('CANCELLED', 'DRAFT')
    and sc.amount is not null
) c on true
where public.staff_role_in('ADMIN', 'CEO', 'FINANCE')
  and (select public.has_package_capability('viewInternalFinance'));

alter view public.departure_group_payment_summaries set (security_invoker = true);

comment on view public.departure_group_payment_summaries is
  'Group-level money rollup. Returns rows only for ADMIN, CEO and FINANCE who also hold the viewInternalFinance package capability (TASK-043 PKG-12); everyone else gets none. supplier_payables_due sources from supplier_commitments (the real ledger) — see 20261003090000.';

notify pgrst, 'reload schema';
