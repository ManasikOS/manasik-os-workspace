-- Reconciles two supplier-side number disagreements flagged in the
-- Departure Operations Intelligence review:
--
-- 1. `departure_group_payment_summaries.supplier_payables_due` summed the
--    group's own `internal_cost` fields on accommodations/transports — a
--    number a staff member types by hand, independent of what's actually
--    owed on the real Supplier Commitment. Now that linking a supplier
--    creates a commitment automatically (see the departure-groups actions
--    that call `syncCommitmentForLinkedEntity`), the commitment ledger is
--    the one real source for "what do we still owe suppliers" — this makes
--    it the only source the payables figure reads.
--
-- 2. `supplier_departure_usage` (20260911090000) was a second usage-count
--    view that nothing in the app ever actually queried — `suppliers-
--    repository.ts` only ever reads `supplier_directory_rows`. Rather than
--    leave an unused, disagreeing view sitting in the schema, the one thing
--    it had that the live view didn't (a guide-assignment count) is folded
--    into `supplier_directory_rows`, and the orphan is dropped. One
--    definition of "how many groups is this supplier actually on."

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
  -- Same per-currency-only limitation `supplier_directory_rows.
  -- outstanding_amount` already documents (suppliers-module-implementation-
  -- plan.md D1): mixed-currency commitments on one group are summed as if
  -- comparable. A real multi-currency payables figure needs conversion
  -- rates this schema doesn't carry yet — out of scope for this pass.
  select sum(sc.amount - sc.amount_paid) as payables_due
  from public.supplier_commitments sc
  where sc.departure_group_id = g.id
    and sc.status not in ('CANCELLED', 'DRAFT')
    and sc.amount is not null
) c on true;

comment on view public.departure_group_payment_summaries is
  'Group-level money rollup for the Payments tab and Overview collection KPI. supplier_payables_due sources from supplier_commitments (the real ledger), not the accommodation/transport internal_cost fields — see 20261003090000.';

drop view if exists public.supplier_departure_usage;

-- `s.*` is deliberately avoided here (unlike an earlier draft of this
-- migration) — `suppliers` has since gained `agency_id` (20260824090000),
-- and a wildcard would silently inject it into the middle of this select
-- list, shifting every column after it by one position. `CREATE OR REPLACE
-- VIEW` can only append columns at the end, never rename/reorder one in
-- place, so that shift fails outright: "cannot change name of view column
-- ... to agency_id". Listing `suppliers`' columns explicitly, in the exact
-- order the original view (20260817090000) already committed to, keeps
-- every ordinal position stable no matter what columns get added to the
-- base table later.
create or replace view public.supplier_directory_rows as
select
  s.id, s.supplier_code, s.name, s.supplier_type, s.status, s.reliability,
  s.reliability_reason, s.reliability_reviewed_at, s.reliability_reviewed_by,
  s.reliability_reviewed_by_name, s.city, s.country, s.currency,
  s.payment_terms, s.payment_terms_note, s.lead_time_days, s.preferred_channel,
  s.internal_notes, s.created_by, s.created_by_name, s.created_at, s.updated_at,
  (select count(distinct c.departure_group_id) from public.supplier_commitments c
     where c.supplier_id = s.id and c.status in ('REQUESTED', 'SUPPLIER_RESPONDED', 'CONFIRMED'))  as active_group_count,
  (select count(*) from public.supplier_commitments c
     where c.supplier_id = s.id and c.status = 'CONFIRMED')                                        as confirmed_count,
  (select count(*) from public.supplier_commitments c
     where c.supplier_id = s.id and c.status in ('REQUESTED', 'SUPPLIER_RESPONDED'))               as pending_count,
  (select count(*) from public.supplier_commitments c
     where c.supplier_id = s.id and c.status = 'DISPUTED')                                         as issue_count,
  (select coalesce(sum(c.amount - c.amount_paid), 0) from public.supplier_commitments c
     where c.supplier_id = s.id and c.status not in ('CANCELLED') and c.amount is not null
       and c.currency = s.currency)                                                                as outstanding_amount,
  (select min(c.payment_due_at) from public.supplier_commitments c
     where c.supplier_id = s.id and c.amount_paid < coalesce(c.amount, 0)
       and c.status not in ('CANCELLED', 'COMPLETED'))                                             as next_payment_due_at,
  (select string_agg(distinct sv.category, ',') from public.supplier_services sv
     where sv.supplier_id = s.id)                                                                  as service_categories,
  (select con.name from public.supplier_contacts con
     where con.supplier_id = s.id and con.is_primary limit 1)                                      as primary_contact_name,
  (select con.whatsapp_number from public.supplier_contacts con
     where con.supplier_id = s.id and con.is_primary limit 1)                                      as primary_contact_whatsapp,
  (select con.phone_number from public.supplier_contacts con
     where con.supplier_id = s.id and con.is_primary limit 1)                                      as primary_contact_phone,
  -- Folded in from the now-dropped supplier_departure_usage: a guide
  -- sourced from this supplier (departure_groups.primary_guide_supplier_id)
  -- has no commitment concept at all, so it's the one count that can never
  -- come from supplier_commitments the way the others do. Appended last
  -- (rather than grouped with the other usage counts above) because
  -- `CREATE OR REPLACE VIEW` can only add columns at the end — the live
  -- view already had service_categories/primary_contact_* at those
  -- ordinal positions, and any new column placed before them fails the
  -- same way `s.*` did (see the comment above this view).
  (select count(*) from public.departure_groups dg
     where dg.primary_guide_supplier_id = s.id and dg.archived = false)                            as guide_group_count
from public.suppliers s;

comment on view public.supplier_directory_rows is
  'outstanding_amount only sums commitments in the supplier''s own default currency — mixed-currency totals are computed per-currency in the application layer (see suppliers-module-implementation-plan.md, decision D1). guide_group_count is the one usage count that cannot come from supplier_commitments (guide sourcing has no commitment concept) — folded in from the now-dropped supplier_departure_usage so there is exactly one usage-count source (20261003090000).';

notify pgrst, 'reload schema';
