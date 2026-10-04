"use client";

import type { RankedCandidate } from "@/lib/finance/reconciliation-candidates";

import { formatDate, formatExactCurrency } from "../utils";

/** Read-only evidence for a proposed reconciliation match; it never confirms a match. */
export default function ReconciliationCandidateEvidence({
  candidate,
  currency,
}: {
  candidate: RankedCandidate;
  currency: string;
}) {
  const { evidence } = candidate;
  return (
    <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-2">
      <span>Amount: {formatExactCurrency(candidate.amount, currency)} {evidence.amountExact ? "matches exactly" : "does not match exactly"}</span>
      <span>Date: {formatDate(candidate.date)} · {evidence.dateDaysApart === 0 ? "same day" : `${Math.ceil(evidence.dateDaysApart)} days apart`}</span>
      {evidence.reference && <span>Reference: {evidence.reference} {evidence.referenceMatched ? "matches" : "not matched"}</span>}
      {evidence.counterpartyName && <span>Counterparty: {evidence.counterpartyName} {evidence.counterpartyMatched ? "matches" : "not matched"}</span>}
      {evidence.priorPatternMatched && <span className="sm:col-span-2">Prior confirmed pattern: matched</span>}
    </div>
  );
}
