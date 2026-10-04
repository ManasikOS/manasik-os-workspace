-- MI2.2 — queue membership function and rail (G2, G12). docs/inbox/implementation-plan.md MI2.2, Architecture §5.4, §7.5.
--
-- ONE definition of every queue predicate lives in compute_conversation_queues(). Everything else derives from it:
--   * refresh_conversation_queues(id)   — recomputes one conversation's membership rows (called by the triggers below)
--   * the one-time backfill at the bottom of this file (set-based, over every conversation)
--   * the TypeScript layer never re-implements a predicate; it reads conversation_queue_membership.
-- Queue counts become one indexed count(*) group-by (inbox_queue_counts), replacing the 5 000-row in-memory scan
-- (VIEW_SCAN_LIMIT in lib/data/inbox-repository.ts).
--
-- Predicates defined here (Phase 2 scope — the queues whose inputs exist today). Queues that depend on later
-- slices are declared in the catalogue but have NO predicate yet, so they stay empty and hidden:
--   NEW_ENQUIRIES, QUALIFIED, BOOKING_READY, QUOTE_SENT (MI3.4) · NEARING_DEADLINE, SLA_BREACHED (MI2.6)
--   DEPARTURE_CHANGES, GROUP_CHANGES (no intent code exists for them yet)
-- MINE is deliberately NOT a membership row: it is per staff member, and a shared membership table cannot hold
-- "for me". inbox_queue_counts() counts it directly from conversations (indexed on agency + assignee).
--
-- Legacy nine views map onto queue codes so there is one predicate, not two; their semantics are preserved exactly:
-- ALL = not closed and lead not SPAM · UNASSIGNED = not closed, no assignee · channels = not closed on that channel ·
-- RESOLVED = closed · SPAM = lead stage SPAM. Two codes are added to the contract for them: EMAIL and SPAM.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Feature flag, membership columns, widened queue-code check
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.agency_settings add column if not exists inbox_queues_v2 boolean not null default false;
comment on column public.agency_settings.inbox_queues_v2 is
  'When true the Inbox rail shows the grouped queue catalogue (Inbox / Operations / Channels); when false it shows the original nine views. Membership is maintained either way.';

alter table public.conversation_queue_membership add column if not exists last_activity_at timestamptz not null default now();

alter table public.conversation_queue_membership drop constraint if exists conversation_queue_membership_queue_code_check;
alter table public.conversation_queue_membership
  add constraint conversation_queue_membership_queue_code_check check (queue_code in (
    'ALL', 'MINE', 'UNASSIGNED', 'NEEDS_REPLY', 'WAITING_CUSTOMER', 'WAITING_TEAM', 'RESOLVED',
    'NEW_ENQUIRIES', 'QUALIFIED', 'BOOKING_READY', 'QUOTE_SENT', 'PAYMENT_DISCUSSIONS',
    'DOCUMENTS', 'VISA_ISSUES', 'DEPARTURE_CHANGES', 'GROUP_CHANGES', 'COMPLAINTS', 'ESCALATIONS',
    'NEARING_DEADLINE', 'SLA_BREACHED', 'WHATSAPP', 'INSTAGRAM', 'MESSENGER', 'EMAIL', 'SPAM'));

