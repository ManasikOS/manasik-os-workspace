-- Phase B, increment 1: database invariants for Finance's booking projection.
-- This migration is additive and intentionally does not backfill or alter
-- existing balances. Apply only after the Phase A inventory is reviewed.

create or replace function public.validate_booking_finance_parent()
returns trigger
language plpgsql
as $$
declare
  parent_group uuid;
  parent_agency uuid;
begin
  select departure_group_id, agency_id
    into parent_group, parent_agency
  from public.departure_group_bookings
  where id = new.booking_id;

  if parent_group is null then
    raise exception 'Finance row % references a missing booking %', tg_table_name, new.booking_id
      using errcode = '23503';
  end if;
  if new.departure_group_id is distinct from parent_group then
    raise exception 'Finance row % has group %, booking % belongs to %', tg_table_name,
      new.departure_group_id, new.booking_id, parent_group using errcode = '23514';
  end if;
  if new.agency_id is distinct from parent_agency then
    raise exception 'Finance row % has tenant %, booking % belongs to %', tg_table_name,
      new.agency_id, new.booking_id, parent_agency using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists booking_payment_milestones_parent_guard on public.booking_payment_milestones;
create trigger booking_payment_milestones_parent_guard
  before insert or update on public.booking_payment_milestones
  for each row execute function public.validate_booking_finance_parent();

drop trigger if exists payment_allocations_parent_guard on public.payment_allocations;
create or replace function public.validate_payment_allocation_parent()
returns trigger
language plpgsql
as $$
declare
  payment_booking uuid;
  milestone_booking uuid;
begin
  select booking_id into payment_booking from public.payments where id = new.payment_id;
  select booking_id into milestone_booking from public.booking_payment_milestones where id = new.milestone_id;
  if payment_booking is null or milestone_booking is null or payment_booking is distinct from milestone_booking then
    raise exception 'Payment allocation % crosses booking ownership', new.id using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger payment_allocations_parent_guard
  before insert or update on public.payment_allocations
  for each row execute function public.validate_payment_allocation_parent();

create index if not exists booking_payment_milestones_agency_booking_idx
  on public.booking_payment_milestones (agency_id, booking_id, sequence);

comment on function public.validate_booking_finance_parent() is
  'Rejects booking Finance schedule rows whose group or tenant differs from the booking parent.';
comment on function public.validate_payment_allocation_parent() is
  'Rejects payment allocations that cross booking ownership.';
