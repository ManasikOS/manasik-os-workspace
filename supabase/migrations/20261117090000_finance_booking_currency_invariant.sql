alter table public.departure_group_bookings
  add column if not exists currency text not null default 'LKR';

update public.departure_group_bookings b
set currency = coalesce(nullif(p.currency, ''), 'LKR')
from public.departure_group_pricing p
where p.departure_group_id = b.departure_group_id
  and (b.currency is null or b.currency = 'LKR');

alter table public.departure_group_bookings
  add constraint departure_group_bookings_currency_nonempty
  check (length(trim(currency)) between 3 and 10);

comment on column public.departure_group_bookings.currency is
  'Currency agreed for this booking; immutable contract currency for Finance records.';
