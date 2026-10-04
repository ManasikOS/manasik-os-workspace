/**
 * Row types for the Agent / Sub-Agent Portal.
 *
 * Keep in sync with `supabase/migrations/20261021090000_agent_portal.sql`.
 */

export type SalesAgentStatus = "ACTIVE" | "SUSPENDED" | "INACTIVE";
export type AgentSubmissionStatus = "SUBMITTED" | "REVIEWED" | "CONVERTED" | "REJECTED";
export type CommissionAccrualStatus = "PENDING" | "APPROVED" | "PAID" | "CANCELLED";
export type AgentSettlementStatus = "DRAFT" | "FINALIZED" | "PAID";

export interface SalesAgentRow {
  id: string;
  name: string;
  agency_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  status: SalesAgentStatus;
  credit_limit: number | null;
  created_by_name: string;
  created_at: string;
  portal_user_id: string | null;
  portal_invited_at: string | null;
}

export interface AgentPackageAllocationRow {
  id: string;
  sales_agent_id: string;
  package_id: string;
  allocated_seats: number;
  created_by_name: string;
  created_at: string;
}

export interface AgentBookingSubmissionRow {
  id: string;
  sales_agent_id: string;
  package_id: string | null;
  lead_name: string;
  lead_contact: string | null;
  notes: string | null;
  status: AgentSubmissionStatus;
  converted_booking_id: string | null;
  submitted_by_name: string;
  created_at: string;
  reviewed_at: string | null;
}

export interface CommissionRuleRow {
  id: string;
  sales_agent_id: string | null;
  name: string;
  rate_percentage: number;
  is_active: boolean;
  created_by_name: string;
  created_at: string;
}

export interface CommissionAccrualRow {
  id: string;
  sales_agent_id: string;
  commission_rule_id: string;
  booking_id: string | null;
  settlement_id: string | null;
  amount: number;
  status: CommissionAccrualStatus;
  created_by_name: string;
  created_at: string;
  approved_by_name: string | null;
  approved_at: string | null;
  paid_at: string | null;
}

export interface AgentSettlementRow {
  id: string;
  sales_agent_id: string;
  period_start: string;
  period_end: string;
  status: AgentSettlementStatus;
  created_by_name: string;
  created_at: string;
  paid_at: string | null;
}

/** Live-computed per agent, never stored. */
export interface AgentMetrics {
  allocatedSeats: number;
  usedSeats: number;
  submissionCount: number;
  convertedCount: number;
  pendingCommission: number;
  paidCommission: number;
}

export interface SalesAgentWithMetrics extends SalesAgentRow {
  metrics: AgentMetrics;
}

export interface AgentSubmissionWithAgent extends AgentBookingSubmissionRow {
  agentName: string;
}

export interface CommissionAccrualWithContext extends CommissionAccrualRow {
  agentName: string;
  ruleName: string;
}

export interface AgentSettlementWithContext extends AgentSettlementRow {
  agentName: string;
  /** Live sum of linked commission_accruals — never stored on the settlement itself. */
  totalAmount: number;
  accrualCount: number;
}

/** An agent's own allocation, as seen from the Agent Portal — with the package title it doesn't otherwise carry. */
export interface PortalAllocation extends AgentPackageAllocationRow {
  packageTitle: string;
}
