-- Performance: evaluate auth helpers once per statement instead of once per row.
--
-- Supabase's performance advisor (0003_auth_rls_initplan) flagged 11 policies
-- that call auth.uid() / current_agency_id() / current_staff_role() directly.
-- Postgres re-runs a bare function call for every row it checks; wrapping it in
-- `(select ...)` turns it into an InitPlan that is evaluated once and reused
-- (https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv).
--
-- ALTER POLICY only rewrites the expressions — the roles, commands and the
-- logic are exactly what they were; nothing here widens or narrows access.

alter policy "agency_members_select" on public.agency_members
  using (user_id = (select auth.uid()));

alter policy "staff_notifications_select_own" on public.staff_notifications
  using (recipient_id = (select auth.uid()) and agency_id = (select public.current_agency_id()));

alter policy "staff_notifications_update_own" on public.staff_notifications
  using (recipient_id = (select auth.uid()) and agency_id = (select public.current_agency_id()))
  with check (recipient_id = (select auth.uid()) and agency_id = (select public.current_agency_id()));

alter policy "guide acknowledge own guide_briefings" on public.guide_briefings
  using (agency_id = (select public.current_agency_id()) and staff_id = (select auth.uid()))
  with check (agency_id = (select public.current_agency_id()) and staff_id = (select auth.uid()));

alter policy "guide acknowledge own guide_handovers" on public.guide_handovers
  using (agency_id = (select public.current_agency_id()) and to_staff_id = (select auth.uid()))
  with check (agency_id = (select public.current_agency_id()) and to_staff_id = (select auth.uid()));

alter policy "staff_profiles_select" on public.staff_profiles
  using (
    agency_id = (select public.current_agency_id())
    and (id = (select auth.uid()) or (select public.current_staff_role()) = any (array['ADMIN'::text, 'CEO'::text]))
  );

alter policy "guide check in themselves" on public.field_checkins
  with check (agency_id = (select public.current_agency_id()) and staff_id = (select auth.uid()));

alter policy "staff_activity_logs_select" on public.staff_activity_logs
  using (
    agency_id = (select public.current_agency_id())
    and (staff_profile_id = (select auth.uid()) or (select public.current_staff_role()) = any (array['ADMIN'::text, 'CEO'::text]))
  );

alter policy "pilgrim read own record" on public.pilgrims
  using (portal_user_id = (select auth.uid()));

alter policy "agent read own record" on public.sales_agents
  using (portal_user_id = (select auth.uid()));

alter policy "staff manage ai_surface_settings" on public.ai_surface_settings
  using (
    agency_id = (select public.current_agency_id())
    and exists (
      select 1
      from public.staff_profiles sp
      left join public.role_permissions rp on rp.role_id = sp.role_id and rp.module = 'insights'::text
      where sp.id = (select auth.uid())
        and coalesce(((rp.capabilities ->> 'manageAiSurfaces'::text))::boolean, public.staff_role_in(variadic array['ADMIN'::text, 'CEO'::text]))
    )
  )
  with check (
    agency_id = (select public.current_agency_id())
    and exists (
      select 1
      from public.staff_profiles sp
      left join public.role_permissions rp on rp.role_id = sp.role_id and rp.module = 'insights'::text
      where sp.id = (select auth.uid())
        and coalesce(((rp.capabilities ->> 'manageAiSurfaces'::text))::boolean, public.staff_role_in(variadic array['ADMIN'::text, 'CEO'::text]))
    )
  );

-- Two identical indexes on staff_profiles(agency_id); keep one.
drop index if exists public.staff_profiles_agency_idx;
