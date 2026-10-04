-- Lets a pilgrim hold one room per accommodation instead of one room, period.
--
-- Context: `departure_group_room_assignments_pilgrim_unique unique (pilgrim_id)`
-- (20260809090000_create_departure_groups.sql) modelled "a pilgrim's room" as
-- a single global bed. That is wrong for the itinerary this schema exists to
-- serve: every Hajj/Umrah departure needs its travellers roomed in Makkah
-- *and* separately in Madinah, at the same time, for different legs of the
-- same trip. Assigning a Madinah room and then a Makkah room silently
-- released the Madinah assignment (the application code deliberately treated
-- a second assignment as a "move" — see `assignPilgrimToRoomInStore` in
-- lib/data/departure-groups-rooming.ts) — that is the "unable to assign in
-- Makkah after Madinah" bug this migration fixes, together with the
-- accompanying application changes.
--
-- `accommodation_id` is denormalized from `room_id`'s accommodation rather
-- than left to a join, so the uniqueness constraint below can actually be
-- expressed and enforced by Postgres.

alter table public.departure_group_room_assignments
  add column if not exists accommodation_id uuid
    references public.departure_group_accommodations (id) on delete cascade;

update public.departure_group_room_assignments a
set accommodation_id = r.accommodation_id
from public.departure_group_rooms r
where r.id = a.room_id
  and a.accommodation_id is null;

alter table public.departure_group_room_assignments
  alter column accommodation_id set not null;

alter table public.departure_group_room_assignments
  drop constraint if exists departure_group_room_assignments_pilgrim_unique;

alter table public.departure_group_room_assignments
  add constraint departure_group_room_assignments_pilgrim_accommodation_unique
    unique (pilgrim_id, accommodation_id);

create index if not exists departure_group_room_assignments_accommodation_idx
  on public.departure_group_room_assignments (accommodation_id);

comment on column public.departure_group_room_assignments.accommodation_id is
  'Denormalized from room_id''s accommodation at write time. Backs the (pilgrim_id, accommodation_id) uniqueness constraint that lets one pilgrim hold a Makkah room and a Madinah room at once.';

notify pgrst, 'reload schema';
