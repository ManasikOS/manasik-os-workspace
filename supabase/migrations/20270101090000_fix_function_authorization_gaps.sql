-- TASK-029 P2.4, finding F3 (docs/progress/2026-10-02-tenant-isolation-audit.md): authorisation gaps in privileged functions that signed-in
-- users can call. Found by reading the bodies of the 28 security-definer functions callable by `authenticated`, then proving each in a
-- rolled-back transaction on staging.
--
-- THE COMMON CAUSE: a comparison with NULL is never true, and `if NULL then` does not raise. The checks were written as
--     if <agency is different> or <role is not allowed> then raise ...
-- but for some callers one side of that is NULL instead of true or false, so the whole condition is NULL and the caller is let through:
--   * public.current_agency_id() is NULL for a signed-in user with no staff profile, and for a staff member whose OWN agency is suspended.
--   * public.staff_role_in(...) is NULL (not false) for a user with no staff profile, so `not staff_role_in(...)` is NULL too.
--
-- 1. public.set_inbox_autonomy_level (SERIOUS, proved): the ADMIN or CEO of a SUSPENDED agency could call it with any other agency's id and
--    switch that agency's Inbox to fully autonomous replies (level L3, mode ACTIVE). Their own agency id is NULL, so `p_agency_id <>
--    current_agency_id()` was NULL; their role passed the role test; and the actor check passed because they named themselves. The guard
--    now fails closed: the caller must have an agency, it must be the agency being changed, and they must hold ADMIN or CEO there.
--    (A user with no staff profile at all was already stopped, but only because the audit row's foreign key rejected them.)
--
-- 2. public.record_conversation_answer_candidate (proved): a signed-in user with no agency, or an admin of a suspended agency, could write
--    and overwrite answer-cache rows in ANY agency, including replacing an approved answer's text and demoting it to a candidate. Same
--    cause, same fail-closed guard. The application calls it with the caller's own agency or the service key, so legitimate use is unchanged.
--
-- 3. public.staff_role_in (the root cause for the role side): now returns false, never NULL. Four functions and four row-level-security
--    policies negate it. Each policy also requires `agency_id = current_agency_id()` first, so for a user with no agency nothing changes;
--    for everyone with a staff profile the result is identical. Callers that use it positively are unaffected.
--
-- 4. public.packages_apply_status_transition (role bypass inside an agency, proved): the internal step behind archive_package,
--    close_package_sales, publish_package, reopen_package and restore_package. Those wrappers check the caller's role (ADMIN or OPERATIONS);
--    the step does not, and `authenticated` could execute it, so a CEO who was refused by archive_package could archive a package by calling
--    the step directly. No application code calls it directly, only the five wrappers, which are security definer and keep working because
--    they run as the function owner. Execute is revoked from `authenticated`.
--
-- Checked and left unchanged: the other callable functions (their checks hold), reject_conversation_answer_cache_hit (not callable by
-- signed-in users), and the package wrappers that use `current_staff_role() not in (...)` (a NULL role passes that test, but each is stopped
-- by a second check that needs the agency; worth hardening later).
--
-- Rollback: restore the previous guard text and `grant execute ... to authenticated`. Do neither where real customers exist. Idempotent.

-- 3. Root cause for the role side ---------------------------------------------------------------------------------------------------
create or replace function public.staff_role_in(variadic roles text[]) returns boolean
language sql stable as $$
  select coalesce(public.current_staff_role() = any(roles), false)
$$;

-- 1. Inbox autonomy -----------------------------------------------------------------------------------------------------------------
create or replace function public.set_inbox_autonomy_level(
  p_agency_id uuid, p_surface text, p_level text, p_mode text, p_enabled boolean, p_autonomy jsonb, p_actor_id uuid, p_reason text, p_evidence jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_from text;
begin
  -- Fails closed (see the header): a missing agency or role must refuse, never pass.
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' and (
    public.current_agency_id() is null
    or p_agency_id is distinct from public.current_agency_id()
    or not coalesce(public.staff_role_in('ADMIN','CEO'), false)
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
$$;

-- 2. Answer cache -------------------------------------------------------------------------------------------------------------------
create or replace function public.record_conversation_answer_candidate(
  p_agency_id uuid,
  p_question_fingerprint text,
  p_normalized_question text,
  p_question_embedding extensions.vector(1024),
  p_answer_text text,
  p_intent_code text,
  p_knowledge_version bigint,
  p_source_chunk_ids uuid[] default '{}'
) returns table(id uuid, occurrence_count integer, status text)
language plpgsql security definer set search_path = '' as $$
begin
  -- Fails closed. A comparison with NULL is never true, so the agency must be tested for being missing as well as for being different.
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role'
     and (public.current_agency_id() is null or p_agency_id is distinct from public.current_agency_id()) then
    raise exception 'agency mismatch';
  end if;
  return query
  insert into public.conversation_answer_cache (
    agency_id, question_fingerprint, normalized_question, question_embedding,
    answer_text, intent_code, knowledge_version, source_chunk_ids
  ) values (
    p_agency_id, p_question_fingerprint, p_normalized_question, p_question_embedding,
    p_answer_text, p_intent_code, p_knowledge_version, p_source_chunk_ids
  )
  on conflict (agency_id, question_fingerprint, knowledge_version) do update set
    occurrence_count = case
      when public.conversation_answer_cache.answer_text = excluded.answer_text
        then public.conversation_answer_cache.occurrence_count + 1
      else 1
    end,
    answer_text = excluded.answer_text,
    question_embedding = excluded.question_embedding,
    source_chunk_ids = excluded.source_chunk_ids,
    status = case
      when public.conversation_answer_cache.answer_text = excluded.answer_text
        and public.conversation_answer_cache.status = 'APPROVED' then 'APPROVED'
      else 'CANDIDATE'
    end,
    rejection_count = case
      when public.conversation_answer_cache.answer_text = excluded.answer_text
        then public.conversation_answer_cache.rejection_count
      else 0
    end,
    retired_reason = null,
    expires_at = now() + interval '90 days',
    updated_at = now()
  returning conversation_answer_cache.id, conversation_answer_cache.occurrence_count, conversation_answer_cache.status;
end;
$$;

-- Privileges. `create or replace` keeps them, but they are restated so this file is the whole truth.
revoke execute on function public.set_inbox_autonomy_level(uuid, text, text, text, boolean, jsonb, uuid, text, jsonb) from public, anon;
grant execute on function public.set_inbox_autonomy_level(uuid, text, text, text, boolean, jsonb, uuid, text, jsonb) to authenticated, service_role;

revoke execute on function public.record_conversation_answer_candidate(uuid,text,text,extensions.vector,text,text,bigint,uuid[]) from public, anon;
grant execute on function public.record_conversation_answer_candidate(uuid,text,text,extensions.vector,text,text,bigint,uuid[]) to authenticated, service_role;

-- 4. The internal status step is reachable only through the role-checking wrappers (which run as the function owner).
revoke execute on function public.packages_apply_status_transition(uuid, timestamptz, text[], text, text, text) from public, anon, authenticated;
grant execute on function public.packages_apply_status_transition(uuid, timestamptz, text[], text, text, text) to service_role;
