/**
 * Visa queue block (docs/modules/dashboard-role-blocks-spec.md section 3.2) —
 * pure, client-safe.
 *
 * Nothing here defines "ready to submit", "issues" or "at risk": the counts
 * are `computeVisaKpis()` and the per-group figures are
 * `computeGroupVisaBoards()`, the visa module's own derivations over the same
 * `VisaListItem`s its page renders. This only decides which groups need a
 * person today and words the next step.
 *
 * Carries no pilgrim-level data at all — group names and counts only — so the
 * block cannot leak a passport number or a name whatever the role.
 */

import type { VisaQueueData, VisaQueueGroupRow } from "@/lib/types/dashboard";

import { computeGroupVisaBoards, computeVisaKpis, type GroupVisaBoard, type VisaListItem } from "./visa";

/** Top N groups plus a count of the rest — progressive disclosure, spec section 2. */
export const VISA_QUEUE_ROW_LIMIT = 6;

function needsAction(board: GroupVisaBoard): boolean {
  return board.readyToSubmit > 0 || board.reworkRequired > 0 || board.rejected > 0 || board.criticalBlockers.length > 0;
}

/** The single most urgent verb for a group, in the order a visa officer would work it. */
function nextAction(board: GroupVisaBoard): string {
  if (board.rejected > 0) return `Resolve ${board.rejected} rejected`;
  if (board.reworkRequired > 0) return `Rework ${board.reworkRequired}`;
  if (board.readyToSubmit > 0) return `Submit ${board.readyToSubmit}`;
  const blockers = board.criticalBlockers.length;
  return `Review ${blockers} blocker${blockers === 1 ? "" : "s"}`;
}

function toRow(board: GroupVisaBoard): VisaQueueGroupRow {
  return {
    groupId: board.groupId,
    groupName: board.groupName,
    groupCode: board.groupCode,
    daysToDeparture: board.daysToDeparture,
    pilgrimCount: board.pilgrimCount,
    readyToSubmit: board.readyToSubmit,
    submitted: board.submitted,
    reworkRequired: board.reworkRequired,
    rejected: board.rejected,
    issued: board.issued,
    readinessPercent: board.readinessPercent,
    riskBand: board.riskBand,
    action: nextAction(board),
    blockers: board.criticalBlockers,
  };
}

export function buildVisaQueue(allItems: VisaListItem[]): VisaQueueData {
  // A group that has already left has nothing a visa officer can still do.
  const items = allItems.filter((i) => i.daysToDeparture >= 0);
  const kpis = computeVisaKpis(items);
  const actionable = computeGroupVisaBoards(items).filter(needsAction);

  return {
    counts: {
      readyToSubmit: kpis.readyToSubmit,
      submittedPending: kpis.submittedPending,
      visaIssues: kpis.visaIssues,
      issued: kpis.issued,
    },
    // `computeGroupVisaBoards` already sorts soonest departure first.
    groups: actionable.slice(0, VISA_QUEUE_ROW_LIMIT).map(toRow),
    actionableGroupCount: actionable.length,
    totalApplications: items.length,
  };
}
