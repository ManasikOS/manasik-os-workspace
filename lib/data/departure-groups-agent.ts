/**
 * Read model for the Departure Operations Agent's UI surfaces — the group
 * detail's Agent tab (§12.1) and the cross-group Approvals queue (§12.2) of
 * docs/modules/departure-operations-agent-implementation-plan.md.
 *
 * Deliberately separate from `departure-groups.ts`'s giant `loadStore()`
 * unit of work: `agent_proposals`, `departure_group_agent_findings` and
 * `departure_group_agent_state` are not part of `DepartureGroupStore` (see
 * the Phase 1 migration's own comment on why `agent_proposals` is kernel,
 * not group, infrastructure) — they are read directly here.
 */

import "server-only";

import { colomboDayKey } from "@/lib/date";
import { daysBetween } from "@/lib/data/departure-groups-copy";
import type { Db } from "@/lib/data/departure-groups-repository";
import type {
  DepartureOpsAgencyMode,
  DepartureOpsMode,
  ProposalDiffLine,
  ProposalEvidenceRef,
  ProposalRisk,
  ProposalStatus,
} from "@/lib/agent/kernel/proposals/types";
import type { FindingCategory, FindingSeverity } from "@/lib/agent/kernel/proposals/types";

export interface GroupAgentState {
  mode: DepartureOpsMode;
  effectiveMode: DepartureOpsAgencyMode;
  lastRunAt: string | null;
  nextRunAt: string;
  consecutiveNoopRuns: number;
  suppressedUntil: string | null;
  suppressedReason: string | null;
}

export interface GroupAgentFinding {
  id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  headline: string;
  detail: string;
  corroboratingBlockerId: string | null;
}

export interface GroupAgentRunSummary {
  id: string;
  status: string;
  createdAt: string;
  error: string | null;
  findings: GroupAgentFinding[];
}

export interface GroupAgentProposal {
  id: string;
  kind: string;
  title: string;
  rationale: string;
  risk: ProposalRisk;
  status: ProposalStatus;
  requiredCapability: string;
  humanDiff: ProposalDiffLine[];
  evidence: ProposalEvidenceRef[];
  draftBody: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  executionError: string | null;
}

export interface GroupAgentPanel {
  state: GroupAgentState | null;
  latestRun: GroupAgentRunSummary | null;
  openProposals: GroupAgentProposal[];
  recentDecisions: GroupAgentProposal[];
}

