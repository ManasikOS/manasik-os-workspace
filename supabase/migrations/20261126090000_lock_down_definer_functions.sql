-- Lock down SECURITY DEFINER functions that were callable by anyone (security audit, 2026-09-18).
--
-- Root cause: Supabase grants EXECUTE on every new function in `public` directly to `anon`,
-- `authenticated` and `service_role`. `revoke ... from public` (used by earlier migrations) removes only
-- the PUBLIC pseudo-role, so the signed-out `anon` role kept the right to call all 26 SECURITY DEFINER
-- functions over the REST API. Most check auth.uid() and so did nothing for an anonymous caller, but two
-- did not:
--
--   * reset_agency_business_data() — deletes an agency's business data (54 DELETE statements) and
--     checked only that the caller belongs to an agency, not that they are an ADMIN. Any signed-in staff
--     member could call it straight from the browser and skip the Server Action's checks (ADMIN, not
--     production, typed confirmation). It now checks ADMIN itself.
--   * increment_conversation_unread(uuid) — updates any conversation by id, for any caller, bypassing row
--     security. Nothing in the app or the database calls it, so it is now service_role only.
--
--   * Two views were readable by `anon` and ran with their owner's rights, which skips row security:
--     departure_group_payment_summaries (revenue, collections, overdue and supplier payables for every
--     agency's departures — one row today) and supplier_directory_rows (supplier contacts, payment terms
--     and internal notes — empty today). Anyone holding the public browser key could read them. They are
--     now security_invoker like the other 24 views, and anon loses SELECT on them.
--   * The root cause is also fixed for the future: the database's default privileges gave anon (and the
--     built-in PUBLIC role) EXECUTE on every function the postgres role creates in `public`.
--
-- Nothing that legitimately runs breaks: no row-security policy that applies to `anon` calls any of these
-- functions, every real caller uses a signed-in session, and a trigger function does not need its caller
-- to hold EXECUTE (the privilege is checked when the trigger is created, not when it fires).

