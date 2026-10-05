-- SEC-6 of docs/progress/2026-10-05-inbox-security-and-bug-audit.md: nothing limited how many billable WhatsApp chats or templates, AI drafts or translations a staff
-- account (or one agency) could trigger. A stolen session could message arbitrary numbers from the agency's verified number and risk a Meta quality downgrade, or
-- run up the AI bill.
--
-- Two counters per action, both checked together and bumped in ONE atomic step so two simultaneous clicks cannot both squeeze through:
--   USER   one staff member, one hour at a time;
--   AGENCY one whole agency, one day at a time (Sri Lanka day; the server passes the window start).
-- The limits themselves come from the server's defaults (lib/inbox/rate-limit/policy.ts). Platform staff can change them for ONE agency with a row in
-- inbox_rate_limit_overrides (a null column keeps the default, 0 blocks the action). Agency admins cannot: both tables are server-only, like
-- inbox_template_send_claims, so an agency cannot raise its own ceiling. See docs/runbooks/inbox-rate-limits.md.
--
-- Rollback: drop the two functions and the two tables. Idempotent.

create table if not exists public.inbox_rate_limit_counters (
  agency_id     uuid        not null references public.agencies (id) on delete cascade,
  scope         text        not null check (scope in ('USER', 'AGENCY')),
  -- the staff member for USER, the agency itself for AGENCY
  subject_id    uuid        not null,
  action        text        not null,
  window_start  timestamptz not null,
  used          integer     not null default 0 check (used >= 0),
  primary key (agency_id, scope, subject_id, action, window_start)
);

comment on table public.inbox_rate_limit_counters is
  'One counter per agency, scope (USER hour / AGENCY day), subject, action and window (SEC-6). Written only by consume_inbox_rate_limit / refund_inbox_rate_limit. Server-only.';

create index if not exists inbox_rate_limit_counters_window_idx on public.inbox_rate_limit_counters (window_start);

create table if not exists public.inbox_rate_limit_overrides (
  agency_id         uuid        not null references public.agencies (id) on delete cascade,
  action            text        not null,
  per_user_hourly   integer     check (per_user_hourly is null or per_user_hourly >= 0),
  per_agency_daily  integer     check (per_agency_daily is null or per_agency_daily >= 0),
  note              text        not null default '',
  updated_at        timestamptz not null default now(),
  primary key (agency_id, action)
);

comment on table public.inbox_rate_limit_overrides is
  'Platform-set limits for one agency and action (SEC-6). A null column keeps the default; 0 blocks the action. Server-only: agency admins cannot raise their own limits.';

alter table public.inbox_rate_limit_counters enable row level security;
alter table public.inbox_rate_limit_overrides enable row level security;
revoke all on table public.inbox_rate_limit_counters from anon, authenticated;
revoke all on table public.inbox_rate_limit_overrides from anon, authenticated;

-- Counts one use against the agency's day counter and the person's hour counter, only if BOTH still have room. A null limit means that scope is not limited.
-- Both counters are locked in a fixed order (agency, then user), so overlapping calls queue instead of deadlocking.
create or replace function public.consume_inbox_rate_limit(
  p_agency_id    uuid,
  p_user_id      uuid,
  p_action       text,
  p_user_limit   integer,
  p_agency_limit integer,
  p_hour_start   timestamptz,
  p_day_start    timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency_used integer := 0;
  v_user_used   integer := 0;
begin
  if p_agency_limit is not null then
    insert into public.inbox_rate_limit_counters (agency_id, scope, subject_id, action, window_start, used)
    values (p_agency_id, 'AGENCY', p_agency_id, p_action, p_day_start, 0)
    on conflict do nothing;
    select used into v_agency_used from public.inbox_rate_limit_counters
     where agency_id = p_agency_id and scope = 'AGENCY' and subject_id = p_agency_id and action = p_action and window_start = p_day_start
     for update;
  end if;

  if p_user_limit is not null then
    insert into public.inbox_rate_limit_counters (agency_id, scope, subject_id, action, window_start, used)
    values (p_agency_id, 'USER', p_user_id, p_action, p_hour_start, 0)
    on conflict do nothing;
    select used into v_user_used from public.inbox_rate_limit_counters
     where agency_id = p_agency_id and scope = 'USER' and subject_id = p_user_id and action = p_action and window_start = p_hour_start
     for update;
  end if;

  if p_agency_limit is not null and v_agency_used >= p_agency_limit then
    return jsonb_build_object('allowed', false, 'blocked_by', 'AGENCY', 'agency_used', v_agency_used, 'user_used', v_user_used);
  end if;
  if p_user_limit is not null and v_user_used >= p_user_limit then
    return jsonb_build_object('allowed', false, 'blocked_by', 'USER', 'agency_used', v_agency_used, 'user_used', v_user_used);
  end if;

  if p_agency_limit is not null then
    update public.inbox_rate_limit_counters set used = used + 1
     where agency_id = p_agency_id and scope = 'AGENCY' and subject_id = p_agency_id and action = p_action and window_start = p_day_start;
    v_agency_used := v_agency_used + 1;
  end if;
  if p_user_limit is not null then
    update public.inbox_rate_limit_counters set used = used + 1
     where agency_id = p_agency_id and scope = 'USER' and subject_id = p_user_id and action = p_action and window_start = p_hour_start;
    v_user_used := v_user_used + 1;
  end if;

  return jsonb_build_object('allowed', true, 'blocked_by', null, 'agency_used', v_agency_used, 'user_used', v_user_used);
end;
$$;

-- Gives back one use when the action turned out not to happen (for example Meta refused the send). Never goes below zero.
create or replace function public.refund_inbox_rate_limit(
  p_agency_id  uuid,
  p_user_id    uuid,
  p_action     text,
  p_hour_start timestamptz,
  p_day_start  timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.inbox_rate_limit_counters
     set used = greatest(used - 1, 0)
   where agency_id = p_agency_id
     and action = p_action
     and ((scope = 'AGENCY' and subject_id = p_agency_id and window_start = p_day_start)
       or (scope = 'USER' and subject_id = p_user_id and window_start = p_hour_start));
$$;

revoke all on function public.consume_inbox_rate_limit(uuid, uuid, text, integer, integer, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.refund_inbox_rate_limit(uuid, uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.consume_inbox_rate_limit(uuid, uuid, text, integer, integer, timestamptz, timestamptz) to service_role;
grant execute on function public.refund_inbox_rate_limit(uuid, uuid, text, timestamptz, timestamptz) to service_role;
