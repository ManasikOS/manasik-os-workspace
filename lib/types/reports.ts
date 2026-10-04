/**
 * Hand-maintained row types for the Reports schema.
 *
 * Keep in sync with `supabase/migrations/20260819090000_reports.sql`. Same
 * convention as `lib/types/finance.ts`: snake_case, exactly the shape a
 * `select *` against the matching `report_*_facts` view returns. Every field
 * here is owned by another module's table — Reports adds no column that is
 * ever written to.
 */

export interface ReportBookingFact {
  booking_id: string;
  booking_reference: string;
  booking_status: "HELD" | "DEPOSIT_PENDING" | "CONFIRMED" | "CANCELLED" | "WAITLIST";
  booked_at: string | null;
  created_at: string;
  traveller_count: number;
  total_booking_value: number;
  amount_paid: number;
  outstanding_balance: number;
  next_due_at: string | null;
  finance_owner_name: string | null;
  departure_group_id: string;
  group_name: string;
  group_code: string;
  branch: string;
  journey_type: "UMRAH" | "HAJJ" | "EARLY_REGISTRATION";
  departure_date: string;
  group_status: string;
  package_template_id: string;
  package_name: string | null;
  package_code: string | null;
  lead_id: string | null;
  lead_reference: string | null;
  lead_source: string | null;
  sales_owner_id: string | null;
  sales_owner_name: string | null;
}

export interface ReportPaymentFact {
  payment_id: string;
  payment_reference: string;
  amount: number;
  currency: string;
  paid_at: string;
  method: string;
  status: string;
  reverses_payment_id: string | null;
  booking_id: string;
  booking_reference: string;
  departure_group_id: string;
  group_name: string;
  group_code: string;
  branch: string;
  journey_type: string;
  package_template_id: string;
  package_name: string | null;
  finance_owner_name: string | null;
}

export interface ReportMilestoneFact {
  milestone_id: string;
  booking_id: string;
  label: string;
  milestone_type: string;
  amount: number;
  paid_amount: number;
  outstanding_amount: number;
  due_at: string | null;
  waived: boolean;
  booking_reference: string;
  departure_group_id: string;
  group_name: string;
  branch: string;
  finance_owner_name: string | null;
}

export interface ReportLeadFact {
  lead_id: string;
  reference: string;
  stage: string;
  temperature: "HOT" | "WARM" | "COLD";
  source: string;
  journey_type: string;
  estimated_value_lkr: number;
  sales_owner_id: string | null;
  sales_owner_name: string;
  created_at: string;
  first_response_at: string | null;
  last_contacted_at: string | null;
  next_follow_up_at: string | null;
  lost_reason: string | null;
  postponed_until: string | null;
  selected_departure_group_id: string | null;
  booking_id: string | null;
  total_booking_value: number | null;
  booking_branch: string | null;
}

export interface ReportGroupFact {
  departure_group_id: string;
  group_name: string;
  group_code: string;
  branch: string;
  journey_type: string;
  group_status: string;
  sales_status: string;
  departure_date: string;
  return_date: string;
  capacity: number;
  booked_seats: number;
  held_seats: number;
  available_seats: number;
  waitlisted_count: number;
  readiness_score: number;
  readiness_status: "READY" | "AT_RISK" | "BLOCKED" | "NOT_STARTED";
  finance_owner_name: string | null;
  operations_owner_name: string | null;
  visa_owner_name: string | null;
  primary_guide_name: string | null;
  package_template_id: string;
  package_name: string | null;
  expected_revenue: number;
  collected_amount: number;
  outstanding_amount: number;
  overdue_amount: number;
  refund_pending_amount: number;
  supplier_cost_mixed_currency: number;
  /** Contract currency for this departure group. */
  currency?: string;
  /** Supplier commitment totals keyed by their stored currency. */
  supplier_cost_by_currency?: Record<string, number>;
  blocker_count: number;
  occupancy_percent: number;
}

export interface ReportPilgrimComplianceFact {
  journey_id: string;
  pilgrim_id: string;
  pilgrim_reference: string;
  full_name: string;
  passport_number: string | null;
  passport_expiry: string | null;
  seat_status: string;
  visa_status: string;
  visa_submitted_at: string | null;
  payment_status: string;
  documents_completed: number;
  documents_required: number;
  document_completion_percent: number;
  departure_group_id: string;
  group_name: string;
  group_code: string;
  branch: string;
  journey_type: string;
  departure_date: string;
  group_visa_owner_name: string | null;
  days_to_departure: number;
  passport_days_remaining: number | null;
}

export interface ReportSupplierFact {
  commitment_id: string;
  reference_code: string;
  service_category: string;
  service_label: string;
  commitment_status: string;
  amount: number | null;
  amount_paid: number;
  outstanding_amount: number;
  currency: string;
  payment_due_at: string | null;
  service_start_date: string | null;
  confirmed_at: string | null;
  owner_name: string | null;
  created_at: string;
  confirmed_on_time: boolean | null;
  supplier_id: string;
  supplier_name: string;
  supplier_code: string;
  departure_group_id: string;
  group_name: string;
  group_code: string;
  branch: string;
}

export interface ReportTaskFact {
  task_id: string;
  title: string;
  category: "OPERATIONS" | "VISA" | "FINANCE" | "GUIDE" | "MARKETING" | "OTHER";
  status: "OPEN" | "IN_PROGRESS" | "COMPLETE" | "OVERDUE";
  owner_id: string | null;
  owner_name: string;
  due_at: string;
  departure_group_id: string;
  group_name: string;
  group_code: string;
  branch: string;
}

/** The Overview tab's server-loaded snapshot: current + comparison windows. */
export interface ReportsOverviewSnapshot {
  bookingsCurrent: ReportBookingFact[];
  bookingsPrevious: ReportBookingFact[];
  paymentsCurrent: ReportPaymentFact[];
  paymentsPrevious: ReportPaymentFact[];
  /** Live state, not period-filtered — a group's readiness is "now", not "in period". */
  groups: ReportGroupFact[];
}

/** Sales & Leads tab. Leads created within the selected period. */
export interface ReportsSalesSnapshot {
  leads: ReportLeadFact[];
}

/** Finance tab. Milestones and refunds are live state; bookings/payments are period-scoped. */
export interface ReportsFinanceSnapshot {
  bookings: ReportBookingFact[];
  payments: ReportPaymentFact[];
  milestones: ReportMilestoneFact[];
  groups: ReportGroupFact[];
  refundsPending: { count: number; amount: number };
}

/** Departure Groups tab. Always live state — readiness is "now", not "in period". */
export interface ReportsGroupsSnapshot {
  groups: ReportGroupFact[];
}

/** Pilgrims & Compliance tab. Always live state. */
export interface ReportsPilgrimsSnapshot {
  pilgrims: ReportPilgrimComplianceFact[];
}

/** Suppliers & Operations tab. Always live state. */
export interface ReportsSuppliersSnapshot {
  suppliers: ReportSupplierFact[];
  tasks: ReportTaskFact[];
}
