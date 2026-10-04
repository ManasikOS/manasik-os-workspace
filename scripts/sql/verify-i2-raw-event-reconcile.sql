-- Verifies I2 (docs/inbox/scale-inngest-implementation-plan.md, Phase I) against a database where
-- 20261204090400_i2_raw_event_reconcile.sql is applied. Everything runs in one transaction that is rolled back by the final exception.
-- To dry-run the migration first, run the migration file followed by this file as ONE batch.
--
-- Result: a failed check raises "I2 FAILED: ..."; when every check passes it raises "I2 PASSED (rolled back)" with one line per check.
do $do$
declare
  v_out text := '';
  v_agency uuid;
  v_found uuid[]; v_n int;
  e_ok uuid; e_young uuid; e_old uuid; e_status uuid; e_done uuid; e_unsigned uuid; e_orphan uuid; e_err uuid;
  v_msgs jsonb := '{"entry":[{"changes":[{"value":{"messages":[{"id":"wamid.x"}]}}]}]}';
  v_status jsonb := '{"entry":[{"changes":[{"value":{"statuses":[{"id":"wamid.x"}]}}]}]}';
  v_error text; v_processed timestamptz;
  c_ok uuid; c_status uuid;
begin
  insert into public.agencies (name, slug) values ('i2-a', 'i2-a-' || substr(md5(random()::text), 1, 8)) returning id into v_agency;

  insert into public.whatsapp_webhook_events (agency_id, external_event_id, payload, signature_valid, received_at)
    values (v_agency, 'i2-ok', v_msgs, true, now() - interval '5 minutes') returning id into e_ok;
  insert into public.whatsapp_webhook_events (agency_id, external_event_id, payload, signature_valid, received_at)
    values (v_agency, 'i2-young', v_msgs, true, now() - interval '10 seconds') returning id into e_young;
  insert into public.whatsapp_webhook_events (agency_id, external_event_id, payload, signature_valid, received_at)
    values (v_agency, 'i2-old', v_msgs, true, now() - interval '7 hours') returning id into e_old;
  insert into public.whatsapp_webhook_events (agency_id, external_event_id, payload, signature_valid, received_at)
    values (v_agency, 'i2-status', v_status, true, now() - interval '5 minutes') returning id into e_status;
  insert into public.whatsapp_webhook_events (agency_id, external_event_id, payload, signature_valid, received_at, processed_at)
    values (v_agency, 'i2-done', v_msgs, true, now() - interval '5 minutes', now()) returning id into e_done;
  insert into public.whatsapp_webhook_events (agency_id, external_event_id, payload, signature_valid, received_at)
    values (v_agency, 'i2-unsigned', v_msgs, false, now() - interval '5 minutes') returning id into e_unsigned;
  insert into public.whatsapp_webhook_events (agency_id, external_event_id, payload, signature_valid, received_at)
    values (null, 'i2-orphan', v_msgs, true, now() - interval '5 minutes') returning id into e_orphan;
  insert into public.whatsapp_webhook_events (agency_id, external_event_id, payload, signature_valid, received_at, error)
    values (v_agency, 'i2-err', v_msgs, true, now() - interval '30 minutes', 'reconcile: earlier failure') returning id into e_err;

  -- 1. Candidates: signed, tenant-resolved, unhandled, holding messages, inside the age window. Nothing else.
  select array_agg(f.id order by f.error is not null, f.id) into v_found
    from public.find_unreconciled_raw_events('WHATSAPP', 120, 6 * 3600, 500) f
   where f.id in (e_ok, e_young, e_old, e_status, e_done, e_unsigned, e_orphan, e_err);
  if v_found is null or not (v_found @> array[e_ok, e_err]) or array_length(v_found, 1) <> 2 then
    raise exception 'I2 FAILED: candidates were % (expected exactly the aged, unhandled, signed, tenant-resolved deliveries with messages)', v_found;
  end if;
  v_out := v_out || E'\nonly aged, unhandled, signed, tenant-resolved deliveries that hold messages are candidates';

  -- 2. An event that failed before sorts after one that has not, so a stubborn event does not hold up the rest.
  if (select f.id from public.find_unreconciled_raw_events('WHATSAPP', 120, 6 * 3600, 500) f where f.id in (e_ok, e_err) limit 1) <> e_ok then
    raise exception 'I2 FAILED: a previously failed event was returned before a fresh one';
  end if;
  v_out := v_out || E'\na previously failed event sorts after a fresh one';

  -- 3. Marking: success stamps processed_at once; failure records a truncated message and stays eligible.
  select public.mark_raw_events_reconciled('WHATSAPP', array[e_ok], null) into v_n;
  select processed_at, error into v_processed, v_error from public.whatsapp_webhook_events where id = e_ok;
  if v_n <> 1 or v_processed is null or v_error is not null then raise exception 'I2 FAILED: success mark left processed_at %, error %', v_processed, v_error; end if;
  select public.mark_raw_events_reconciled('WHATSAPP', array[e_ok], null) into v_n;
  if v_n <> 0 then raise exception 'I2 FAILED: an already handled event was marked again (%)', v_n; end if;
  perform public.mark_raw_events_reconciled('WHATSAPP', array[e_err], repeat('x', 500));
  select processed_at, error into v_processed, v_error from public.whatsapp_webhook_events where id = e_err;
  if v_processed is not null or length(v_error) <> 300 then raise exception 'I2 FAILED: failure mark left processed_at %, error length %', v_processed, length(v_error); end if;
  if not exists (select 1 from public.find_unreconciled_raw_events('WHATSAPP', 120, 6 * 3600, 500) f where f.id = e_err) then
    raise exception 'I2 FAILED: a failed event stopped being a candidate';
  end if;
  v_out := v_out || E'\nsuccess stamps processed_at once; a failure keeps the event eligible and stores a truncated message';

  -- 4. Messenger / Instagram deliveries: same rules against channel_webhook_events.
  insert into public.channel_webhook_events (provider, agency_id, external_event_id, payload, signature_valid, received_at)
    values ('MESSENGER', v_agency, 'i2-c-ok', '{"entry":[{"id":"P","messaging":[{"message":{"mid":"m"}}]}]}', true, now() - interval '5 minutes') returning id into c_ok;
  insert into public.channel_webhook_events (provider, agency_id, external_event_id, payload, signature_valid, received_at)
    values ('INSTAGRAM', v_agency, 'i2-c-none', '{"entry":[{"id":"P"}]}', true, now() - interval '5 minutes') returning id into c_status;
  select array_agg(f.id) into v_found from public.find_unreconciled_raw_events('CHANNEL', 120, 6 * 3600, 500) f where f.id in (c_ok, c_status);
  if v_found is null or v_found <> array[c_ok] then raise exception 'I2 FAILED: channel candidates were %', v_found; end if;
  if (select f.provider from public.find_unreconciled_raw_events('CHANNEL', 120, 6 * 3600, 500) f where f.id = c_ok) <> 'MESSENGER' then
    raise exception 'I2 FAILED: the provider was not returned';
  end if;
  perform public.mark_raw_events_reconciled('CHANNEL', array[c_ok], null);
  if (select processed_at from public.channel_webhook_events where id = c_ok) is null then raise exception 'I2 FAILED: channel event not stamped'; end if;
  v_out := v_out || E'\nchannel deliveries follow the same rules and return their provider';

  -- 5. Unknown source, and lock-down.
  begin perform * from public.find_unreconciled_raw_events('NOPE', 1, 2, 3); raise exception 'Q'; exception when raise_exception then
    if sqlerrm = 'Q' then raise exception 'I2 FAILED: an unknown source was accepted'; end if; end;
  if has_function_privilege('authenticated', 'public.find_unreconciled_raw_events(text,integer,integer,integer)', 'execute')
     or has_function_privilege('anon', 'public.mark_raw_events_reconciled(text,uuid[],text)', 'execute') then
    raise exception 'I2 FAILED: a signed-in or anonymous role can run the reconciler functions';
  end if;
  v_out := v_out || E'\nan unknown source is refused and only the service role can run the functions';

  raise exception 'I2 PASSED (rolled back)%', v_out;
end
$do$;
