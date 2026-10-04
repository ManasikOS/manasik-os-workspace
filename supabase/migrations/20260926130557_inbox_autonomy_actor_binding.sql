-- LR1: set_inbox_autonomy_level is intentionally callable by signed-in ADMIN/CEO staff.
-- It already enforces role and active-agency ownership; this also binds the audited
-- actor to the caller so a signed-in user cannot record a change as someone else.
-- Service-role callers (automatic demotion) keep passing a null or system actor.
create or replace function public.set_inbox_autonomy_level(
  p_agency_id uuid, p_surface text, p_level text, p_mode text, p_enabled boolean,
  p_autonomy jsonb, p_actor_id uuid, p_reason text, p_evidence jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare v_from text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' and (
    p_agency_id <> public.current_agency_id()
    or not public.staff_role_in('ADMIN','CEO')
    or p_actor_id is distinct from auth.uid()
  ) then
    raise exception 'not permitted to change Inbox autonomy';
  end if;
  if p_surface not in ('INBOX_REPLY','INBOX_INTAKE') or p_level not in ('L0','L1','L2','L3') or p_mode not in ('OFF','SHADOW','PROPOSE','ACTIVE') then
    raise exception 'invalid Inbox autonomy setting';
  end if;

  select coalesce(s.autonomy ->> 'level','L0') into v_from
  from public.ai_surface_settings s where s.agency_id=p_agency_id and s.surface=p_surface for update;
  v_from := coalesce(v_from,'L0');

  insert into public.ai_surface_settings(agency_id,surface,enabled,mode,autonomy,updated_by)
  values (p_agency_id,p_surface,p_enabled,p_mode,p_autonomy,p_actor_id)
  on conflict (agency_id,surface) do update set
    enabled=excluded.enabled, mode=excluded.mode, autonomy=excluded.autonomy, updated_by=excluded.updated_by;

  insert into public.inbox_autonomy_level_audit(agency_id,surface,from_level,to_level,reason,evidence,changed_by)
  values (p_agency_id,p_surface,v_from,p_level,p_reason,coalesce(p_evidence,'{}'::jsonb),p_actor_id);
end;
$function$;

revoke all on function public.set_inbox_autonomy_level(uuid, text, text, text, boolean, jsonb, uuid, text, jsonb) from public, anon;
grant execute on function public.set_inbox_autonomy_level(uuid, text, text, text, boolean, jsonb, uuid, text, jsonb) to authenticated, service_role;
