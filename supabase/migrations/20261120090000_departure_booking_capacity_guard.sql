-- Serialize seat-consuming booking writes per departure group.  The
-- application still performs friendly pre-validation, but this trigger is the
-- authoritative race-safe backstop inside the same database transaction.

create or replace function public.guard_departure_group_booking_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  group_capacity integer;
  booked_seats integer;
begin
  -- hashtextextended gives a stable advisory key without exposing tenant data.
  perform pg_advisory_xact_lock(hashtextextended(new.departure_group_id::text, 0));

  select capacity into group_capacity
  from public.departure_groups
  where id = new.departure_group_id;

  if group_capacity is null then
    raise exception 'Booking % references a missing departure group %', new.id, new.departure_group_id
      using errcode = '23503';
  end if;

  select coalesce(sum(traveller_count), 0)::integer into booked_seats
  from public.departure_group_bookings
  where departure_group_id = new.departure_group_id
    and id <> new.id
    and booking_status not in ('WAITLIST', 'CANCELLED');

  if new.booking_status not in ('WAITLIST', 'CANCELLED') then
    booked_seats := booked_seats + new.traveller_count;
  end if;

  if booked_seats > group_capacity then
    raise exception 'Departure group % has capacity %, booking would require % seats',
      new.departure_group_id, group_capacity, booked_seats using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists departure_booking_capacity_guard on public.departure_group_bookings;
create trigger departure_booking_capacity_guard
  before insert or update of departure_group_id, booking_status, traveller_count
  on public.departure_group_bookings
  for each row execute function public.guard_departure_group_booking_capacity();

comment on function public.guard_departure_group_booking_capacity() is
  'Serializes and rejects over-capacity seat-consuming booking writes per departure group.';
