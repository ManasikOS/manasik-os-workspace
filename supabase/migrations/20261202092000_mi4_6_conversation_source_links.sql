-- MI4.6 — every object created from a conversation points back at it (the Inbox is never a dead end).
--
-- Adds two nullable columns to each table a conversion can create a row in:
--   source_conversation_id  the conversation the row came from
--   source_message_id       the customer's message that prompted it (the evidence)
--
-- Both are composite foreign keys ((id, agency_id)), like every tenant reference in this schema, so a row can never point at
-- another agency's conversation or message. Deleting a conversation or a message clears the pointer only; it never deletes
-- the lead, booking, task or case that grew from it. Nullable because every row created before this migration, and every row
-- created by hand outside the Inbox, has no source.
--
-- Tables: leads, lead_quotes, departure_group_bookings, departure_group_tasks, pilgrim_support_requests.
-- Additive and idempotent. Roll back with the DROP COLUMNs at the bottom of this file.

do $$
declare
  t text;
begin
  foreach t in array array['leads', 'lead_quotes', 'departure_group_bookings', 'departure_group_tasks', 'pilgrim_support_requests']
  loop
    execute format('alter table public.%I add column if not exists source_conversation_id uuid', t);
    execute format('alter table public.%I add column if not exists source_message_id uuid', t);

    -- A message pointer needs its conversation pointer (a message is only evidence inside a conversation).
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_source_pair_check');
    execute format(
      'alter table public.%I add constraint %I check (source_message_id is null or source_conversation_id is not null)',
      t, t || '_source_pair_check');

    execute format('alter table public.%I drop constraint if exists %I', t, t || '_source_conversation_fkey');
    execute format(
      'alter table public.%I add constraint %I foreign key (source_conversation_id, agency_id) references public.conversations (id, agency_id) on delete set null (source_conversation_id)',
      t, t || '_source_conversation_fkey');

    execute format('alter table public.%I drop constraint if exists %I', t, t || '_source_message_fkey');
    execute format(
      'alter table public.%I add constraint %I foreign key (source_message_id, agency_id) references public.conversation_messages (id, agency_id) on delete set null (source_message_id)',
      t, t || '_source_message_fkey');

    -- "What came out of this conversation?" reads by conversation; only rows that have a source are indexed.
    execute format(
      'create index if not exists %I on public.%I (agency_id, source_conversation_id) where source_conversation_id is not null',
      t || '_source_conversation_idx', t);
  end loop;
end $$;

comment on column public.departure_group_tasks.source_conversation_id is
  'The Inbox conversation this task was created from (MI4.6). Null for tasks created by hand.';

notify pgrst, 'reload schema';

-- Roll back:
--   do $$ declare t text; begin
--     foreach t in array array['leads','lead_quotes','departure_group_bookings','departure_group_tasks','pilgrim_support_requests'] loop
--       execute format('alter table public.%I drop column if exists source_message_id, drop column if exists source_conversation_id', t);
--     end loop; end $$;
