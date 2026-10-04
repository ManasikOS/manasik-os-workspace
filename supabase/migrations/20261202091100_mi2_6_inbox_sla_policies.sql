-- MI2.6 — SLA policy and the deadline clock (Architecture §16 R2). docs/inbox/implementation-plan.md MI2.6.
--
--  1. inbox_sla_policies — per agency, per queue: first-reply and resolution targets in MINUTES, the clock
--     (BUSINESS_HOURS | ALWAYS) and whether a breach opens an intervention. RLS in this same migration. Seeded for every
--     agency from R2's table; the base first-reply target of ESCALATIONS / COMPLAINTS / BOOKING_READY reuses the agency's
--     existing ai_settings.handoff_alert_minutes (default 15) so an agency that tuned it keeps its setting. The same numbers
--     live in lib/inbox/sla/policies.ts (DEFAULT_SLA_POLICIES); a test compares the two, and an agency with no row falls
--     back to the code defaults, so one created after this seed is never without targets.
--  2. compute_conversation_queues() gains the two deadline queues and a priority raise on breach. The predicates read
--     conversations.sla_due_at (a column that has existed, unused, since unified_inbox_core); the SLA sweep writes it.
--     The business-hours arithmetic stays in ONE place, lib/inbox/sla — it is not re-implemented in SQL.
--  3. The SLA sweep is scheduled every two minutes through invoke_cron_route (allow-list extended, body otherwise
--     copied from 20261202090300).
--
-- Calendar: reuses agency_settings.timezone and ai_settings.working_hours. No second calendar is added.

-- ---------------------------------------------------------------------------
-- 1. inbox_sla_policies
-- ---------------------------------------------------------------------------
create table if not exists public.inbox_sla_policies (
  agency_id                     uuid not null default public.current_agency_id() references public.agencies (id) on delete cascade,
  queue_code                    text not null check (queue_code in (
                                  'ESCALATIONS', 'COMPLAINTS', 'BOOKING_READY', 'PAYMENT_DISCUSSIONS', 'NEW_ENQUIRIES', 'NEEDS_REPLY',
                                  'DEPARTURE_CHANGES', 'GROUP_CHANGES', 'QUALIFIED', 'QUOTE_SENT', 'DOCUMENTS', 'VISA_ISSUES')),
  first_reply_minutes           integer check (first_reply_minutes is null or first_reply_minutes between 1 and 86400),
  resolution_minutes            integer check (resolution_minutes is null or resolution_minutes between 1 and 86400),
  clock                         text not null default 'BUSINESS_HOURS' check (clock in ('BUSINESS_HOURS', 'ALWAYS')),
  opens_intervention_on_breach  boolean not null default false,
  updated_by                    uuid references public.staff_profiles (id) on delete set null,
  updated_at                    timestamptz not null default now(),
  primary key (agency_id, queue_code)
);

comment on table public.inbox_sla_policies is
  'Reply and resolution targets per Inbox queue (Architecture §16 R2). Minutes on the queue''s own clock. A queue with no row uses the defaults in lib/inbox/sla/policies.ts.';

drop trigger if exists inbox_sla_policies_set_updated_at on public.inbox_sla_policies;
create trigger inbox_sla_policies_set_updated_at
  before update on public.inbox_sla_policies
  for each row execute function public.set_updated_at();

alter table public.inbox_sla_policies enable row level security;

