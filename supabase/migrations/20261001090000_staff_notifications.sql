-- Manasik Copilot's proposal queue (agent_proposals) had no surface that
-- reaches out — the dashboard's "Copilot Approvals" card and the per-group
-- Agent tab both only speak up when someone happens to visit them. F6 of
-- docs/modules/departure-operations-agent-implementation-plan.md said it plainly:
-- "a proposal queue nobody is told about is a queue nobody reads, and the
-- agent silently stops mattering." This table is the fan-out — one row per
-- (recipient, thing they should know about) — read by the header bar's
-- notification bell (components/header-bar.tsx), which until now rendered
-- a hardcoded unread dot with nothing behind it.
--
-- Deliberately narrow for its first cut: only PROPOSAL_PENDING is written
-- today, from notifyProposalPending() in lib/data/staff-notifications.ts,
-- called out of createProposal() in lib/agent/kernel/proposals/service.ts.
-- Extend the `kind` check constraint in a follow-up migration when a second
-- writer (an aged-blocker digest, a completed-review summary) actually
-- ships, rather than reserving unused values now.

create table if not exists public.staff_notifications (
  id                   uuid primary key default gen_random_uuid(),
  agency_id            uuid not null default public.current_agency_id()
                         references public.agencies (id),
  recipient_id         uuid not null references public.staff_profiles (id) on delete cascade,
  kind                 text not null check (kind in ('PROPOSAL_PENDING')),
  departure_group_id   uuid references public.departure_groups (id) on delete cascade,
  proposal_id          uuid references public.agent_proposals (id) on delete cascade,
  title                text not null,
  read_at              timestamptz,
  created_at           timestamptz not null default now()
);

comment on table public.staff_notifications is
  'Fan-out of agent_proposals (and, later, other Copilot-raised events) to the staff who should hear about them. Written server-side only, via the admin client that already bypasses RLS to write agent_proposals itself — never by a direct client insert.';
comment on column public.staff_notifications.title is
  'A snapshot of the source row''s title at fan-out time, the same posture as departure_group_activity_logs.message — not a live join, so a notification still reads correctly after the proposal it points to is later approved, rejected, superseded, or expires.';

create index if not exists staff_notifications_recipient_unread_idx
  on public.staff_notifications (recipient_id, created_at desc)
  where read_at is null;
create index if not exists staff_notifications_recipient_idx
  on public.staff_notifications (recipient_id, created_at desc);
create index if not exists staff_notifications_agency_idx
  on public.staff_notifications (agency_id);

alter table public.staff_notifications enable row level security;

-- A person only ever sees or touches their own notifications. There is
-- deliberately no insert policy for `authenticated` at all: every row is
-- written by server code through the admin client, which RLS does not
-- apply to — matching exactly how agent_proposals itself is only ever
-- written by createProposal(), never by a signed-in user's own session. An
-- ordinary session can never insert into this table.
drop policy if exists "staff_notifications_select_own" on public.staff_notifications;
create policy "staff_notifications_select_own" on public.staff_notifications
  for select to authenticated
  using (recipient_id = auth.uid() and agency_id = public.current_agency_id());

drop policy if exists "staff_notifications_update_own" on public.staff_notifications;
create policy "staff_notifications_update_own" on public.staff_notifications
  for update to authenticated
  using (recipient_id = auth.uid() and agency_id = public.current_agency_id())
  with check (recipient_id = auth.uid() and agency_id = public.current_agency_id());
