-- Lead retention: unanswered-handoff alerts, quiet-lead follow-ups, response-time metric.
-- Plan: docs/modules/lead-retention-followups-implementation-plan.md
--
-- A. ai_settings gets the follow-up + alert settings (agency-wide, every channel; default OFF / dry-run).
-- B. conversation_followups is the idempotency + audit ledger for the sweep. Written by the cron with
--    the admin client only; staff with Inbox access can read it.
-- C. staff_notifications learns two conversation kinds and a conversation link.
-- D. invoke_cron_route allows /api/cron/lead-followups, scheduled every 10 minutes.
--
-- The plan says "messages"; the real table is conversation_messages.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. ai_settings
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.ai_settings
  add column if not exists followups_enabled             boolean not null default false,
  add column if not exists followups_dry_run             boolean not null default true,
  add column if not exists followup_delays_hours         integer[] not null default '{3,22,72}',
  add column if not exists followup_message_text         text not null default
    'Hi {name}, just checking in — would you like me to help with anything else about your trip? I''m happy to answer questions or connect you with our team.',
  add column if not exists followup_whatsapp_template_id uuid references public.whatsapp_templates (id) on delete set null,
  add column if not exists handoff_alert_minutes         integer not null default 15,
  add column if not exists handoff_escalation_minutes    integer not null default 60;

alter table public.ai_settings drop constraint if exists ai_settings_followup_delays_check;
alter table public.ai_settings drop constraint if exists ai_settings_handoff_alert_check;
alter table public.ai_settings
  add constraint ai_settings_followup_delays_check
    check (array_length(followup_delays_hours, 1) between 1 and 3
           and 1 <= all (followup_delays_hours)
           and 720 >= all (followup_delays_hours)),
  add constraint ai_settings_handoff_alert_check
    check (handoff_alert_minutes between 1 and 1440
           and handoff_escalation_minutes >= handoff_alert_minutes
           and handoff_escalation_minutes <= 10080);

-- ─────────────────────────────────────────────────────────────────────────────
-- B. conversation_followups — the ledger
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.conversation_followups (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null default public.current_agency_id() references public.agencies (id),
  conversation_id     uuid not null references public.conversations (id) on delete cascade,
  lead_id             uuid references public.leads (id) on delete set null,
  kind                text not null check (kind in ('QUIET_NUDGE', 'HANDOFF_ALERT', 'HANDOFF_ESCALATION')),
  sequence            integer not null default 1,
  anchor_message_id   uuid not null references public.conversation_messages (id) on delete cascade,
  channel             text not null,
  status              text not null check (status in ('CLAIMED', 'SENT', 'SKIPPED', 'FAILED', 'DRY_RUN')),
  skip_reason         text,
  external_message_id text,
  created_at          timestamptz not null default now(),
  unique (conversation_id, kind, sequence, anchor_message_id)
);

comment on table public.conversation_followups is
  'Ledger of automatic follow-ups and handoff alerts. The sweep inserts a CLAIMED row before acting; the unique key makes overlapping cron runs safe. Written by the cron (admin client) only.';

create index if not exists conversation_followups_agency_created_idx
  on public.conversation_followups (agency_id, created_at desc);
create index if not exists conversation_followups_conversation_idx
  on public.conversation_followups (conversation_id, created_at desc);
create index if not exists conversation_followups_anchor_idx
  on public.conversation_followups (anchor_message_id);

alter table public.conversation_followups enable row level security;

-- Read: same agency and the roles that can read conversations. No insert/update/delete policy at all.
drop policy if exists "staff read conversation_followups" on public.conversation_followups;
create policy "staff read conversation_followups" on public.conversation_followups
  for select to authenticated
  using (agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA'));

revoke all on public.conversation_followups from anon, authenticated;
grant select on public.conversation_followups to authenticated;

-- Candidate scan for the quiet-lead sweep (plan §6.4).
create index if not exists conversations_followup_scan_idx
  on public.conversations (agency_id, state, last_inbound_at)
  where state in ('AI_ACTIVE', 'AI_RESUMED');

-- Response-time metric scan (plan §7): bounded by agency and time.
create index if not exists conversation_messages_agency_created_idx
  on public.conversation_messages (agency_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- C. staff_notifications
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.staff_notifications drop constraint if exists staff_notifications_kind_check;
alter table public.staff_notifications
  add constraint staff_notifications_kind_check
    check (kind in ('PROPOSAL_PENDING', 'HANDOFF_WAITING', 'HANDOFF_ESCALATED'));

alter table public.staff_notifications
  add column if not exists conversation_id uuid references public.conversations (id) on delete cascade;

create index if not exists staff_notifications_conversation_idx
  on public.staff_notifications (conversation_id) where conversation_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Cron: allow-list + schedule (body copied from 20260927090000_cron_jobs.sql; only the list changed)
-- ─────────────────────────────────────────────────────────────────────────────
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
    '/api/cron/lead-followups'
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
    perform cron.unschedule('lead-followups-sweep');
  exception when others then
    null; -- first apply
  end;

  perform cron.schedule(
    'lead-followups-sweep',
    '*/10 * * * *',
    format('select public.invoke_cron_route(%L);', '/api/cron/lead-followups')
  );
end $$;
