"use server";

/**
 * The human side of the approval queue — §9.2 of
 * docs/modules/departure-operations-agent-implementation-plan.md. Every write here
 * runs under the signed-in staff member's own session and capabilities;
 * `lib/agent/kernel/proposals/service.ts` does the actual work, this file
 * is the session/role resolution and `revalidatePath` shell around it —
 * the same division every other action in this module already uses.
 *
 * There is deliberately no `createAgentProposalAction` here: creating a
 * proposal is not a human-facing action in the shipped design — only the
 * Departure Operations Agent creates one (Phase 4). `createProposal()` in
 * service.ts exists for that caller (and for this phase's own
 * verification), not for a Server Action a person clicks.
 */

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { requireUser } from "@/lib/dal";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { setGroupAgentSuppression } from "@/lib/data/departure-groups-agent";
import {
  approveProposal,
  rejectProposal,
  type DecisionActor,
} from "@/lib/agent/kernel/proposals/service";
import { createClient } from "@/utils/supabase/server";

export type AgentProposalActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Resolves the caller into a `DecisionActor` — the one thing every action
 * below needs before it can touch a proposal. Returns `null` (never
 * throws) for "no usable session/agency", so callers turn that into an
 * ordinary refused result instead of a 500.
 */
async function resolveDecisionActor(): Promise<
  { actor: DecisionActor; client: ReturnType<typeof createClient> } | null
> {
  const user = await requireUser();
  const { role, roleId, name, staffId, agencyId } = await getCurrentStaffRole();
  if (!agencyId) return null;

  const client = createClient(await cookies());
  const { data: settings } = await client
    .from("ai_settings")
    .select("departure_ops_high_risk_roles")
    .eq("agency_id", agencyId)
    .maybeSingle();

  return {
    actor: {
      agencyId,
      role,
      roleId,
      actor: { id: staffId ?? user.id, name: name ?? "Staff", agencyId },
      highRiskRoles: (settings as { departure_ops_high_risk_roles: string[] } | null)
        ?.departure_ops_high_risk_roles ?? ["ADMIN", "CEO"],
    },
    client,
  };
}

export async function approveAgentProposalAction(
  proposalId: string,
  editedPayload?: unknown,
): Promise<AgentProposalActionResult> {
  const resolved = await resolveDecisionActor();
  if (!resolved) return { ok: false, error: "No active agency for your account." };

  const outcome = await approveProposal(proposalId, resolved.actor, resolved.client, {
    editedPayload,
  });

  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath("/departure-groups");
  revalidatePath("/operations");
  return { ok: true };
}

export async function rejectAgentProposalAction(
  proposalId: string,
  decisionNote?: string,
): Promise<AgentProposalActionResult> {
  const resolved = await resolveDecisionActor();
  if (!resolved) return { ok: false, error: "No active agency for your account." };

  const outcome = await rejectProposal(proposalId, resolved.actor, resolved.client, decisionNote);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath("/departure-groups");
  revalidatePath("/operations");
  return { ok: true };
}

/**
 * Mutes or un-mutes the agent on one group. Any signed-in staff member with
 * module access may do this — it only ever stops the agent from running,
 * never changes what it is allowed to propose, so it carries none of the
 * Class-2 capability weight `approveAgentProposalAction` does.
 */
export async function setGroupAgentSuppressionAction(
  groupId: string,
  input: { days: number | null; reason: string },
): Promise<AgentProposalActionResult> {
  const user = await requireUser();
  const { agencyId } = await getCurrentStaffRole();
  if (!agencyId) return { ok: false, error: "No active agency for your account." };

  const client = createClient(await cookies());
  const outcome = await setGroupAgentSuppression(client, groupId, agencyId, {
    suppressedUntil: input.days === null ? null : new Date(Date.now() + input.days * 86_400_000).toISOString(),
    suppressedById: input.days === null ? null : user.id,
    reason: input.days === null ? null : input.reason.trim() || "Muted by staff",
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath(`/departure-groups/${groupId}`);
  return { ok: true };
}
