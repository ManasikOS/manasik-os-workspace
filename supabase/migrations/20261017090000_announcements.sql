-- ─────────────────────────────────────────────────────────────────────────────
-- Announcements (M13 partial) — broadcast composer with targeting and
-- read/acknowledgement tracking.
--
-- Targeting reuses Audiences (supabase/migrations/20261014090000_audiences.sql)
-- rather than reinventing a filter language: an announcement points at either
-- a departure group (target_type = 'DEPARTURE_GROUP') or a saved audience
-- (target_type = 'AUDIENCE'). `announcement_recipients` is the frozen
-- snapshot of who the audience/group resolved to *at send time* — consent is
-- checked against the live leads/pilgrims consent columns when that snapshot
-- is built, never inferred or reused from an older send.
--
-- Actual outbound delivery (WhatsApp/email/SMS dispatch) is out of scope
-- here — there is no outbound broadcast integration in this codebase yet,
-- only the per-conversation Inbox send path. Marking an announcement SENT
-- freezes its recipient list and timestamp; wiring a real channel dispatch
-- is future work once such an integration exists.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),

  title text not null,
  body text not null,
  channel text not null check (channel in ('PORTAL', 'WHATSAPP', 'EMAIL', 'SMS', 'IN_APP')),

  target_type text not null check (target_type in ('DEPARTURE_GROUP', 'AUDIENCE')),
  departure_group_id uuid references public.departure_groups (id) on delete cascade,
  audience_id uuid references public.audiences (id) on delete set null,

  status text not null default 'DRAFT' check (status in ('DRAFT', 'SCHEDULED', 'SENT', 'CANCELLED')),
  scheduled_at timestamptz,
  sent_at timestamptz,

  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint announcements_target_ref_check check (
    (target_type = 'DEPARTURE_GROUP' and departure_group_id is not null)
    or (target_type = 'AUDIENCE' and audience_id is not null)
  )
);

comment on table public.announcements is
  'Broadcast composed against a departure group or a saved audience. Recipients are snapshotted into announcement_recipients when sent.';

create index if not exists announcements_agency_idx on public.announcements (agency_id);

alter table public.announcements enable row level security;

drop policy if exists "staff read announcements" on public.announcements;
create policy "staff read announcements" on public.announcements
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write announcements" on public.announcements;
create policy "staff write announcements" on public.announcements
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS'));

-- ─────────────────────────────────────────────────────────────────────────────
-- announcement_recipients — the frozen "who" for one sent announcement, plus
-- read/acknowledgement tracking. contactable = false records that this
-- subject was in the target group/audience but was excluded from the
-- snapshot for consent reasons (do_not_contact, or channel not in
-- contactable_channels) — kept as a row, not silently dropped, so the
-- announcement's reach is auditable.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.announcement_recipients (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  announcement_id uuid not null references public.announcements (id) on delete cascade,

  subject_type text not null check (subject_type in ('LEAD', 'PILGRIM')),
  subject_id uuid not null,
  contactable boolean not null default true,
  exclusion_reason text,

  delivered_at timestamptz,
  read_at timestamptz,
  acknowledged_at timestamptz,

  unique (announcement_id, subject_id)
);

comment on table public.announcement_recipients is
  'Frozen recipient snapshot for one announcement, including excluded-for-consent rows for auditability.';

create index if not exists announcement_recipients_announcement_idx on public.announcement_recipients (announcement_id);
create index if not exists announcement_recipients_agency_idx on public.announcement_recipients (agency_id);

alter table public.announcement_recipients enable row level security;

drop policy if exists "staff read announcement_recipients" on public.announcement_recipients;
create policy "staff read announcement_recipients" on public.announcement_recipients
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write announcement_recipients" on public.announcement_recipients;
create policy "staff write announcement_recipients" on public.announcement_recipients
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS'));

notify pgrst, 'reload schema';
