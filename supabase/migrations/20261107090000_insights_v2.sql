-- Insights v2 — Phase 0 (P0.3) of docs/modules/manasik-intelligence-build-roadmap.md;
-- fixes F4 in docs/modules/manasik-intelligence-implementation-plan.md §1.3
-- ("Insights are thin and ungoverned").
--
-- Widens `insights`/`insight_evidence`/`insight_outcomes`
-- (20261022090000_ai_insights.sql) with the fields the spec's §27 asks
-- every insight to carry: module, surface, origin (RULE vs COPILOT —
-- see docs/standards/copilot-attribution-convention.md), confidence, a
-- recommendation, who may act (`required_capability`) vs who may see
-- (`viewer_capability`), a one-click proposal reference, data freshness,
-- expiry, and the run that produced it. Backfills the 4 existing
-- generators (STALLED_LEAD, CONSENT_GAP, LOW_SURVEY_SCORE,
-- CAMPAIGN_DIAGNOSIS_*) with `origin = 'RULE'` — correct for all four,
-- since none of them call a model.
--
-- Replaces the hard-coded role list on insights'/insight_evidence's/
-- insight_outcomes' write policies (ADMIN, CEO, OPERATIONS, MARKETING)
-- with a capability check via `insights.actOnInsight` /
-- `insights.manageAiSurfaces`, resolved the same way every other
-- capability in this schema now can be (role_permissions, per
-- 20261106090000_rbac_new_modules.sql) — so a FINANCE user can eventually
-- own a finance insight without a code change to this policy.
--
-- Safe to run after 20261022090000 and 20261106090000.

alter table public.insights
  add column if not exists module text,
  add column if not exists surface text,
  add column if not exists origin text not null default 'RULE' check (origin in ('RULE', 'COPILOT')),
  add column if not exists confidence numeric(3, 2),
  add column if not exists recommendation text,
  add column if not exists required_capability text,
  add column if not exists viewer_capability text,
  add column if not exists proposal_kind text,
  add column if not exists data_freshness jsonb not null default '{}'::jsonb,
  add column if not exists expires_at timestamptz,
  add column if not exists run_id uuid;

update public.insights set module = 'leads', surface = 'SALES' where insight_type = 'STALLED_LEAD' and module is null;
update public.insights set module = 'settings', surface = 'MARKETING' where insight_type = 'CONSENT_GAP' and module is null;
update public.insights set module = 'relationships', surface = 'PILGRIM_SUCCESS' where insight_type = 'LOW_SURVEY_SCORE' and module is null;
update public.insights set module = 'marketing', surface = 'MARKETING' where insight_type like 'CAMPAIGN_%' and module is null;
update public.insights set module = coalesce(module, 'reports'), surface = coalesce(surface, 'BUSINESS_INTELLIGENCE') where module is null;

-- Widen subject_type — Phase 1+ generators surface findings about
-- bookings, quotes, refunds and bank transactions too, not only the four
-- subject types the first cut needed. Free text going forward (see the
-- companion agent_proposals migration's F5 note); this ALTER only
-- widens the existing check constraint, it does not remove it, since
-- insights already has real rows depending on it staying enforced at all.
alter table public.insights drop constraint if exists insights_subject_type_check;
alter table public.insights add constraint insights_subject_type_check
  check (subject_type in (
    'LEAD', 'PILGRIM', 'DEPARTURE_GROUP', 'SURVEY_RESPONSE', 'AGENT', 'CAMPAIGN',
    'BOOKING', 'QUOTE', 'REFUND_REQUEST', 'SUPPLIER', 'BANK_TRANSACTION'
  ));

alter table public.insight_evidence
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists href text,
  add column if not exists is_fact boolean not null default true;

comment on column public.insight_evidence.is_fact is
  'true = a confirmed record this insight cites; false = an inference/prediction being shown alongside its evidence. Lets the UI honestly distinguish the two per the spec''s "AI must distinguish confirmed facts from suggestions or predictions."';

alter table public.insight_outcomes
  add column if not exists outcome_detail jsonb not null default '{}'::jsonb,
  add column if not exists helpful boolean,
  add column if not exists correction text;

create index if not exists insights_module_idx on public.insights (agency_id, module, status);
create index if not exists insights_surface_idx on public.insights (agency_id, surface, status);

-- Capability-aware write policy, replacing the hard-coded role list.
-- `insights.actOnInsight` covers day-to-day dismiss/resolve/acknowledge;
-- `manageAiSurfaces` (ADMIN/CEO only, per the placeholder seed) is not
-- required for ordinary insight writes — this policy intentionally stays
-- at the lower bar so any role granted actOnInsight can act, matching the
-- pre-existing MARKETING/OPERATIONS inclusion.
create or replace function public.can_act_on_insight()
returns boolean
language sql
stable
security invoker
as $$
  select exists (
    select 1
    from public.staff_profiles sp
    left join public.role_permissions rp
      on rp.role_id = sp.role_id and rp.module = 'insights'
    where sp.id = auth.uid()
      and sp.agency_id = public.current_agency_id()
      and coalesce((rp.capabilities ->> 'actOnInsight')::boolean, public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'MARKETING'))
  );
$$;

comment on function public.can_act_on_insight is
  'RLS helper for insights/insight_evidence/insight_outcomes writes: true when the caller''s role_permissions row grants insights.actOnInsight, falling back to the pre-P0.3 hard-coded role list (ADMIN/CEO/OPERATIONS/MARKETING) when no dynamic override exists for their role, so no existing account loses access the moment this migration lands.';

drop policy if exists "staff write insights" on public.insights;
create policy "staff write insights" on public.insights
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.can_act_on_insight())
  with check (agency_id = public.current_agency_id() and public.can_act_on_insight());

drop policy if exists "staff write insight_evidence" on public.insight_evidence;
create policy "staff write insight_evidence" on public.insight_evidence
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.can_act_on_insight())
  with check (agency_id = public.current_agency_id() and public.can_act_on_insight());

drop policy if exists "staff write insight_outcomes" on public.insight_outcomes;
create policy "staff write insight_outcomes" on public.insight_outcomes
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.can_act_on_insight())
  with check (agency_id = public.current_agency_id() and public.can_act_on_insight());

notify pgrst, 'reload schema';
