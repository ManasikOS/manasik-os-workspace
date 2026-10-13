/**
 * Document review block (docs/modules/dashboard-role-blocks-spec.md
 * section 3.2) — pure, client-safe.
 *
 * Counts are `computeDocumentKpis()`, the Documents module's own derivation;
 * "rejected" uses the same `REJECTED` status `computeGroupDocumentBoards()`
 * calls "awaiting rework". This only decides which groups need a person and
 * words the next step.
 *
 * Carries no traveller-level data - group names and counts only - so it needs
 * no masking by `viewSensitiveTravellerData` and cannot leak a name, a
 * passport number or a file name whatever the role.
 */

import type { DocumentReviewData, DocumentReviewGroupRow } from "@/lib/types/dashboard";

import { computeDocumentKpis, computeGroupDocumentBoards, type DocumentListItem } from "./documents";

/** Top N groups plus a count of the rest — progressive disclosure, spec section 2. */
export const DOCUMENT_REVIEW_ROW_LIMIT = 6;

/**
 * Most urgent first, in the order a document officer would work it: a
 * submitted file is waiting on *us*; an expiring passport blocks the visa;
 * a rejected or missing file is waiting on the pilgrim.
 */
function nextAction(row: { awaitingReview: number; expiringSoon: number; rejected: number; missingDocuments: number }): string {
  if (row.awaitingReview > 0) return `Review ${row.awaitingReview}`;
  if (row.expiringSoon > 0) return `Check ${row.expiringSoon} expiring`;
  if (row.rejected > 0) return `Chase ${row.rejected} rejected`;
  return `Chase ${row.missingDocuments} missing`;
}

export function buildDocumentReview(allItems: DocumentListItem[]): DocumentReviewData {
  // A group that has already left has nothing a document officer can still do.
  const items = allItems.filter((i) => i.daysToDeparture >= 0);
  const kpis = computeDocumentKpis(items);

  const itemsByGroup = new Map<string, DocumentListItem[]>();
  for (const item of items) {
    const list = itemsByGroup.get(item.groupId);
    if (list) list.push(item);
    else itemsByGroup.set(item.groupId, [item]);
  }

  // `computeGroupDocumentBoards` sorts soonest departure first.
  const rows: DocumentReviewGroupRow[] = [];
  for (const board of computeGroupDocumentBoards(items)) {
    const groupItems = itemsByGroup.get(board.groupId) ?? [];
    const groupKpis = computeDocumentKpis(groupItems);
    const rejected = groupItems.filter((i) => i.status === "REJECTED").length;
    const counts = {
      awaitingReview: groupKpis.awaitingReview,
      expiringSoon: groupKpis.expiringSoon,
      rejected,
      missingDocuments: groupKpis.missingDocuments,
    };
    if (counts.awaitingReview + counts.expiringSoon + counts.rejected + counts.missingDocuments === 0) continue;

    rows.push({
      groupId: board.groupId,
      groupName: board.groupName,
      groupCode: board.groupCode,
      daysToDeparture: board.daysToDeparture,
      pilgrimCount: board.pilgrimCount,
      readinessPercent: board.readinessPercent,
      ...counts,
      action: nextAction(counts),
      blockers: board.criticalBlockers,
    });
  }

  return {
    counts: {
      missingDocuments: kpis.missingDocuments,
      awaitingReview: kpis.awaitingReview,
      rejected: items.filter((i) => i.status === "REJECTED").length,
      aiFlagged: kpis.aiFlagged,
      expiringSoon: kpis.expiringSoon,
    },
    groups: rows.slice(0, DOCUMENT_REVIEW_ROW_LIMIT),
    actionableGroupCount: rows.length,
    totalDocuments: items.length,
  };
}
