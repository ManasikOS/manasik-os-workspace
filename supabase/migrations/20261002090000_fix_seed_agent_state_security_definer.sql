-- 20260921090000's `seed_departure_group_agent_state()` trigger inserts into
-- `departure_group_agent_state`, but every write policy on that table is
-- service-role only (20260919090000 §G) — there is no INSERT policy for
-- `authenticated`. The function was declared without `security definer`, so
-- it ran as the invoking (authenticated) role and its insert was rejected by
-- RLS. Because the trigger fires `after insert on departure_groups` inside
-- the same transaction, that RLS failure aborted the whole departure-group
-- creation — exactly the outcome the migration's own comment says must
-- never happen "over a scheduling-table convenience row".
--
-- Fix: `security definer` (same pattern as every other trigger function in
-- this schema that must write past RLS on behalf of an authenticated caller,
-- e.g. 20260825090000_whatsapp_channel.sql, 20260927090000_cron_jobs.sql) so
-- the insert runs as the function's owner and bypasses RLS, while
-- `set search_path = public` (already present) keeps it from resolving an
-- attacker-controlled search_path.
create or replace function public.seed_departure_group_agent_state()
returns trigger
language plpgsql
security definer
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
  'Gives every new departure group a departure_group_agent_state row at INHERIT/now() so the Departure Operations Agent sweep picks it up without a separate backfill step. security definer: departure_group_agent_state has no authenticated write policy (service-role only), so this must run as the table owner to get past RLS on behalf of whichever staff member created the group. See docs/modules/departure-operations-agent-implementation-plan.md §10.2.';
