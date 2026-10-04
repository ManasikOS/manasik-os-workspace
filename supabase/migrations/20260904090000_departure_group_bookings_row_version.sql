-- Optimistic-concurrency guard for `departure_group_bookings`.
--
-- `persistStore()` (lib/data/departure-groups-repository.ts) has always
-- written every mutated row with a blind `upsert` — the last writer to reach
-- the database wins outright, with no check that the row it is about to
-- overwrite still looks like the row it loaded. For most tables in this
-- schema that is an acceptable trade (the Rooming and Departure Groups tabs
-- are one operator at a time in practice); for `departure_group_bookings` it
-- is not, because `amount_paid` / `outstanding_balance` are accumulator
-- columns two independent payments can legitimately touch within the same
-- few seconds. Two staff — or a staff member and the WhatsApp AI agent —
-- recording a payment against the same booking at the same moment both load
-- `amount_paid = 100`, both add their own amount, and whichever write lands
-- second silently discards the first payment's contribution. A customer's
-- money goes missing with no error, no log line, nothing to reconcile
-- against — the worst kind of bug this schema has.
--
-- `row_version` closes that: every UPDATE increments it via trigger (never
-- the application, which is what keeps this reliable — see
-- `20260824090000_tenancy.sql`'s `agency_id` comment for the same reasoning
-- applied to a different column), and `persistStore()`'s guarded-update path
-- for this one collection conditions every write on the version it loaded.
-- A second writer's version has already moved by the time the loser's write
-- lands, so the loser's `UPDATE ... WHERE row_version = ?` matches zero
-- rows instead of silently succeeding — surfaced through `mutate()`
-- (departure-groups.ts) as an ordinary, retryable "this booking was just
-- updated elsewhere" outcome rather than a lost payment.
alter table public.departure_group_bookings
  add column if not exists row_version integer not null default 1;

create or replace function public.bump_departure_group_booking_row_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.row_version = old.row_version + 1;
  return new;
end;
$$;

drop trigger if exists departure_group_bookings_bump_row_version on public.departure_group_bookings;
create trigger departure_group_bookings_bump_row_version
  before update on public.departure_group_bookings
  for each row execute function public.bump_departure_group_booking_row_version();
