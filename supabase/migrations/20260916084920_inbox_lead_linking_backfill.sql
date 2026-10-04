-- Repair the original Inbox migration's missing CRM bridge. It is deliberately
-- conservative: an exact provider identity wins; otherwise only a single
-- exact WhatsApp mobile candidate is linked. Duplicate lead numbers remain
-- untouched for an explicit staff decision.

-- The original generic realtime trigger dereferenced `new.conversation_id`
-- even when attached to `conversations`, where that column does not exist.
-- PostgreSQL validates both CASE branches for a trigger record, so *any*
-- conversation update could fail. JSON access is safe for either row shape.
create or replace function public.broadcast_inbox_invalidation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_agency_id uuid;
  v_conversation_id uuid;
begin
  if tg_op = 'DELETE' then v_row := to_jsonb(old); else v_row := to_jsonb(new); end if;
  v_agency_id := (v_row ->> 'agency_id')::uuid;
  v_conversation_id := case
    when tg_table_name = 'conversations' then (v_row ->> 'id')::uuid
    else (v_row ->> 'conversation_id')::uuid
  end;

  perform realtime.send(jsonb_build_object('conversation_id', v_conversation_id), 'inbox.invalidate', 'inbox:' || v_agency_id::text, true);
  perform realtime.send(jsonb_build_object('conversation_id', v_conversation_id), 'inbox.invalidate', 'inbox:' || v_agency_id::text || ':conversation:' || v_conversation_id::text, true);
  return coalesce(new, old);
end;
$$;
revoke all on function public.broadcast_inbox_invalidation() from public, anon, authenticated;

-- 1. Existing provider identities are the strongest evidence.
update public.conversations c
set lead_id = ci.lead_id
from public.contact_identities ci
where c.lead_id is null
  and c.agency_id = ci.agency_id
  and c.channel = ci.provider
  and c.external_conversation_id = ci.external_subject_id
  and ci.lead_id is not null;

-- 2. Link only one-to-one WhatsApp phone matches. This mirrors
-- `normaliseMobile()` for the currently supported Sri Lankan WA format.
with candidates as (
  select
    c.id as conversation_id,
    l.id as lead_id,
    count(*) over (partition by c.id) as match_count
  from public.conversations c
  join public.leads l
    on l.agency_id = c.agency_id
   and l.mobile = case
     when regexp_replace(c.contact_phone, '\\D', '', 'g') like '0094%' then substring(regexp_replace(c.contact_phone, '\\D', '', 'g') from 5)
     when regexp_replace(c.contact_phone, '\\D', '', 'g') like '94%' and length(regexp_replace(c.contact_phone, '\\D', '', 'g')) > 9 then substring(regexp_replace(c.contact_phone, '\\D', '', 'g') from 3)
     when regexp_replace(c.contact_phone, '\\D', '', 'g') like '0%' then substring(regexp_replace(c.contact_phone, '\\D', '', 'g') from 2)
     else regexp_replace(c.contact_phone, '\\D', '', 'g')
   end
  where c.lead_id is null
    and c.channel = 'WHATSAPP'
    and c.contact_phone is not null
)
update public.conversations c
set lead_id = candidates.lead_id
from candidates
where c.id = candidates.conversation_id
  and candidates.match_count = 1;

-- 3. Keep the cross-channel identity index in sync with the repaired link.
update public.contact_identities ci
set lead_id = c.lead_id,
    match_confidence = case when ci.match_confidence = 'UNRESOLVED' then 'VERIFIED_CONTACT' else ci.match_confidence end,
    last_seen_at = greatest(ci.last_seen_at, c.updated_at)
from public.conversations c
where ci.lead_id is null
  and c.lead_id is not null
  and c.agency_id = ci.agency_id
  and c.channel = ci.provider
  and c.external_conversation_id = ci.external_subject_id;
