-- SC2 prerequisite (docs/inbox/scaling.md §6.3, §7.2): give every message a per-conversation sequence number.
--
-- `conversation_messages.sequence_number` was backfilled once (20260916073247_unified_inbox_core.sql) and nothing has
-- assigned it since, so every message written after that has NULL. The scoped thread read ("messages after sequence N")
-- and the client's ordering rule ("an older event can never overwrite newer state") both need a real, monotonic value,
-- so the database assigns it, atomically, in a BEFORE INSERT trigger.
--
-- The counter lives in its OWN table rather than on `conversations`: a `conversations` UPDATE fires the realtime
-- trigger, so a counter there would add two LIST broadcasts to every message. The counter row's lock serialises inserts
-- into ONE conversation only; other conversations and other agencies never contend. The existing unique index
-- (conversation_id, sequence_number) remains the final guard.
create table if not exists public.conversation_message_counters (
  conversation_id uuid primary key,
  agency_id       uuid not null,
  last_sequence   bigint not null default 0 check (last_sequence >= 0),
  foreign key (conversation_id, agency_id) references public.conversations (id, agency_id) on delete cascade
);

-- Written only by the trigger below (SECURITY DEFINER). No policy: no session role can read or write it directly.
alter table public.conversation_message_counters enable row level security;
revoke all on table public.conversation_message_counters from anon, authenticated;

-- Backfill without notifying every connected browser once per row: pause the realtime trigger for this statement only.
alter table public.conversation_messages disable trigger conversation_messages_inbox_realtime;

with numbered as (
  select m.id,
         row_number() over (partition by m.conversation_id order by m.created_at, m.id)
           + coalesce(max(m.sequence_number) over (partition by m.conversation_id), 0) as next_sequence
    from public.conversation_messages m
)
update public.conversation_messages m
   set sequence_number = numbered.next_sequence
  from numbered
 where m.id = numbered.id and m.sequence_number is null;

alter table public.conversation_messages enable trigger conversation_messages_inbox_realtime;

insert into public.conversation_message_counters (conversation_id, agency_id, last_sequence)
select m.conversation_id, m.agency_id, max(m.sequence_number)
  from public.conversation_messages m
 group by m.conversation_id, m.agency_id
on conflict (conversation_id) do update set last_sequence = greatest(public.conversation_message_counters.last_sequence, excluded.last_sequence);

create or replace function public.assign_conversation_message_sequence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sequence_number is null then
    insert into public.conversation_message_counters as k (conversation_id, agency_id, last_sequence)
    values (new.conversation_id, new.agency_id, 1)
    on conflict (conversation_id) do update set last_sequence = k.last_sequence + 1
    returning k.last_sequence into new.sequence_number;
  end if;
  return new;
end;
$$;

revoke all on function public.assign_conversation_message_sequence() from public, anon, authenticated;

drop trigger if exists conversation_messages_assign_sequence on public.conversation_messages;
create trigger conversation_messages_assign_sequence
  before insert on public.conversation_messages
  for each row execute function public.assign_conversation_message_sequence();
