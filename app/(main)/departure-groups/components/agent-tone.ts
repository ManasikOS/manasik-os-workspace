/**
 * Tone mapping for the Departure Operations Agent's own vocabulary — risk,
 * finding severity, proposal status. Kept separate from `../utils.ts`'s
 * tone functions because the types they key on (`ProposalRisk`,
 * `FindingSeverity`, `ProposalStatus`) are agent-specific, not core
 * Departure Groups domain types.
 */

import type { Tone } from "@/lib/ui/tone";
import type {
  FindingSeverity,
  ProposalRisk,
  ProposalStatus,
} from "@/lib/agent/kernel/proposals/types";

export function riskTone(risk: ProposalRisk): Tone {
  switch (risk) {
    case "HIGH":
      return "danger";
    case "MEDIUM":
      return "warning";
    case "LOW":
      return "neutral";
  }
}

export function severityTone(severity: FindingSeverity): Tone {
  switch (severity) {
    case "CRITICAL":
      return "danger";
    case "WARNING":
      return "warning";
    case "INFO":
      return "info";
  }
}

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  PROPOSED: "Awaiting decision",
  APPROVED: "Approved",
  EXECUTED: "Executed",
  REJECTED: "Rejected",
  SUPERSEDED: "Superseded",
  EXPIRED: "Expired",
  FAILED: "Failed",
};

export function proposalStatusTone(status: ProposalStatus): Tone {
  switch (status) {
    case "PROPOSED":
      return "warning";
    case "APPROVED":
      return "info";
    case "EXECUTED":
      return "success";
    case "REJECTED":
      return "neutral";
    case "SUPERSEDED":
    case "EXPIRED":
      return "neutral";
    case "FAILED":
      return "danger";
  }
}
