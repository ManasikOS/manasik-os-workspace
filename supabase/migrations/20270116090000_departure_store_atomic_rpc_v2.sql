-- SEC-11 (docs/tasks/TASK-037-departure-groups-security-and-flaw-remediation.md): a version-aware twin of
-- apply_departure_store_changes_atomic, so every departure-group mutation can commit or abort as ONE transaction.
--
-- Why a new function and not an edit of the existing one: apply_departure_store_changes_atomic is live and carries
-- booking creation. This file is a NEW name, so applying it cannot change that path; the application only calls v2 when
-- DEPARTURE_ATOMIC_PERSIST=all is set.
--
-- What v2 adds over v1:
--   1. p_expected_versions: { "<booking id>": <row_version the caller loaded>, ... }. Before anything is written, every
--      listed booking row is locked and its row_version compared. If one has moved, the whole call raises SQLSTATE 40001
--      (serialization_failure) and nothing is written - the same "this booking was just updated elsewhere" outcome the
--      row-by-row path gives, and the guard that stops two payments on one booking losing one of them.
--   2. Columns come from the keys actually present in each table's payload, not from every column of the table. v1 builds its
--      column list from the whole table, so a column missing from the payload (row_version, which the application never
--      writes) is inserted as an explicit NULL; here a missing column is left out, so inserts take the column default and
--      updates leave the stored value alone, which is what the row-by-row path does.
--
-- Same as v1: security invoker (row-level security applies), the caller's agency must match current_agency_id() unless the
-- service role is calling, no row from another agency is accepted, parent-before-child writes, child-first deletes,
-- append-only activity log, and finance milestones seeded for new bookings.
--
-- NOT YET RUN against a database when this was written. Before setting DEPARTURE_ATOMIC_PERSIST=all anywhere, build the
-- migrations on a local database (scripts/local/rebuild-from-migrations.sh), then on staging run the checks in the SEC-11
-- section of the task document.
--
-- Rollback: drop function public.apply_departure_store_changes_atomic_v2(jsonb, jsonb, uuid, uuid[], jsonb);
-- and unset DEPARTURE_ATOMIC_PERSIST.

create or replace function public.apply_departure_store_changes_atomic_v2(
  p_changes jsonb,
  p_deletes jsonb,
  p_agency_id uuid,
  p_new_booking_ids uuid[] default '{}'::uuid[],
  p_expected_versions jsonb default '{}'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order text[] := array[
    'departure_groups', 'departure_group_package_snapshots',
    'departure_group_pricing', 'departure_group_cost_estimates',
    'departure_group_flights', 'departure_group_flight_legs',
    'departure_group_accommodations', 'departure_group_rooms',
    'departure_group_transports', 'departure_group_bookings',
    'departure_group_pilgrims', 'departure_group_pilgrim_documents',
    'departure_group_pilgrim_charges', 'departure_group_pilgrim_deviations',
    'booking_traveller_relationships', 'departure_group_room_assignments',
    'departure_group_readiness_items', 'departure_group_tasks',
    'departure_group_activity_logs'
  ];
  v_table text;
  v_index integer;
  v_booking_id uuid;
  v_payload jsonb;
  v_columns text;
  v_updates text;
  v_pk text;
  v_key text;
  v_expected text;
begin
  if p_agency_id is null
     or (coalesce(auth.role(), '') <> 'service_role'
         and p_agency_id is distinct from public.current_agency_id()) then
    raise exception 'Atomic departure mutation has no valid current agency' using errcode = '42501';
  end if;

  -- Optimistic-concurrency guard: lock each booking this call updates and check it is still the version the caller read.
  for v_key, v_expected in
    select key, value from jsonb_each_text(coalesce(p_expected_versions, '{}'::jsonb))
  loop
    perform 1
      from public.departure_group_bookings b
     where b.id = v_key::uuid
       and b.row_version = v_expected::integer
       for update;
    if not found then
      raise exception 'departure_group_bookings.%: row_version % no longer matches - modified by another write since it was loaded.',
        v_key, v_expected using errcode = '40001';
    end if;
  end loop;

  foreach v_table in array v_order loop
    v_payload := coalesce(p_changes -> v_table, '[]'::jsonb);
    if jsonb_array_length(v_payload) = 0 then continue; end if;
    if exists (
      select 1 from jsonb_array_elements(v_payload) x
      where x ? 'agency_id' and x->>'agency_id' is not null
        and x->>'agency_id' <> p_agency_id::text
    ) then
      raise exception 'Atomic departure mutation contains a row from another agency' using errcode = '42501';
    end if;

    select a.attname into v_pk
    from pg_index i join pg_attribute a
      on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = format('public.%I', v_table)::regclass and i.indisprimary
    order by a.attnum limit 1;

    -- Only the columns this payload actually carries.
    select string_agg(format('%I', a.attname), ', ' order by a.attnum)
      into v_columns
    from pg_attribute a
    where a.attrelid = format('public.%I', v_table)::regclass
      and a.attnum > 0 and not a.attisdropped
      and a.attgenerated = '' and a.attidentity = ''
      and a.attname::text in (
        select k from jsonb_array_elements(v_payload) x, jsonb_object_keys(x) k
      );

    select string_agg(format('%1$I = excluded.%1$I', a.attname), ', ' order by a.attnum)
      into v_updates
    from pg_attribute a
    where a.attrelid = format('public.%I', v_table)::regclass
      and a.attnum > 0 and not a.attisdropped
      and a.attgenerated = '' and a.attidentity = ''
      and a.attname::text <> v_pk
      and a.attname::text in (
        select k from jsonb_array_elements(v_payload) x, jsonb_object_keys(x) k
      );

    if v_updates is null then
      execute format(
        'insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict (%I) do nothing',
        v_table, v_columns, v_columns, v_table, v_pk
      ) using v_payload;
    else
      execute format(
        'insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict (%I) do update set %s',
        v_table, v_columns, v_columns, v_table, v_pk, v_updates
      ) using v_payload;
    end if;
  end loop;

  -- Activity is append-only; all other rows are deleted child-first.
  for v_index in reverse array_lower(v_order, 1)..array_upper(v_order, 1) loop
    v_table := v_order[v_index];
    if v_table = 'departure_group_activity_logs' then continue; end if;
    v_payload := coalesce(p_deletes -> v_table, '[]'::jsonb);
    if jsonb_array_length(v_payload) = 0 then continue; end if;
    select a.attname into v_pk
    from pg_index i join pg_attribute a
      on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = format('public.%I', v_table)::regclass and i.indisprimary
    order by a.attnum limit 1;
    execute format(
      'delete from public.%I where %I::text in (select value from jsonb_array_elements_text($1))',
      v_table, v_pk
    ) using v_payload;
  end loop;

  foreach v_booking_id in array p_new_booking_ids loop
    perform public.seed_departure_booking_finance_atomic(v_booking_id);
  end loop;
end;
$$;

do $$
begin
  revoke all on function public.apply_departure_store_changes_atomic_v2(jsonb, jsonb, uuid, uuid[], jsonb) from public;
  grant execute on function public.apply_departure_store_changes_atomic_v2(jsonb, jsonb, uuid, uuid[], jsonb) to authenticated;
  grant execute on function public.apply_departure_store_changes_atomic_v2(jsonb, jsonb, uuid, uuid[], jsonb) to service_role;
  comment on function public.apply_departure_store_changes_atomic_v2 is
    'Applies a departure-group store diff in parent/child order inside one tenant-checked transaction, guarded by booking row_version.';
end;
$$;
