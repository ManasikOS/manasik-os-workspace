-- Consent & Contactability (docs/architecture/remaining-modules-master-plan.md, Phase C1).
--
-- Every growth module the master plan schedules after this one — Campaigns,
-- Audiences, Announcements — can reach a real person by WhatsApp, email or
-- SMS. Building any of them before this migration would mean a segment or
-- broadcast tool with no way to know who has actually agreed to be
-- contacted, or who has asked not to be. This is deliberately the first
-- thing built in Phase C.
--
-- Scope: a consent_status + do_not_contact + contactable_channels on both
-- leads and pilgrims (the two tables a message is ever sent to), plus an
-- append-only consent_events log recording every change, on which side of
-- it, and why. No campaign/audience/announcement table is added here — see
-- the follow-on migrations for those.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. leads — consent fields.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.leads
  add column if not exists consent_status text not null default 'UNKNOWN'
    check (consent_status in ('UNKNOWN', 'OPTED_IN', 'OPTED_OUT'));
alter table public.leads
  add column if not exists consent_source text;
alter table public.leads
  add column if not exists consent_at timestamptz;
alter table public.leads
  add column if not exists do_not_contact boolean not null default false;
alter table public.leads
  add column if not exists contactable_channels text[] not null default '{}';

comment on column public.leads.consent_status is
  'UNKNOWN until a staff member records an explicit decision. Never inferred from a reply, a WhatsApp conversation existing, or any other implicit signal.';
comment on column public.leads.do_not_contact is
  'Set independently of consent_status — a lead can be OPTED_IN on WhatsApp and still asked not to be called, or vice versa. Checked before every broadcast (see Announcements, Phase C6).';
comment on column public.leads.contactable_channels is
  'Subset of WHATSAPP/EMAIL/SMS/CALL the lead has actually agreed to. Empty means "no channel confirmed yet" — never defaults to "all channels" just because consent_status is OPTED_IN.';

create index if not exists leads_consent_status_idx on public.leads (consent_status);
create index if not exists leads_do_not_contact_idx on public.leads (do_not_contact) where do_not_contact;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. pilgrims — identical fields, same reasoning.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.pilgrims
  add column if not exists consent_status text not null default 'UNKNOWN'
    check (consent_status in ('UNKNOWN', 'OPTED_IN', 'OPTED_OUT'));
alter table public.pilgrims
  add column if not exists consent_source text;
alter table public.pilgrims
  add column if not exists consent_at timestamptz;
alter table public.pilgrims
  add column if not exists do_not_contact boolean not null default false;
alter table public.pilgrims
  add column if not exists contactable_channels text[] not null default '{}';

comment on column public.pilgrims.consent_status is
  'UNKNOWN until a staff member records an explicit decision. See leads.consent_status for the same rule.';

create index if not exists pilgrims_consent_status_idx on public.pilgrims (consent_status);
create index if not exists pilgrims_do_not_contact_idx on public.pilgrims (do_not_contact) where do_not_contact;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. consent_events — append-only audit trail. subject_id is intentionally
--    FK-less (it points at leads.id or pilgrims.id depending on
--    subject_type) — same posture as departure_group_activity_logs.entity_id.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.consent_events (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null default public.current_agency_id()
                  references public.agencies (id),
  subject_type  text not null check (subject_type in ('LEAD', 'PILGRIM')),
  subject_id    uuid not null,
  action        text not null
                  check (action in ('OPT_IN', 'OPT_OUT', 'DNC_SET', 'DNC_CLEARED', 'CHANNELS_UPDATED')),
  channel       text check (channel is null or channel in ('WHATSAPP', 'EMAIL', 'SMS', 'CALL')),
  source        text not null default '',
  note          text,
  actor_name    text not null default 'Staff',
  created_at    timestamptz not null default now()
);

comment on table public.consent_events is
  'Append-only. One row per consent/do-not-contact decision recorded on a lead or pilgrim — who decided what, when, and why. Never updated or deleted.';

create index if not exists consent_events_subject_idx on public.consent_events (subject_type, subject_id, created_at desc);
create index if not exists consent_events_agency_idx on public.consent_events (agency_id);

alter table public.consent_events enable row level security;

drop policy if exists "staff read consent_events" on public.consent_events;
create policy "staff read consent_events" on public.consent_events
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff insert consent_events" on public.consent_events;
create policy "staff insert consent_events" on public.consent_events
  for insert to authenticated
  with check (agency_id = public.current_agency_id());

-- No update/delete policy for `authenticated` — append-only by construction.

notify pgrst, 'reload schema';
