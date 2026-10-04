begin;

-- TASK-032 S6: the stored per-queue counts must follow a conversation being deleted. One transaction, rolled back. Expect zero rows from finish().
-- Passes on a database built from the repository and on staging after 20270108090000_queue_counts_follow_deletes.sql.

create extension if not exists pgtap with schema extensions;
select plan(5);

insert into public.agencies (id, name, slug, status) values ('10000000-0000-4000-8000-0000000000e1', 'Queue Count Agency', 'queue-count-agency', 'ACTIVE');
insert into public.channel_connections (id, agency_id, provider, provider_account_id, display_name, status)
  values ('20000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', 'WHATSAPP', 'sim-queue-count', 'Queue count (simulated)', 'CONNECTED');
insert into public.conversations (id, agency_id, connection_id, channel, external_conversation_id, contact_name, state, handling_mode, lifecycle_status, last_activity_at)
  values
  ('30000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e1', 'WHATSAPP', '447700900901', 'Queue A', 'HUMAN_ACTIVE', 'HUMAN_ACTIVE', 'OPEN', now()),
  ('30000000-0000-4000-8000-0000000000e2', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e1', 'WHATSAPP', '447700900902', 'Queue B', 'HUMAN_ACTIVE', 'HUMAN_ACTIVE', 'OPEN', now());

select is((select conversation_count from public.conversation_queue_counts where agency_id = '10000000-0000-4000-8000-0000000000e1' and queue_code = 'ALL'), 2, 'Two open conversations are counted in ALL');

delete from public.conversations where id = '30000000-0000-4000-8000-0000000000e1';

select is((select conversation_count from public.conversation_queue_counts where agency_id = '10000000-0000-4000-8000-0000000000e1' and queue_code = 'ALL'), 1, 'Deleting a conversation takes it out of the ALL count');
select is((select conversation_count from public.conversation_queue_counts where agency_id = '10000000-0000-4000-8000-0000000000e1' and queue_code = 'WHATSAPP'), 1, 'and out of its channel queue');

delete from public.conversations where id = '30000000-0000-4000-8000-0000000000e2';

select is((select count(*)::integer from public.conversation_queue_counts where agency_id = '10000000-0000-4000-8000-0000000000e1'), 0, 'Deleting the last one leaves no count rows for the agency');
select is_empty(
  $$select q.agency_id, q.queue_code from public.conversation_queue_counts q
     where q.conversation_count <> (select count(*) from public.conversation_queue_membership m where m.agency_id = q.agency_id and m.queue_code = q.queue_code)$$,
  'Every stored queue count equals its membership rows');

select * from finish();
rollback;
