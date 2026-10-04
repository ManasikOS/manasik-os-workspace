-- reset_agency_business_data: service role only, agency passed in (follow-up to 20261126090000).
--
-- 20261126090000 added an ADMIN check inside the function, but an ADMIN could still call it directly
-- through the REST API in production, skipping the Server Action's "not in production" rule and its typed
-- confirmation. That rule can only be enforced where the code runs, so the function no longer trusts a
-- caller's session at all: it takes the agency id as a parameter and only the service role may execute it.
-- The Server Action (resetAgencyDataAction) still checks ADMIN, non-production and the typed phrase, and
-- then calls it with the server-side client and the agency id it resolved for the signed-in admin.
--
-- The delete list is unchanged; only the header, the agency source and the caller check differ.

create or replace function public.reset_agency_business_data(p_agency_id uuid)
returns table (table_name text, rows_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_agency uuid := p_agency_id;
  affected bigint;
begin
  if target_agency is null then
    raise exception 'reset_agency_business_data: an agency id is required';
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

-- Only the trusted server may run it. A signed-in browser session, ADMIN or not, can no longer reach it.
revoke all on function public.reset_agency_business_data(uuid) from public, anon, authenticated;
grant execute on function public.reset_agency_business_data(uuid) to service_role;

-- The session-based version is gone, so there is no way to call it with a user's own login.
drop function public.reset_agency_business_data();

comment on function public.reset_agency_business_data(uuid) is
  'Danger Zone "Reset to factory state": deletes every business record for the given agency (keeps the agency, settings, staff, branches and catalog/config tables). Service role only; the caller (resetAgencyDataAction) is responsible for the ADMIN, non-production and confirmation checks.';

notify pgrst, 'reload schema';
