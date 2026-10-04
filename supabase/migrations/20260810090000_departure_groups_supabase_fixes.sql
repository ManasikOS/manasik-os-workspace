-- Departure Groups — corrections found while wiring the module to Supabase.
--
-- Every statement is additive or a constraint relaxation, so this is safe to run
-- on a database that already has 20260809090000 applied, and safe to run twice.
--
-- The findings, in the order they appear below:
--
--   1. `departure_group_transports.confirmation_url` was written by the
--      application (`setTransportConfirmationInStore`) and declared on the row
--      type, but the column was never created.
--   2. `completed_by` / `assigned_by` are uuid FKs to auth.users, but the code
--      stored the actor's *display name* in them and the Readiness drawer
--      renders that value as a name. Splitting the two keeps the audit FK and
--      the printable name without either lying about the other.
--   3. `package_template_id` was NOT NULL with an FK to public.packages, while
--      the create flow can legitimately run from a built-in template that has
--      no `packages` row. Nullable keeps the FK meaningful and the flow working
--      — the frozen snapshot still carries the template name and code.
--   4. One flight per group per direction was enforced only in application
--      code; a concurrent insert could still create a second sector.
--   5. Seats could be oversold by two concurrent bookings, because the capacity
--      check happened in the application between a read and a write.
--   6. `departure_group_payment_summaries` disagreed with the application's own
--      money rollup in three places (see the view comment).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Transport confirmation link
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.departure_group_transports
  add column if not exists confirmation_url text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Actor names alongside the actor FKs
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.departure_group_readiness_items
  add column if not exists completed_by_name text;

alter table public.departure_group_room_assignments
  add column if not exists assigned_by_name text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A group may come from a built-in template with no `packages` row
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.departure_groups
  alter column package_template_id drop not null;

alter table public.departure_group_package_snapshots
  alter column package_template_id drop not null;

-- The template a group was built from is still worth keeping when it has no
-- `packages` row, so the snapshot records it as text as well.
alter table public.departure_group_package_snapshots
  add column if not exists source_template_key text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. One flight sector per direction, enforced by the database
-- ─────────────────────────────────────────────────────────────────────────────
create unique index if not exists departure_group_flights_direction_unique
  on public.departure_group_flights (departure_group_id, direction);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Seats cannot be oversold, even by concurrent writers
--
-- The application still returns the friendly "only N seats left" message; this
-- is the backstop for two bookings that pass that check at the same instant.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'departure_groups_seats_within_capacity'
  ) then
    alter table public.departure_groups
      add constraint departure_groups_seats_within_capacity
      check (booked_seats + held_seats <= capacity) not valid;
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Payment summary view, corrected
--
-- Three disagreements with `buildPaymentSummary()` in the application:
--
--   * `refund_pending_amount` joined pilgrims to bookings, so a booking with
--     four travellers counted its balance four times; and it summed
--     `outstanding_balance`, which a cancellation sets to zero — exactly the
--     case a refund arises from. It is the money already *collected* on those
--     bookings that is owed back, counted once per booking.
--   * `overdue_amount` counted a past due date even when nothing was owed.
--   * Cancelled bookings were excluded from the revenue lines but their
--     collected money still has to appear as a refund liability.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.departure_group_payment_summaries as
select
  g.id as departure_group_id,
  coalesce(b.expected_revenue,      0) as expected_revenue,
  coalesce(b.collected_amount,      0) as collected_amount,
  coalesce(b.outstanding_amount,    0) as outstanding_amount,
  coalesce(b.overdue_amount,        0) as overdue_amount,
  coalesce(p.refund_pending_amount, 0) as refund_pending_amount,
  coalesce(a.hotel_cost, 0) + coalesce(t.transport_cost, 0) as supplier_payables_due
from public.departure_groups g
left join lateral (
  select
    sum(total_booking_value)  as expected_revenue,
    sum(amount_paid)          as collected_amount,
    sum(outstanding_balance)  as outstanding_amount,
    sum(
      case
        when next_due_at < now() and outstanding_balance > 0
        then outstanding_balance
        else 0
      end
    ) as overdue_amount
  from public.departure_group_bookings
  where departure_group_id = g.id and booking_status <> 'CANCELLED'
) b on true
left join lateral (
  -- One row per booking, not per traveller, and the collected money is what is
  -- owed back — a cancelled booking's outstanding balance is zero by design.
  select sum(bk.amount_paid) as refund_pending_amount
  from public.departure_group_bookings bk
  where bk.departure_group_id = g.id
    and exists (
      select 1
      from public.departure_group_pilgrims pg
      where pg.booking_id = bk.id
        and pg.payment_status = 'REFUND_PENDING'
    )
) p on true
left join lateral (
  select sum(internal_cost) as hotel_cost
  from public.departure_group_accommodations
  where departure_group_id = g.id and status in ('REQUESTED', 'CONFIRMED')
) a on true
left join lateral (
  select sum(internal_cost) as transport_cost
  from public.departure_group_transports
  where departure_group_id = g.id and status in ('REQUESTED', 'CONFIRMED')
) t on true;

comment on view public.departure_group_payment_summaries is
  'Group-level money rollup for the Payments tab and Overview collection KPI. Mirrors buildPaymentSummary() in lib/data/departure-groups.ts exactly.';
