-- Team invitation repair — Phase 1 of docs/modules/team-module-remediation-plan.md.
--
-- Fixes the four independent breaks on the "invite a team member" path (B1-B4):
--
--   B2. `staff_profiles_write` / `staff_invitations_write` only grant ADMIN.
--       An invitee's own `INVITED -> ACTIVE` transition (lib/dal.ts) is
--       silently denied for every non-Admin role, so they can never sign
--       back in after accepting — getCurrentStaffRole() keeps returning the
--       denied floor forever. `touch_own_activity()` / `accept_own_invitation()`
--       are narrow security-definer escape hatches: they let a person flip
--       their OWN row from INVITED to ACTIVE and stamp their own activity,
--       nothing else — never role, branch or status in the other direction.
--   B3. The `auth.users` row is created (in application code, via the admin
--       client) before `staff_profiles` / `staff_invitations` are written.
--       Doing those two inserts as one transaction inside
--       `create_staff_invitation()` means a failure can't leave the profile
--       half-written; the remaining failure mode (the RPC call itself
--       failing after the auth user already exists) is handled by the
--       caller in lib/data/team-repository.ts, which deletes the orphaned
--       auth user on any error from this function.
--   B4. Nothing has ever inserted into `agency_members` for an invited
--       person — there is no `authenticated` write policy on it, by design
--       (20260829090000's header). `create_staff_invitation()` adds the
--       membership row in the same transaction as the profile.
--   C1. `changeStaffRole` / `deactivateStaff` / `reactivateStaff` write only
--       `staff_profiles`, so `agency_members` drifts — and
--       `switch_active_agency()` then writes the STALE role back onto
--       `staff_profiles` the next time the person switches agencies. A
--       trigger keeps the two in lockstep so no mutator has to remember to.
--   H1. `enforce_last_admin()` counts remaining Admins with no `agency_id`
--       filter, relying entirely on RLS to scope its own query — replaced
--       with an explicit predicate, matching every other cross-tenant guard
--       in this schema.
--   H2. `create_staff_invitation()` also accepts `p_branch_id`, checked
--       against the caller's own agency, so invites can populate the
--       per-agency `branches` FK rather than only the legacy free-text
--       `branch` snapshot column.
--
-- Safe on a database with 20260808...20260922 applied.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. touch_own_activity() — the caller's own `last_active_at` stamp, and the
--    one-time INVITED -> ACTIVE flip on first sign-in. Re-checks status
--    itself (rather than trusting the caller's stale read) so it is safe to
--    call unconditionally.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.touch_own_activity() returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_now timestamptz := now();
begin
  select status into v_status from public.staff_profiles where id = auth.uid();
  if v_status is null then
    return;
  end if;

  if v_status = 'INVITED' then
    update public.staff_profiles
    set status = 'ACTIVE', activated_at = v_now, last_active_at = v_now
    where id = auth.uid();
  else
    update public.staff_profiles
    set last_active_at = v_now
    where id = auth.uid();
  end if;
end;
$$;

comment on function public.touch_own_activity() is
  'Security-definer: stamps the caller''s own staff_profiles.last_active_at, and on first call after an invite flips INVITED -> ACTIVE. Never touches role, branch or any other account''s row. See docs/modules/team-module-remediation-plan.md B2.';

revoke all on function public.touch_own_activity() from public;
grant execute on function public.touch_own_activity() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. accept_own_invitation() — marks the caller's own pending invitation
--    accepted. Paired with touch_own_activity(); lib/dal.ts calls both on a
--    first sign-in after an invite.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.accept_own_invitation() returns void
  language sql security definer set search_path = public as $$
  update public.staff_invitations
  set status = 'ACCEPTED', accepted_at = now()
  where staff_profile_id = auth.uid() and status = 'PENDING';
$$;

comment on function public.accept_own_invitation() is
  'Security-definer: marks the caller''s own PENDING staff_invitations rows ACCEPTED. See docs/modules/team-module-remediation-plan.md B2.';

revoke all on function public.accept_own_invitation() from public;
grant execute on function public.accept_own_invitation() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. create_staff_invitation(...) — one transaction for the three rows an
--    invitation needs: staff_profiles, staff_invitations, agency_members.
--    Called by lib/data/team-repository.ts AFTER the admin client has
--    created the auth.users row (that part cannot be folded in here — it is
--    a Supabase Auth Admin API call, not a database write).
--
--    Verifies the caller is an ADMIN of their own agency rather than trusting
--    the application layer alone — this function is reachable by any
--    authenticated role, same posture as switch_active_agency().
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.create_staff_invitation(
  p_staff_id uuid,
  p_full_name text,
  p_email text,
  p_whatsapp text,
  p_role text,
  p_branch text,
  p_branch_id uuid,
  p_employment_type text,
  p_access_starts_on date,
  p_access_ends_on date,
  p_job_title text,
  p_sent_via text[],
  p_expires_at timestamptz
) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_agency_id uuid;
  v_actor_name text;
begin
  select role, agency_id, full_name into v_actor_role, v_agency_id, v_actor_name
  from public.staff_profiles where id = v_actor_id;

  if v_actor_role is distinct from 'ADMIN' then
    raise exception 'Only Admin can invite staff.' using errcode = '42501';
  end if;

  if v_agency_id is null then
    raise exception 'Could not resolve the caller''s agency.' using errcode = '42501';
  end if;

  -- p_branch_id, if given, must belong to the caller's own agency — never
  -- trust a client-supplied id blindly (H2 of the Team remediation plan).
  if p_branch_id is not null and not exists (
    select 1 from public.branches where id = p_branch_id and agency_id = v_agency_id
  ) then
    raise exception 'That branch does not belong to this agency.' using errcode = '42501';
  end if;

  insert into public.staff_profiles (
    id, full_name, email, whatsapp, role, branch, branch_id, employment_type, status,
    access_starts_on, access_ends_on, job_title, agency_id
  ) values (
    p_staff_id, p_full_name, p_email, nullif(p_whatsapp, ''), p_role, p_branch, p_branch_id, p_employment_type,
    'INVITED', p_access_starts_on, p_access_ends_on, nullif(p_job_title, ''), v_agency_id
  );

  insert into public.staff_invitations (
    staff_profile_id, email, role, branch, employment_type,
    invited_by, invited_by_name, sent_via, status, expires_at, agency_id
  ) values (
    p_staff_id, p_email, p_role, p_branch, p_employment_type,
    v_actor_id, v_actor_name, p_sent_via, 'PENDING', p_expires_at, v_agency_id
  );

  insert into public.agency_members (user_id, agency_id, role, status, is_default)
  values (
    p_staff_id, v_agency_id, p_role, 'INVITED',
    not exists (select 1 from public.agency_members where user_id = p_staff_id)
  );
end;
$$;

comment on function public.create_staff_invitation(uuid, text, text, text, text, text, uuid, text, date, date, text, text[], timestamptz) is
  'Security-definer: one transaction for staff_profiles + staff_invitations + agency_members on a fresh invite. Caller must already be ADMIN of their own agency; p_branch_id must belong to that agency. See docs/modules/team-module-remediation-plan.md B3/B4/H2.';

revoke all on function public.create_staff_invitation(uuid, text, text, text, text, text, uuid, text, date, date, text, text[], timestamptz) from public;
grant execute on function public.create_staff_invitation(uuid, text, text, text, text, text, uuid, text, date, date, text, text[], timestamptz) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Keep agency_members in lockstep with staff_profiles whenever role or
--    status changes — changeStaffRole() / deactivateStaff() / reactivateStaff()
--    in lib/data/team-repository.ts write only staff_profiles (an ADMIN
--    writing a colleague's row, already permitted by staff_profiles_write);
--    this trigger is what keeps the membership roster from silently going
--    stale, which switch_active_agency() would otherwise write back onto
--    staff_profiles as a regression. Status mapping matches the one-time
--    backfill in 20260829090000_agency_membership.sql.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.sync_staff_profile_to_agency_membership() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role or new.status is distinct from old.status then
    update public.agency_members
    set role = case
                  when new.role in ('ADMIN','CEO','FINANCE','MARKETING','OPERATIONS','VISA','GUIDE')
                  then new.role
                  else role
                end,
        status = case new.status
                    when 'ACTIVE'            then 'ACTIVE'
                    when 'INVITED'           then 'INVITED'
                    when 'DEACTIVATED'       then 'REMOVED'
                    when 'SEASONAL_INACTIVE' then 'SUSPENDED'
                    else status
                  end
    where user_id = new.id and agency_id = new.agency_id;
  end if;
  return new;
end;
$$;

comment on function public.sync_staff_profile_to_agency_membership() is
  'Mirrors staff_profiles.role/.status onto the matching agency_members row on every UPDATE. See docs/modules/team-module-remediation-plan.md C1.';

drop trigger if exists staff_profiles_sync_agency_membership on public.staff_profiles;
create trigger staff_profiles_sync_agency_membership
  after update on public.staff_profiles
  for each row execute function public.sync_staff_profile_to_agency_membership();

-- ─────────────────────────────────────────────────────────────────────────────
-- E. enforce_last_admin() — scope the remaining-Admin count to the affected
--    agency explicitly, rather than relying on RLS to filter the trigger's
--    own query. See docs/modules/team-module-remediation-plan.md H1.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_last_admin() returns trigger
  language plpgsql as $$
declare
  remaining_admins integer;
begin
  if tg_op = 'UPDATE' and old.role = 'ADMIN' and old.status = 'ACTIVE'
     and (new.role <> 'ADMIN' or new.status <> 'ACTIVE') then
    select count(*) into remaining_admins
    from public.staff_profiles
    where role = 'ADMIN' and status = 'ACTIVE' and agency_id = old.agency_id and id <> old.id;

    if remaining_admins = 0 then
      raise exception 'Cannot change the role or status of the last remaining Admin.'
        using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'DELETE' and old.role = 'ADMIN' and old.status = 'ACTIVE' then
    select count(*) into remaining_admins
    from public.staff_profiles
    where role = 'ADMIN' and status = 'ACTIVE' and agency_id = old.agency_id and id <> old.id;

    if remaining_admins = 0 then
      raise exception 'Cannot remove the last remaining Admin.' using errcode = 'P0001';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

-- Trigger itself is unchanged (still fires on the same table/events); only
-- the function body above changed. Re-create defensively for idempotency.
drop trigger if exists staff_profiles_enforce_last_admin on public.staff_profiles;
create constraint trigger staff_profiles_enforce_last_admin
  after update or delete on public.staff_profiles
  for each row execute function public.enforce_last_admin();
