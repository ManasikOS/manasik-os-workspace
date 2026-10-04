-- TASK-032 S6: the browser run found the Inbox showing "Showing 0 of 1" with an empty list. The stored per-queue counts (conversation_queue_counts) are kept by
-- triggers on INSERT and UPDATE of a conversation, but nothing runs when a conversation is DELETED, so every delete leaves each queue count one too high
-- for good. The Inbox retention sweep (lib/inbox/retention/sweep.ts) deletes conversations, so this is not only a test artefact: live staging already
-- shows it (agency royal-al-fathima: ALL counted 10, 7 rows; WAITING_CUSTOMER counted 6, 3 rows). The rail badges, the "n conversations" line and
-- the empty-view message then disagree with the list.
--
-- 1. A BEFORE DELETE trigger on conversations takes the conversation out of the counts of the queues it is in, in the same transaction, the way the
--    insert/update trigger adds it. (Membership rows go with the conversation through their foreign key, so only the counts need this.)
-- 2. One recount of every agency's counts from the membership table, which is the source of truth for what each list shows. Idempotent. It fixes
--    the drift that has already built up.
--
-- No conversation, message or membership data changes. Rollback: drop the trigger and function (do not: the counts drift again).

create or replace function public.trg_release_queues_for_deleted_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(old.id::text, 0));

  update public.conversation_queue_counts q
     set conversation_count = q.conversation_count - 1
    from public.conversation_queue_membership m
   where m.conversation_id = old.id
     and q.agency_id = m.agency_id
     and q.queue_code = m.queue_code;

  delete from public.conversation_queue_counts q
   where q.agency_id = old.agency_id and q.conversation_count <= 0;

  return old;
end;
$$;

revoke all on function public.trg_release_queues_for_deleted_conversation() from public, anon, authenticated;

drop trigger if exists conversations_release_queues on public.conversations;
create trigger conversations_release_queues
  before delete on public.conversations
  for each row execute function public.trg_release_queues_for_deleted_conversation();

-- The recount: counts equal the membership rows, nothing more, nothing less.
with actual as (
  select m.agency_id, m.queue_code, count(*)::integer as conversation_count
    from public.conversation_queue_membership m
   group by m.agency_id, m.queue_code
)
insert into public.conversation_queue_counts as q (agency_id, queue_code, conversation_count)
select a.agency_id, a.queue_code, a.conversation_count from actual a
on conflict (agency_id, queue_code) do update set conversation_count = excluded.conversation_count;

delete from public.conversation_queue_counts q
 where not exists (
   select 1 from public.conversation_queue_membership m where m.agency_id = q.agency_id and m.queue_code = q.queue_code
 );

-- Guard: every stored count equals its membership rows, and the trigger is in place.
do $$
declare
  v_problem text;
begin
  select string_agg(problem, '; ') into v_problem from (
    select 'queue count differs from its membership: ' || q.agency_id || ' ' || q.queue_code as problem
      from public.conversation_queue_counts q
     where q.conversation_count <> (select count(*) from public.conversation_queue_membership m where m.agency_id = q.agency_id and m.queue_code = q.queue_code)
    union all
    select 'conversations_release_queues trigger is missing'
     where not exists (select 1 from pg_trigger t where t.tgrelid = 'public.conversations'::regclass and t.tgname = 'conversations_release_queues' and not t.tgisinternal)
  ) found;

  if v_problem is not null then
    raise exception 'Queue counts follow deletes: %', v_problem;
  end if;
end;
$$;
