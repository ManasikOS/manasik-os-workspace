-- 20260823090000_pilgrim_customisation.sql added per-pilgrim charges and
-- deviations and logs both to departure_group_activity_logs with
-- entity_type 'CHARGE' / 'DEVIATION' (see lib/data/departure-groups-charges.ts
-- and lib/data/departure-groups-deviations.ts), but never extended that
-- table's entity_type check constraint to allow either value. Every charge
-- or deviation write has been failing the activity-log insert (and, because
-- persistStore treats the whole mutation as one unit, the charge/deviation
-- itself) ever since.

alter table public.departure_group_activity_logs
  drop constraint if exists departure_group_activity_logs_entity_type_check;

alter table public.departure_group_activity_logs
  add constraint departure_group_activity_logs_entity_type_check
  check (entity_type in ('GROUP', 'FLIGHT', 'ACCOMMODATION', 'ROOM', 'TRANSPORT', 'BOOKING',
                         'PILGRIM', 'PAYMENT', 'READINESS_ITEM', 'TASK', 'DOCUMENT', 'VISA',
                         'CHARGE', 'DEVIATION'));
