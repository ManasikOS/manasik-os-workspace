-- MI0.1 — finish the AI cost ledger (G11) of docs/inbox/implementation-plan.md.
--
--   A. ai_runs.cost_usd widened to numeric(12,8). numeric(10,4) rounds a classify call (~$0.00003)
--      to $0.0000, which would make cheap runs look free in exactly the ledger meant to price them.
--   B. ai_usage_daily — one row per (agency, day, surface): the nightly rollup every cost view reads.
--   C. rollup_ai_usage_daily(day) — idempotent, service_role only. Folds ai_runs (every surface built
--      from Phase 0 on) and agent_runs (the WhatsApp agent, surface 'WHATSAPP_AGENT') into (B), priced from
--      ai_model_rates at the rate in force on the run's day. A run with no rate row is counted in
--      unpriced_runs and contributes nothing to cost_usd — it is never priced at 0.
--   D. Missing ai_model_rates rows for the models the app already calls (embeddings, transcription).
--   E. Cron allow-list + schedule (body copied from 20261201090000_lead_retention_followups.sql; only the
--      list changed). Days are UTC days; the route re-processes yesterday AND today so late runs land.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Precision
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.ai_runs alter column cost_usd type numeric(12, 8);

-- ─────────────────────────────────────────────────────────────────────────────
-- B. ai_usage_daily
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_usage_daily (
  agency_id               uuid not null default public.current_agency_id() references public.agencies (id),
  day                     date not null,
  surface                 text not null,
  runs                    integer not null default 0,
  unpriced_runs           integer not null default 0,
  input_tokens            bigint not null default 0,
  output_tokens           bigint not null default 0,
  cache_read_tokens       bigint not null default 0,
  cache_creation_tokens   bigint not null default 0,
  cost_usd                numeric(14, 8) not null default 0,
  conversations_enriched  integer not null default 0,
  updated_at              timestamptz not null default now(),

  primary key (agency_id, day, surface)
);

comment on table public.ai_usage_daily is
  'Nightly per-agency, per-surface AI usage and cost rollup (UTC days). Written only by rollup_ai_usage_daily(); cost excludes unpriced_runs, which are counted separately rather than priced at zero.';

create index if not exists ai_usage_daily_day_idx on public.ai_usage_daily (agency_id, day desc);

alter table public.ai_usage_daily enable row level security;

drop policy if exists "staff read ai_usage_daily" on public.ai_usage_daily;
create policy "staff read ai_usage_daily" on public.ai_usage_daily
  for select to authenticated
  using (agency_id = public.current_agency_id());

