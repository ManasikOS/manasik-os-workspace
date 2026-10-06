-- SEC-12 (docs/tasks/TASK-037-departure-groups-security-and-flaw-remediation.md): erasing a traveller's sensitive details.
--
-- Adds the marker that says a traveller's passport, contact and file details have been erased (24 months after the group's
-- return date, or earlier at a person's request once the trip is over). The details themselves are cleared by the application
-- (lib/data/departure-groups-erasure.ts); this column is what keeps the nightly sweep from visiting the same traveller twice and
-- lets the screens say "erased" instead of "missing".
--
-- The partial index makes "travellers not yet erased" cheap to list, which is all the sweep asks.
--
-- Rollback: drop index if exists departure_group_pilgrims_not_erased_idx;
--           alter table public.departure_group_pilgrims drop column if exists sensitive_data_erased_at;

alter table public.departure_group_pilgrims
  add column if not exists sensitive_data_erased_at timestamptz;

create index if not exists departure_group_pilgrims_not_erased_idx
  on public.departure_group_pilgrims (departure_group_id)
  where sensitive_data_erased_at is null;
