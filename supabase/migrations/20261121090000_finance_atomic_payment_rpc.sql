-- Atomic posted-payment command.  The application keeps the pending
-- verification path (which must not change receivables), while evidenced
-- payments use this function so the ledger, allocations, booking projection,
-- and held-seat promotion commit or roll back together.

create or replace function public.record_departure_booking_payment_atomic(
  p_booking_id uuid,
  p_departure_group_id uuid,
  p_amount numeric,
  p_currency text,
  p_method text,
  p_payment_reference text,
  p_reference_number text,
  p_proof_path text,
  p_paid_at timestamptz,
  p_internal_note text,
  p_pending_allocations jsonb,
  p_actor_id uuid,
  p_actor_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  b record;
  pmt_id uuid;
  m record;
  requested numeric := 0;
  remaining numeric;
  applied numeric;
  old_status text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero' using errcode = '22023';
  end if;

  -- Lock parent rows in a stable order.  This serializes capacity and money
  -- changes for one booking/group without blocking unrelated departures.
  perform pg_advisory_xact_lock(hashtextextended(p_departure_group_id::text, 0));
  select id, capacity into strict m from public.departure_groups
    where id = p_departure_group_id for update;
  select * into strict b from public.departure_group_bookings
    where id = p_booking_id for update;

  if b.departure_group_id is distinct from p_departure_group_id then
    raise exception 'Booking does not belong to the selected departure group' using errcode = '23514';
  end if;
  if b.agency_id is distinct from public.current_agency_id() then
    raise exception 'Booking is outside the current agency' using errcode = '42501';
  end if;
  if b.booking_status = 'CANCELLED' then
    raise exception 'Cancelled bookings cannot receive payments' using errcode = '23514';
  end if;
  if coalesce(b.currency, 'LKR') <> coalesce(p_currency, 'LKR') then
    raise exception 'Payment currency does not match the booking contract' using errcode = '23514';
  end if;
  if p_amount > b.outstanding_balance then
    raise exception 'Payment exceeds the outstanding booking balance' using errcode = '23514';
  end if;

  insert into public.payments (
    payment_reference, booking_id, departure_group_id, agency_id, amount,
    currency, paid_at, method, reference_number, proof_path, status,
    internal_note, recorded_by, recorded_by_name
  ) values (
    p_payment_reference, b.id, b.departure_group_id, b.agency_id, p_amount,
    coalesce(p_currency, 'LKR'), coalesce(p_paid_at, now()), p_method,
    nullif(trim(p_reference_number), ''), p_proof_path, 'COMPLETED',
    nullif(trim(p_internal_note), ''), p_actor_id, coalesce(p_actor_name, 'Staff')
  ) returning id into pmt_id;

  -- A selected allocation is validated against locked milestone rows.  An
  -- empty selection is allocated oldest-due-first, preserving unapplied
  -- balance only when the booking has no open milestones.
  if jsonb_array_length(coalesce(p_pending_allocations, '[]'::jsonb)) > 0 then
    select coalesce(sum((x.amount)::numeric), 0) into requested
    from jsonb_to_recordset(p_pending_allocations) as x(milestone_id uuid, amount numeric);
    if requested > p_amount then
      raise exception 'Milestone allocations exceed the payment amount' using errcode = '23514';
    end if;
    if (select count(*) from jsonb_to_recordset(p_pending_allocations) as x(milestone_id uuid, amount numeric))
       <> (select count(distinct x.milestone_id) from jsonb_to_recordset(p_pending_allocations) as x(milestone_id uuid, amount numeric)) then
      raise exception 'Duplicate milestone allocation' using errcode = '23514';
    end if;
    for m in select x.milestone_id, x.amount from jsonb_to_recordset(p_pending_allocations) as x(milestone_id uuid, amount numeric) loop
      if m.amount <= 0 then raise exception 'Allocation must be positive' using errcode = '22023'; end if;
      perform 1 from public.booking_payment_milestones
        where id = m.milestone_id and booking_id = b.id and not waived
          and m.amount <= (amount - paid_amount) for update;
      if not found then
        raise exception 'Milestone allocation is invalid or exceeds its remaining balance' using errcode = '23514';
      end if;
      insert into public.payment_allocations(payment_id, milestone_id, amount)
        values (pmt_id, m.milestone_id, m.amount);
    end loop;
  else
    remaining := p_amount;
    for m in select id, amount, paid_amount from public.booking_payment_milestones
      where booking_id = b.id and not waived and paid_amount < amount
      order by due_at asc nulls last, sequence asc for update loop
      exit when remaining <= 0;
      applied := least(remaining, greatest(m.amount - m.paid_amount, 0));
      if applied > 0 then
        insert into public.payment_allocations(payment_id, milestone_id, amount)
          values (pmt_id, m.id, applied);
        remaining := remaining - applied;
      end if;
    end loop;
  end if;

  old_status := b.booking_status;
  update public.departure_group_bookings
  set amount_paid = amount_paid + p_amount,
      outstanding_balance = greatest(total_booking_value - (amount_paid + p_amount), 0),
      next_due_at = case when greatest(total_booking_value - (amount_paid + p_amount), 0) <= 0 then null else next_due_at end,
      booking_status = case when booking_status in ('HELD', 'DEPOSIT_PENDING') then 'CONFIRMED' else booking_status end,
      confirmed_at = case when booking_status in ('HELD', 'DEPOSIT_PENDING') then coalesce(confirmed_at, now()) else confirmed_at end,
      booked_at = case when booking_status in ('HELD', 'DEPOSIT_PENDING') then coalesce(booked_at, now()) else booked_at end,
      seat_hold_expires_at = case when booking_status = 'HELD' then null else seat_hold_expires_at end
  where id = b.id;

  if old_status = 'HELD' then
    update public.departure_groups
    set held_seats = greatest(held_seats - b.traveller_count, 0),
        booked_seats = booked_seats + b.traveller_count,
        available_seats = greatest(capacity - (booked_seats + b.traveller_count) - greatest(held_seats - b.traveller_count, 0), 0),
        updated_at = now()
    where id = b.departure_group_id;
  end if;

  update public.departure_group_pilgrims
  set payment_status = case
        when (b.total_booking_value) <= 0 or (b.amount_paid + p_amount) >= b.total_booking_value then 'PAID_IN_FULL'
        when (b.amount_paid + p_amount) > 0 then 'PARTIAL'
        else 'NOT_STARTED' end,
      seat_status = case when seat_status = 'HELD' then 'CONFIRMED' else seat_status end
  where booking_id = b.id and payment_status <> 'REFUND_PENDING';

  return jsonb_build_object(
    'payment_id', pmt_id,
    'outstanding_balance', greatest(b.total_booking_value - (b.amount_paid + p_amount), 0)
  );
end;
$$;
