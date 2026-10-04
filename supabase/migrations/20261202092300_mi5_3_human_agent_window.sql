alter table public.conversations
  add column if not exists human_agent_window_expires_at timestamptz;

update public.conversations
set human_agent_window_expires_at = last_inbound_at + interval '7 days'
where channel in ('MESSENGER','INSTAGRAM') and last_inbound_at is not null;

create or replace function public.refresh_human_agent_window_from_inbound()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.role = 'user' then
    update public.conversations
       set human_agent_window_expires_at = coalesce(new.provider_sent_at, new.created_at) + interval '7 days'
     where id = new.conversation_id and agency_id = new.agency_id
       and channel in ('MESSENGER','INSTAGRAM');
  end if;
  return new;
end;
$$;

create trigger conversation_messages_refresh_human_agent_window
  after insert on public.conversation_messages
  for each row execute function public.refresh_human_agent_window_from_inbound();

notify pgrst, 'reload schema';
