-- MI2.2 follow-up — evaluate the RLS helpers once per statement, not once per row, on the tables this programme added.
--
-- Found by the MI2.2 performance run: a queue-count query over 20 000 conversations (~160 000 membership rows) hit the
-- statement timeout for an `authenticated` session, because the policies called current_agency_id() and
-- staff_role_in(...) — both SECURITY DEFINER functions that cannot be inlined — for every row. This is the same
-- defect 20261128090000_perf_rls_initplan_and_duplicate_index.sql fixed on other tables: wrapping the call in
-- `(select ...)` makes it an InitPlan, evaluated once and reused.
--
-- ALTER POLICY only rewrites the expression; roles, commands and the access rule are unchanged.

alter policy "staff read ai_usage_daily" on public.ai_usage_daily
  using (agency_id = (select public.current_agency_id()));

alter policy "staff read inbox_gate_decisions" on public.inbox_gate_decisions
  using (agency_id = (select public.current_agency_id()));

alter policy "staff read channel_jobs" on public.channel_jobs
  using (agency_id = (select public.current_agency_id()));

alter policy "staff read conversation_intelligence" on public.conversation_intelligence
  using (agency_id = (select public.current_agency_id())
         and (select public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA')));

alter policy "staff read conversation_signals" on public.conversation_signals
  using (agency_id = (select public.current_agency_id())
         and (select public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA')));

alter policy "staff read conversation_interventions" on public.conversation_interventions
  using (agency_id = (select public.current_agency_id())
         and (select public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA')));

alter policy "staff read conversation_queue_membership" on public.conversation_queue_membership
  using (agency_id = (select public.current_agency_id())
         and (select public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA')));

create or replace function public.inbox_queue_counts(p_staff_id uuid)
returns table (queue_code text, conversation_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.queue_code, count(*)::integer
    from public.conversation_queue_membership m
   where m.agency_id = (select public.current_agency_id())
   group by m.queue_code
  union all
  select 'MINE', count(*)::integer
    from public.conversations c
   where c.agency_id = (select public.current_agency_id())
     and c.assigned_to_id = p_staff_id
     and c.state <> 'CLOSED';
$$;

revoke all on function public.inbox_queue_counts(uuid) from public, anon;
grant execute on function public.inbox_queue_counts(uuid) to authenticated, service_role;
