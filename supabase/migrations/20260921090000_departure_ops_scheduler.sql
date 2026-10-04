-- Phase 5 of docs/modules/departure-operations-agent-implementation-plan.md: the
-- scheduler. The sweep (§10.2) selects due groups by querying
-- `departure_group_agent_state` directly — `next_run_at <= now() and mode
-- <> 'OFF'`, per that table's own partial index from 20260919090000. That
-- only works if every departure group actually has a state row; Phase 1
-- created the table but nothing that populates it per group. This
-- migration closes that gap: a backfill for every group that exists today,
-- and a trigger so every group created from here on gets one automatically
-- — the same pattern `ai_settings`' own per-agency seed insert already
-- uses in 20260919090000 §A.

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill. `agency_id is not null` matters here: a handful of
-- pre-tenancy-retrofit rows could in principle still carry a null
-- agency_id, and departure_group_agent_state.agency_id is NOT NULL — one
-- such row would fail the whole INSERT ... SELECT otherwise. A group that
-- genuinely has no agency is not reviewable regardless; it is excluded
-- rather than blocking every other group's backfill.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.departure_group_agent_state (departure_group_id, agency_id)
select id, agency_id
from public.departure_groups
where agency_id is not null
on conflict (departure_group_id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger. Same null-guard as the backfill, for the same reason — and
-- because a trigger runs inside the inserting transaction, letting a
-- constraint violation here escape would abort the group creation itself,
-- which must never happen over a scheduling-table convenience row.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.seed_departure_group_agent_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.agency_id is not null then
    insert into public.departure_group_agent_state (departure_group_id, agency_id)
    values (new.id, new.agency_id)
    on conflict (departure_group_id) do nothing;
  end if;
  return new;
end;
$$;

comment on function public.seed_departure_group_agent_state() is
  'Gives every new departure group a departure_group_agent_state row at INHERIT/now() so the Departure Operations Agent sweep picks it up without a separate backfill step. See docs/modules/departure-operations-agent-implementation-plan.md §10.2.';

drop trigger if exists departure_groups_seed_agent_state on public.departure_groups;
create trigger departure_groups_seed_agent_state
  after insert on public.departure_groups
  for each row execute function public.seed_departure_group_agent_state();
