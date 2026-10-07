-- departure_group_bookings.channel is a staging-only leftover (no code reads or writes it; see 20270106090000_clean_rebuild_alignment.sql).
-- It is NOT NULL with default 'STAFF', but apply_departure_store_changes_atomic builds rows with jsonb_populate_recordset, which supplies an
-- explicit NULL for every key the application does not send, so the default never applies and every booking insert failed with 23502.
-- Make it nullable: a no-op on a fresh build (the column does not exist there). Idempotent.
-- Rollback: update public.departure_group_bookings set channel = 'STAFF' where channel is null; alter column channel set not null.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'departure_group_bookings' and column_name = 'channel'
  ) then
    alter table public.departure_group_bookings alter column channel drop not null;
  end if;
end $$;