-- No insert/update/delete policy for authenticated: only service_role (the rollup function) writes.

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Rollup
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.rollup_ai_usage_daily(p_day date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  with source_runs as (
    select r.agency_id,
           r.surface,
           r.model,
           coalesce(r.input_tokens, 0)          as input_tokens,
           coalesce(r.output_tokens, 0)         as output_tokens,
           coalesce(r.cache_read_tokens, 0)     as cache_read_tokens,
           coalesce(r.cache_creation_tokens, 0) as cache_creation_tokens,
           case when r.subject_type = 'CONVERSATION' then r.subject_id end as conversation_id
      from public.ai_runs r
     where r.created_at >= p_day::timestamptz
       and r.created_at <  (p_day + 1)::timestamptz
    union all
    select a.agency_id,
           'WHATSAPP_AGENT',
           a.model,
           coalesce(a.input_tokens, 0),
           coalesce(a.output_tokens, 0),
           coalesce(a.cache_read_tokens, 0),
           coalesce(a.cache_creation_tokens, 0),
           a.conversation_id
      from public.agent_runs a
     where a.created_at >= p_day::timestamptz
       and a.created_at <  (p_day + 1)::timestamptz
  ),
  priced as (
    select s.*,
           (rate.model is not null) as has_rate,
           case when rate.model is null then 0 else
             (s.input_tokens          / 1000000.0) * rate.input_rate_per_million +
             (s.output_tokens         / 1000000.0) * rate.output_rate_per_million +
             (s.cache_read_tokens     / 1000000.0) * rate.cache_read_rate_per_million +
             (s.cache_creation_tokens / 1000000.0) * rate.cache_write_rate_per_million
           end as run_cost
      from source_runs s
      left join lateral (
        select m.*
          from public.ai_model_rates m
         where m.model = s.model and m.effective_from <= p_day
         order by m.effective_from desc
         limit 1
      ) rate on true
  ),
  rolled as (
    select agency_id,
           surface,
           count(*)                              as runs,
           count(*) filter (where not has_rate)  as unpriced_runs,
           sum(input_tokens)                     as input_tokens,
           sum(output_tokens)                    as output_tokens,
           sum(cache_read_tokens)                as cache_read_tokens,
           sum(cache_creation_tokens)            as cache_creation_tokens,
           round(sum(run_cost), 8)               as cost_usd,
           count(distinct conversation_id)       as conversations_enriched
      from priced
     group by agency_id, surface
  )
  insert into public.ai_usage_daily as d
    (agency_id, day, surface, runs, unpriced_runs, input_tokens, output_tokens,
     cache_read_tokens, cache_creation_tokens, cost_usd, conversations_enriched, updated_at)
  select agency_id, p_day, surface, runs, unpriced_runs, input_tokens, output_tokens,
         cache_read_tokens, cache_creation_tokens, cost_usd, conversations_enriched, now()
    from rolled
  on conflict (agency_id, day, surface) do update
    set runs                   = excluded.runs,
        unpriced_runs          = excluded.unpriced_runs,
        input_tokens           = excluded.input_tokens,
        output_tokens          = excluded.output_tokens,
        cache_read_tokens      = excluded.cache_read_tokens,
        cache_creation_tokens  = excluded.cache_creation_tokens,
        cost_usd               = excluded.cost_usd,
        conversations_enriched = excluded.conversations_enriched,
        updated_at             = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.rollup_ai_usage_daily(date) from public, anon, authenticated;
grant execute on function public.rollup_ai_usage_daily(date) to service_role;

comment on function public.rollup_ai_usage_daily(date) is
  'Idempotent: recomputes ai_usage_daily for one UTC day from ai_runs + agent_runs. service_role only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Rates for models already in use but never priced
-- ─────────────────────────────────────────────────────────────────────────────
-- OpenRouter list prices per million tokens; add a NEW dated row on a price change, never edit one.
insert into public.ai_model_rates
  (model, effective_from, input_rate_per_million, output_rate_per_million,
   cache_read_rate_per_million, cache_write_rate_per_million, currency)
values
  ('google/gemini-3.5-flash-lite', '2026-01-01', 0.1000, 0.4000, 0.0100, 0.0000, 'USD'),
  ('baai/bge-m3',                  '2026-01-01', 0.0100, 0.0000, 0.0000, 0.0000, 'USD'),
  -- Free OpenRouter model the WhatsApp agent uses for untouched chats (AI_FREE_CHAT_MODEL): genuinely $0, so
  -- pricing it at 0 is true, unlike an unknown model. Seen in agent_runs from 2026-09-19.
  ('inclusionai/ling-3.0-flash-vl:free', '2026-01-01', 0.0000, 0.0000, 0.0000, 0.0000, 'USD')
on conflict (model, effective_from) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Cron
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
    '/api/cron/lead-followups',
    '/api/cron/ai-usage-rollup'
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
    perform cron.unschedule('ai-usage-rollup');
  exception when others then
    null; -- first apply
  end;

  perform cron.schedule(
    'ai-usage-rollup',
    '15 * * * *',
    format('select public.invoke_cron_route(%L);', '/api/cron/ai-usage-rollup')
  );
end $$;