drop policy if exists "staff read inbox_sla_policies" on public.inbox_sla_policies;
create policy "staff read inbox_sla_policies" on public.inbox_sla_policies
  for select to authenticated
  using (agency_id = (select public.current_agency_id())
         and (select public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA')));

drop policy if exists "owners manage inbox_sla_policies" on public.inbox_sla_policies;
create policy "owners manage inbox_sla_policies" on public.inbox_sla_policies
  for all to authenticated
  using (agency_id = (select public.current_agency_id()) and (select public.staff_role_in('ADMIN', 'CEO')))
  with check (agency_id = (select public.current_agency_id()) and (select public.staff_role_in('ADMIN', 'CEO')));

insert into public.inbox_sla_policies (agency_id, queue_code, first_reply_minutes, resolution_minutes, clock, opens_intervention_on_breach)
select a.id, d.queue_code,
       case when d.queue_code in ('ESCALATIONS', 'COMPLAINTS', 'BOOKING_READY')
            then coalesce((select s.handoff_alert_minutes from public.ai_settings s where s.agency_id = a.id), d.first_reply_minutes)
            else d.first_reply_minutes end,
       d.resolution_minutes, d.clock, d.opens_intervention_on_breach
  from public.agencies a
 cross join (values
   ('ESCALATIONS',         15,  1440, 'ALWAYS',         true),
   ('COMPLAINTS',          15,  1440, 'ALWAYS',         true),
   ('BOOKING_READY',       15,  240,  'BUSINESS_HOURS', true),
   ('PAYMENT_DISCUSSIONS', 30,  240,  'BUSINESS_HOURS', true),
   ('NEW_ENQUIRIES',       30,  480,  'BUSINESS_HOURS', false),
   ('NEEDS_REPLY',         60,  null, 'BUSINESS_HOURS', false),
   ('DEPARTURE_CHANGES',   120, 1440, 'BUSINESS_HOURS', false),
   ('GROUP_CHANGES',       120, 1440, 'BUSINESS_HOURS', false),
   ('QUALIFIED',           120, 2880, 'BUSINESS_HOURS', false),
   ('QUOTE_SENT',          120, 2880, 'BUSINESS_HOURS', false),
   ('DOCUMENTS',           240, 1440, 'BUSINESS_HOURS', false),
   ('VISA_ISSUES',         240, 1440, 'BUSINESS_HOURS', false)
 ) as d(queue_code, first_reply_minutes, resolution_minutes, clock, opens_intervention_on_breach)
on conflict (agency_id, queue_code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The deadline queues and the priority raise
-- ---------------------------------------------------------------------------
create index if not exists conversations_sla_due_idx
  on public.conversations (agency_id, sla_due_at) where sla_due_at is not null;

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
                              and r.sla_due_at > now() and r.sla_due_at < now() + interval '30 minutes')
   ) as q(code, member)
   where q.member;
$$;

revoke all on function public.compute_conversation_queues(uuid[]) from public, anon, authenticated;
grant execute on function public.compute_conversation_queues(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Schedule the SLA sweep (app/api/cron/inbox-sla/route.ts) every two minutes
-- ---------------------------------------------------------------------------
create or replace function public.invoke_cron_route(p_path text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_base_url text;
  v_secret text;
  v_request_id bigint;
begin
  if p_path not in (
    '/api/cron/agent-jobs',
    '/api/cron/whatsapp-health',
    '/api/cron/whatsapp-billing-sync',
    '/api/cron/departure-ops-jobs',
    '/api/cron/release-seat-holds',
    '/api/cron/lead-followups',
    '/api/cron/ai-usage-rollup',
    '/api/cron/inbox-lanes',
    '/api/cron/inbox-sla'
  ) then
    raise exception 'invoke_cron_route: % is not a recognised cron path', p_path;
  end if;

  select ds.decrypted_secret into v_base_url
    from vault.decrypted_secrets ds join vault.secrets s on s.id = ds.id
    where s.name = 'cron_http_base_url';
  select ds.decrypted_secret into v_secret
    from vault.decrypted_secrets ds join vault.secrets s on s.id = ds.id
    where s.name = 'cron_http_secret';

  if v_base_url is null or v_secret is null then
    raise warning 'invoke_cron_route(%): cron_http_base_url/cron_http_secret not configured — call public.set_cron_http_config() first', p_path;
    return null;
  end if;

  select net.http_get(
    url := v_base_url || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 55000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.invoke_cron_route(text) from public, authenticated, anon;

do $$
begin
  begin
    perform cron.unschedule('inbox-sla');
  exception when others then
    null; -- first apply
  end;

  perform cron.schedule(
    'inbox-sla',
    '*/2 * * * *',
    format('select public.invoke_cron_route(%L);', '/api/cron/inbox-sla')
  );
end $$;

notify pgrst, 'reload schema';

-- Rollback (commented): restore the MI2.2 predicate set by re-running the function body of 20261202090500.
-- select cron.unschedule('inbox-sla');
-- drop table if exists public.inbox_sla_policies;
-- drop index if exists public.conversations_sla_due_idx;