-- The only change to this function is the ADMIN guard at the top; everything else is unchanged.
create or replace function public.reset_agency_business_data()
returns table (table_name text, rows_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_agency uuid := public.current_agency_id();
  affected bigint;
begin
  -- Added by 20261126090000: the application checks ADMIN before calling this, but the function is also
  -- reachable directly through the REST API with any staff member's session, so the database must check too.
  if public.current_staff_role() is distinct from 'ADMIN' then
    raise exception 'reset_agency_business_data: only an administrator can reset agency data' using errcode = '42501';
  end if;

  if target_agency is null then
    raise exception 'reset_agency_business_data: caller has no resolvable agency_id';
  end if;

  -- AI agent / WhatsApp conversation history — deleted before the leads and
  -- departure groups it can reference (both are `on delete set null`, so
  -- order does not strictly matter here, but child-first is followed
  -- throughout this function for consistency and to make each step's
  -- row count meaningful on its own).
  delete from public.agent_tool_calls where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'agent_tool_calls'; rows_deleted := affected; return next;

  delete from public.booking_sessions where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'booking_sessions'; rows_deleted := affected; return next;

  delete from public.agent_runs where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'agent_runs'; rows_deleted := affected; return next;

  delete from public.agent_jobs where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'agent_jobs'; rows_deleted := affected; return next;

  delete from public.conversation_messages where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'conversation_messages'; rows_deleted := affected; return next;

  delete from public.conversations where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'conversations'; rows_deleted := affected; return next;

  delete from public.whatsapp_webhook_events where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'whatsapp_webhook_events'; rows_deleted := affected; return next;

  -- Documents
  delete from public.document_review_events where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'document_review_events'; rows_deleted := affected; return next;

  delete from public.document_ai_analyses where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'document_ai_analyses'; rows_deleted := affected; return next;

  -- Visa
  delete from public.visa_application_events where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'visa_application_events'; rows_deleted := affected; return next;

  delete from public.visa_submission_batches where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'visa_submission_batches'; rows_deleted := affected; return next;

  -- Settings change history (the settings themselves are kept)
  delete from public.settings_activity_logs where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'settings_activity_logs'; rows_deleted := affected; return next;

  -- Finance
  delete from public.refund_requests where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'refund_requests'; rows_deleted := affected; return next;

  delete from public.finance_adjustments where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'finance_adjustments'; rows_deleted := affected; return next;

  delete from public.finance_activity_events where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'finance_activity_events'; rows_deleted := affected; return next;

  delete from public.payment_allocations where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'payment_allocations'; rows_deleted := affected; return next;

  delete from public.invoice_line_items where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'invoice_line_items'; rows_deleted := affected; return next;

  delete from public.invoices where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'invoices'; rows_deleted := affected; return next;

  delete from public.payments where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'payments'; rows_deleted := affected; return next;

  delete from public.booking_payment_milestones where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'booking_payment_milestones'; rows_deleted := affected; return next;

  -- Suppliers
  delete from public.supplier_activity_events where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'supplier_activity_events'; rows_deleted := affected; return next;

  delete from public.supplier_payments where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'supplier_payments'; rows_deleted := affected; return next;

  delete from public.supplier_commitments where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'supplier_commitments'; rows_deleted := affected; return next;

  delete from public.supplier_services where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'supplier_services'; rows_deleted := affected; return next;

  delete from public.supplier_contacts where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'supplier_contacts'; rows_deleted := affected; return next;

  delete from public.suppliers where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'suppliers'; rows_deleted := affected; return next;

  -- Leads
  delete from public.lead_activity where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'lead_activity'; rows_deleted := affected; return next;

  delete from public.lead_notes where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'lead_notes'; rows_deleted := affected; return next;

  delete from public.lead_quotes where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'lead_quotes'; rows_deleted := affected; return next;

  delete from public.leads where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'leads'; rows_deleted := affected; return next;

  -- Departure groups and every child row. Most of these already cascade
  -- from `departure_groups` itself (`on delete cascade`), but every table is
  -- deleted explicitly by `agency_id` anyway — never wrong, and it gives an
  -- honest per-table row count instead of one opaque cascade.
  delete from public.departure_group_room_assignments where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'departure_group_room_assignments'; rows_deleted := affected; return next;

  delete from public.departure_group_rooms where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'departure_group_rooms'; rows_deleted := affected; return next;

  delete from public.departure_group_pilgrim_documents where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'departure_group_pilgrim_documents'; rows_deleted := affected; return next;

  delete from public.departure_group_pilgrim_charges where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'departure_group_pilgrim_charges'; rows_deleted := affected; return next;

  delete from public.departure_group_pilgrim_deviations where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'departure_group_pilgrim_deviations'; rows_deleted := affected; return next;

  delete from public.departure_group_pilgrims where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'departure_group_pilgrims'; rows_deleted := affected; return next;

  delete from public.departure_group_bookings where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'departure_group_bookings'; rows_deleted := affected; return next;

  delete from public.departure_group_readiness_items where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'departure_group_readiness_items'; rows_deleted := affected; return next;

  delete from public.departure_group_tasks where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'departure_group_tasks'; rows_deleted := affected; return next;

  delete from public.departure_group_transports where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'departure_group_transports'; rows_deleted := affected; return next;

  delete from public.departure_group_accommodations where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'departure_group_accommodations'; rows_deleted := affected; return next;

  delete from public.departure_group_flight_legs where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'departure_group_flight_legs'; rows_deleted := affected; return next;

  delete from public.departure_group_flights where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'departure_group_flights'; rows_deleted := affected; return next;

  delete from public.departure_group_pricing where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'departure_group_pricing'; rows_deleted := affected; return next;

  delete from public.departure_group_cost_estimates where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'departure_group_cost_estimates'; rows_deleted := affected; return next;

  delete from public.departure_group_package_snapshots where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'departure_group_package_snapshots'; rows_deleted := affected; return next;

  delete from public.departure_group_activity_logs where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'departure_group_activity_logs'; rows_deleted := affected; return next;

  delete from public.departure_groups where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'departure_groups'; rows_deleted := affected; return next;

  -- Pilgrims (the shared, standalone directory) — deliberately AFTER
  -- departure_group_pilgrims above, not before: `20260813090000_create_pilgrims.sql`
  -- added `departure_group_pilgrims_pilgrim_fk` as ON DELETE RESTRICT
  -- ("a group being deleted must never erase a person"), so a pilgrim who
  -- is still on a departure_group_pilgrims row cannot be deleted first.
  delete from public.pilgrim_activity_logs where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'pilgrim_activity_logs'; rows_deleted := affected; return next;

  delete from public.pilgrim_medical_records where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'pilgrim_medical_records'; rows_deleted := affected; return next;

  delete from public.pilgrim_payment_milestones where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'pilgrim_payment_milestones'; rows_deleted := affected; return next;

  delete from public.pilgrim_support_requests where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'pilgrim_support_requests'; rows_deleted := affected; return next;

  delete from public.pilgrims where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'pilgrims'; rows_deleted := affected; return next;

  -- Packages — last, because departure_groups.package_template_id
  -- references packages(id) ON DELETE RESTRICT. Every group is already
  -- gone by this point, so this can never be blocked by that constraint.
  delete from public.packages where agency_id = target_agency;
  get diagnostics affected = row_count; table_name := 'packages'; rows_deleted := affected; return next;

  return;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Nobody signed out needs to call any of these.
-- ─────────────────────────────────────────────────────────────────────────────
revoke execute on function public.accept_own_invitation() from public, anon;
revoke execute on function public.archive_package(uuid, timestamptz, text, boolean) from public, anon;
revoke execute on function public.close_package_sales(uuid, timestamptz) from public, anon;
revoke execute on function public.create_cancellation_refund_request() from public, anon;
revoke execute on function public.create_staff_invitation(uuid, text, text, text, text, text, uuid, text, date, date, text, text[], timestamptz) from public, anon;
revoke execute on function public.current_agency_id() from public, anon;
revoke execute on function public.current_portal_agent_id() from public, anon;
revoke execute on function public.current_portal_group_ids() from public, anon;
revoke execute on function public.current_portal_pilgrim_id() from public, anon;
revoke execute on function public.current_staff_role() from public, anon;
revoke execute on function public.guard_departure_group_booking_capacity() from public, anon;
-- Clean-rebuild fix (TASK-032 S5): increment_conversation_unread(uuid) was created by hand on staging and by no migration, so a fresh build has
-- nothing to revoke on. Guarded; identical effect where the function exists.
do $$ begin if to_regprocedure('public.increment_conversation_unread(uuid)') is not null then revoke execute on function public.increment_conversation_unread(uuid) from public, anon; end if; end $$;
revoke execute on function public.is_platform_admin() from public, anon;
revoke execute on function public.package_versions_create(uuid, jsonb) from public, anon;
revoke execute on function public.packages_apply_status_transition(uuid, timestamptz, text[], text, text, text) from public, anon;
revoke execute on function public.publish_package(uuid, timestamptz) from public, anon;
revoke execute on function public.reopen_package(uuid, timestamptz) from public, anon;
revoke execute on function public.reset_agency_business_data() from public, anon;
revoke execute on function public.restore_package(uuid, timestamptz) from public, anon;
revoke execute on function public.seed_departure_group_agent_state() from public, anon;
revoke execute on function public.staff_assigned_to_group(uuid) from public, anon;
revoke execute on function public.switch_active_agency(uuid) from public, anon;
revoke execute on function public.sync_agency_member_role_text() from public, anon;
revoke execute on function public.sync_staff_profile_role_text() from public, anon;
revoke execute on function public.sync_staff_profile_to_agency_membership() from public, anon;
revoke execute on function public.touch_own_activity() from public, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger functions are only ever run by their triggers; a signed-in user has no reason to call them.
-- ─────────────────────────────────────────────────────────────────────────────
revoke execute on function public.create_cancellation_refund_request() from authenticated;
revoke execute on function public.guard_departure_group_booking_capacity() from authenticated;
revoke execute on function public.seed_departure_group_agent_state() from authenticated;
revoke execute on function public.sync_agency_member_role_text() from authenticated;
revoke execute on function public.sync_staff_profile_role_text() from authenticated;
revoke execute on function public.sync_staff_profile_to_agency_membership() from authenticated;

-- Unused, and had no caller check: only the service role may run it.
do $$ begin if to_regprocedure('public.increment_conversation_unread(uuid)') is not null then revoke execute on function public.increment_conversation_unread(uuid) from authenticated; end if; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Views that skipped row security. With security_invoker the caller's own row-security rights apply, so a
-- signed-in user sees only their agency's rows and nobody signed out sees anything.
-- ─────────────────────────────────────────────────────────────────────────────
alter view public.departure_group_payment_summaries set (security_invoker = true);
alter view public.supplier_directory_rows set (security_invoker = true);
revoke select on public.departure_group_payment_summaries from anon;
revoke select on public.supplier_directory_rows from anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- Future functions: stop handing EXECUTE to anon (and to the built-in PUBLIC role, which anon inherits).
-- authenticated and service_role still receive it, so a new function is callable by signed-in users unless
-- its migration revokes that too — see docs/security/security-guidelines.md.
-- ─────────────────────────────────────────────────────────────────────────────
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

notify pgrst, 'reload schema';
