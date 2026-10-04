import "server-only";

/**
 * The fan-out and read side of `staff_notifications` — see
 * supabase/migrations/20261001090000_staff_notifications.sql for why this
 * table exists (F6 of docs/modules/departure-operations-agent-implementation-plan.md:
 * a proposal queue nobody is told about is a queue nobody reads).
 *
 * `notifyProposalPending` is called from `createProposal()`
 * (lib/agent/kernel/proposals/service.ts) with the same admin client that
 * wrote the proposal — never a signed-in user's session, matching the
 * table's RLS posture (no insert policy for `authenticated` at all).
 */

import type { StaffRole } from "@/lib/access/departure-groups-access";
import { resolveCapability } from "@/lib/agent/kernel/proposals/capabilities";
import type { Db } from "@/lib/data/departure-groups-repository";

export interface NotifyProposalPendingInput {
  agencyId: string;
  /** A `PermissionModule` key — resolved per-recipient via `resolveCapability()`, generalised in Phase 0 (P0.2) beyond departure_groups. */
  module: string;
  /** Null for a proposal not scoped to a departure group — the GUIDE own-group-scoping filter below only applies when this is set. */
  departureGroupId: string | null;
  proposalId: string;
  requiredCapability: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  title: string;
}

/**
 * Notifies every staff member who could actually decide on this proposal —
 * the same eligibility `approveProposal()` checks at decision time
 * (required capability, the HIGH-risk role gate, GUIDE's own-group
 * scoping), resolved here up front so nobody's bell lights up for a
 * proposal their role could never act on.
 *
 * Best-effort by design: a notification failing to write must never roll
 * back the proposal it describes, which is why every caller awaits this
 * strictly after the proposal insert has already committed, and why this
 * function itself never throws — it logs and returns on any query error.
 */
export async function notifyProposalPending(input: NotifyProposalPendingInput, client: Db): Promise<void> {
  try {
    const { data: staff } = await client
      .from("staff_profiles")
      .select("id, role, role_id")
      .eq("agency_id", input.agencyId)
      .eq("status", "ACTIVE");

    const staffRows = (staff ?? []) as { id: string; role: StaffRole; role_id: string | null }[];
    const capableFlags = await Promise.all(
      staffRows.map((s) => resolveCapability(s.role, s.role_id, input.module, input.requiredCapability, client)),
    );
    const capable = staffRows.filter((_, i) => capableFlags[i]);

    let eligible = capable;
    if (input.risk === "HIGH") {
      const { data: settings } = await client
        .from("ai_settings")
        .select("departure_ops_high_risk_roles")
        .eq("agency_id", input.agencyId)
        .maybeSingle();
      const highRiskRoles =
        (settings as { departure_ops_high_risk_roles: string[] } | null)?.departure_ops_high_risk_roles ??
        ["ADMIN", "CEO"];
      eligible = eligible.filter((s) => highRiskRoles.includes(s.role));
    }

    const guideIds = eligible.filter((s) => s.role === "GUIDE").map((s) => s.id);
    let assignedGuideIds = new Set<string>();
    if (guideIds.length > 0 && input.departureGroupId) {
      const { data: assignments } = await client
        .from("staff_group_assignments")
        .select("staff_profile_id")
        .eq("departure_group_id", input.departureGroupId)
        .in("staff_profile_id", guideIds)
        .is("unassigned_at", null);
      assignedGuideIds = new Set(
        ((assignments ?? []) as { staff_profile_id: string }[]).map((a) => a.staff_profile_id),
      );
    }

    const recipients = eligible.filter((s) => s.role !== "GUIDE" || assignedGuideIds.has(s.id));
    if (recipients.length === 0) return;

    await client.from("staff_notifications").insert(
      recipients.map((s) => ({
        agency_id: input.agencyId,
        recipient_id: s.id,
        kind: "PROPOSAL_PENDING" as const,
        departure_group_id: input.departureGroupId,
        proposal_id: input.proposalId,
        title: input.title,
      })),
    );
  } catch (error) {
    console.error("notifyProposalPending failed (non-fatal):", error);
  }
}

