/**
 * The staged buffer — D8 of
 * docs/modules/departure-operations-agent-implementation-plan.md. Every write a
 * tool call makes during a turn lands here, in memory, never touching the
 * database. Nothing commits until `submit_review` fires and the guardrails
 * (§11) have run over the buffer; a turn that ends without calling
 * `submit_review` persists nothing but telemetry (`run.ts` enforces this by
 * simply never calling `commitStagedBuffer` unless `submitted` is set).
 *
 * Each staged item carries a `stagedId` (`"task-1"`, `"finding-2"`, …) so
 * the model can cross-reference within one turn — a finding created after
 * a proposal can name it in `linkedProposalStagedId` — before any of it has
 * a real database id.
 */

import type { CreateGroupTaskInput } from "@/lib/data/departure-groups-tasks";
import type { UpdateReadinessItemInput } from "@/lib/data/departure-groups-readiness";
import type { FindingCategory, FindingSeverity } from "@/lib/agent/kernel/proposals/types";
import type { CreateProposalInput } from "@/lib/agent/kernel/proposals/service";

export interface StagedTask {
  stagedId: string;
  input: Omit<CreateGroupTaskInput, "departureGroupId">;
}

export interface StagedTaskReassignment {
  stagedId: string;
  taskId: string;
  ownerName: string;
  ownerId: string | null;
}

export interface StagedTaskStatusUpdate {
  stagedId: string;
  taskId: string;
  status: "IN_PROGRESS" | "COMPLETE";
}

export interface StagedReadinessItemUpdate {
  stagedId: string;
  input: Omit<UpdateReadinessItemInput, "departureGroupId" | "status" | "required">;
}

export interface StagedFinding {
  stagedId: string;
  severity: FindingSeverity;
  category: FindingCategory;
  headline: string;
  detail: string;
  corroboratingBlockerId: string | null;
  linkedTaskStagedId: string | null;
  linkedProposalStagedId: string | null;
}

export interface StagedProposal {
  stagedId: string;
  input: Omit<CreateProposalInput, "agencyId" | "departureGroupId" | "agentRunId">;
}

export interface StagedReview {
  summary: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  tierAssessment: string;
}

export interface StagedBuffer {
  tasks: StagedTask[];
  taskReassignments: StagedTaskReassignment[];
  taskStatusUpdates: StagedTaskStatusUpdate[];
  readinessItemUpdates: StagedReadinessItemUpdate[];
  findings: StagedFinding[];
  proposals: StagedProposal[];
  /** Set by the terminal `submit_review` tool. Null means the turn never called it. */
  submitted: StagedReview | null;
}

export function newStagedBuffer(): StagedBuffer {
  return {
    tasks: [],
    taskReassignments: [],
    taskStatusUpdates: [],
    readinessItemUpdates: [],
    findings: [],
    proposals: [],
    submitted: null,
  };
}

/**
 * A per-turn, cross-referenceable id generator. Deliberately a factory, not
 * module-level state — this runtime serves many concurrent reviews, and a
 * shared counter would race between them. `tools/registry.ts` creates one
 * instance per turn and closes every tool's `run()` over it.
 */
export function createStagedIdGenerator(): (kind: string) => string {
  let counter = 0;
  return (kind: string) => {
    counter += 1;
    return `${kind}-${counter}`;
  };
}
