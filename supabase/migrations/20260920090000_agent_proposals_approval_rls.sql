-- Phase 3 of docs/modules/departure-operations-agent-implementation-plan.md: the
-- executor registry and the approve/reject Server Actions this migration's
-- predecessor (20260919090000) explicitly deferred these policies for —
-- see that migration's §G comment ("Phase 3 adds the authenticated UPDATE
-- policy on agent_proposals once there is a caller for it").
--
-- Capability checking (`required_capability` vs `capabilitiesFor(role)`) is
-- NOT expressible in RLS — it is a column value compared against a
-- TypeScript capability matrix, not a role claim. That check happens in the
-- Server Action, before it ever reaches the database (F7: "RLS is the
-- floor, the Server Action is the gate"). What RLS adds here is the floor:
-- only the roles that could ever hold ANY decision capability may touch
-- these rows at all, and only within their own agency.

-- ─────────────────────────────────────────────────────────────────────────────
-- agent_proposals — a decision (approve/reject) is an UPDATE of `status`,
-- `decided_by`, `decided_at`, `decision_note`, and — only for an
-- edit-then-approve — `payload`. Scoped to the same roles §6.6 already
-- named as agent_proposals' decision-makers.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "staff decide agent_proposals" on public.agent_proposals;
create policy "staff decide agent_proposals" on public.agent_proposals
  for update to authenticated
  using (
    agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'FINANCE')
  )
  with check (
    agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'FINANCE')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- agent_proposal_events — still append-only (no update/delete policy for
-- anyone, unchanged), but a decision now needs to WRITE its own event row
-- from the approving human's own session, so `actor_id` resolves to their
-- real `auth.uid()` rather than a service-role write with no real actor.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "staff write agent_proposal_events" on public.agent_proposal_events;
create policy "staff write agent_proposal_events" on public.agent_proposal_events
  for insert to authenticated
  with check (
    agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'FINANCE')
  );
