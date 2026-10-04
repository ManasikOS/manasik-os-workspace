-- TASK-032 S5: the clean-rebuild proof (docs/progress/2026-10-03-clean-rebuild-proof.md) built a database from nothing with every migration in this
-- repository and compared it, object by object, with staging. This migration closes the differences that matter, and is a no-op wherever the
-- database already matches the repository. Every statement is idempotent.
--
-- 1. Staging was MISSING two protections the repository defines. Both migrations are recorded as applied there, but their effect is not in the database:
--
--    a. The MARKETING column scope on packages (20261005090000_packages_lifecycle_rls_hardening.sql): trigger `packages_enforce_marketing_scope` and its
--       function. Without it, a MARKETING user whom the row policy allows to update a package can change ANY column, not just the "featured" flag.
--       The function is re-created here with a FIX: the original compared the old and new row, but in a BEFORE trigger the table's generated columns
--       (itinerary_days and the *_count columns) are not yet computed in the new row, so they always looked changed and MARKETING could not update
--       anything, not even `featured`. The bug was invisible because the trigger was never active on staging. Generated columns are now excluded
--       automatically, so a column added later cannot reintroduce it.
--
--    b. The policy "staff write departure_group_activity_logs" (dropped by 20260822090000_rls_hardening.sql, still present on staging). It grants every
--       command to every signed-in user of the agency with no role check, so any staff member, a guide included, could rewrite or delete a departure
--       group's audit log. The intended policies are the read policy and the role-limited insert policy, which stay.
--
-- 2. Differences where a FRESH build is looser than staging:
--
--    c. `reset_agency_business_data()` with no argument (20260912090000) deletes an agency's business data and is executable by signed-in users (it checks
--       for an administrator inside). Staging does not have it, and the application only calls the `(uuid)` version through the service role, so the
--       no-argument version is dropped everywhere.
--
--    d. The marketing-scope function is a security-definer trigger function that anonymous callers could execute on a fresh build, which the go-live
--       gate rightly reports. A trigger function needs no execute privilege to fire (privileges are checked when the trigger is created), so it is
--       revoked from everyone.
--
-- Not changed here, on purpose: the staging-only leftovers that no code uses (tables ai_agent_settings, ai_model_roles, package_content, package_faqs,
-- package_media, package_seo_analyses; functions increment_conversation_unread(uuid), whatsapp_read_access_token(uuid), whatsapp_store_access_token(text, text);
-- the 40 package columns that 20261008090000 meant to drop; departure_group_bookings.api_client_key_id and .channel; departure_groups.public_listed; the
-- empty whatsapp-media bucket). Removing data and columns is the owner's decision, listed in the proof document.
--
-- Rollback: re-create the policy from the earlier definition (do not, it is a hole), drop the trigger, re-create the zero-argument function from
-- 20260913090000. Safe to apply: tightening only, no data changes.

-- 1a. The MARKETING column scope on packages ------------------------------------------------------------------------------------------------
create or replace function public.packages_enforce_marketing_column_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_role text := public.current_staff_role();
  scope_exclusions text[] := array['featured', 'updated_at'];
begin
  if acting_role in ('ADMIN', 'OPERATIONS') then
    return new;
  end if;

  -- Generated columns are computed after BEFORE triggers run, so the new row carries no value for them yet: never compare them.
  scope_exclusions := scope_exclusions || coalesce(
    (select array_agg(a.attname::text) from pg_attribute a where a.attrelid = 'public.packages'::regclass and a.attgenerated <> '' and not a.attisdropped),
    '{}'::text[]);

  if acting_role = 'MARKETING' then
    if (to_jsonb(old) - scope_exclusions) is distinct from (to_jsonb(new) - scope_exclusions) then
      raise exception
        'MARKETING may only change a package''s featured flag, not its other fields.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Every other role's UPDATE is already refused by the RLS policy before this trigger can run; this is a fail-closed backstop.
  raise exception 'Your role cannot update packages.' using errcode = '42501';
end;
$$;

drop trigger if exists packages_enforce_marketing_scope on public.packages;
create trigger packages_enforce_marketing_scope
  before update on public.packages
  for each row execute function public.packages_enforce_marketing_column_scope();

-- 1d. A trigger function is not callable by clients; take every client privilege away.
revoke all on function public.packages_enforce_marketing_column_scope() from public, anon, authenticated;

-- 1b. The activity-log policy that lets any staff member rewrite the audit log ------------------------------------------------------------------
drop policy if exists "staff write departure_group_activity_logs" on public.departure_group_activity_logs;

-- 2c. The no-argument reset function --------------------------------------------------------------------------------------------------------------
drop function if exists public.reset_agency_business_data();

-- Guard: all four are in place -------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_problem text;
begin
  select string_agg(problem, '; ') into v_problem from (
    select 'packages_enforce_marketing_scope trigger is missing' as problem
     where not exists (select 1 from pg_trigger t where t.tgrelid = 'public.packages'::regclass and t.tgname = 'packages_enforce_marketing_scope' and not t.tgisinternal)
    union all
    select 'the activity-log write policy is still there'
     where exists (select 1 from pg_policy p where p.polrelid = 'public.departure_group_activity_logs'::regclass and p.polname = 'staff write departure_group_activity_logs')
    union all
    select 'the no-argument reset_agency_business_data() is still there'
     where to_regprocedure('public.reset_agency_business_data()') is not null
    union all
    select 'the marketing-scope function is still executable by a client role'
     where has_function_privilege('anon', 'public.packages_enforce_marketing_column_scope()', 'execute')
        or has_function_privilege('authenticated', 'public.packages_enforce_marketing_column_scope()', 'execute')
  ) found;

  if v_problem is not null then
    raise exception 'Clean-rebuild alignment: %', v_problem;
  end if;
end;
$$;
