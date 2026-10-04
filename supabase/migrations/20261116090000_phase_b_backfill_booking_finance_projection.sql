-- Backfill bookings created after the original Finance migration.  This is
-- deliberately conservative: only schedules that can be proven to reconcile
-- to the booking total are expanded; every other booking receives one
-- FINAL_BALANCE row so it cannot disappear from receivables and aging.
do $$
declare
  bk record;
  schedule jsonb;
  fixed_total numeric(14,2);
  seq integer;
  item jsonb;
  mrow record;
  allocated numeric(14,2);
  v_amount numeric(14,2);
begin
  for bk in
    select b.id, b.departure_group_id, b.agency_id, b.total_booking_value,
           b.amount_paid, b.next_due_at
    from public.departure_group_bookings b
    where not exists (
      select 1 from public.booking_payment_milestones m where m.booking_id = b.id
    )
  loop
    select coalesce(s.payment_schedule_snapshot, '[]'::jsonb)
      into schedule
      from public.departure_group_package_snapshots s
      where s.departure_group_id = bk.departure_group_id
      order by s.copied_at desc
      limit 1;

    select coalesce(sum((value ->> 'amount')::numeric), 0)
      into fixed_total
      from jsonb_array_elements(coalesce(schedule, '[]'::jsonb)) value
      where coalesce(value ->> 'amount_type', 'Fixed') <> 'Percentage'
        and (value ->> 'amount') is not null;

    if fixed_total = bk.total_booking_value and fixed_total > 0 then
      seq := 0;
      allocated := 0;
      for item in select value from jsonb_array_elements(schedule) value order by (value ->> 'due_date') nulls last loop
        if coalesce(item ->> 'amount_type', 'Fixed') = 'Percentage' or (item ->> 'amount') is null then
          continue;
        end if;
        seq := seq + 1;
        v_amount := (item ->> 'amount')::numeric;
        allocated := allocated + v_amount;
        insert into public.booking_payment_milestones
          (booking_id, departure_group_id, agency_id, sequence, label, milestone_type, amount, due_at)
        values (
          bk.id, bk.departure_group_id, bk.agency_id, seq,
          coalesce(nullif(item ->> 'label', ''), 'Instalment ' || seq),
          case when seq = 1 then 'DEPOSIT'
               when seq = jsonb_array_length(schedule) then 'FINAL_BALANCE'
               else 'INSTALMENT' end,
          v_amount, nullif(item ->> 'due_date', '')::timestamptz
        );
      end loop;
    else
      insert into public.booking_payment_milestones
        (booking_id, departure_group_id, agency_id, sequence, label, milestone_type, amount, due_at)
      values (bk.id, bk.departure_group_id, bk.agency_id, 1, 'Full Balance',
              'FINAL_BALANCE', bk.total_booking_value, bk.next_due_at);
    end if;

    -- Keep the new projection aligned with the already-recorded booking paid
    -- total.  This does not create a fabricated payment ledger entry.
    allocated := bk.amount_paid;
    for mrow in
      select m.id, m.amount as milestone_amount
      from public.booking_payment_milestones m
      where m.booking_id = bk.id order by m.due_at nulls last, m.sequence
    loop
      exit when allocated <= 0;
      v_amount := least(allocated, mrow.milestone_amount);
      update public.booking_payment_milestones
        set paid_amount = v_amount, paid_at = case when v_amount > 0 then now() else null end
        where id = mrow.id;
      allocated := allocated - v_amount;
    end loop;
  end loop;
end;
$$;