export type ConversationNotificationKind = "HANDOFF_WAITING" | "HANDOFF_ESCALATED" | "WORKFLOW_CREATED" | "REPLY_WINDOW_CLOSING";

/** Active staff of one agency with any of the given roles — the recipient lookup shared by every role-addressed notification. */
export async function listActiveStaffIdsByRole(client: Db, agencyId: string, roles: readonly string[]): Promise<string[]> {
  const { data, error } = await client
    .from("staff_profiles")
    .select("id")
    .eq("agency_id", agencyId)
    .eq("status", "ACTIVE")
    .in("role", [...roles]);
  if (error) throw new Error(`Could not look up staff by role: ${error.message}`);
  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}

export interface NotifyConversationWaitingInput {
  agencyId: string;
  conversationId: string;
  kind: ConversationNotificationKind;
  recipientIds: string[];
  title: string;
}

/** A created Inbox workflow must reach the person responsible for it; failure to ring the bell never undoes the work. */
export async function notifyWorkflowCreated(input: NotifyConversationWaitingInput, client: Db): Promise<void> {
  await notifyConversationWaiting(input, client);
}

/**
 * Tells staff a customer is waiting on a person (Phase 1 of
 * docs/modules/lead-retention-followups-implementation-plan.md). Unlike `notifyProposalPending` this reports
 * whether the rows were written, because the sweep records that outcome in its ledger.
 */
export async function notifyConversationWaiting(input: NotifyConversationWaitingInput, client: Db): Promise<{ ok: boolean; notified: number }> {
  if (input.recipientIds.length === 0) return { ok: true, notified: 0 };
  const { error } = await client.from("staff_notifications").insert(
    input.recipientIds.map((recipientId) => ({
      agency_id: input.agencyId,
      recipient_id: recipientId,
      kind: input.kind,
      conversation_id: input.conversationId,
      title: input.title,
    })),
  );
  if (error) {
    console.error(`notifyConversationWaiting failed for agency ${input.agencyId}: ${error.message}`);
    return { ok: false, notified: 0 };
  }
  return { ok: true, notified: input.recipientIds.length };
}

export interface StaffNotificationRow {
  id: string;
  kind: string;
  departureGroupId: string | null;
  proposalId: string | null;
  conversationId: string | null;
  title: string;
  readAt: string | null;
  createdAt: string;
  groupName: string | null;
  groupCode: string | null;
}

/** The bell's unread badge count — a `head: true` count query, no row bodies. */
export async function getUnreadNotificationCount(staffId: string, client: Db): Promise<number> {
  const { count } = await client
    .from("staff_notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", staffId)
    .is("read_at", null);
  return count ?? 0;
}

/** The bell dropdown's list — most recent first, joined to the group for display. */
export async function listStaffNotifications(
  staffId: string,
  client: Db,
  limit = 20,
): Promise<StaffNotificationRow[]> {
  const { data } = await client
    .from("staff_notifications")
    .select(
      "id, kind, departure_group_id, proposal_id, conversation_id, title, read_at, created_at, departure_groups(group_name, group_code)",
    )
    .eq("recipient_id", staffId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const group = row.departure_groups as { group_name: string; group_code: string } | null;
    return {
      id: row.id as string,
      kind: row.kind as string,
      departureGroupId: (row.departure_group_id as string) ?? null,
      proposalId: (row.proposal_id as string) ?? null,
      conversationId: (row.conversation_id as string) ?? null,
      title: row.title as string,
      readAt: (row.read_at as string) ?? null,
      createdAt: row.created_at as string,
      groupName: group?.group_name ?? null,
      groupCode: group?.group_code ?? null,
    };
  });
}
