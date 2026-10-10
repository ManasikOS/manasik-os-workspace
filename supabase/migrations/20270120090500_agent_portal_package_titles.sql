-- TASK-043 Phase 1, step 5 (PKG-06): an agent-portal user (an external sales agent) no longer reads package rows at all.
--
-- The policy "agent read allocated packages" (20261030090000) let an allocated agent `select *` from public.packages. Row security cannot limit columns, so
-- that exposed every field of the package: internal itinerary and transport notes, the readiness checklist, who verifies each document, payment and
-- cancellation terms, the finance-role setting, the owner, and the row whatever its status (a Draft or Archived package that was allocated once stayed readable).
-- The agent portal uses exactly one thing from a package: its title, shown next to the allocation.
--
-- This migration
--   1. adds agent_allocated_package_titles(): returns (package_id, title) for the packages allocated to the calling agent, and nothing else;
--   2. drops the agent's SELECT policy on packages.
-- Staff policies are untouched. An agent's own allocation rows stay readable (policy "agent read own allocations"). Foreign-key checks from
-- agent_package_allocations and agent_booking_submissions to packages do not need a SELECT policy.
--
-- Deploy together with the change to listPortalAllocations() in lib/data/agent-portal-repository.ts, which now calls the function instead of embedding the
-- package. Idempotent. Rollback: recreate the policy from 20261030090000 and drop the function.

create or replace function public.agent_allocated_package_titles()
returns table (package_id uuid, title text)
language sql
stable
security definer
set search_path = public
as $$
  select a.package_id, p.title
    from public.agent_package_allocations a
    join public.packages p on p.id = a.package_id and p.agency_id = a.agency_id
   where a.sales_agent_id = public.current_portal_agent_id()
$$;

comment on function public.agent_allocated_package_titles() is
  'The id and title of each package allocated to the calling sales agent (matched on sales_agents.portal_user_id = auth.uid()). Nothing else about a package is exposed to an agent. TASK-043 PKG-06.';

revoke all on function public.agent_allocated_package_titles() from public, anon;
grant execute on function public.agent_allocated_package_titles() to authenticated, service_role;

drop policy if exists "agent read allocated packages" on public.packages;

notify pgrst, 'reload schema';
