-- FIX2 (docs/inbox/fixing-plan.md) — a conversation linked to a booking through
-- any supported relationship gets booking retention, and the nightly message
-- sweep resumes from a persisted keyset cursor instead of rescanning from the
-- start of the table on every run.
--
-- Booking-linked relationships recognised here:
--   1. a departure_group_bookings row has source_conversation_id = conversation.id
--   2. conversation.lead_id points to a lead whose booking_id is set
-- A third relationship (a future canonical booking/conversation link table) is
-- deliberately not modelled yet — none exists on `main`.

create table public.inbox_retention_cursors (
  agency_id uuid not null default public.current_agency_id() references public.agencies(id) on delete cascade,
  scope text not null,
  cursor_at timestamptz not null,
  cursor_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (agency_id, scope)
);
alter table public.inbox_retention_cursors enable row level security;
revoke all on public.inbox_retention_cursors from anon, authenticated;
grant select on public.inbox_retention_cursors to authenticated;
create policy inbox_retention_cursors_select on public.inbox_retention_cursors
  for select to authenticated
  using (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN', 'CEO'));

-- One candidate page per call: booking-linked conversations use the longer
-- retention cutoff, everyone else uses the enquiry cutoff, ordered by the
-- same keyset the cursor tracks so a resumed sweep never re-walks rows it
-- already cleared and never skips a row that only just crossed its cutoff.
create or replace function public.inbox_retention_candidate_conversations(
  p_agency_id uuid,
  p_booking_cutoff timestamptz,
  p_enquiry_cutoff timestamptz,
  p_cursor_at timestamptz,
  p_cursor_id uuid,
  p_limit integer
)
returns table(id uuid, last_activity_at timestamptz, booking_linked boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with linkage as (
    select
      c.id,
      c.last_activity_at,
      coalesce(bl.linked, false) or coalesce(ld.linked, false) as booking_linked
    from public.conversations c
    left join lateral (
      select true as linked
      from public.departure_group_bookings b
      where b.agency_id = p_agency_id and b.source_conversation_id = c.id
      limit 1
    ) bl on true
    left join lateral (
      select true as linked
      from public.leads l
      where l.agency_id = p_agency_id and l.id = c.lead_id and l.booking_id is not null
      limit 1
    ) ld on true
    where c.agency_id = p_agency_id
      and (c.last_activity_at, c.id) > (p_cursor_at, p_cursor_id)
  )
  select id, last_activity_at, booking_linked
  from linkage
  where last_activity_at < case when booking_linked then p_booking_cutoff else p_enquiry_cutoff end
  order by last_activity_at, id
  limit p_limit;
$$;
revoke all on function public.inbox_retention_candidate_conversations(uuid, timestamptz, timestamptz, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.inbox_retention_candidate_conversations(uuid, timestamptz, timestamptz, timestamptz, uuid, integer) to service_role;

-- Cursor writes go through the admin (service-role) client directly, the same
-- way `inbox_retention_sweeps` rows are already written — no RPC wrapper
-- needed since service_role bypasses RLS and already holds table privileges.

notify pgrst, 'reload schema';
