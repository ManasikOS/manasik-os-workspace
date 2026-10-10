/**
 * Server-only read/write access for the Agent / Sub-Agent Portal.
 *
 * Backed by `sales_agents` / `agent_package_allocations` /
 * `agent_booking_submissions` / `commission_rules` / `commission_accruals` /
 * `agent_settlements` added in `supabase/migrations/20261021090000_agent_portal.sql`.
 * Per-agent seat usage and commission totals are computed live from
 * submissions/accruals, never stored.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AgentBookingSubmissionRow,
  AgentPackageAllocationRow,
  AgentSettlementRow,
  AgentSettlementWithContext,
  AgentSubmissionStatus,
  AgentSubmissionWithAgent,
  CommissionAccrualRow,
  CommissionAccrualStatus,
  CommissionAccrualWithContext,
  CommissionRuleRow,
  PortalAllocation,
  SalesAgentRow,
  SalesAgentStatus,
  SalesAgentWithMetrics,
} from "@/lib/types/agent-portal";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class AgentPortalPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update" | "delete",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`AgentPortal: ${operation} on ${table} failed — ${detail}`);
    this.name = "AgentPortalPersistenceError";
  }
}

export async function listSalesAgentsWithMetrics(client: Db): Promise<SalesAgentWithMetrics[]> {
  const [agentsResult, allocationsResult, submissionsResult, accrualsResult] = await Promise.all([
    client.from("sales_agents").select("*").order("created_at", { ascending: false }),
    client.from("agent_package_allocations").select("sales_agent_id, allocated_seats"),
    client.from("agent_booking_submissions").select("sales_agent_id, status"),
    client.from("commission_accruals").select("sales_agent_id, amount, status"),
  ]);
  if (agentsResult.error) throw new AgentPortalPersistenceError("sales_agents", "select", agentsResult.error);
  if (allocationsResult.error) throw new AgentPortalPersistenceError("agent_package_allocations", "select", allocationsResult.error);
  if (submissionsResult.error) throw new AgentPortalPersistenceError("agent_booking_submissions", "select", submissionsResult.error);
  if (accrualsResult.error) throw new AgentPortalPersistenceError("commission_accruals", "select", accrualsResult.error);

  const allocations = (allocationsResult.data ?? []) as Pick<AgentPackageAllocationRow, "sales_agent_id" | "allocated_seats">[];
  const submissions = (submissionsResult.data ?? []) as Pick<AgentBookingSubmissionRow, "sales_agent_id" | "status">[];
  const accruals = (accrualsResult.data ?? []) as Pick<CommissionAccrualRow, "sales_agent_id" | "amount" | "status">[];

  return ((agentsResult.data ?? []) as SalesAgentRow[]).map((agent) => {
    const ownAllocations = allocations.filter((a) => a.sales_agent_id === agent.id);
    const ownSubmissions = submissions.filter((s) => s.sales_agent_id === agent.id);
    const ownAccruals = accruals.filter((a) => a.sales_agent_id === agent.id);

    return {
      ...agent,
      metrics: {
        allocatedSeats: ownAllocations.reduce((sum, a) => sum + a.allocated_seats, 0),
        usedSeats: ownSubmissions.filter((s) => s.status === "CONVERTED").length,
        submissionCount: ownSubmissions.length,
        convertedCount: ownSubmissions.filter((s) => s.status === "CONVERTED").length,
        pendingCommission: ownAccruals
          .filter((a) => a.status === "PENDING" || a.status === "APPROVED")
          .reduce((sum, a) => sum + a.amount, 0),
        paidCommission: ownAccruals.filter((a) => a.status === "PAID").reduce((sum, a) => sum + a.amount, 0),
      },
    };
  });
}

export async function listAgentAllocations(client: Db, salesAgentId: string): Promise<AgentPackageAllocationRow[]> {
  const { data, error } = await client
    .from("agent_package_allocations")
    .select("*")
    .eq("sales_agent_id", salesAgentId);
  if (error) throw new AgentPortalPersistenceError("agent_package_allocations", "select", error);
  return (data ?? []) as AgentPackageAllocationRow[];
}

export async function listAgentSubmissionsWithAgent(client: Db): Promise<AgentSubmissionWithAgent[]> {
  const [submissionsResult, agentsResult] = await Promise.all([
    client.from("agent_booking_submissions").select("*").order("created_at", { ascending: false }),
    client.from("sales_agents").select("id, name"),
  ]);
  if (submissionsResult.error) throw new AgentPortalPersistenceError("agent_booking_submissions", "select", submissionsResult.error);
  if (agentsResult.error) throw new AgentPortalPersistenceError("sales_agents", "select", agentsResult.error);

  const nameById = new Map(((agentsResult.data ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));
  return ((submissionsResult.data ?? []) as AgentBookingSubmissionRow[]).map((s) => ({
    ...s,
    agentName: nameById.get(s.sales_agent_id) ?? "Unknown",
  }));
}

export async function listCommissionRules(client: Db): Promise<CommissionRuleRow[]> {
  const { data, error } = await client.from("commission_rules").select("*").order("created_at", { ascending: false });
  if (error) throw new AgentPortalPersistenceError("commission_rules", "select", error);
  return (data ?? []) as CommissionRuleRow[];
}

export async function listCommissionAccrualsWithContext(client: Db): Promise<CommissionAccrualWithContext[]> {
  const [accrualsResult, agentsResult, rulesResult] = await Promise.all([
    client.from("commission_accruals").select("*").order("created_at", { ascending: false }),
    client.from("sales_agents").select("id, name"),
    client.from("commission_rules").select("id, name"),
  ]);
  if (accrualsResult.error) throw new AgentPortalPersistenceError("commission_accruals", "select", accrualsResult.error);
  if (agentsResult.error) throw new AgentPortalPersistenceError("sales_agents", "select", agentsResult.error);
  if (rulesResult.error) throw new AgentPortalPersistenceError("commission_rules", "select", rulesResult.error);

  const agentNameById = new Map(((agentsResult.data ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));
  const ruleNameById = new Map(((rulesResult.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));

  return ((accrualsResult.data ?? []) as CommissionAccrualRow[]).map((a) => ({
    ...a,
    agentName: agentNameById.get(a.sales_agent_id) ?? "Unknown",
    ruleName: ruleNameById.get(a.commission_rule_id) ?? "Unknown",
  }));
}

/** One agent's own submissions — the Agent Portal side of `listAgentSubmissionsWithAgent`, which lists across every agent for staff. */
export async function listSubmissionsForAgent(client: Db, salesAgentId: string): Promise<AgentBookingSubmissionRow[]> {
  const { data, error } = await client
    .from("agent_booking_submissions")
    .select("*")
    .eq("sales_agent_id", salesAgentId)
    .order("created_at", { ascending: false });
  if (error) throw new AgentPortalPersistenceError("agent_booking_submissions", "select", error);
  return (data ?? []) as AgentBookingSubmissionRow[];
}

