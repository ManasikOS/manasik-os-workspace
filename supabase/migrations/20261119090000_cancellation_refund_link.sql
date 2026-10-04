-- Make a cancellation refund an auditable Finance liability in the same
-- database transaction as the booking cancellation.  The application stores
-- the requested amount on the booking; this trigger creates the Finance case
-- exactly once and is therefore safe across retries and partial client flows.

alter table public.departure_group_bookings
  add column if not exists cancellation_refund_amount numeric(14, 2) not null default 0
  check (cancellation_refund_amount >= 0);

create or replace function public.create_cancellation_refund_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.booking_status = 'CANCELLED'
     and (old.booking_status is distinct from 'CANCELLED')
     and new.cancellation_refund_amount > 0 then
    if not exists (
      select 1 from public.refund_requests r
      where r.booking_id = new.id and r.reason = 'CANCELLATION'
    ) then
      insert into public.refund_requests (
        reference, booking_id, departure_group_id, reason, reason_note,
        amount, currency, requested_by, requested_by_name
      ) values (
        'CAN-' || replace(new.booking_reference, ' ', '-') || '-' ||
          substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
        new.id, new.departure_group_id, 'CANCELLATION',
        'Created automatically from booking cancellation',
        new.cancellation_refund_amount, coalesce(new.currency, 'LKR'),
        auth.uid(), 'Booking cancellation'
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists booking_cancellation_refund_request on public.departure_group_bookings;
create trigger booking_cancellation_refund_request
  after update of booking_status, cancellation_refund_amount
  on public.departure_group_bookings
  for each row execute function public.create_cancellation_refund_request();

comment on column public.departure_group_bookings.cancellation_refund_amount is
  'Refund liability requested at cancellation; a trigger creates the idempotent Finance refund request.';
