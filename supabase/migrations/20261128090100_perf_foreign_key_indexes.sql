-- Performance: cover foreign keys on tables that will grow.
--
-- The advisor lists 168 foreign keys with no covering index. Today every one of
-- those tables is tiny (the largest has 59 rows), so this is preparation, not a
-- fix for a present slowdown: an unindexed FK makes joins, parent deletes and
-- "children of this parent" reads scan the whole child table once it is large.
--
-- Deliberately NOT indexed: audit columns that point at auth.users
-- (created_by, actor_id, decided_by, ...). They are written on every row but
-- almost never filtered or joined on, so an index would cost writes for nothing.
-- Plain CREATE INDEX (not CONCURRENTLY) is fine at these sizes; revisit if any
-- of these tables is large by the time this is applied elsewhere.

create index if not exists whatsapp_message_charges_conversation_id_idx on public.whatsapp_message_charges (conversation_id);
create index if not exists whatsapp_message_charges_message_id_idx on public.whatsapp_message_charges (message_id);
create index if not exists agent_runs_job_id_idx on public.agent_runs (job_id);
create index if not exists departure_ops_runs_job_id_idx on public.departure_ops_runs (job_id);
create index if not exists agent_proposals_agent_run_id_idx on public.agent_proposals (agent_run_id);
create index if not exists departure_group_pilgrim_documents_ai_analysis_id_idx on public.departure_group_pilgrim_documents (ai_analysis_id);
create index if not exists pilgrims_origin_lead_id_idx on public.pilgrims (origin_lead_id);
create index if not exists contact_identities_lead_id_idx on public.contact_identities (lead_id);
create index if not exists contact_identities_pilgrim_id_idx on public.contact_identities (pilgrim_id);
create index if not exists leads_booking_id_idx on public.leads (booking_id);
create index if not exists leads_desired_package_id_idx on public.leads (desired_package_id);
create index if not exists lead_quotes_departure_group_id_idx on public.lead_quotes (departure_group_id);
create index if not exists lead_quotes_package_id_idx on public.lead_quotes (package_id);
create index if not exists booking_sessions_departure_group_id_idx on public.booking_sessions (departure_group_id);
create index if not exists booking_sessions_booking_id_idx on public.booking_sessions (booking_id);
create index if not exists booking_sessions_lead_id_idx on public.booking_sessions (lead_id);
create index if not exists commission_accruals_booking_id_idx on public.commission_accruals (booking_id);
create index if not exists commission_accruals_commission_rule_id_idx on public.commission_accruals (commission_rule_id);
create index if not exists finance_activity_events_departure_group_id_idx on public.finance_activity_events (departure_group_id);
create index if not exists finance_activity_events_payment_id_idx on public.finance_activity_events (payment_id);
create index if not exists finance_activity_events_invoice_id_idx on public.finance_activity_events (invoice_id);
create index if not exists invoices_departure_group_id_idx on public.invoices (departure_group_id);
create index if not exists invoices_milestone_id_idx on public.invoices (milestone_id);
create index if not exists payments_reverses_payment_id_idx on public.payments (reverses_payment_id);
create index if not exists payment_reminders_departure_group_id_idx on public.payment_reminders (departure_group_id);
create index if not exists refund_requests_departure_group_id_idx on public.refund_requests (departure_group_id);
create index if not exists pilgrim_support_requests_departure_group_id_idx on public.pilgrim_support_requests (departure_group_id);
create index if not exists survey_responses_departure_group_id_idx on public.survey_responses (departure_group_id);
create index if not exists announcements_departure_group_id_idx on public.announcements (departure_group_id);
create index if not exists milestone_change_events_departure_group_id_idx on public.milestone_change_events (departure_group_id);
create index if not exists staff_notifications_departure_group_id_idx on public.staff_notifications (departure_group_id);
create index if not exists staff_notifications_proposal_id_idx on public.staff_notifications (proposal_id);
create index if not exists itinerary_events_transport_id_idx on public.itinerary_events (transport_id);
create index if not exists itinerary_events_accommodation_id_idx on public.itinerary_events (accommodation_id);
create index if not exists loyalty_point_entries_reference_booking_id_idx on public.loyalty_point_entries (reference_booking_id);
create index if not exists agent_booking_submissions_package_id_idx on public.agent_booking_submissions (package_id);
create index if not exists agent_booking_submissions_converted_booking_id_idx on public.agent_booking_submissions (converted_booking_id);
create index if not exists agent_package_allocations_package_id_idx on public.agent_package_allocations (package_id);
create index if not exists booking_events_agency_id_idx on public.booking_events (agency_id);
create index if not exists booking_financial_snapshots_agency_id_idx on public.booking_financial_snapshots (agency_id);
create index if not exists conversation_events_conversation_id_agency_id_idx on public.conversation_events (conversation_id,agency_id);
create index if not exists conversation_drafts_conversation_id_agency_id_idx on public.conversation_drafts (conversation_id,agency_id);
create index if not exists conversation_notes_conversation_id_agency_id_idx on public.conversation_notes (conversation_id,agency_id);
create index if not exists outbox_messages_conversation_id_agency_id_idx on public.outbox_messages (conversation_id,agency_id);
create index if not exists outbox_messages_message_id_agency_id_idx on public.outbox_messages (message_id,agency_id);
create index if not exists message_attachments_message_id_agency_id_idx on public.message_attachments (message_id,agency_id);
create index if not exists message_delivery_events_message_id_agency_id_idx on public.message_delivery_events (message_id,agency_id);
create index if not exists note_mentions_note_id_agency_id_idx on public.note_mentions (note_id,agency_id);
create index if not exists conversation_messages_reply_to_message_id_agency_id_idx on public.conversation_messages (reply_to_message_id,agency_id);
create index if not exists conversations_contact_identity_id_agency_id_idx on public.conversations (contact_identity_id,agency_id);
create index if not exists conversations_connection_id_agency_id_idx on public.conversations (connection_id,agency_id);
create index if not exists conversations_assigned_to_id_idx on public.conversations (assigned_to_id);
create index if not exists reconciliation_match_lines_agency_id_idx on public.reconciliation_match_lines (agency_id);
create index if not exists identity_match_events_contact_identity_id_agency_id_idx on public.identity_match_events (contact_identity_id,agency_id);