/** One agent's own commission accruals — RLS already scopes this, the salesAgentId filter is just a convenience narrow. */
export async function listCommissionAccrualsForAgent(client: Db, salesAgentId: string): Promise<CommissionAccrualRow[]> {
  const { data, error } = await client
    .from("commission_accruals")
    .select("*")
    .eq("sales_agent_id", salesAgentId)
    .order("created_at", { ascending: false });
  if (error) throw new AgentPortalPersistenceError("commission_accruals", "select", error);
  return (data ?? []) as CommissionAccrualRow[];
}

/**
 * One agent's own allocations, with each package's title.
 *
 * An agent never reads package rows: row security cannot limit columns, so the old "agent read allocated packages" policy exposed every field of every
 * allocated package (TASK-043 PKG-06, supabase/migrations/20270120090500_agent_portal_package_titles.sql). The title comes from
 * `agent_allocated_package_titles()`, which returns the package id and title and nothing else.
 */
export async function listPortalAllocations(client: Db, salesAgentId: string): Promise<PortalAllocation[]> {
  const [allocations, titles] = await Promise.all([
    client.from("agent_package_allocations").select("*").eq("sales_agent_id", salesAgentId),
    client.rpc("agent_allocated_package_titles"),
  ]);
  if (allocations.error) throw new AgentPortalPersistenceError("agent_package_allocations", "select", allocations.error);
  if (titles.error) throw new AgentPortalPersistenceError("agent_package_allocations", "select", titles.error);

  const titleByPackage = new Map(((titles.data ?? []) as { package_id: string; title: string }[]).map((row) => [row.package_id, row.title]));
  return ((allocations.data ?? []) as AgentPackageAllocationRow[]).map((row) => ({
    ...row,
    packageTitle: titleByPackage.get(row.package_id) || "—",
  }));
}

