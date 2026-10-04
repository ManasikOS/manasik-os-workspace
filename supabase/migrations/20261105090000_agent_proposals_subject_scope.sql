-- Proposal kernel v2 — Phase 0 (P0.2) of
-- docs/modules/manasik-intelligence-build-roadmap.md; generalises `agent_proposals`
-- from departure-group-only to any subject type, per §3.2 of
-- docs/modules/manasik-intelligence-implementation-plan.md.
--
-- `departure_group_id` stays in place as a nullable denormalised filter —
-- the group Agent tab, the guide-scoping RLS
-- (20260903090000/20260905090000) and every existing query that assumes a
-- group parent keep working unchanged. `module`/`subject_type`/
-- `subject_id` are the new, general addressing scheme every future
-- proposal kind (quotes, bookings, refunds, referrals, …) uses instead.
--
-- Safe to run after 20260919090000 and 20260920090000. Backfills every
-- existing row (today all DEPARTURE_GROUP-scoped) before tightening the
-- new columns to NOT NULL, so there is no window where a row fails the
-- new constraints.

alter table public.agent_proposals
  add column if not exists module text,
  add column if not exists subject_type text,
  add column if not exists subject_id uuid,
  add column if not exists surface text,
  add column if not exists source_insight_id uuid;

update public.agent_proposals
   set module = 'departure_groups',
       subject_type = 'DEPARTURE_GROUP',
       subject_id = departure_group_id,
       surface = coalesce(surface, 'DEPARTURE_OPS')
 where subject_id is null;

alter table public.agent_proposals
  alter column departure_group_id drop not null;

alter table public.agent_proposals
  alter column module set not null,
  alter column subject_type set not null,
  alter column subject_id set not null;

-- `source_insight_id` deliberately has no FK yet — `insights` gains the
-- columns this references in the companion `_p0_3` migrations, sequenced
-- after this one; a same-migration FK to a table not yet shaped for it
-- would be backwards. Added as a plain uuid now, FK constraint follow-up
-- is optional once §3.5 (insights v2) lands.

comment on column public.agent_proposals.module is
  'A PermissionModule key (lib/access/role-permissions-shared.ts) — which module''s capabilities gate this proposal''s approval. Free text, not a check constraint: a module added later must not require a migration just to be nameable here (see docs/modules/manasik-intelligence-implementation-plan.md F5).';
comment on column public.agent_proposals.subject_type is
  'What subject_id refers to — e.g. DEPARTURE_GROUP, BOOKING, QUOTE, REFUND_REQUEST. Free text for the same reason as module.';
comment on column public.agent_proposals.subject_id is
  'The record this proposal is about. For subject_type = DEPARTURE_GROUP this equals departure_group_id (kept in sync by application code, not a generated column, since departure_group_id predates this and many existing queries filter on it directly).';
comment on column public.agent_proposals.surface is
  'The AI surface that raised this proposal (Plan §3.7 roster) — e.g. DEPARTURE_OPS, BOOKING_ADVISOR, FINANCE. Free text.';

-- Replace the group-only unique/query indexes with subject-scoped ones.
drop index if exists public.agent_proposals_open_fingerprint_idx;
create unique index if not exists agent_proposals_open_fingerprint_idx
  on public.agent_proposals (subject_type, subject_id, fingerprint)
  where status in ('PROPOSED', 'APPROVED');

drop index if exists public.agent_proposals_group_idx;
create index if not exists agent_proposals_subject_idx
  on public.agent_proposals (subject_type, subject_id, status);

-- departure_group_id keeps its own index (now on a nullable column) since
-- the group Agent tab still filters by it directly.
create index if not exists agent_proposals_departure_group_idx
  on public.agent_proposals (departure_group_id, status)
  where departure_group_id is not null;

create index if not exists agent_proposals_module_idx
  on public.agent_proposals (agency_id, module, status);

-- Widen the RLS "floor" to every base role — capability checking
-- (`required_capability` vs the approver's resolved capabilities) is the
-- real gate, in the Server Action per module (F7 in the departure-ops
-- plan: "RLS is the floor, the Server Action is the gate"). The floor was
-- ADMIN/CEO/OPERATIONS/FINANCE because those were the only roles any
-- departure-ops proposal kind could ever require; Phase 1+ adds kinds
-- gated by MARKETING (audiences, referrals) and VISA (visa-linked
-- proposals), so the floor widens to match, not the ceiling.
drop policy if exists "staff decide agent_proposals" on public.agent_proposals;
create policy "staff decide agent_proposals" on public.agent_proposals
  for update to authenticated
  using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());

drop policy if exists "staff write agent_proposal_events" on public.agent_proposal_events;
create policy "staff write agent_proposal_events" on public.agent_proposal_events
  for insert to authenticated
  with check (agency_id = public.current_agency_id());

-- Rollback (commented — additive migration, not applied automatically):
-- drop index if exists public.agent_proposals_module_idx;
-- drop index if exists public.agent_proposals_departure_group_idx;
-- drop index if exists public.agent_proposals_subject_idx;
-- create unique index agent_proposals_open_fingerprint_idx on public.agent_proposals (departure_group_id, fingerprint) where status in ('PROPOSED', 'APPROVED');
-- alter table public.agent_proposals alter column departure_group_id set not null;
-- alter table public.agent_proposals drop column module, drop column subject_type, drop column subject_id, drop column surface, drop column source_insight_id;

notify pgrst, 'reload schema';
