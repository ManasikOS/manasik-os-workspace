-- Generic transaction boundary for the departure-group store. The client sends
-- only changed rows and deleted primary keys; this function applies the same
-- parent-before-child order as the in-memory repository in one transaction.

create or replace function public.seed_departure_booking_finance_atomic(p_booking_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  bk record;
  s record;
  pr record;
  item jsonb;
  seq integer := 0;
  running numeric(14,2) := 0;
  item_amount numeric(14,2);
  total numeric(14,2);
  due_at_value timestamptz;
  opening_id uuid;
  remaining numeric(14,2);
  applied numeric(14,2);
  m record;
begin
  if exists (select 1 from public.booking_payment_milestones where booking_id = p_booking_id) then
    return;
  end if;
  select booking_row.*, g.departure_date into strict bk
    from public.departure_group_bookings booking_row
    join public.departure_groups g on g.id = booking_row.departure_group_id
    where booking_row.id = p_booking_id for update;
  total := greatest(coalesce(bk.total_booking_value, 0), 0);
  select payment_schedule_snapshot into s
    from public.departure_group_package_snapshots
    where departure_group_id = bk.departure_group_id;
  select payment_milestones into pr
    from public.departure_group_pricing
    where departure_group_id = bk.departure_group_id;

  for item in select value from jsonb_array_elements(
    coalesce(pr.payment_milestones, s.payment_schedule_snapshot, '[]'::jsonb)
  ) loop
    seq := seq + 1;
    item_amount := case
      when lower(coalesce(item->>'amount_type', 'Fixed')) = 'percentage'
        then round(total * coalesce((item->>'amount')::numeric, 0) / 100, 2)
      when lower(coalesce(item->>'amount_type', 'Fixed')) in ('remaining balance', 'remaining_balance')
        then greatest(total - running, 0)
      else greatest(coalesce((item->>'amount')::numeric, 0), 0)
    end;
    running := round(running + item_amount, 2);
    due_at_value := case
      when lower(coalesce(item->>'due_rule', '')) = 'on booking' then bk.created_at
      when lower(coalesce(item->>'due_rule', '')) = 'fixed date' and nullif(item->>'due_date', '') is not null
        then ((item->>'due_date')::date + time '17:00') at time zone 'UTC'
      when lower(coalesce(item->>'due_rule', '')) = 'days before departure'
        then ((bk.departure_date - coalesce((item->>'days_before_departure')::integer, 0))::date + time '17:00') at time zone 'UTC'
      else null
    end;
    insert into public.booking_payment_milestones
      (booking_id, departure_group_id, agency_id, sequence, label, milestone_type, amount, due_at)
    values (bk.id, bk.departure_group_id, bk.agency_id, seq,
      coalesce(nullif(item->>'label', ''), 'Instalment ' || seq),
      case when seq = 1 then 'DEPOSIT' when lower(coalesce(item->>'label','')) like '%final%' then 'FINAL_BALANCE' else 'INSTALMENT' end,
      item_amount, due_at_value);
  end loop;

  if seq = 0 then
    insert into public.booking_payment_milestones
      (booking_id, departure_group_id, agency_id, sequence, label, milestone_type, amount, due_at)
    values (bk.id, bk.departure_group_id, bk.agency_id, 1, 'Full Balance', 'FINAL_BALANCE', total, bk.created_at);
  elsif round(running, 2) <> round(total, 2) then
    update public.booking_payment_milestones
      set amount = greatest(amount + round(total - running, 2), 0)
      where booking_id = bk.id and sequence = seq;
  end if;

  -- Mirror a historical opening balance exactly once. This is a ledger record,
  -- not a new cash receipt, and is allocated oldest-due-first.
  if coalesce(bk.amount_paid, 0) > 0 and not exists (
    select 1 from public.payments where booking_id = bk.id and internal_note = 'Opening balance mirrored from booking creation'
  ) then
    insert into public.payments
      (payment_reference, booking_id, departure_group_id, agency_id, amount, currency, paid_at, method, status, internal_note, recorded_by_name)
    values ('OPEN-' || replace(bk.booking_reference, ' ', '-') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
      bk.id, bk.departure_group_id, bk.agency_id, bk.amount_paid, coalesce(bk.currency, 'LKR'), bk.created_at, 'OTHER', 'COMPLETED',
      'Opening balance mirrored from booking creation', 'System') returning id into opening_id;
    remaining := bk.amount_paid;
    for m in select id, amount, paid_amount from public.booking_payment_milestones
      where booking_id = bk.id and not waived and paid_amount < amount
      order by due_at asc nulls last, sequence asc for update loop
      exit when remaining <= 0;
      applied := least(remaining, greatest(m.amount - m.paid_amount, 0));
      if applied > 0 then
        insert into public.payment_allocations(payment_id, milestone_id, amount) values (opening_id, m.id, applied);
        remaining := remaining - applied;
      end if;
    end loop;
  end if;
end;
$$;
