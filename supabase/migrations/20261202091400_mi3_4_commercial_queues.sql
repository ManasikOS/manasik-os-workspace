-- MI3.4 — commercial stage and the four Sales queues. docs/inbox/implementation-plan.md MI3.4.
--
-- conversation_intelligence.commercial_stage has existed since MI2.1 and has been written as UNQUALIFIED by default. From this
-- slice the pipeline derives it from records (lead stage, quotes, booking, the matched offer) with no model, and
-- compute_conversation_queues() reads it to fill NEW_ENQUIRIES, QUALIFIED, BOOKING_READY and QUOTE_SENT.
--
-- Body copied from 20261202091100 with two additions: the commercial_stage column in `base`, and the four predicates. Nothing
-- else about the function, its grants or refresh_conversation_queues() changes. No table changes; RLS is untouched.
--
-- Existing conversations keep commercial_stage = 'UNQUALIFIED' until their next enrichment, so a conversation whose intent is
-- already commercial appears in NEW_ENQUIRIES immediately, and moves on its next message.

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
           coalesce(l.stage = 'SPAM', false)                          as is_spam,
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

-- Rollback (commented — restores the MI2.6 body): re-apply the compute_conversation_queues() definition from 20261202091100.
