export const OWNER_INBOX_KPI_DEFINITIONS = [
  ["New enquiries", "new_enquiries", "NEW_ENQUIRIES"],
  ["Qualified opportunities", "qualified_opportunities", "QUALIFIED"],
  ["Booking-ready", "booking_ready", "BOOKING_READY"],
  ["High-value family/group enquiries", "high_value_group_enquiries", "QUALIFIED"],
  ["Awaiting staff reply", "awaiting_staff_reply", "NEEDS_REPLY"],
  ["Nearing channel deadline", "nearing_channel_deadline", "NEARING_DEADLINE"],
  ["Payment claims needing verification", "payment_claims_needing_verification", "PAYMENT_DISCUSSIONS"],
  ["Document and visa escalations", "document_visa_escalations", "DOCUMENTS"],
  ["AI-safe resolutions", "ai_safe_resolutions", "RESOLVED"],
  ["Human interventions required", "human_interventions_required", "ESCALATIONS"],
] as const;

export function ownerInboxMetricsFromRow(row: Record<string, unknown>) {
  return OWNER_INBOX_KPI_DEFINITIONS.map(([label, key, queueCode]) => ({ label, value: Number(row[key] ?? 0), queueCode }));
}