-- The list access path: newest activity first within a queue, keyset-paginated on (last_activity_at, conversation_id).
create index if not exists conversation_queue_membership_activity_idx
  on public.conversation_queue_membership (agency_id, queue_code, last_activity_at desc, conversation_id desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- B. The single predicate definition
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.compute_conversation_queues(p_conversation_ids uuid[] default null)
returns table (agency_id uuid, conversation_id uuid, queue_code text, priority_rank integer, last_activity_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select c.id,
           c.agency_id,
           c.channel,
           c.state,
           c.assigned_to_id,
           c.last_inbound_at,
           c.last_outbound_at,
           coalesce(c.last_activity_at, c.updated_at, c.created_at)   as activity_at,
           (c.state = 'CLOSED')                                       as is_closed,
           coalesce(l.stage = 'SPAM', false)                          as is_spam,
           coalesce(ci.intent_code, '')                               as intent_code,
           coalesce(ci.urgency, 'NORMAL')                             as urgency,
           coalesce(iv.open_count, 0) > 0                             as has_open,
           coalesce(iv.has_block, false)                              as has_block,
           coalesce(iv.kinds, '{}'::text[])                           as kinds
      from public.conversations c
      left join public.leads l on l.id = c.lead_id
      left join public.conversation_intelligence ci on ci.conversation_id = c.id
      left join lateral (
        select count(*)                                as open_count,
               coalesce(bool_or(i.severity = 'BLOCK'), false) as has_block,
               array_agg(i.kind::text)                 as kinds
          from public.conversation_interventions i
         where i.conversation_id = c.id and i.status in ('OPEN', 'ACKNOWLEDGED')
      ) iv on true
     where p_conversation_ids is null or c.id = any (p_conversation_ids)
  ),
  ranked as (
    select b.*,
           (case when b.has_block then 300 when b.has_open then 200 else 0 end
            + case b.urgency when 'CRITICAL' then 100 when 'HIGH' then 50 else 0 end) as rank
      from base b
  )
  select r.agency_id, r.id, q.code, r.rank, r.activity_at
    from ranked r
   cross join lateral (values
      -- Legacy views, semantics preserved
      ('ALL',           not r.is_closed and not r.is_spam),
      ('UNASSIGNED',    not r.is_closed and r.assigned_to_id is null),
      ('WHATSAPP',      not r.is_closed and r.channel = 'WHATSAPP'),
      ('INSTAGRAM',     not r.is_closed and r.channel = 'INSTAGRAM'),
      ('MESSENGER',     not r.is_closed and r.channel = 'MESSENGER'),
      ('EMAIL',         not r.is_closed and r.channel = 'GMAIL'),
      ('RESOLVED',      r.is_closed),
      ('SPAM',          r.is_spam),
      -- Who is waiting on whom. NEEDS_REPLY and WAITING_CUSTOMER partition every conversation that has any message.
      ('NEEDS_REPLY',      not r.is_closed and not r.is_spam and r.last_inbound_at is not null
                           and (r.last_outbound_at is null or r.last_inbound_at > r.last_outbound_at)),
      ('WAITING_CUSTOMER', not r.is_closed and not r.is_spam and r.last_outbound_at is not null
                           and (r.last_inbound_at is null or r.last_outbound_at >= r.last_inbound_at)),
      ('WAITING_TEAM',     not r.is_closed and not r.is_spam and (r.state = 'HUMAN_REQUESTED' or r.has_open)),
      -- Business-consequence queues driven by the intelligence projection and open interventions
      ('ESCALATIONS',         not r.is_closed and not r.is_spam and (r.has_block or r.urgency = 'CRITICAL')),
      ('COMPLAINTS',          not r.is_closed and not r.is_spam
                              and (r.intent_code = 'COMPLAINT' or r.kinds && array['COMPLAINT', 'REFUND_REQUEST'])),
      ('PAYMENT_DISCUSSIONS', not r.is_closed and not r.is_spam
                              and (r.intent_code = 'PAYMENT_CLAIM' or r.kinds && array['PAYMENT_CLAIM', 'BANK_DETAIL_MISMATCH'])),
      ('DOCUMENTS',           not r.is_closed and not r.is_spam
                              and (r.intent_code = 'DOCUMENT_ISSUE' or r.kinds && array['PASSPORT_EXPIRY', 'SENSITIVE_DOCUMENT'])),
      ('VISA_ISSUES',         not r.is_closed and not r.is_spam and r.intent_code = 'VISA_QUERY')
   ) as q(code, member)
   where q.member;
$$;

revoke all on function public.compute_conversation_queues(uuid[]) from public, anon, authenticated;
grant execute on function public.compute_conversation_queues(uuid[]) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Per-conversation refresh
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.refresh_conversation_queues(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Leave queues the conversation no longer belongs to.
  delete from public.conversation_queue_membership m
   where m.conversation_id = p_conversation_id
     and not exists (
       select 1 from public.compute_conversation_queues(array[p_conversation_id]) w where w.queue_code = m.queue_code
     );

  -- Enter (or re-rank) the queues it belongs to. entered_at is set once, on first entry.
  insert into public.conversation_queue_membership as m (agency_id, queue_code, conversation_id, priority_rank, last_activity_at)
  select w.agency_id, w.queue_code, w.conversation_id, w.priority_rank, w.last_activity_at
    from public.compute_conversation_queues(array[p_conversation_id]) w
  on conflict (agency_id, queue_code, conversation_id) do update
    set priority_rank = excluded.priority_rank,
        last_activity_at = excluded.last_activity_at
    where (m.priority_rank, m.last_activity_at) is distinct from (excluded.priority_rank, excluded.last_activity_at);
end;
$$;

revoke all on function public.refresh_conversation_queues(uuid) from public, anon, authenticated;
grant execute on function public.refresh_conversation_queues(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Triggers. security definer: a staff session that reassigns a chat has no write policy on membership.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.trg_refresh_queues_for_conversation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.refresh_conversation_queues(new.id);
  return null;
end;
$$;

create or replace function public.trg_refresh_queues_by_conversation_id()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.refresh_conversation_queues(coalesce(new.conversation_id, old.conversation_id));
  return null;
end;
$$;

create or replace function public.trg_refresh_queues_for_lead()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  for v_id in select c.id from public.conversations c where c.lead_id = new.id loop
    perform public.refresh_conversation_queues(v_id);
  end loop;
  return null;
end;
$$;

revoke all on function public.trg_refresh_queues_for_conversation() from public, anon, authenticated;
revoke all on function public.trg_refresh_queues_by_conversation_id() from public, anon, authenticated;
revoke all on function public.trg_refresh_queues_for_lead() from public, anon, authenticated;

drop trigger if exists conversations_refresh_queues on public.conversations;
create trigger conversations_refresh_queues
  after insert or update of state, channel, assigned_to_id, lead_id, last_inbound_at, last_outbound_at, last_activity_at, lifecycle_status
  on public.conversations
  for each row execute function public.trg_refresh_queues_for_conversation();

drop trigger if exists conversation_intelligence_refresh_queues on public.conversation_intelligence;
create trigger conversation_intelligence_refresh_queues
  after insert or update of intent_code, urgency on public.conversation_intelligence
  for each row execute function public.trg_refresh_queues_by_conversation_id();

drop trigger if exists conversation_interventions_refresh_queues on public.conversation_interventions;
create trigger conversation_interventions_refresh_queues
  after insert or delete or update of status, severity, kind on public.conversation_interventions
  for each row execute function public.trg_refresh_queues_by_conversation_id();

-- Belt and braces: ingest updates the conversation row too, but a message inserted by any other path must still count.
drop trigger if exists conversation_messages_refresh_queues on public.conversation_messages;
create trigger conversation_messages_refresh_queues
  after insert on public.conversation_messages
  for each row execute function public.trg_refresh_queues_by_conversation_id();

drop trigger if exists leads_refresh_conversation_queues on public.leads;
create trigger leads_refresh_conversation_queues
  after update of stage on public.leads
  for each row when (old.stage is distinct from new.stage)
  execute function public.trg_refresh_queues_for_lead();

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Counts: one indexed group-by, plus MINE. security INVOKER — RLS scopes the caller to their own agency.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.inbox_queue_counts(p_staff_id uuid)
returns table (queue_code text, conversation_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.queue_code, count(*)::integer
    from public.conversation_queue_membership m
   where m.agency_id = public.current_agency_id()
   group by m.queue_code
  union all
  select 'MINE', count(*)::integer
    from public.conversations c
   where c.agency_id = public.current_agency_id()
     and c.assigned_to_id = p_staff_id
     and c.state <> 'CLOSED';
$$;

revoke all on function public.inbox_queue_counts(uuid) from public, anon;
grant execute on function public.inbox_queue_counts(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- F. Backfill: every existing conversation, set-based, idempotent
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.conversation_queue_membership as m (agency_id, queue_code, conversation_id, priority_rank, last_activity_at)
select w.agency_id, w.queue_code, w.conversation_id, w.priority_rank, w.last_activity_at
  from public.compute_conversation_queues(null) w
on conflict (agency_id, queue_code, conversation_id) do nothing;