export interface CreateSalesAgentInput {
  name: string;
  agencyName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  creditLimit: number | null;
  createdByName: string;
}

export async function createSalesAgent(client: Db, input: CreateSalesAgentInput): Promise<SalesAgentRow> {
  const { data, error } = await client
    .from("sales_agents")
    .insert({
      name: input.name,
      agency_name: input.agencyName,
      contact_phone: input.contactPhone,
      contact_email: input.contactEmail,
      credit_limit: input.creditLimit,
      created_by_name: input.createdByName,
    })
    .select("*")
    .single();
  if (error) throw new AgentPortalPersistenceError("sales_agents", "insert", error);
  return data as SalesAgentRow;
}

export async function updateSalesAgentStatus(client: Db, id: string, status: SalesAgentStatus): Promise<void> {
  const { error } = await client.from("sales_agents").update({ status }).eq("id", id);
  if (error) throw new AgentPortalPersistenceError("sales_agents", "update", error);
}

export interface CreateAllocationInput {
  salesAgentId: string;
  packageId: string;
  allocatedSeats: number;
  createdByName: string;
}

export async function createAgentAllocation(client: Db, input: CreateAllocationInput): Promise<AgentPackageAllocationRow> {
  const { data, error } = await client
    .from("agent_package_allocations")
    .upsert(
      {
        sales_agent_id: input.salesAgentId,
        package_id: input.packageId,
        allocated_seats: input.allocatedSeats,
        created_by_name: input.createdByName,
      },
      { onConflict: "sales_agent_id,package_id" },
    )
    .select("*")
    .single();
  if (error) throw new AgentPortalPersistenceError("agent_package_allocations", "insert", error);
  return data as AgentPackageAllocationRow;
}

export interface CreateSubmissionInput {
  salesAgentId: string;
  packageId: string | null;
  leadName: string;
  leadContact: string | null;
  notes: string | null;
  submittedByName: string;
}

export async function createAgentSubmission(client: Db, input: CreateSubmissionInput): Promise<AgentBookingSubmissionRow> {
  const { data, error } = await client
    .from("agent_booking_submissions")
    .insert({
      sales_agent_id: input.salesAgentId,
      package_id: input.packageId,
      lead_name: input.leadName,
      lead_contact: input.leadContact,
      notes: input.notes,
      submitted_by_name: input.submittedByName,
    })
    .select("*")
    .single();
  if (error) throw new AgentPortalPersistenceError("agent_booking_submissions", "insert", error);
  return data as AgentBookingSubmissionRow;
}

export async function updateSubmissionStatus(client: Db, id: string, status: AgentSubmissionStatus): Promise<void> {
  const { error } = await client
    .from("agent_booking_submissions")
    .update({ status, reviewed_at: status === "SUBMITTED" ? null : new Date().toISOString() })
    .eq("id", id);
  if (error) throw new AgentPortalPersistenceError("agent_booking_submissions", "update", error);
}

export interface CreateCommissionRuleInput {
  salesAgentId: string | null;
  name: string;
  ratePercentage: number;
  createdByName: string;
}

export async function createCommissionRule(client: Db, input: CreateCommissionRuleInput): Promise<CommissionRuleRow> {
  const { data, error } = await client
    .from("commission_rules")
    .insert({
      sales_agent_id: input.salesAgentId,
      name: input.name,
      rate_percentage: input.ratePercentage,
      created_by_name: input.createdByName,
    })
    .select("*")
    .single();
  if (error) throw new AgentPortalPersistenceError("commission_rules", "insert", error);
  return data as CommissionRuleRow;
}

