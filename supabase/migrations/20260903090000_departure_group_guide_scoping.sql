-- Wires GUIDE row-scoping into RLS for the departure_group_* tables.
--
-- `20260822090000_rls_hardening.sql` built `staff_assigned_to_group()`
-- specifically "to scope GUIDE row access" (its own doc comment says so) but
-- then left the 13 core departure_group_* tables at `using (true)` for every
-- authenticated role, reasoning that "every one of the 7 roles has
-- viewModule: true ... so row-level read restriction would be a no-op."
-- That covers the "should this table be visible at all" question; it does
-- not cover GUIDE specifically, whose own capability matrix
-- (`lib/access/departure-groups-access.ts`) sets `restrictedToAssignedGroups:
-- true` — a GUIDE should see only the groups `staff_group_assignments`
-- names them on, everyone else the whole branch. That restriction has only
-- ever been enforced by `filterGroupsForRole()` / `canRoleOpenGroup()` in the
-- Next.js layer; a GUIDE session calling PostgREST or Storage directly (a
-- leaked service key is not required — the anon/session client is enough)
-- reads and writes every group in the agency, including money, passport
-- numbers and other travellers' bookings.
--
-- This folds `not staff_role_in('GUIDE') or staff_assigned_to_group(...)`
-- into whichever expression each policy *currently* carries — read live from
-- `pg_policies`, the same technique `20260824090000_tenancy.sql` §E uses and
-- explains why: "the rewrite can't disagree with what is actually enforced
-- today." By the time this migration runs, every one of these policies
-- already carries `agency_id = current_agency_id() and (...)` from that
-- tenancy pass; hand-transcribing a fresh `using (true)` here — the naive
-- version of this fix — would have silently dropped that tenant clause and
-- reopened cross-agency access while trying to close a role-scoping gap.
--
-- Not covered here: `departure_group_flight_legs` (scoped by `flight_id`),
-- `departure_group_rooms` (`accommodation_id`) and
-- `departure_group_room_assignments` (`room_id`) reach their group only via
-- a parent table, which needs a join-aware helper rather than a straight
-- `staff_assigned_to_group(departure_group_id)` call. Left alone for now —
-- a real but narrower gap (seat maps and room numbers, not money or
-- passport data, which live on the tables this migration does cover) — as a
-- documented follow-up rather than a rushed multi-table join fix with no
-- live database here to verify it against.
do $$
declare
  pol record;
  join_col text;
  guide_clause text;
  new_qual text;
  new_check text;
  check_clause text;
  -- departure_groups' own primary key stands in for the join column that
  -- names it everywhere else (`departure_group_id`).
  scoped_tables text[] := array[
    'departure_groups', 'departure_group_package_snapshots', 'departure_group_flights',
    'departure_group_accommodations', 'departure_group_transports', 'departure_group_bookings',
    'departure_group_pilgrims', 'departure_group_readiness_items', 'departure_group_tasks',
    'departure_group_activity_logs'
  ];
begin
  for pol in
    select schemaname, tablename, policyname, cmd, roles, permissive, qual, with_check
    from pg_policies
    where schemaname = 'public' and tablename = any(scoped_tables)
  loop
    join_col := case when pol.tablename = 'departure_groups' then 'id' else 'departure_group_id' end;
    guide_clause := format(
      'not public.staff_role_in(''GUIDE'') or public.staff_assigned_to_group(%I)', join_col
    );

    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);

    new_qual := case when pol.qual is not null
      then format('(%s) and (%s)', guide_clause, pol.qual)
      else null
    end;
    new_check := case when pol.with_check is not null
      then format('(%s) and (%s)', guide_clause, pol.with_check)
      else null
    end;

    if pol.cmd = 'INSERT' then
      -- INSERT-only policies (departure_group_activity_logs' insert policy)
      -- take WITH CHECK alone — USING is not valid syntax there.
      execute format(
        'create policy %I on public.%I as %s for insert to %s with check (%s)',
        pol.policyname, pol.tablename, pol.permissive,
        array_to_string(pol.roles, ', '),
        coalesce(new_check, guide_clause)
      );
    else
      check_clause := case when new_check is not null
        then format(' with check (%s)', new_check)
        else ''
      end;
      execute format(
        'create policy %I on public.%I as %s for %s to %s using (%s)%s',
        pol.policyname, pol.tablename, pol.permissive, pol.cmd,
        array_to_string(pol.roles, ', '),
        coalesce(new_qual, guide_clause),
        check_clause
      );
    end if;
  end loop;
end $$;
