insert into public.ai_surface_settings (agency_id, surface, enabled, mode, autonomy)
select a.id, s.surface, false, 'SHADOW', jsonb_build_object(
  'level', 'L0', 'safe_replies', false, 'intake_flow', false,
  'office_hours', false, 'approved_template_ids', '[]'::jsonb,
  'handover_triggers', jsonb_build_array('PRICE_NEGOTIATION','BOOKING_CONFIRMATION','DENY_LIST')
)
from public.agencies a
cross join (values ('INBOX_REPLY'), ('INBOX_INTAKE')) as s(surface)
on conflict (agency_id, surface) do nothing;

alter table public.ai_surface_settings
  drop constraint if exists ai_surface_settings_inbox_autonomy_shape;
alter table public.ai_surface_settings
  add constraint ai_surface_settings_inbox_autonomy_shape check (
    surface not in ('INBOX_REPLY','INBOX_INTAKE')
    or (
      autonomy ? 'level'
      and autonomy ->> 'level' in ('L0','L1','L2','L3')
      and jsonb_typeof(autonomy -> 'approved_template_ids') = 'array'
      and jsonb_typeof(autonomy -> 'handover_triggers') = 'array'
    )
  );

create table public.inbox_autonomy_decisions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  message_id uuid,
  surface text not null check (surface in ('INBOX_REPLY','INBOX_INTAKE')),
  effective_level text not null check (effective_level in ('L0','L1','L2','L3')),
  decision text not null check (decision in ('PROPOSED','SENT','REJECTED','REFUSED')),
  source text not null,
  reasons text[] not null default '{}',
  correct boolean,
  deny_list_violation boolean not null default false,
  candidate_text text,
  reviewed_by uuid references public.staff_profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint inbox_autonomy_decisions_conversation_agency_fk foreign key (conversation_id, agency_id)
    references public.conversations(id, agency_id) on delete cascade,
  constraint inbox_autonomy_decisions_message_agency_fk foreign key (message_id, agency_id)
    references public.conversation_messages(id, agency_id) on delete set null
);
create index inbox_autonomy_decisions_evidence_idx on public.inbox_autonomy_decisions(agency_id,surface,created_at desc);
alter table public.inbox_autonomy_decisions enable row level security;
revoke all on public.inbox_autonomy_decisions from anon, authenticated;
grant select on public.inbox_autonomy_decisions to authenticated;
grant all on public.inbox_autonomy_decisions to service_role;
create policy inbox_autonomy_decisions_select on public.inbox_autonomy_decisions for select to authenticated
  using (agency_id=(select public.current_agency_id()) and public.staff_role_in('ADMIN','CEO'));

create table public.inbox_triage_reviews (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  conversation_id uuid not null,
  predicted_intent text not null,
  reviewed_intent text not null,
  prediction_computed_at timestamptz not null,
  correct boolean generated always as (predicted_intent = reviewed_intent) stored,
  reviewed_by uuid references public.staff_profiles(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  foreign key (conversation_id, agency_id) references public.conversations(id, agency_id) on delete cascade,
  unique (agency_id, conversation_id, prediction_computed_at)
);
create index inbox_triage_reviews_evidence_idx on public.inbox_triage_reviews(agency_id,reviewed_at desc);
alter table public.inbox_triage_reviews enable row level security;
revoke all on public.inbox_triage_reviews from anon, authenticated;
grant select on public.inbox_triage_reviews to authenticated;
grant all on public.inbox_triage_reviews to service_role;
create policy inbox_triage_reviews_select on public.inbox_triage_reviews for select to authenticated
  using (agency_id=(select public.current_agency_id()) and public.staff_role_in('ADMIN','CEO'));

create table public.inbox_intake_states (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  conversation_id uuid not null,
  step text not null check (step in ('DATES','DEPARTURE_CITY','ROOM_ARRANGEMENT','PASSPORT_READINESS','HUMAN_REVIEW')),
  answers jsonb not null default '{}'::jsonb,
  stalled_turns integer not null default 0 check (stalled_turns between 0 and 2),
  last_message_id uuid,
  last_reply_key text,
  updated_at timestamptz not null default now(),
  primary key (agency_id,conversation_id),
  foreign key (conversation_id,agency_id) references public.conversations(id,agency_id) on delete cascade,
  foreign key (last_message_id,agency_id) references public.conversation_messages(id,agency_id) on delete set null (last_message_id)
);
alter table public.inbox_intake_states enable row level security;
revoke all on public.inbox_intake_states from public, anon, authenticated;
grant all on public.inbox_intake_states to service_role;

create table public.inbox_autonomy_level_audit (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  surface text not null check (surface in ('INBOX_REPLY','INBOX_INTAKE')),
  from_level text not null check (from_level in ('L0','L1','L2','L3')),
  to_level text not null check (to_level in ('L0','L1','L2','L3')),
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  changed_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index inbox_autonomy_level_audit_agency_idx on public.inbox_autonomy_level_audit(agency_id,created_at desc);
alter table public.inbox_autonomy_level_audit enable row level security;
revoke all on public.inbox_autonomy_level_audit from anon, authenticated;
grant select on public.inbox_autonomy_level_audit to authenticated;
grant all on public.inbox_autonomy_level_audit to service_role;
create policy inbox_autonomy_level_audit_select on public.inbox_autonomy_level_audit for select to authenticated
  using (agency_id=(select public.current_agency_id()) and public.staff_role_in('ADMIN','CEO'));

create or replace function public.set_inbox_autonomy_level(
  p_agency_id uuid,
  p_surface text,
  p_level text,
  p_mode text,
  p_enabled boolean,
  p_autonomy jsonb,
  p_actor_id uuid,
  p_reason text,
  p_evidence jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_from text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' and (
    p_agency_id <> public.current_agency_id()
    or not public.staff_role_in('ADMIN','CEO')
  ) then
    raise exception 'not permitted to change Inbox autonomy';
  end if;
  if p_surface not in ('INBOX_REPLY','INBOX_INTAKE') or p_level not in ('L0','L1','L2','L3') or p_mode not in ('OFF','SHADOW','PROPOSE','ACTIVE') then
    raise exception 'invalid Inbox autonomy setting';
  end if;

  select coalesce(s.autonomy ->> 'level','L0') into v_from
  from public.ai_surface_settings s where s.agency_id=p_agency_id and s.surface=p_surface for update;
  v_from := coalesce(v_from,'L0');

  insert into public.ai_surface_settings(agency_id,surface,enabled,mode,autonomy,updated_by)
  values (p_agency_id,p_surface,p_enabled,p_mode,p_autonomy,p_actor_id)
  on conflict (agency_id,surface) do update set
    enabled=excluded.enabled, mode=excluded.mode, autonomy=excluded.autonomy, updated_by=excluded.updated_by;

  insert into public.inbox_autonomy_level_audit(agency_id,surface,from_level,to_level,reason,evidence,changed_by)
  values (p_agency_id,p_surface,v_from,p_level,p_reason,coalesce(p_evidence,'{}'::jsonb),p_actor_id);
end;
$$;
revoke all on function public.set_inbox_autonomy_level(uuid,text,text,text,boolean,jsonb,uuid,text,jsonb) from public, anon;
grant execute on function public.set_inbox_autonomy_level(uuid,text,text,text,boolean,jsonb,uuid,text,jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
