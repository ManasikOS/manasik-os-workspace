create or replace function public.apply_departure_store_changes_atomic(
  p_changes jsonb,
  p_deletes jsonb,
  p_agency_id uuid,
  p_new_booking_ids uuid[] default '{}'::uuid[]
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
begin
  if p_agency_id is null
     or (coalesce(auth.role(), '') <> 'service_role'
         and p_agency_id is distinct from public.current_agency_id()) then
    raise exception 'Atomic departure mutation has no valid current agency' using errcode = '42501';
  end if;

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

    select string_agg(format('%I', a.attname), ', ' order by a.attnum)
      into v_columns
    from pg_attribute a
    where a.attrelid = format('public.%I', v_table)::regclass
      and a.attnum > 0 and not a.attisdropped
      and a.attgenerated = '' and a.attidentity = '';

    select a.attname into v_pk
    from pg_index i join pg_attribute a
      on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = format('public.%I', v_table)::regclass and i.indisprimary
    order by a.attnum limit 1;

    select string_agg(format('%1$I = excluded.%1$I', a.attname), ', ' order by a.attnum)
      into v_updates
    from pg_attribute a
    where a.attrelid = format('public.%I', v_table)::regclass
      and a.attnum > 0 and not a.attisdropped
      and a.attgenerated = '' and a.attidentity = ''
      and a.attname <> v_pk;

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
