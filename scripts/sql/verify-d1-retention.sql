-- Verifies D1 (docs/inbox/scale-inngest-implementation-plan.md, Phase D) against a database where
-- 20261204090500_d1_retention_raw_events_and_jobs.sql is applied. One transaction, rolled back by the final exception.
-- To dry-run the migration first, run the migration file followed by this file as ONE batch.
--
-- Result: a failed check raises "D1 FAILED: ..."; when every check passes it raises "D1 PASSED (rolled back)" with one line per check.
do $do$
declare
  v_agency uuid; v_n int; v_out text := ''; v_left int;
begin
  insert into public.agencies (name, slug) values ('d1-a', 'd1-a-' || substr(md5(random()::text), 1, 8)) returning id into v_agency;

  -- The columns the sweep reads exist (the old scopes named columns that did not).
  perform id, received_at from public.whatsapp_webhook_events where agency_id = v_agency and received_at < now() order by received_at, id limit 1;
  perform id, received_at from public.channel_webhook_events where agency_id = v_agency and received_at < now() order by received_at, id limit 1;
  perform conversation_id, computed_at from public.conversation_intelligence where agency_id = v_agency order by computed_at, conversation_id limit 1;
  perform id, created_at from public.channel_jobs where agency_id = v_agency and status in ('DONE','DEAD') order by created_at, id limit 1;
  perform id, created_at from public.agent_jobs where agency_id = v_agency and status in ('DONE','DEAD') order by created_at, id limit 1;
  v_out := v_out || E'\nevery column the sweep reads exists';

  insert into public.whatsapp_webhook_events (agency_id, external_event_id, payload, signature_valid, received_at) values
    (null, 'd1-old-unknown', '{}', true,  now() - interval '31 days'),
    (null, 'd1-old-forged',  '{}', false, now() - interval '45 days'),
    (null, 'd1-recent',      '{}', true,  now() - interval '5 days'),
    (v_agency, 'd1-old-agency', '{}', true, now() - interval '60 days');
  insert into public.channel_webhook_events (provider, agency_id, external_event_id, payload, signature_valid, received_at) values
    ('MESSENGER', null, 'd1-c-old', '{}', true, now() - interval '31 days'),
    ('MESSENGER', null, 'd1-c-new', '{}', true, now() - interval '1 day');

  select public.purge_unattributed_raw_events(30, 2000) into v_n;
  if v_n < 3 then raise exception 'D1 FAILED: purged % (expected at least the 3 old agency-less fixtures)', v_n; end if;
  if exists (select 1 from public.whatsapp_webhook_events where external_event_id in ('d1-old-unknown','d1-old-forged'))
     or exists (select 1 from public.channel_webhook_events where external_event_id = 'd1-c-old') then
    raise exception 'D1 FAILED: an old agency-less delivery survived';
  end if;
  v_out := v_out || E'\nold agency-less deliveries (unknown number, forged signature) are purged';
  if not exists (select 1 from public.whatsapp_webhook_events where external_event_id = 'd1-recent')
     or not exists (select 1 from public.channel_webhook_events where external_event_id = 'd1-c-new') then
    raise exception 'D1 FAILED: a recent agency-less delivery was purged';
  end if;
  if not exists (select 1 from public.whatsapp_webhook_events where external_event_id = 'd1-old-agency') then
    raise exception 'D1 FAILED: an agency-attributed delivery was purged here (the per-agency sweep owns those)';
  end if;
  v_out := v_out || E'\nrecent ones and every agency-attributed one are left alone';

  insert into public.whatsapp_webhook_events (agency_id, external_event_id, payload, signature_valid, received_at)
    select null, 'd1-bulk-' || g, '{}', true, now() - interval '40 days' from generate_series(1, 25) g;
  select public.purge_unattributed_raw_events(30, 10) into v_n;
  select count(*) into v_left from public.whatsapp_webhook_events where external_event_id like 'd1-bulk-%';
  if v_left <> 15 then raise exception 'D1 FAILED: a batch of 10 left % of 25 (expected 15)', v_left; end if;
  v_out := v_out || E'\na batch is bounded';

  if has_function_privilege('authenticated', 'public.purge_unattributed_raw_events(integer,integer)', 'execute')
     or has_function_privilege('anon', 'public.purge_unattributed_raw_events(integer,integer)', 'execute') then
    raise exception 'D1 FAILED: a signed-in or anonymous role can run the purge';
  end if;
  v_out := v_out || E'\nonly the service role can run it';

  raise exception 'D1 PASSED (rolled back)%', v_out;
end
$do$;
