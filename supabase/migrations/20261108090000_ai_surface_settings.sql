-- ai_surface_settings — Phase 0 (P0.3) of
-- docs/modules/manasik-intelligence-build-roadmap.md; see Plan §3.7.
--
-- Per-agency, per-surface AI configuration: on/off, autonomy mode
-- (OFF/SHADOW/PROPOSE/ACTIVE — the same four-state ladder
-- `departure_group_agent_state.mode` already uses), high-risk approver
-- roles, budgets, and the rejection-rate threshold that demotes a surface
-- back to SHADOW. `lib/ai/budget.ts` reads this table before every model
-- call through the shared provider seam (`lib/ai/provider.ts`).
--
-- Seeds one row per existing agency for `DEPARTURE_OPS` and `WHATSAPP`,
-- copied from `ai_settings`' existing columns, so those two agents keep
-- behaving exactly as configured today — `lib/ai/budget.ts` is
-- permissive (returns ok:true) whenever a surface has no row at all, so
-- this seed is a courtesy for the two agents that already have a
-- meaningful on/off state to preserve, not a requirement for the table to
-- function.
--
-- Safe to run after 20260826090000 (ai_settings) and 20260919090000
-- (departure_group_agent_state).

create table if not exists public.ai_surface_settings (
  agency_id                  uuid not null default public.current_agency_id() references public.agencies (id),
  surface                    text not null,

  enabled                    boolean not null default false,
  mode                       text not null default 'SHADOW' check (mode in ('OFF', 'SHADOW', 'PROPOSE', 'ACTIVE')),
  high_risk_roles            text[] not null default '{ADMIN,CEO}',
  max_proposals_per_day      integer not null default 50,
  monthly_budget_usd         numeric(10, 2),
  autonomy                   jsonb not null default '{}'::jsonb,
  rejection_demote_threshold numeric(3, 2) not null default 0.40,

  updated_by                 uuid,
  updated_at                 timestamptz not null default now(),

  primary key (agency_id, surface)
);

comment on table public.ai_surface_settings is
  'Per-agency, per-AI-surface configuration — enabled/mode/high-risk roles/budget. A surface absent here is treated as unmetered/permissive by lib/ai/budget.ts, matching this schema''s existing "absent config is not a silent block" posture (see lib/access/dynamic-capabilities.ts).';

create index if not exists ai_surface_settings_agency_idx on public.ai_surface_settings (agency_id);

alter table public.ai_surface_settings enable row level security;

drop policy if exists "staff read ai_surface_settings" on public.ai_surface_settings;
create policy "staff read ai_surface_settings" on public.ai_surface_settings
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff manage ai_surface_settings" on public.ai_surface_settings;
create policy "staff manage ai_surface_settings" on public.ai_surface_settings
  for all to authenticated
  using (
    agency_id = public.current_agency_id()
    and exists (
      select 1 from public.staff_profiles sp
      left join public.role_permissions rp on rp.role_id = sp.role_id and rp.module = 'insights'
      where sp.id = auth.uid()
        and coalesce((rp.capabilities ->> 'manageAiSurfaces')::boolean, public.staff_role_in('ADMIN', 'CEO'))
    )
  )
  with check (
    agency_id = public.current_agency_id()
    and exists (
      select 1 from public.staff_profiles sp
      left join public.role_permissions rp on rp.role_id = sp.role_id and rp.module = 'insights'
      where sp.id = auth.uid()
        and coalesce((rp.capabilities ->> 'manageAiSurfaces')::boolean, public.staff_role_in('ADMIN', 'CEO'))
    )
  );

drop trigger if exists ai_surface_settings_set_updated_at on public.ai_surface_settings;
create trigger ai_surface_settings_set_updated_at
  before update on public.ai_surface_settings
  for each row execute function public.set_updated_at();

-- Seed DEPARTURE_OPS / WHATSAPP rows from ai_settings for every agency
-- that already has one, so nothing about either agent's current
-- behaviour changes the moment this table exists.
insert into public.ai_surface_settings (agency_id, surface, enabled, mode, high_risk_roles)
select
  s.agency_id,
  'DEPARTURE_OPS',
  coalesce(s.departure_ops_enabled, false),
  coalesce(s.departure_ops_mode, 'SHADOW'),
  coalesce(s.departure_ops_high_risk_roles, '{ADMIN,CEO}')
from public.ai_settings s
on conflict (agency_id, surface) do nothing;

insert into public.ai_surface_settings (agency_id, surface, enabled, mode)
select
  s.agency_id,
  'WHATSAPP',
  coalesce(s.enabled, false),
  case when coalesce(s.enabled, false) then 'ACTIVE' else 'OFF' end
from public.ai_settings s
on conflict (agency_id, surface) do nothing;

-- Rollback (commented — additive migration, not applied automatically):
-- drop table if exists public.ai_surface_settings;

notify pgrst, 'reload schema';