export interface GrantCommissionInput {
  salesAgentId: string;
  commissionRuleId: string;
  bookingId: string | null;
  amount: number;
  createdByName: string;
}

export async function grantCommissionAccrual(client: Db, input: GrantCommissionInput): Promise<CommissionAccrualRow> {
  const { data, error } = await client
    .from("commission_accruals")
    .insert({
      sales_agent_id: input.salesAgentId,
      commission_rule_id: input.commissionRuleId,
      booking_id: input.bookingId,
      amount: input.amount,
      created_by_name: input.createdByName,
    })
    .select("*")
    .single();
  if (error) throw new AgentPortalPersistenceError("commission_accruals", "insert", error);
  return data as CommissionAccrualRow;
}

export async function updateCommissionAccrualStatus(
  client: Db,
  id: string,
  status: CommissionAccrualStatus,
  actorName: string,
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === "APPROVED") {
    patch.approved_by_name = actorName;
    patch.approved_at = new Date().toISOString();
  }
  if (status === "PAID") patch.paid_at = new Date().toISOString();

  const { error } = await client.from("commission_accruals").update(patch).eq("id", id);
  if (error) throw new AgentPortalPersistenceError("commission_accruals", "update", error);
}

export async function listAgentSettlements(client: Db, salesAgentId: string): Promise<AgentSettlementRow[]> {
  const { data, error } = await client
    .from("agent_settlements")
    .select("*")
    .eq("sales_agent_id", salesAgentId)
    .order("created_at", { ascending: false });
  if (error) throw new AgentPortalPersistenceError("agent_settlements", "select", error);
  return (data ?? []) as AgentSettlementRow[];
}

/** Every settlement across every agent, with its total computed live from the commission_accruals it bundled — never stored on the settlement row. */
export async function listAllSettlementsWithContext(client: Db): Promise<AgentSettlementWithContext[]> {
  const [settlementsResult, agentsResult, accrualsResult] = await Promise.all([
    client.from("agent_settlements").select("*").order("created_at", { ascending: false }),
    client.from("sales_agents").select("id, name"),
    client.from("commission_accruals").select("settlement_id, amount").not("settlement_id", "is", null),
  ]);
  if (settlementsResult.error) throw new AgentPortalPersistenceError("agent_settlements", "select", settlementsResult.error);
  if (agentsResult.error) throw new AgentPortalPersistenceError("sales_agents", "select", agentsResult.error);
  if (accrualsResult.error) throw new AgentPortalPersistenceError("commission_accruals", "select", accrualsResult.error);

  const agentNameById = new Map(((agentsResult.data ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));
  const accruals = (accrualsResult.data ?? []) as { settlement_id: string; amount: number }[];

  return ((settlementsResult.data ?? []) as AgentSettlementRow[]).map((settlement) => {
    const own = accruals.filter((a) => a.settlement_id === settlement.id);
    return {
      ...settlement,
      agentName: agentNameById.get(settlement.sales_agent_id) ?? "Unknown",
      totalAmount: own.reduce((sum, a) => sum + a.amount, 0),
      accrualCount: own.length,
    };
  });
}

export interface CreateSettlementInput {
  salesAgentId: string;
  periodStart: string;
  periodEnd: string;
  accrualIds: string[];
  createdByName: string;
}

/** Bundles the given PENDING/APPROVED accruals into one settlement and marks them PAID. */
export async function createSettlement(client: Db, input: CreateSettlementInput): Promise<AgentSettlementRow> {
  const { data, error } = await client
    .from("agent_settlements")
    .insert({
      sales_agent_id: input.salesAgentId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      status: "PAID",
      created_by_name: input.createdByName,
      paid_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw new AgentPortalPersistenceError("agent_settlements", "insert", error);
  const settlement = data as AgentSettlementRow;

  if (input.accrualIds.length > 0) {
    const { error: updateError } = await client
      .from("commission_accruals")
      .update({ settlement_id: settlement.id, status: "PAID", paid_at: new Date().toISOString() })
      .in("id", input.accrualIds);
    if (updateError) throw new AgentPortalPersistenceError("commission_accruals", "update", updateError);
  }

  return settlement;
}
