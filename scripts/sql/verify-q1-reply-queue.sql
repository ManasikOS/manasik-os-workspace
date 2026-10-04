-- Verifies Q1 (docs/inbox/scale-inngest-implementation-plan.md §5.1) against a database where 20261204090000_q1_reply_queue.sql is applied.
-- Everything runs in one transaction that is rolled back by the final exception, so nothing is written. It needs at least one
-- conversation to exist (it borrows one, as verify-sc5-scoped-broadcasts.sql does).
--
-- To dry-run the migration itself before applying it, run the migration file followed by this file as ONE batch: the final
-- exception aborts the whole transaction, migration included.
--
-- Result: a failed check raises "Q1 FAILED: ..." naming it. When every check passes the script still raises, so that nothing is
-- kept, with "Q1 PASSED (rolled back)" followed by one line per check.
do $do$
declare
  v_agency uuid; v_conv uuid; v_out text := '';
  v_first record; v_second record; v_third record; v_dup record; v_voice record; v_plain record;
  v_job_a uuid; v_job_b uuid; v_job_c uuid;
  v_n int; v_kind text; v_created timestamptz; v_run_after timestamptz; v_payload jsonb; v_running boolean;
begin
  select agency_id, id into v_agency, v_conv from public.conversations limit 1;
  if v_agency is null then raise exception 'Q1 FAILED: the check needs at least one conversation'; end if;

  -- 1. The kind is accepted.
  insert into public.channel_jobs (agency_id, lane, kind, coalesce_key, payload, status)
    values (v_agency, 'REALTIME', 'REPLY', 'reply:verify-kind', '{}'::jsonb, 'DONE');
  v_out := v_out || E'\nREPLY is accepted as a job kind';

  -- 2. One reply per conversation at a time. A is RUNNING; B, for the SAME conversation, is due and QUEUED; C is another conversation.
  --    Every other QUEUED REALTIME job is parked first so the claims below see only these fixtures.
  update public.channel_jobs set run_after = now() + interval '1 day' where lane = 'REALTIME' and status = 'QUEUED';
  insert into public.channel_jobs (agency_id, lane, kind, coalesce_key, payload, status, locked_at, locked_by, attempts)
    values (v_agency, 'REALTIME', 'REPLY', 'reply:verify-conv-1', '{}'::jsonb, 'RUNNING', now(), 'verify-worker', 1) returning id into v_job_a;
  insert into public.channel_jobs (agency_id, lane, kind, coalesce_key, payload, status, run_after)
    values (v_agency, 'REALTIME', 'REPLY', 'reply:verify-conv-1', '{}'::jsonb, 'QUEUED', now() - interval '1 second') returning id into v_job_b;
  insert into public.channel_jobs (agency_id, lane, kind, coalesce_key, payload, status, run_after)
    values (v_agency, 'REALTIME', 'REPLY', 'reply:verify-conv-2', '{}'::jsonb, 'QUEUED', now() - interval '1 second') returning id into v_job_c;

  select count(*) into v_n from public.claim_channel_jobs('REALTIME', 'verify-claimer', 10, 10) c where c.id = v_job_b;
  if v_n <> 0 then raise exception 'Q1 FAILED: a REPLY was claimed while another for the same conversation was RUNNING'; end if;
  select (status = 'RUNNING') into v_running from public.channel_jobs where id = v_job_c;
  if not v_running then raise exception 'Q1 FAILED: a REPLY for a different conversation was held back'; end if;
  v_out := v_out || E'\nthe claim skips a reply while its conversation already has one running, and does not hold back other conversations';

  update public.channel_jobs set status = 'DONE', locked_at = null, locked_by = null where id in (v_job_a, v_job_c);
  select count(*) into v_n from public.claim_channel_jobs('REALTIME', 'verify-claimer', 10, 10) c where c.id = v_job_b;
  if v_n <> 1 then raise exception 'Q1 FAILED: the queued REPLY was not claimable once the running one finished'; end if;
  v_out := v_out || E'\nthe queued reply is claimed once the running one is done';

  -- 3. Routing. The agency is listed: PROCESS_INBOUND becomes a REPLY job and no agent_jobs row is written.
  insert into public.inbox_reply_queue_agencies (agency_id, enabled_by) values (v_agency, 'verify-q1');
  select * into v_first from public.ingest_inbound_message_atomic(v_agency, v_conv, 'q1-verify-1', 'Hi', 'TEXT', '{}'::jsonb, 'PROCESS_INBOUND', 4);
  select kind, created_at, run_after, payload into v_kind, v_created, v_run_after, v_payload from public.channel_jobs where id = v_first.agent_job_id;
  if v_kind is distinct from 'REPLY' then raise exception 'Q1 FAILED: a listed agency''s PROCESS_INBOUND did not become a REPLY job (got %)', v_kind; end if;
  select count(*) into v_n from public.agent_jobs where id = v_first.agent_job_id;
  if v_n <> 0 then raise exception 'Q1 FAILED: a listed agency also got an agent_jobs row'; end if;
  if v_run_after > now() + interval '10 seconds' then raise exception 'Q1 FAILED: the settle wait exceeded 10 s'; end if;
  v_out := v_out || E'\na listed agency''s PROCESS_INBOUND is a REPLY job on channel_jobs, with no agent_jobs row';

  -- 4. A burst is one reply: the second message merges into the queued job and it now answers the newest message.
  select * into v_second from public.ingest_inbound_message_atomic(v_agency, v_conv, 'q1-verify-2', 'Umrah package', 'TEXT', '{}'::jsonb, 'PROCESS_INBOUND', 4);
  if v_second.agent_job_id is distinct from v_first.agent_job_id then raise exception 'Q1 FAILED: the second message did not merge into the queued REPLY'; end if;
  select count(*) into v_n from public.channel_jobs where agency_id = v_agency and kind = 'REPLY' and status = 'QUEUED' and coalesce_key = 'reply:' || v_conv::text;
  if v_n <> 1 then raise exception 'Q1 FAILED: expected exactly one queued REPLY for the conversation, found %', v_n; end if;
  select payload into v_payload from public.channel_jobs where id = v_first.agent_job_id;
  if (v_payload ->> 'messageId') is distinct from v_second.message_id::text then raise exception 'Q1 FAILED: the merged job does not answer the newest message'; end if;
  v_out := v_out || E'\na second message merges into the queued reply, which now answers the newest message';

  -- The wait can never be pushed past 20 s after the job was first queued, however long the customer keeps typing.
  update public.channel_jobs set created_at = now() - interval '30 seconds', run_after = now() - interval '1 second' where id = v_first.agent_job_id;
  select * into v_third from public.ingest_inbound_message_atomic(v_agency, v_conv, 'q1-verify-3', 'four people', 'TEXT', '{}'::jsonb, 'PROCESS_INBOUND', 10);
  select run_after into v_run_after from public.channel_jobs where id = v_first.agent_job_id;
  if v_run_after > now() then raise exception 'Q1 FAILED: a chatty customer pushed the reply past the 20 s cap (run_after %)', v_run_after; end if;
  v_out := v_out || E'\nthe settle wait is capped at 20 s after the job was first queued';

  -- 5. Voice notes and unlisted agencies keep the old path.
  select * into v_voice from public.ingest_inbound_message_atomic(v_agency, v_conv, 'q1-verify-voice', '', 'AUDIO', '{}'::jsonb, 'TRANSCRIBE_AUDIO', 4);
  select count(*) into v_n from public.agent_jobs where id = v_voice.agent_job_id and kind = 'TRANSCRIBE_AUDIO';
  if v_n <> 1 then raise exception 'Q1 FAILED: a voice note did not stay on agent_jobs'; end if;
  v_out := v_out || E'\na voice note keeps agent_jobs (its follow-up reply is queued by the transcription job)';

  delete from public.inbox_reply_queue_agencies where agency_id = v_agency;
  select * into v_plain from public.ingest_inbound_message_atomic(v_agency, v_conv, 'q1-verify-plain', 'Hello', 'TEXT', '{}'::jsonb, 'PROCESS_INBOUND', 4);
  select count(*) into v_n from public.agent_jobs where id = v_plain.agent_job_id and kind = 'PROCESS_INBOUND';
  if v_n <> 1 then raise exception 'Q1 FAILED: an unlisted agency did not keep the agent_jobs path'; end if;
  v_out := v_out || E'\nan unlisted agency keeps agent_jobs exactly as before';

  -- 6. A duplicate delivery creates nothing.
  select * into v_dup from public.ingest_inbound_message_atomic(v_agency, v_conv, 'q1-verify-1', 'Hi', 'TEXT', '{}'::jsonb, 'PROCESS_INBOUND', 4);
  if not v_dup.is_duplicate or v_dup.agent_job_id is not null or v_dup.enrich_job_id is not null then
    raise exception 'Q1 FAILED: a duplicate delivery was not reported as one, or queued work';
  end if;
  v_out := v_out || E'\na duplicate delivery returns the canonical ids and queues nothing';

  -- 7. One reply intent per inbound message.
  insert into public.reply_intents (agency_id, conversation_id, inbound_message_id) values (v_agency, v_conv, v_first.message_id);
  begin
    insert into public.reply_intents (agency_id, conversation_id, inbound_message_id) values (v_agency, v_conv, v_first.message_id);
    raise exception 'Q1 FAILED: a second reply intent for the same inbound message was accepted';
  exception when unique_violation then
    null;
  end;
  v_out := v_out || E'\na second reply intent for the same inbound message is a unique violation';

  -- 8. Tenants cannot reach any of it.
  if has_table_privilege('authenticated', 'public.reply_intents', 'select')
     or has_table_privilege('anon', 'public.reply_intents', 'select')
     or has_table_privilege('authenticated', 'public.inbox_reply_queue_agencies', 'select')
     or has_table_privilege('anon', 'public.inbox_reply_queue_agencies', 'select')
     or has_function_privilege('authenticated', 'public.claim_channel_jobs(text, text, integer, integer)', 'execute')
     or has_function_privilege('anon', 'public.ingest_inbound_message_atomic(uuid, uuid, text, text, text, jsonb, text, integer)', 'execute')
  then raise exception 'Q1 FAILED: a tenant role can read a new table or call a queue function'; end if;
  v_out := v_out || E'\nthe new tables and the queue functions are closed to anon and authenticated';

  raise exception 'Q1 PASSED (rolled back):%', v_out;
end
$do$;
