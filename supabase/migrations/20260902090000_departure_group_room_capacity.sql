-- `departure_group_rooms.assigned_pilgrim_count` only ever had a `>= 0`
-- check — nothing at the database level ties it to `occupancy_capacity`, the
-- same class of gap `20260810090000_departure_groups_supabase_fixes.sql`
-- closed for `departure_groups.booked_seats + held_seats <= capacity`.
--
-- The application enforces the same rule (`assignGroupPilgrimToRoomInStore`
-- in lib/data/departure-groups-rooming.ts refuses an assignment once
-- `assigned_pilgrim_count >= occupancy_capacity`), but that check runs
-- between a read and a write with no row lock in between: two concurrent
-- assignments to the same room can both pass the application's check before
-- either write lands, over-filling the room. This is the database-level
-- backstop for that race, exactly as the seat-capacity constraint backstops
-- concurrent bookings — the application still returns the friendly "this
-- room is full" message; this only catches the two-writers-at-once case.
--
-- `not valid` for the same reason as the seat-capacity fix: it applies to
-- every write from here on without requiring a scan of existing rows to
-- validate history that the application has already kept correct.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'departure_group_rooms_occupancy_within_capacity'
  ) then
    alter table public.departure_group_rooms
      add constraint departure_group_rooms_occupancy_within_capacity
      check (assigned_pilgrim_count <= occupancy_capacity) not valid;
  end if;
end;
$$;
