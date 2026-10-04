-- A WhatsApp conversation created after the unified-inbox migration had no channel connection, so staff
-- replies from the Inbox failed with "conversation has no channel connection". That migration backfilled
-- `conversations.connection_id` once for the conversations that existed then, and no code path (the WhatsApp
-- webhook, "New chat") sets it for new ones. Setting it in the database means every path gets it.
--
-- New rows: a BEFORE INSERT trigger fills connection_id with the agency's WhatsApp connection (the one bridged
-- from the legacy whatsapp_integrations row) when the inserter left it empty.
-- Existing rows: backfilled here for any WhatsApp conversation still missing it.
--
-- The trigger function is SECURITY DEFINER (a session inserting a conversation may not be allowed to read
-- channel_connections), pins search_path, and is not callable by anyone: triggers do not need EXECUTE.

create or replace function public.set_default_conversation_connection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.connection_id is null and new.channel = 'WHATSAPP' then
    select cc.id into new.connection_id
    from public.channel_connections cc
    where cc.agency_id = new.agency_id
      and cc.legacy_whatsapp_integration_id is not null
    order by cc.created_at
    limit 1;
  end if;
  return new;
end;
$$;

revoke execute on function public.set_default_conversation_connection() from public, anon, authenticated;

drop trigger if exists conversations_set_default_connection on public.conversations;
create trigger conversations_set_default_connection
  before insert on public.conversations
  for each row execute function public.set_default_conversation_connection();

update public.conversations c
set connection_id = (
  select cc.id
  from public.channel_connections cc
  where cc.agency_id = c.agency_id
    and cc.legacy_whatsapp_integration_id is not null
  order by cc.created_at
  limit 1
)
where c.channel = 'WHATSAPP'
  and c.connection_id is null;
