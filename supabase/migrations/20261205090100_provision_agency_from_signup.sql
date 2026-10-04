-- Agency self-onboarding, Slice 1 (docs/onboarding/plan.md §7.1 M2).
-- Fixes D2 (provisioning not atomic → duplicate agencies) and D3 (slug
-- collisions and empty slugs throw).
--
-- One transaction: lock the staged signup, validate it, create the agency via
-- the existing provision_agency(), and mark the signup consumed. A second call
-- for the same signup (second tab, refresh, retry after a dropped response)
-- waits on the row lock and then returns the agency the first call created.

create or replace function public.provision_agency_from_signup(
  p_pending_id uuid,
  p_user_id uuid,
  p_email text
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_pending public.pending_agency_signups%rowtype;
  v_base_slug text;
  v_slug text;
  v_agency_id uuid;
  v_attempt int := 0;
  v_existing uuid;
begin
  -- `for update` is what serialises two concurrent callers on the same row.
  select * into v_pending
  from public.pending_agency_signups
  where id = p_pending_id
  for update;

  if not found then
    raise exception 'pending_signup_not_found';
  end if;

  -- The confirmed session's email must be the address the signup was staged for.
  if lower(v_pending.email) <> lower(p_email) then
    raise exception 'pending_signup_email_mismatch';
  end if;

  -- Already provisioned: answer with the same agency. Older rows consumed before
  -- agency_id existed fall back to the owner's default membership.
  if v_pending.consumed_at is not null then
    if v_pending.agency_id is not null then
      return v_pending.agency_id;
    end if;
    select agency_id into v_existing
    from public.agency_members
    where user_id = p_user_id and status = 'ACTIVE'
    order by is_default desc, created_at asc
    limit 1;
    if v_existing is not null then
      return v_existing;
    end if;
    raise exception 'pending_signup_expired';
  end if;

  if v_pending.expires_at < now() then
    raise exception 'pending_signup_expired';
  end if;

  -- Slug: lower-case letters/digits joined by single hyphens. A name with no
  -- Latin letters or digits collapses to '' and gets a stable fallback.
  v_base_slug := trim(both '-' from regexp_replace(lower(v_pending.agency_name), '[^a-z0-9]+', '-', 'g'));
  if v_base_slug is null or v_base_slug = '' then
    v_base_slug := 'agency-' || substr(replace(p_pending_id::text, '-', ''), 1, 8);
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_slug := case
      when v_attempt = 1 then v_base_slug
      when v_attempt <= 20 then v_base_slug || '-' || v_attempt
      else v_base_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)
    end;

    if exists (select 1 from public.agencies where slug = v_slug) then
      continue;
    end if;

    begin
      v_agency_id := public.provision_agency(
        v_pending.agency_name,
        v_slug,
        p_user_id,
        v_pending.owner_full_name,
        lower(p_email)
      );
      exit;
    exception
      when unique_violation then
        -- Another signup took this slug between the check and the insert, and
        -- the sub-transaction rolled back cleanly. Try the next suffix.
        if v_attempt >= 40 then
          raise;
        end if;
    end;
  end loop;

  update public.pending_agency_signups
  set consumed_at = now(),
      agency_id = v_agency_id
  where id = p_pending_id;

  return v_agency_id;
end;
$$;

comment on function public.provision_agency_from_signup(uuid, uuid, text) is
  'Atomically turns one confirmed self-serve signup into one agency. Idempotent per signup: repeat calls return the same agency. Rejects unknown, expired and email-mismatched signups. service-role only.';

revoke all on function public.provision_agency_from_signup(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.provision_agency_from_signup(uuid, uuid, text) to service_role;
