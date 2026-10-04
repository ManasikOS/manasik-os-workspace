-- MI2.2 follow-up — make inbox_queue_counts() SECURITY DEFINER with the access rule written out explicitly.
--
-- Why: as SECURITY INVOKER the function paid for row-level security on every row it counted. The membership policies
-- are now initplan-safe (20261202090600), but the MINE branch counts over `conversations`, whose long-standing policy
-- calls current_agency_id() / staff_role_in() per row; on a 20 000-conversation agency that alone dominated the
-- ~90 ms p95. A counting function does not need per-row filtering — it needs one agency and one role check.
--
-- The rule is unchanged, only made explicit and evaluated once:
--   * the agency is the caller's own (current_agency_id(), derived from auth.uid() — never a parameter);
--   * the caller must hold one of the roles that may read conversations (the same list as the conversations policy);
--   * anyone else, including a signed-out caller, gets zero rows.
-- p_staff_id only selects whose MINE count to return; it is checked against the caller so one staff member cannot read
-- another's count.

create or replace function public.inbox_queue_counts(p_staff_id uuid)
returns table (queue_code text, conversation_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agency uuid := public.current_agency_id();
begin
  if v_agency is null
     or not public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA') then
    return;
  end if;

  return query
    select m.queue_code, count(*)::integer
      from public.conversation_queue_membership m
     where m.agency_id = v_agency
     group by m.queue_code
    union all
    select 'MINE', count(*)::integer
      from public.conversations c
     where c.agency_id = v_agency
       and c.assigned_to_id = p_staff_id
       and p_staff_id = auth.uid()
       and c.state <> 'CLOSED';
end;
$$;

revoke all on function public.inbox_queue_counts(uuid) from public, anon;
grant execute on function public.inbox_queue_counts(uuid) to authenticated, service_role;
