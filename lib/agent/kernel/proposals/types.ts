/**
 * Row shapes for the approval subsystem's four tables — see
 * `supabase/migrations/20260919090000_departure_operations_agent.sql` and
 * §6/§9 of docs/modules/departure-operations-agent-implementation-plan.md.
 *
 * Deliberately narrow for now: `kind`, `required_capability`, `category` and
 * `corroborating_blocker_id` are typed as `string` here rather than as the
 * closed unions the plan's executor registry will give them, because that
 * registry — the ~17 proposal kinds, their Zod schemas, their capability
 * mapping — is Phase 3 work and does not exist yet. Widening these to real
 * unions is that phase's job, not this one's; typing them narrower than the
 * database today would just be invented precision this file cannot back up.
 *
 * `agency_id`/`departure_group_id` scoping and every enum that genuinely is
 * closed at the database level (status, risk, severity, event) are typed in
 * full, because those are exactly what the migration's CHECK constraints
 * already commit to.
 */

/* ── departure_group_agent_state ────────────────────────────────────────── */

export type DepartureOpsMode = "INHERIT" | "OFF" | "SHADOW" | "PROPOSE" | "ACTIVE";

/** Same four states minus INHERIT — what `ai_settings.departure_ops_mode` (the agency default) can hold. */
export type DepartureOpsAgencyMode = Exclude<DepartureOpsMode, "INHERIT">;

export interface DepartureGroupAgentStateRow {
  departure_group_id: string;
  agency_id: string;
  mode: DepartureOpsMode;
  last_run_at: string | null;
  next_run_at: string;
  last_fingerprint: string | null;
  last_tier: string | null;
  consecutive_noop_runs: number;
  suppressed_until: string | null;
  suppressed_by: string | null;
  suppressed_reason: string | null;
  created_at: string;
  updated_at: string;
}

/* ── agent_proposals ───────────────────────────────────────────────────── */

export type ProposalRisk = "LOW" | "MEDIUM" | "HIGH";

export type ProposalStatus =
  | "PROPOSED"
  | "APPROVED"
  | "EXECUTED"
  | "REJECTED"
  | "SUPERSEDED"
  | "EXPIRED"
  | "FAILED";

/** One entry of `human_diff` — rendered as a from → to row in the approval card. */
export interface ProposalDiffLine {
  field: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
}

/** One entry of `evidence` — the same shape `DepartureGroupBlocker` already uses, so it links straight into a group tab. */
export interface ProposalEvidenceRef {
  label: string;
  tab: string;
  filter?: string;
}

export interface AgentProposalRow {
  id: string;
  agency_id: string;
  /** Nullable since `_p0_2_agent_proposals_subject_scope` — non-null only for `subject_type === "DEPARTURE_GROUP"`, kept for every query that still filters on it directly (the group Agent tab, guide scoping). Use `subject_type`/`subject_id` for anything module-agnostic. */
  departure_group_id: string | null;
  /** References departure_ops_runs.id, not agent_runs — see the migration's F-DRIFT note. */
  agent_run_id: string | null;

  /** A PermissionModule key — see `lib/access/role-permissions-shared.ts`. */
  module: string;
  /** What `subject_id` refers to — e.g. "DEPARTURE_GROUP", "BOOKING", "QUOTE". */
  subject_type: string;
  subject_id: string;
  /** The AI surface that raised this proposal — Plan §3.7's roster (e.g. "DEPARTURE_OPS", "FINANCE"). */
  surface: string | null;
  source_insight_id: string | null;

  /** A ProposalKind once Phase 3's executor registry defines the closed set. */
  kind: string;
  payload: Record<string, unknown>;
  /** A key of DepartureGroupCapabilities — see lib/access/departure-groups-access.ts. */
  required_capability: string;
  risk: ProposalRisk;

  title: string;
  rationale: string;
  human_diff: ProposalDiffLine[];
  evidence: ProposalEvidenceRef[];
  draft_body: string | null;

  dependency_keys: string[];
  dependency_hash: string;
  fingerprint: string;

  status: ProposalStatus;
  expires_at: string;

  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  executed_at: string | null;
  execution_error: string | null;

  created_at: string;
  updated_at: string;
}

/* ── agent_proposal_events ─────────────────────────────────────────────── */

export type ProposalEventKind =
  | "PROPOSED"
  | "APPROVED"
  | "REJECTED"
  | "SUPERSEDED"
  | "EXPIRED"
  | "EXECUTED"
  | "EXECUTION_FAILED"
  | "EDITED";

export interface AgentProposalEventRow {
  id: string;
  agency_id: string;
  proposal_id: string;
  event: ProposalEventKind;
  actor_id: string | null;
  actor_name: string;
  detail: Record<string, unknown>;
  created_at: string;
}

/* ── departure_group_agent_findings ───────────────────────────────────── */

export type FindingSeverity = "CRITICAL" | "WARNING" | "INFO";

export type FindingCategory =
  | "FLIGHT"
  | "HOTEL"
  | "TRANSPORT"
  | "VISA"
  | "DOCUMENTS"
  | "ROOMING"
  | "PAYMENTS"
  | "GUIDE"
  | "MANIFEST";

export interface DepartureGroupAgentFindingRow {
  id: string;
  agency_id: string;
  departure_group_id: string;
  agent_run_id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  headline: string;
  detail: string;
  /** The buildBlockers() blocker id or readiness item id this finding restates the cause of. Null only when severity is INFO — see the migration's dg_agent_findings_corroboration check. */
  corroborating_blocker_id: string | null;
  linked_task_id: string | null;
  linked_proposal_id: string | null;
  created_at: string;
}

/* ── ai_settings — the departure_ops_* columns this migration adds ───────── */

export interface DepartureOpsAiSettings {
  departure_ops_enabled: boolean;
  departure_ops_mode: DepartureOpsAgencyMode;
  departure_ops_autonomy: Record<string, unknown>;
  departure_ops_max_proposals_per_run: number;
  departure_ops_max_tasks_per_run: number;
  departure_ops_high_risk_roles: string[];
  departure_ops_rejection_cooldown_days: number;
}
