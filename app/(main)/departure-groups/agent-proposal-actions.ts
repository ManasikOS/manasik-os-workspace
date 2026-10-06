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

import { canRoleActOnGroup } from "@/lib/access/departure-groups-access";
import { requireUser } from "@/lib/dal";
import { getCurrentDepartureCapabilities, getCurrentStaffRole } from "@/lib/data/departure-groups";
import { loadAssignedGroupIds } from "@/lib/data/team-repository";
import {
  approveAgentProposalSchema,
  muteAgentOnGroupSchema,
  rejectAgentProposalSchema,
} from "@/lib/validations/departure-groups";
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
  const parsed = approveAgentProposalSchema.safeParse({ proposalId, editedPayload });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That proposal is invalid." };
  }

  const resolved = await resolveDecisionActor();
  if (!resolved) return { ok: false, error: "No active agency for your account." };

  const outcome = await approveProposal(parsed.data.proposalId, resolved.actor, resolved.client, {
    editedPayload: parsed.data.editedPayload,
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
  const parsed = rejectAgentProposalSchema.safeParse({ proposalId, decisionNote });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That proposal is invalid." };
  }

  const resolved = await resolveDecisionActor();
  if (!resolved) return { ok: false, error: "No active agency for your account." };

  const outcome = await rejectProposal(
    parsed.data.proposalId,
    resolved.actor,
    resolved.client,
    parsed.data.decisionNote,
  );
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath("/departure-groups");
  revalidatePath("/operations");
  return { ok: true };
}

/**
 * Mutes or un-mutes the agent on one group.
 *
 * Muting only ever stops the agent from running - it never widens what the agent
 * may propose - but it does silence the checks that watch a departure, so it needs
 * `manageReadiness` (the capability that owns those checks) and a group the caller
 * is allowed to act on. Everything the client sends is validated: the length of the
 * mute is bounded, and the group is confirmed to belong to the caller's agency
 * before a row is written for it.
 */
export async function setGroupAgentSuppressionAction(
  groupId: string,
  input: { days: number | null; reason: string },
): Promise<AgentProposalActionResult> {
  const user = await requireUser();

  const parsed = muteAgentOnGroupSchema.safeParse({ groupId, days: input?.days, reason: input?.reason });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That request is invalid." };
  }

  const { role, staffId, agencyId } = await getCurrentStaffRole();
  if (!agencyId) return { ok: false, error: "No active agency for your account." };
  if (!(await getCurrentDepartureCapabilities()).manageReadiness) {
    return { ok: false, error: "Your role cannot mute the operations agent." };
  }

  const client = createClient(await cookies());

  const { data: group } = await client
    .from("departure_groups")
    .select("id, sales_status")
    .eq("id", parsed.data.groupId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!group) return { ok: false, error: "That departure group could not be found." };

  const assignedGroupIds =
    role === "GUIDE" && staffId ? await loadAssignedGroupIds(client, staffId) : [];
  if (!canRoleActOnGroup(group, role, assignedGroupIds)) {
    return { ok: false, error: "You do not have access to that departure group." };
  }

  const { days, reason } = parsed.data;
  const outcome = await setGroupAgentSuppression(client, parsed.data.groupId, agencyId, {
    suppressedUntil: days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString(),
    suppressedById: days === null ? null : user.id,
    reason: days === null ? null : reason || "Muted by staff",
  });
  if (!outcome.ok) {
    console.error("setGroupAgentSuppressionAction failed", outcome.error);
    return { ok: false, error: "The agent could not be muted right now. Try again." };
  }

  revalidatePath(`/departure-groups/${parsed.data.groupId}`);
  return { ok: true };
}
