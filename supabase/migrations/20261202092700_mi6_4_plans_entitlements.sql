create table public.plans (
  code text primary key,
  name text not null,
  currency text not null default 'USD',
  monthly_price numeric(12,2),
  seat_allowance integer,
  channel_allowance integer,
  ai_conversation_allowance integer,
  autonomy_ceiling text not null check (autonomy_ceiling in ('L0','L1','L2','L3')),
  features jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.agency_subscriptions (
  agency_id uuid primary key references public.agencies(id) on delete cascade,
  plan_code text not null references public.plans(code),
  status text not null check (status in ('TRIAL','ACTIVE','PAST_DUE','CANCELLED','GRANDFATHERED')),
  seats_purchased integer not null default 0 check (seats_purchased >= 0),
  current_period_start date not null,
  current_period_end date not null,
  overage_opt_in boolean not null default false,
  ai_conversation_allowance_override integer check (ai_conversation_allowance_override is null or ai_conversation_allowance_override >= 0),
  trial_ends_at timestamptz,
  updated_at timestamptz not null default now(),
  check (current_period_end > current_period_start)
);

create table public.agency_usage_counters (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  period_start date not null,
  metric text not null check (metric in ('AI_CONVERSATIONS','AI_COST_USD','SEATS','CHANNELS','VOICE_MINUTES','DOC_EXTRACTIONS')),
  used numeric(14,4) not null default 0 check (used >= 0),
  "limit" numeric(14,4) check ("limit" is null or "limit" >= 0),
  updated_at timestamptz not null default now(),
  primary key (agency_id, period_start, metric)
);

create table public.ai_conversation_meter_events (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  conversation_id uuid not null,
  period_start date not null,
  created_at timestamptz not null default now(),
  primary key (agency_id, conversation_id, period_start),
  foreign key (conversation_id, agency_id) references public.conversations(id, agency_id) on delete cascade
);

insert into public.plans(code,name,monthly_price,seat_allowance,channel_allowance,ai_conversation_allowance,autonomy_ceiling,features) values
('STARTER','Starter',49,3,1,400,'L1','{"payment_claim_risk":true}'),
('GROWTH','Growth',149,10,3,2000,'L2','{"offer_matching":true,"identity_resolution":true,"sla":true,"media_intelligence":true,"owner_panel":"read_only"}'),
('PROFESSIONAL','Professional',399,25,null,8000,'L3','{"offer_matching":true,"identity_resolution":true,"sla":true,"media_intelligence":true,"answer_cache":true,"owner_panel":true,"audit_export":true}'),
('ENTERPRISE','Enterprise',899,null,null,null,'L3','{"all":true}')
on conflict (code) do update set name=excluded.name, monthly_price=excluded.monthly_price,
  seat_allowance=excluded.seat_allowance, channel_allowance=excluded.channel_allowance,
  ai_conversation_allowance=excluded.ai_conversation_allowance, autonomy_ceiling=excluded.autonomy_ceiling,
  features=excluded.features;

insert into public.agency_subscriptions(agency_id,plan_code,status,current_period_start,current_period_end,overage_opt_in)
select id,'ENTERPRISE','GRANDFATHERED',date_trunc('month',current_date)::date,(date_trunc('month',current_date)+interval '1 month')::date,true
from public.agencies on conflict (agency_id) do nothing;

alter table public.plans enable row level security;
alter table public.agency_subscriptions enable row level security;
alter table public.agency_usage_counters enable row level security;
alter table public.ai_conversation_meter_events enable row level security;
revoke all on public.plans, public.agency_subscriptions, public.agency_usage_counters, public.ai_conversation_meter_events from anon, authenticated;
grant select on public.plans, public.agency_subscriptions, public.agency_usage_counters to authenticated;
create policy plans_read on public.plans for select to authenticated using (active);
create policy agency_subscriptions_read on public.agency_subscriptions for select to authenticated using (agency_id=(select public.current_agency_id()));
create policy agency_usage_counters_read on public.agency_usage_counters for select to authenticated using (agency_id=(select public.current_agency_id()));
create trigger agency_subscriptions_set_updated_at before update on public.agency_subscriptions for each row execute function public.set_updated_at();
create trigger agency_usage_counters_set_updated_at before update on public.agency_usage_counters for each row execute function public.set_updated_at();

create or replace function public.clamp_inbox_autonomy_to_plan()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare ceiling text; ceiling_rank int;
begin
  select autonomy_ceiling into ceiling from public.plans where code=new.plan_code;
  ceiling_rank := case ceiling when 'L0' then 0 when 'L1' then 1 when 'L2' then 2 else 3 end;
  update public.ai_surface_settings
     set autonomy = jsonb_set(
       jsonb_set(
         jsonb_set(autonomy,'{clamped_from}',to_jsonb(autonomy->>'level'),true),
         '{clamp_reason}',to_jsonb('Plan ceiling changed to '||ceiling),true
       ),
       '{level}',to_jsonb(ceiling),true
     ) || jsonb_build_object('clamped_at',now()),
         mode = case ceiling when 'L0' then 'SHADOW' when 'L1' then 'PROPOSE' else mode end
   where agency_id=new.agency_id and surface in ('INBOX_REPLY','INBOX_INTAKE')
     and case autonomy->>'level' when 'L0' then 0 when 'L1' then 1 when 'L2' then 2 when 'L3' then 3 else 0 end > ceiling_rank;
  return new;
end;
$$;
create trigger agency_subscription_clamp_inbox_autonomy after insert or update of plan_code on public.agency_subscriptions
  for each row execute function public.clamp_inbox_autonomy_to_plan();

create or replace function public.increment_agency_usage_counter(
  p_agency_id uuid, p_period_start date, p_metric text, p_amount numeric
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'service role required';
  end if;
  insert into public.agency_usage_counters(agency_id,period_start,metric,used)
  values(p_agency_id,p_period_start,p_metric,p_amount)
  on conflict(agency_id,period_start,metric) do update
    set used=public.agency_usage_counters.used+excluded.used,updated_at=now();
end;
$$;
revoke execute on function public.increment_agency_usage_counter(uuid,date,text,numeric) from public, anon, authenticated;
grant execute on function public.increment_agency_usage_counter(uuid,date,text,numeric) to service_role;

create or replace function public.meter_ai_conversation(
  p_agency_id uuid, p_conversation_id uuid, p_period_start date
) returns boolean language plpgsql security definer set search_path = '' as $$
declare inserted_count integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'service role required';
  end if;
  insert into public.ai_conversation_meter_events(agency_id,conversation_id,period_start)
  values(p_agency_id,p_conversation_id,p_period_start)
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 1 then
    insert into public.agency_usage_counters(agency_id,period_start,metric,used)
    values(p_agency_id,p_period_start,'AI_CONVERSATIONS',1)
    on conflict(agency_id,period_start,metric) do update
      set used=public.agency_usage_counters.used+1,updated_at=now();
  end if;
  return inserted_count = 1;
end;
$$;
revoke execute on function public.meter_ai_conversation(uuid,uuid,date) from public, anon, authenticated;
grant execute on function public.meter_ai_conversation(uuid,uuid,date) to service_role;

notify pgrst, 'reload schema';
