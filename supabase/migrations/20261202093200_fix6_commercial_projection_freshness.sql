-- FIX6: one deterministic, idempotent projection writer. Database triggers
-- cover every writer (including future admin/RPC paths) without waiting for a
-- customer message or duplicating this logic in each UI action.
create or replace function public.recompute_conversation_commercial_projection(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency_id uuid;
  v_lead_id uuid;
  v_lead_stage text;
  v_booking_id uuid;
  v_booking_status text;
  v_intent text;
  v_matched_offer jsonb;
  v_readings jsonb;
  v_stage text;
begin
  select c.agency_id, c.lead_id
    into v_agency_id, v_lead_id
    from public.conversations c
   where c.id = p_conversation_id;
  if v_agency_id is null or v_lead_id is null then return; end if;

  select l.stage, l.booking_id
    into v_lead_stage, v_booking_id
    from public.leads l
   where l.id = v_lead_id and l.agency_id = v_agency_id;
  if not found then return; end if;

  select b.booking_status
    into v_booking_status
    from public.departure_group_bookings b
   where b.id = v_booking_id and b.agency_id = v_agency_id;

  select ci.intent_code, ci.matched_offer, ci.travel_intent_evidence
    into v_intent, v_matched_offer, v_readings
    from public.conversation_intelligence ci
   where ci.conversation_id = p_conversation_id and ci.agency_id = v_agency_id;
  if not found then return; end if;

  v_stage := case
    when v_lead_stage in ('LOST', 'DUPLICATE', 'SPAM') then 'LOST'
    when v_booking_status in ('HELD', 'DEPOSIT_PENDING', 'CONFIRMED') or v_lead_stage in ('BOOKED', 'DEPOSIT_PENDING') then 'BOOKED'
    when exists (select 1 from public.lead_quotes q where q.agency_id = v_agency_id and q.lead_id = v_lead_id and q.status = 'ACCEPTED')
      or (v_intent = 'BOOKING_REQUEST' and v_matched_offer is not null) then 'BOOKING_READY'
    when exists (select 1 from public.lead_quotes q where q.agency_id = v_agency_id and q.lead_id = v_lead_id and q.status in ('SENT', 'VIEWED'))
      or v_lead_stage in ('PROPOSAL_SENT', 'NEGOTIATION') then 'QUOTE_SENT'
    when v_matched_offer is not null
      or (coalesce(v_readings, '{}'::jsonb) ? 'travellers' and coalesce(v_readings, '{}'::jsonb) ? 'window')
      or v_lead_stage = 'QUALIFIED' then 'READY_TO_RECOMMEND'
    when v_intent in ('PACKAGE_ENQUIRY', 'PRICE_REQUEST', 'BOOKING_REQUEST', 'GROUP_ENQUIRY')
      or coalesce(v_readings, '{}'::jsonb) <> '{}'::jsonb then 'QUALIFYING'
    else 'UNQUALIFIED'
  end;

  update public.conversation_intelligence ci
     set commercial_stage = v_stage,
         estimated_value_cents = case when v_stage = 'LOST' then null else ci.estimated_value_cents end,
         estimated_value_currency = case when v_stage = 'LOST' then null else ci.estimated_value_currency end
   where ci.conversation_id = p_conversation_id
     and ci.agency_id = v_agency_id
     and (ci.commercial_stage, ci.estimated_value_cents, ci.estimated_value_currency)
       is distinct from (v_stage,
                         case when v_stage = 'LOST' then null else ci.estimated_value_cents end,
                         case when v_stage = 'LOST' then null else ci.estimated_value_currency end);
end;
$$;

revoke all on function public.recompute_conversation_commercial_projection(uuid) from public, anon, authenticated;
grant execute on function public.recompute_conversation_commercial_projection(uuid) to service_role;

create or replace function public.trg_recompute_commercial_for_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_conversation_id uuid;
begin
  for v_conversation_id in
    select c.id from public.conversations c
     where c.agency_id = new.agency_id and c.lead_id = new.id
  loop
    perform public.recompute_conversation_commercial_projection(v_conversation_id);
  end loop;
  return null;
end;
$$;

create or replace function public.trg_recompute_commercial_for_quote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_lead_id uuid; v_agency_id uuid; v_conversation_id uuid;
begin
  if tg_op = 'DELETE' then
    v_lead_id := old.lead_id; v_agency_id := old.agency_id;
  else
    v_lead_id := new.lead_id; v_agency_id := new.agency_id;
  end if;
  for v_conversation_id in
    select c.id from public.conversations c where c.agency_id = v_agency_id and c.lead_id = v_lead_id
  loop
    perform public.recompute_conversation_commercial_projection(v_conversation_id);
  end loop;
  return null;
end;
$$;

create or replace function public.trg_recompute_commercial_for_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_booking_id uuid; v_agency_id uuid; v_source_conversation_id uuid; v_conversation_id uuid;
begin
  if tg_op = 'DELETE' then
    v_booking_id := old.id; v_agency_id := old.agency_id; v_source_conversation_id := old.source_conversation_id;
  else
    v_booking_id := new.id; v_agency_id := new.agency_id; v_source_conversation_id := new.source_conversation_id;
  end if;
  for v_conversation_id in
    select c.id from public.conversations c
      left join public.leads l on l.id = c.lead_id and l.agency_id = c.agency_id
     where c.agency_id = v_agency_id and (l.booking_id = v_booking_id or c.id = v_source_conversation_id)
  loop
    perform public.recompute_conversation_commercial_projection(v_conversation_id);
  end loop;
  return null;
end;
$$;

create or replace function public.trg_recompute_commercial_for_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_booking_id uuid; v_agency_id uuid; v_conversation_id uuid;
begin
  if tg_op = 'DELETE' then
    v_booking_id := old.booking_id; v_agency_id := old.agency_id;
  else
    v_booking_id := new.booking_id; v_agency_id := new.agency_id;
  end if;
  for v_conversation_id in
    select c.id from public.conversations c
      join public.leads l on l.id = c.lead_id and l.agency_id = c.agency_id
     where c.agency_id = v_agency_id and l.booking_id = v_booking_id
  loop
    perform public.recompute_conversation_commercial_projection(v_conversation_id);
  end loop;
  return null;
end;
$$;

revoke all on function public.trg_recompute_commercial_for_lead() from public, anon, authenticated;
revoke all on function public.trg_recompute_commercial_for_quote() from public, anon, authenticated;
revoke all on function public.trg_recompute_commercial_for_booking() from public, anon, authenticated;
revoke all on function public.trg_recompute_commercial_for_payment() from public, anon, authenticated;

drop trigger if exists leads_recompute_commercial_projection on public.leads;
create trigger leads_recompute_commercial_projection
  after update of stage, booking_id on public.leads
  for each row when (old.stage is distinct from new.stage or old.booking_id is distinct from new.booking_id)
  execute function public.trg_recompute_commercial_for_lead();

drop trigger if exists lead_quotes_recompute_commercial_projection on public.lead_quotes;
create trigger lead_quotes_recompute_commercial_projection
  after insert or update or delete on public.lead_quotes
  for each row execute function public.trg_recompute_commercial_for_quote();

drop trigger if exists bookings_recompute_commercial_projection on public.departure_group_bookings;
create trigger bookings_recompute_commercial_projection
  after insert or update or delete on public.departure_group_bookings
  for each row execute function public.trg_recompute_commercial_for_booking();

drop trigger if exists payments_recompute_commercial_projection on public.payments;
create trigger payments_recompute_commercial_projection
  after insert or update or delete on public.payments
  for each row execute function public.trg_recompute_commercial_for_payment();

-- Queue membership must follow the projection write, not the source-row write.
drop trigger if exists conversation_intelligence_refresh_queues on public.conversation_intelligence;
create trigger conversation_intelligence_refresh_queues
  after insert or update of intent_code, urgency, commercial_stage on public.conversation_intelligence
  for each row execute function public.trg_refresh_queues_by_conversation_id();
