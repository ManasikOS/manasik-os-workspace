-- PRD-03: conversation-level spam. The Spam queue and every "not spam" exclusion used to follow only the linked lead's
-- stage (`leads.stage = 'SPAM'`). `conversations.lifecycle_status` already allows 'SPAM' and the intelligence gate honours
-- it, but the queues ignored it, so marking a chat spam would have stopped enrichment while leaving it in the main lists.
--
-- From this migration a conversation is spam when EITHER its lifecycle_status is SPAM OR its lead's stage is SPAM. The
-- change is reversible without any new column: staff restore a chat by writing its lifecycle_status back to 'CLOSED' (its
-- state is closed) or 'OPEN', which is what it was. The existing trigger on conversations already refreshes queue
-- membership when lifecycle_status changes.
--
-- Body copied from 20261202091400 with one change: the is_spam expression. Grants, refresh_conversation_queues() and every
-- table are untouched. No RLS change.
--
-- NULL SAFETY: conversations.lifecycle_status is nullable and legacy rows are NULL. `false or NULL` is NULL, which would make
-- `not is_spam` NULL and silently drop those conversations from All, Needs reply and every other queue, so the lifecycle test
-- is wrapped in coalesce(..., false). (Applied to Manasik OS as two migrations: the first without the coalesce, corrected
-- about two minutes later by `inbox_spam_lifecycle_queues_null_safe` before any membership refresh ran. This file is the
-- final, correct definition.)

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
           c.sla_due_at,
           coalesce(c.last_activity_at, c.updated_at, c.created_at)   as activity_at,
           (c.state = 'CLOSED')                                       as is_closed,
           (coalesce(l.stage = 'SPAM', false) or coalesce(c.lifecycle_status = 'SPAM', false)) as is_spam,
           coalesce(ci.intent_code, '')                               as intent_code,
           coalesce(ci.commercial_stage, 'UNQUALIFIED')               as commercial_stage,
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
            + case b.urgency when 'CRITICAL' then 100 when 'HIGH' then 50 else 0 end
            -- A missed reply target raises the conversation within every queue it is in (Architecture 16 R2 rule 3).
            + case when b.sla_due_at is not null and b.sla_due_at <= now() and not b.is_closed then 150 else 0 end) as rank
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
      ('VISA_ISSUES',         not r.is_closed and not r.is_spam and r.intent_code = 'VISA_QUERY'),
      -- Deadline views (MI2.6). sla_due_at is written by the SLA sweep (lib/inbox/sla/sweep.ts), which owns the business-hours
      -- arithmetic - it is deliberately NOT re-implemented here. 30 minutes = NEARING_DEADLINE_MINUTES in lib/inbox/sla/due-at.ts.
      ('SLA_BREACHED',        not r.is_closed and not r.is_spam and r.sla_due_at is not null and r.sla_due_at <= now()),
      ('NEARING_DEADLINE',    not r.is_closed and not r.is_spam and r.sla_due_at is not null
                              and r.sla_due_at > now() and r.sla_due_at < now() + interval '30 minutes'),
      -- Sales queues (MI3.4). commercial_stage is derived from records by lib/inbox/intelligence/commercial-stage.ts (no model);
      -- this predicate is kept identical to commercialQueuesFor() there by a test. LOST and BOOKED are in none of them.
      ('NEW_ENQUIRIES',       not r.is_closed and not r.is_spam and r.commercial_stage in ('UNQUALIFIED', 'QUALIFYING')
                              and r.intent_code in ('PACKAGE_ENQUIRY', 'PRICE_REQUEST', 'BOOKING_REQUEST', 'GROUP_ENQUIRY')),
      ('QUALIFIED',           not r.is_closed and not r.is_spam and r.commercial_stage = 'READY_TO_RECOMMEND'),
      ('BOOKING_READY',       not r.is_closed and not r.is_spam and r.commercial_stage = 'BOOKING_READY'),
      ('QUOTE_SENT',          not r.is_closed and not r.is_spam and r.commercial_stage = 'QUOTE_SENT')
   ) as q(code, member)
   where q.member;
$$;

revoke all on function public.compute_conversation_queues(uuid[]) from public, anon, authenticated;
grant execute on function public.compute_conversation_queues(uuid[]) to service_role;

-- Bring membership in line for any conversation that is already marked spam (none are expected today).
select public.refresh_conversation_queues(c.id)
  from public.conversations c
 where c.lifecycle_status = 'SPAM';

notify pgrst, 'reload schema';

-- Rollback (commented): re-apply the compute_conversation_queues() definition from 20261202091400, then
-- select public.refresh_conversation_queues(c.id) from public.conversations c where c.lifecycle_status = 'SPAM';
