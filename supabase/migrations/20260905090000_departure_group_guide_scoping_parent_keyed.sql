-- Closes the residual gap `20260903090000_departure_group_guide_scoping.sql`
-- documented and deliberately left open: `departure_group_flight_legs`,
-- `departure_group_rooms` and `departure_group_room_assignments` carry no
-- `departure_group_id` column of their own, so the straight
-- `staff_assigned_to_group(departure_group_id)` clause that migration used
-- for the other ten tables does not apply here — each reaches its group only
-- through a parent (or, for room_assignments, a grandparent) table.
--
-- Same technique as that migration: read each policy's *live* expression
-- from `pg_policies` and fold the GUIDE clause into it, rather than
-- hand-transcribing a fresh `using (true)` that would silently drop the
-- `agency_id = current_agency_id()` tenant clause folded in by
-- `20260824090000_tenancy.sql` §E.
do $$
declare
  pol record;
  guide_clause text;
  new_qual text;
  new_check text;
  check_clause text;
  join_clauses text[] := array[
    -- departure_group_flight_legs -> departure_group_flights (flight_id)
    'exists (select 1 from public.departure_group_flights f where f.id = %1$I.flight_id and public.staff_assigned_to_group(f.departure_group_id))',
    -- departure_group_rooms -> departure_group_accommodations (accommodation_id)
    'exists (select 1 from public.departure_group_accommodations a where a.id = %1$I.accommodation_id and public.staff_assigned_to_group(a.departure_group_id))',
    -- departure_group_room_assignments -> departure_group_rooms -> departure_group_accommodations (room_id)
    'exists (select 1 from public.departure_group_rooms r join public.departure_group_accommodations a on a.id = r.accommodation_id where r.id = %1$I.room_id and public.staff_assigned_to_group(a.departure_group_id))'
  ];
  scoped_tables text[] := array[
    'departure_group_flight_legs', 'departure_group_rooms', 'departure_group_room_assignments'
  ];
  tbl_index int;
begin
  for pol in
    select schemaname, tablename, policyname, cmd, roles, permissive, qual, with_check
    from pg_policies
    where schemaname = 'public' and tablename = any(scoped_tables)
  loop
    tbl_index := array_position(scoped_tables, pol.tablename);
    guide_clause := format(
      'not public.staff_role_in(''GUIDE'') or ' || join_clauses[tbl_index],
      pol.tablename
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
