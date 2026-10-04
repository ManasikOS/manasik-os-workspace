-- MI4.5 — an auditable Sales → Operations handoff. The JSON snapshots are
-- deliberately stored so Operations sees the facts Sales handed over then,
-- even if the booking changes later. Every field is agency-scoped/RLS'd.

-- The composite foreign key below needs (id, agency_id) to be unique on the
-- bookings table. Earlier tenancy migrations add it only conditionally, so make
-- this migration self-sufficient. id is already the primary key, so this is safe.
create unique index if not exists departure_group_bookings_id_agency_uidx
  on public.departure_group_bookings (id, agency_id);

create table if not exists public.conversation_handoffs (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null default public.current_agency_id()
                          references public.agencies (id),
  conversation_id       uuid not null,
  booking_id            uuid not null,
  from_team             text not null default 'SALES' check (from_team in ('SALES', 'OPERATIONS')),
  to_team               text not null default 'OPERATIONS' check (to_team in ('SALES', 'OPERATIONS')),
  summary               jsonb not null default '{}'::jsonb,
  open_items            jsonb not null default '[]'::jsonb,
  customer_expectations jsonb not null default '{}'::jsonb,
  sentiment             text,
  created_by            uuid not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  acknowledged_by       uuid,
  acknowledged_at       timestamptz,

  constraint conversation_handoffs_conversation_agency_fkey
    foreign key (conversation_id, agency_id)
    references public.conversations (id, agency_id) on delete cascade,
  constraint conversation_handoffs_booking_agency_fkey
    foreign key (booking_id, agency_id)
    references public.departure_group_bookings (id, agency_id) on delete cascade,
  constraint conversation_handoffs_creator_agency_fkey
    foreign key (created_by, agency_id)
    references public.staff_profiles (id, agency_id),
  constraint conversation_handoffs_acknowledger_agency_fkey
    foreign key (acknowledged_by, agency_id)
    references public.staff_profiles (id, agency_id),
  constraint conversation_handoffs_acknowledgement_pair_check
    check ((acknowledged_by is null) = (acknowledged_at is null)),
  constraint conversation_handoffs_teams_differ_check
    check (from_team <> to_team),
  constraint conversation_handoffs_summary_object_check
    check (jsonb_typeof(summary) = 'object'),
  constraint conversation_handoffs_open_items_array_check
    check (jsonb_typeof(open_items) = 'array'),
  constraint conversation_handoffs_expectations_object_check
    check (jsonb_typeof(customer_expectations) = 'object'),
  constraint conversation_handoffs_sentiment_check
    check (sentiment is null or sentiment in ('POSITIVE', 'NEUTRAL', 'CONCERNED', 'ANGRY', 'DISTRESSED'))
);

create unique index if not exists conversation_handoffs_id_agency_uidx
  on public.conversation_handoffs (id, agency_id);
create unique index if not exists conversation_handoffs_booking_uidx
  on public.conversation_handoffs (booking_id);
create index if not exists conversation_handoffs_agency_unacknowledged_idx
  on public.conversation_handoffs (agency_id, created_at desc)
  where acknowledged_at is null;
create index if not exists conversation_handoffs_conversation_idx
  on public.conversation_handoffs (agency_id, conversation_id, created_at desc);

alter table public.conversation_handoffs enable row level security;
revoke all on table public.conversation_handoffs from anon;
revoke all on table public.conversation_handoffs from authenticated;
grant select, insert on table public.conversation_handoffs to authenticated;
grant update (acknowledged_by, acknowledged_at) on table public.conversation_handoffs to authenticated;

drop trigger if exists conversation_handoffs_set_updated_at on public.conversation_handoffs;
create trigger conversation_handoffs_set_updated_at
  before update on public.conversation_handoffs
  for each row execute function public.set_updated_at();

create policy "staff read conversation_handoffs" on public.conversation_handoffs
  for select to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and (select public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA'))
  );

create policy "sales create conversation_handoffs" on public.conversation_handoffs
  for insert to authenticated
  with check (
    agency_id = (select public.current_agency_id())
    and created_by = (select auth.uid())
    and (select public.staff_role_in('ADMIN', 'MARKETING', 'OPERATIONS'))
  );

create policy "operations acknowledge conversation_handoffs" on public.conversation_handoffs
  for update to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and (select public.staff_role_in('ADMIN', 'OPERATIONS'))
  )
  with check (
    agency_id = (select public.current_agency_id())
    and acknowledged_by = (select auth.uid())
    and (select public.staff_role_in('ADMIN', 'OPERATIONS'))
  );

insert into public.ai_surface_settings (agency_id, surface, enabled, mode)
select a.id, 'INBOX_HANDOFF', false, 'SHADOW'
from public.agencies a
on conflict (agency_id, surface) do nothing;

notify pgrst, 'reload schema';
