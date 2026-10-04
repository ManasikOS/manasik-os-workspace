import { describe, expect, it } from "vitest";

import { isReconciliationCandidatePrefillEligible, rankCandidates, type RankableCandidate, type TransactionForRanking } from "./reconciliation-candidates";

const TRANSACTION: TransactionForRanking = {
  amount: 45000,
  statementDate: "2026-09-10",
  description: "Transfer from M RAHMAN ref BK-2291",
  reference: "BK-2291",
};

function candidate(overrides: Partial<RankableCandidate>): RankableCandidate {
  return { type: "PAYMENT", id: "c1", label: "BK-2291 · Mohamed Rahman", amount: 45000, date: "2026-09-10", ...overrides };
}

describe("rankCandidates", () => {
  it("bands an exact amount + same date + reference + name match as HIGH", () => {
    const [top] = rankCandidates(TRANSACTION, [candidate({ counterpartyName: "Mohamed Rahman" })]);
    expect(top.confidence).toBe("HIGH");
    expect(top.rationale).toContain("amount exact");
    expect(top.rationale).toContain("same date");
    expect(top.evidence).toMatchObject({
      amountExact: true,
      dateDaysApart: 0,
      reference: "BK-2291",
      referenceMatched: true,
      counterpartyMatched: false,
    });
  });

  it("bands a same-amount-only, far-date, no-reference, no-name-match candidate as MEDIUM at best, never HIGH", () => {
    const [top] = rankCandidates(TRANSACTION, [
      candidate({ id: "c2", date: "2026-09-19", label: "Unrelated booking", counterpartyName: "Someone Else" }),
    ]);
    expect(top.confidence).not.toBe("HIGH");
  });

  it("bands a candidate with no matching signal at all as LOW", () => {
    const [top] = rankCandidates(TRANSACTION, [
      candidate({ id: "c2", date: "2026-12-01", amount: 999, label: "Unrelated booking", counterpartyName: "Someone Else" }),
    ]);
    expect(top.confidence).toBe("LOW");
  });

  it("sorts best candidate first", () => {
    const weak = candidate({ id: "weak", date: "2026-09-18", label: "Weak", counterpartyName: "Nobody" });
    const strong = candidate({ id: "strong", counterpartyName: "Mohamed Rahman" });
    const ranked = rankCandidates(TRANSACTION, [weak, strong]);
    expect(ranked[0].id).toBe("strong");
  });

  it("only reference-matches a candidate whose amount is off by more than the tolerance as a lower score than an exact-amount one", () => {
    const exact = candidate({ id: "exact", counterpartyName: "Mohamed Rahman" });
    const offAmount = candidate({ id: "off", amount: 44000, counterpartyName: "Mohamed Rahman" });
    const ranked = rankCandidates(TRANSACTION, [exact, offAmount]);
    expect(ranked[0].id).toBe("exact");
    expect(ranked.find((r) => r.id === "off")!.rationale).not.toContain("amount exact");
  });

  it("boosts score for a prior confirmed pattern, never on its own fabricating a HIGH band without other signals", () => {
    const weakWithBoost = rankCandidates(
      TRANSACTION,
      [candidate({ id: "c3", date: "2026-09-20", label: "Weak", counterpartyName: "Nobody" })],
      { hasPriorConfirmedPattern: () => true },
    )[0];
    const weakWithoutBoost = rankCandidates(TRANSACTION, [
      candidate({ id: "c3", date: "2026-09-20", label: "Weak", counterpartyName: "Nobody" }),
    ])[0];
    expect(weakWithBoost.score).toBeGreaterThan(weakWithoutBoost.score);
    expect(weakWithBoost.rationale).toContain("matches a previously confirmed pattern for this payer");
  });

  it("uses model-extracted references only as a scoring signal, never as an automatic match", () => {
    const ranked = rankCandidates(TRANSACTION, [candidate({ counterpartyName: "Mohamed Rahman" })], {
      extractedReferences: ["BK-2291"],
    });
    expect(ranked[0].confidence).toBe("HIGH");
    expect(ranked).toHaveLength(1);
  });

  it("only lets a High-confidence candidate prefill review; it never represents a confirmation", () => {
    const [high] = rankCandidates(TRANSACTION, [candidate({ counterpartyName: "Mohamed Rahman" })]);
    const [medium] = rankCandidates(TRANSACTION, [candidate({ id: "medium", date: "2026-09-19", label: "Unrelated", counterpartyName: "Other" })]);

    expect(isReconciliationCandidatePrefillEligible(high)).toBe(true);
    expect(isReconciliationCandidatePrefillEligible(medium)).toBe(false);
  });
});
