-- Leads module — abuse limits and audited export (docs/security/leads-module-security-audit-and-remediation-plan.md, Phase 3: LD-12, LD-18, LD-21).
--
--   A. consume_staff_rate_limit(): a small fixed-window counter, per signed-in user and optionally per agency per day. Used for the actions that cost
--      money (the AI copilot), move data in bulk (CSV import) or answer "does this person exist?" (duplicate check).
--   B. lead_export_logs + authorise_lead_export(): exporting the lead list is recorded and limited, not just a hidden button. Mirrors the package
--      catalogue export (20270120090700).
--   C. leads.email_normalised: a stored, indexed, lower-cased e-mail so the duplicate check compares for equality instead of `ilike` — where PostgREST
--      treats `*` as a wildcard, so an e-mail of `*` matched the first lead on file.
--
-- Idempotent. Rollback: drop the two functions and the table, and the column.

-- ── A. Rate limit buckets ────────────────────────────────────────────────────
create table if not exists public.staff_rate_limit_buckets (
  bucket_key   text        not null,
  window_start timestamptz not null,
  used         integer     not null default 0 check (used >= 0),
  primary key (bucket_key, window_start)
);

comment on table public.staff_rate_limit_buckets is
  'Fixed-window use counters keyed by "<scope>:<id>:<action>". Written only by consume_staff_rate_limit(); no policy is granted to any role.';

alter table public.staff_rate_limit_buckets enable row level security;
revoke all on public.staff_rate_limit_buckets from anon, authenticated;

-- Counts one use for the signed-in user (and, when a daily agency ceiling is given, for the agency). Returns
--   { allowed: boolean, blocked_by: 'USER' | 'AGENCY' | null, retry_after_seconds: integer }
create or replace function public.consume_staff_rate_limit(
  p_action          text,
  p_user_limit      integer,
  p_window_seconds  integer,
  p_agency_limit    integer default null
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_agency  uuid := public.current_agency_id();
  v_now     timestamptz := now();
  v_start   timestamptz;
  v_used    integer;
  v_day     timestamptz := date_trunc('day', v_now at time zone 'Asia/Colombo') at time zone 'Asia/Colombo';
begin
  if v_user is null or v_agency is null then
    raise exception 'Not signed in to an agency' using errcode = '42501';
  end if;
  if p_action is null or length(p_action) > 60 or p_user_limit is null or p_user_limit < 1
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit request' using errcode = '22023';
  end if;

  v_start := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);

  insert into public.staff_rate_limit_buckets as b (bucket_key, window_start, used)
  values ('u:' || v_user::text || ':' || p_action, v_start, 1)
  on conflict (bucket_key, window_start) do update set used = b.used + 1
  returning used into v_used;

  if v_used > p_user_limit then
    return jsonb_build_object(
      'allowed', false, 'blocked_by', 'USER',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - v_now)))::integer)
    );
  end if;

  if p_agency_limit is not null then
    insert into public.staff_rate_limit_buckets as b (bucket_key, window_start, used)
    values ('a:' || v_agency::text || ':' || p_action, v_day, 1)
    on conflict (bucket_key, window_start) do update set used = b.used + 1
    returning used into v_used;

    if v_used > p_agency_limit then
      return jsonb_build_object(
        'allowed', false, 'blocked_by', 'AGENCY',
        'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_day + interval '1 day' - v_now)))::integer)
      );
    end if;
  end if;

  -- Housekeeping: old windows are of no use. Done on a small share of calls so no job is needed.
  if random() < 0.01 then
    delete from public.staff_rate_limit_buckets where window_start < v_now - interval '3 days';
  end if;

  return jsonb_build_object('allowed', true, 'blocked_by', null, 'retry_after_seconds', 0);
end $$;

revoke all on function public.consume_staff_rate_limit(text, integer, integer, integer) from public, anon;
grant execute on function public.consume_staff_rate_limit(text, integer, integer, integer) to authenticated;

-- ── B. Audited export ────────────────────────────────────────────────────────
create table if not exists public.lead_export_logs (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null default public.current_agency_id() references public.agencies (id),
  user_id    uuid references auth.users (id) on delete set null,
  user_name  text not null default 'Staff',
  row_count  integer not null check (row_count between 1 and 100000),
  filters    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.lead_export_logs is
  'One row per Leads export: who, when, how many rows and which view. Written only by authorise_lead_export(); no INSERT, UPDATE or DELETE policy. The hourly limit counts these rows.';

create index if not exists lead_export_logs_user_idx   on public.lead_export_logs (user_id, created_at desc);
create index if not exists lead_export_logs_agency_idx on public.lead_export_logs (agency_id, created_at desc);

alter table public.lead_export_logs enable row level security;
revoke insert, update, delete on public.lead_export_logs from anon, authenticated;

drop policy if exists lead_export_logs_select on public.lead_export_logs;
create policy lead_export_logs_select on public.lead_export_logs
  for select to authenticated
  using (agency_id = (select public.current_agency_id()) and public.staff_role_in('ADMIN'));

-- The same roles the leads write policies allow. The application also checks the role's saved `exportLeads` capability first.
create or replace function public.authorise_lead_export(p_row_count integer, p_filters jsonb default '{}'::jsonb)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  c_limit   constant integer := 10;
  v_agency  uuid := public.current_agency_id();
  v_actor   uuid := auth.uid();
  v_name    text;
  v_used    integer;
  v_oldest  timestamptz;
  v_wait    integer;
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
begin
  if v_actor is null or not public.staff_role_in('ADMIN', 'MARKETING') then
    raise exception 'Your role cannot export leads.' using errcode = '42501';
  end if;
  if v_agency is null then
    raise exception 'Your session has no active agency.' using errcode = '28000';
  end if;
  if p_row_count is null or p_row_count < 1 or p_row_count > 100000 then
    raise exception 'There is nothing to export.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_filters) <> 'object' or length(v_filters::text) > 2000 then
    v_filters := '{}'::jsonb;
  end if;

  -- Two exports started together must not both slip under the limit.
  perform pg_advisory_xact_lock(hashtextextended('lead_export:' || v_actor::text, 0));

  select count(*), min(created_at) into v_used, v_oldest
  from public.lead_export_logs
  where user_id = v_actor and created_at > now() - interval '1 hour';

  if v_used >= c_limit then
    v_wait := greatest(1, ceil(extract(epoch from (v_oldest + interval '1 hour' - now())) / 60)::integer);
    raise exception 'You have reached the limit of % exports an hour. Try again in % minute(s).', c_limit, v_wait using errcode = 'P0001';
  end if;

  select full_name into v_name from public.staff_profiles where id = v_actor;

  insert into public.lead_export_logs (agency_id, user_id, user_name, row_count, filters)
  values (v_agency, v_actor, coalesce(v_name, 'Staff'), p_row_count, v_filters);

  return jsonb_build_object('allowed', true, 'remaining', c_limit - v_used - 1);
end $$;

revoke all on function public.authorise_lead_export(integer, jsonb) from public, anon;
grant execute on function public.authorise_lead_export(integer, jsonb) to authenticated;

-- ── C. Normalised e-mail ─────────────────────────────────────────────────────
alter table public.leads
  add column if not exists email_normalised text
  generated always as (nullif(lower(btrim(email)), '')) stored;

create index if not exists leads_email_normalised_idx on public.leads (agency_id, email_normalised) where email_normalised is not null;

notify pgrst, 'reload schema';