function toProposal(row: Record<string, unknown>): GroupAgentProposal {
  return {
    id: row.id as string,
    kind: row.kind as string,
    title: row.title as string,
    rationale: row.rationale as string,
    risk: row.risk as ProposalRisk,
    status: row.status as ProposalStatus,
    requiredCapability: row.required_capability as string,
    humanDiff: (row.human_diff as ProposalDiffLine[]) ?? [],
    evidence: (row.evidence as ProposalEvidenceRef[]) ?? [],
    draftBody: row.draft_body as string | null,
    payload: (row.payload as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
    decidedByName: row.decided_by_name as string | null,
    decidedAt: row.decided_at as string | null,
    decisionNote: row.decision_note as string | null,
    executionError: row.execution_error as string | null,
  };
}

const PROPOSAL_COLUMNS =
  "id, kind, title, rationale, risk, status, required_capability, human_diff, evidence, draft_body, payload, created_at, expires_at, decided_by_name, decided_at, decision_note, execution_error";

/** Everything the group detail's Agent tab needs, in one hydration. */
export async function getGroupAgentPanel(
  groupId: string,
  agencyId: string,
  client: Db,
): Promise<GroupAgentPanel> {
  const [{ data: stateRow }, { data: aiSettingsRow }, { data: runRows }, { data: openRows }, { data: decidedRows }] =
    await Promise.all([
      client
        .from("departure_group_agent_state")
        .select("mode, last_run_at, next_run_at, consecutive_noop_runs, suppressed_until, suppressed_reason")
        .eq("departure_group_id", groupId)
        .maybeSingle(),
      client
        .from("ai_settings")
        .select("departure_ops_mode")
        .eq("agency_id", agencyId)
        .maybeSingle(),
      client
        .from("departure_ops_runs")
        .select("id, status, created_at, error")
        .eq("departure_group_id", groupId)
        .order("created_at", { ascending: false })
        .limit(1),
      client
        .from("agent_proposals")
        .select(PROPOSAL_COLUMNS)
        .eq("departure_group_id", groupId)
        .in("status", ["PROPOSED", "APPROVED"])
        .order("risk", { ascending: false })
        .order("created_at", { ascending: false }),
      client
        .from("agent_proposals")
        .select(PROPOSAL_COLUMNS)
        .eq("departure_group_id", groupId)
        .in("status", ["EXECUTED", "REJECTED", "SUPERSEDED", "EXPIRED", "FAILED"])
        .order("decided_at", { ascending: false, nullsFirst: false })
        .limit(5),
    ]);

  const stateData = stateRow as {
    mode: DepartureOpsMode;
    last_run_at: string | null;
    next_run_at: string;
    consecutive_noop_runs: number;
    suppressed_until: string | null;
    suppressed_reason: string | null;
  } | null;
  const agencyMode =
    (aiSettingsRow as { departure_ops_mode: DepartureOpsAgencyMode } | null)?.departure_ops_mode ?? "SHADOW";

  const state: GroupAgentState | null = stateData
    ? {
        mode: stateData.mode,
        effectiveMode: stateData.mode === "INHERIT" ? agencyMode : (stateData.mode as DepartureOpsAgencyMode),
        lastRunAt: stateData.last_run_at,
        nextRunAt: stateData.next_run_at,
        consecutiveNoopRuns: stateData.consecutive_noop_runs,
        suppressedUntil: stateData.suppressed_until,
        suppressedReason: stateData.suppressed_reason,
      }
    : null;

  const latestRunRow = (runRows ?? [])[0] as { id: string; status: string; created_at: string; error: string | null } | undefined;
  let latestRun: GroupAgentRunSummary | null = null;
  if (latestRunRow) {
    const { data: findingRows } = await client
      .from("departure_group_agent_findings")
      .select("id, severity, category, headline, detail, corroborating_blocker_id")
      .eq("agent_run_id", latestRunRow.id)
      .order("severity", { ascending: true });
    latestRun = {
      id: latestRunRow.id,
      status: latestRunRow.status,
      createdAt: latestRunRow.created_at,
      error: latestRunRow.error,
      findings: (findingRows ?? []).map((r) => ({
        id: r.id as string,
        severity: r.severity as FindingSeverity,
        category: r.category as FindingCategory,
        headline: r.headline as string,
        detail: r.detail as string,
        corroboratingBlockerId: r.corroborating_blocker_id as string | null,
      })),
    };
  }

  return {
    state,
    latestRun,
    openProposals: (openRows ?? []).map(toProposal),
    recentDecisions: (decidedRows ?? []).map(toProposal),
  };
}

export interface AgencyOpenProposal extends GroupAgentProposal {
  groupId: string;
  groupName: string;
  groupCode: string;
  daysUntilDeparture: number;
}

/** Every open proposal across the agency, newest-risk-first — the Approvals queue's data. */
export async function listAgencyOpenProposals(agencyId: string, client: Db): Promise<AgencyOpenProposal[]> {
  const { data: proposalRows, error } = await client
    .from("agent_proposals")
    .select(`${PROPOSAL_COLUMNS}, departure_group_id`)
    .eq("agency_id", agencyId)
    .in("status", ["PROPOSED", "APPROVED"])
    .order("risk", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to load open proposals: ${error.message}`);

  const rows = proposalRows ?? [];
  if (rows.length === 0) return [];

  const groupIds = [...new Set(rows.map((r) => r.departure_group_id as string))];
  const { data: groupRows, error: groupsError } = await client
    .from("departure_groups")
    .select("id, group_name, group_code, departure_date")
    .in("id", groupIds);
  if (groupsError) throw new Error(`Failed to load groups for proposals: ${groupsError.message}`);

  const groupsById = new Map(
    (groupRows ?? []).map((g) => [g.id as string, g as { group_name: string; group_code: string; departure_date: string }]),
  );
  const today = colomboDayKey();

  return rows.map((row) => {
    const group = groupsById.get(row.departure_group_id as string);
    return {
      ...toProposal(row),
      groupId: row.departure_group_id as string,
      groupName: group?.group_name ?? "Unknown group",
      groupCode: group?.group_code ?? "",
      daysUntilDeparture: group ? daysBetween(today, group.departure_date) : 0,
    };
  });
}

export interface CopilotDailySummary {
  proposalsRaisedToday: number;
  completedToday: number;
  /** `lead_activity` rows of type `GROUP_SELECTED` today — a salesperson used a Manasik Decision match. */
  leadsMatchedToday: number;
}

/**
 * "What Manasik Copilot handled for you today" — the dashboard's plain-
 * language tally (Phase 3 of the Copilot expansion plan), not a fresh
 * capability. Three cheap `head: true` counts, none needing a cross-group
 * or cross-lead join since every source table already carries its own
 * top-level `agency_id`: proposals raised today, proposals a human
 * approved that finished executing today, and — the Leads side, added
 * when "Leads → Groups" was scoped down to a plain audit trail rather than
 * a new proposal kind, since a human already has to click "Use This
 * Offer" for it to happen at all — leads matched to a departure group
 * today via Manasik Decision (`lead_activity.type = 'GROUP_SELECTED'`,
 * written by `selectOfferInStore()` in lib/data/leads-copilot.ts).
 * Deliberately not "3 reminders sent, 2 rooms assigned" — turning
 * free-form `kind`/`type` strings into plain-language verbs per value is a
 * real string-mapping table, not a query, and not worth building until
 * there's a second consumer of it.
 */
export async function getCopilotDailySummary(agencyId: string, client: Db): Promise<CopilotDailySummary> {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const since = startOfToday.toISOString();

  const [raisedResult, completedResult, leadsMatchedResult] = await Promise.all([
    client
      .from("agent_proposals")
      .select("id", { count: "exact", head: true })
      .eq("agency_id", agencyId)
      .gte("created_at", since),
    client
      .from("agent_proposals")
      .select("id", { count: "exact", head: true })
      .eq("agency_id", agencyId)
      .eq("status", "EXECUTED")
      .gte("executed_at", since),
    client
      .from("lead_activity")
      .select("id", { count: "exact", head: true })
      .eq("agency_id", agencyId)
      .eq("type", "GROUP_SELECTED")
      .gte("created_at", since),
  ]);

  return {
    proposalsRaisedToday: raisedResult.count ?? 0,
    completedToday: completedResult.count ?? 0,
    leadsMatchedToday: leadsMatchedResult.count ?? 0,
  };
}

/** Suppresses or un-suppresses the agent on one group — the Agent tab's own control, not gated by any Class-2 capability since it never changes what the agent proposes, only whether it runs at all. */
export async function setGroupAgentSuppression(
  client: Db,
  groupId: string,
  agencyId: string,
  input: { suppressedUntil: string | null; suppressedById: string | null; reason: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await client
    .from("departure_group_agent_state")
    .upsert(
      {
        departure_group_id: groupId,
        agency_id: agencyId,
        suppressed_until: input.suppressedUntil,
        suppressed_by: input.suppressedById,
        suppressed_reason: input.reason,
      },
      { onConflict: "departure_group_id" },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
