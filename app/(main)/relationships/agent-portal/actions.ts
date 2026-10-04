"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import {
  createAgentAllocation,
  createAgentSubmission,
  createCommissionRule,
  createSalesAgent,
  createSettlement,
  grantCommissionAccrual,
  updateCommissionAccrualStatus,
  updateSalesAgentStatus,
  updateSubmissionStatus,
  type CreateAllocationInput,
  type CreateCommissionRuleInput,
  type CreateSalesAgentInput,
  type CreateSettlementInput,
  type CreateSubmissionInput,
  type GrantCommissionInput,
} from "@/lib/data/agent-portal-repository";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import type { AgentSubmissionStatus, CommissionAccrualStatus, SalesAgentStatus } from "@/lib/types/agent-portal";
import { createClient } from "@/utils/supabase/server";

interface ActionResult {
  ok: boolean;
  error?: string;
}

async function db() {
  return createClient(await cookies());
}

async function requireCanManage() {
  await requireUser();
  const { role, name } = await getCurrentStaffRole();
  const ok = role === "ADMIN" || role === "CEO" || role === "OPERATIONS";
  return { ok, name };
}

/** Commission rules/payouts are money-adjacent — restricted further, matching the RLS policy on commission_rules/agent_settlements. */
async function requireCanManageCommissions() {
  await requireUser();
  const { role, name } = await getCurrentStaffRole();
  return { ok: role === "ADMIN" || role === "CEO", name };
}

function revalidateAgentPortal() {
  revalidatePath("/relationships/agent-portal");
}

/**
 * Marks an agent as invited to the Agent Portal — sets portal_invited_at,
 * which `linkPortalAgentIfNeeded` (lib/data/agent-portal-auth.ts) requires
 * before their first sign-in can link an auth.users row to this agent. Does
 * not send the email itself; the agent requests their own magic link at
 * /agent-portal/login the same way pilgrims do.
 */
export async function inviteSalesAgentToPortalAction(agentId: string): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot manage portal access." };

  const supabase = await db();
  const { data: agent } = await supabase.from("sales_agents").select("contact_email").eq("id", agentId).maybeSingle();
  if (!agent?.contact_email) {
    return { ok: false, error: "Add a contact email for this agent before inviting them to the portal." };
  }

  const { error } = await supabase
    .from("sales_agents")
    .update({ portal_invited_at: new Date().toISOString() })
    .eq("id", agentId);
  if (error) return { ok: false, error: error.message };

  revalidateAgentPortal();
  return { ok: true };
}

export async function createSalesAgentAction(input: Omit<CreateSalesAgentInput, "createdByName">): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot add agents." };
  if (!input.name.trim()) return { ok: false, error: "Give the agent a name." };

  const supabase = await db();
  await createSalesAgent(supabase, { ...input, createdByName: name ?? "Staff" });
  revalidateAgentPortal();
  return { ok: true };
}

export async function updateSalesAgentStatusAction(id: string, status: SalesAgentStatus): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot update agent status." };

  const supabase = await db();
  await updateSalesAgentStatus(supabase, id, status);
  revalidateAgentPortal();
  return { ok: true };
}

export async function createAgentAllocationAction(
  input: Omit<CreateAllocationInput, "createdByName">,
): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot allocate packages." };
  if (input.allocatedSeats <= 0) return { ok: false, error: "Enter a seat count greater than zero." };

  const supabase = await db();
  await createAgentAllocation(supabase, { ...input, createdByName: name ?? "Staff" });
  revalidateAgentPortal();
  return { ok: true };
}

export async function createAgentSubmissionAction(
  input: Omit<CreateSubmissionInput, "submittedByName">,
): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot log submissions." };
  if (!input.leadName.trim()) return { ok: false, error: "Enter who the agent brought in." };

  const supabase = await db();
  await createAgentSubmission(supabase, { ...input, submittedByName: name ?? "Staff" });
  revalidateAgentPortal();
  return { ok: true };
}

export async function updateSubmissionStatusAction(id: string, status: AgentSubmissionStatus): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot update this submission." };

  const supabase = await db();
  await updateSubmissionStatus(supabase, id, status);
  revalidateAgentPortal();
  return { ok: true };
}

export async function createCommissionRuleAction(
  input: Omit<CreateCommissionRuleInput, "createdByName">,
): Promise<ActionResult> {
  const { ok, name } = await requireCanManageCommissions();
  if (!ok) return { ok: false, error: "Your role cannot create commission rules." };
  if (!input.name.trim()) return { ok: false, error: "Give the rule a name." };

  const supabase = await db();
  await createCommissionRule(supabase, { ...input, createdByName: name ?? "Staff" });
  revalidateAgentPortal();
  return { ok: true };
}

export async function grantCommissionAction(input: Omit<GrantCommissionInput, "createdByName">): Promise<ActionResult> {
  const { ok, name } = await requireCanManageCommissions();
  if (!ok) return { ok: false, error: "Your role cannot grant commissions." };
  if (input.amount <= 0) return { ok: false, error: "Enter an amount greater than zero." };

  const supabase = await db();
  await grantCommissionAccrual(supabase, { ...input, createdByName: name ?? "Staff" });
  revalidateAgentPortal();
  return { ok: true };
}

export async function updateCommissionAccrualStatusAction(
  id: string,
  status: CommissionAccrualStatus,
): Promise<ActionResult> {
  const { ok, name } = await requireCanManageCommissions();
  if (!ok) return { ok: false, error: "Your role cannot update commission status." };

  const supabase = await db();
  await updateCommissionAccrualStatus(supabase, id, status, name ?? "Staff");
  revalidateAgentPortal();
  return { ok: true };
}

/** Bundles a set of PENDING/APPROVED accruals for one agent into a paid settlement — see createSettlement()'s own doc for the all-or-nothing status flip. */
export async function createSettlementAction(
  input: Omit<CreateSettlementInput, "createdByName">,
): Promise<ActionResult> {
  const { ok, name } = await requireCanManageCommissions();
  if (!ok) return { ok: false, error: "Your role cannot create settlements." };
  if (input.accrualIds.length === 0) return { ok: false, error: "Select at least one commission to bundle." };
  if (!input.periodStart || !input.periodEnd) return { ok: false, error: "Choose the settlement period." };

  const supabase = await db();
  await createSettlement(supabase, { ...input, createdByName: name ?? "Staff" });
  revalidateAgentPortal();
  return { ok: true };
}
