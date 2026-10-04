import { describe, expect, it } from "vitest";

import {
  canDecideFinanceEvidence,
  canReviewFinanceEvidence,
  matchFinanceEvidenceToPayments,
  toFinanceEvidenceIntakeItem,
  type EvidenceMatchingPayment,
  type EvidenceMatchingSubject,
} from "./evidence-matching";

const EVIDENCE: EvidenceMatchingSubject = {
  id: "evidence-1",
  amount: 45000,
  reference: "TRX-88231",
  date: "2026-09-10",
  bookingId: "booking-1",
  departureGroupId: "group-1",
};

function payment(overrides: Partial<EvidenceMatchingPayment> = {}): EvidenceMatchingPayment {
  return {
    paymentId: "payment-1",
    paymentReference: "PAY-0001",
    referenceNumber: null,
    amount: 45000,
    currency: "LKR",
    paidAt: "2026-09-10T08:30:00.000Z",
    status: "COMPLETED",
    bookingId: "booking-9",
    departureGroupId: "group-9",
    reversesPaymentId: null,
    ...overrides,
  };
}

describe("matchFinanceEvidenceToPayments", () => {
  it("never auto-applies a match, even for a perfect candidate", () => {
    const result = matchFinanceEvidenceToPayments(EVIDENCE, [
      payment({ referenceNumber: "trx-88231", bookingId: "booking-1", departureGroupId: "group-1" }),
    ]);
    expect(result.autoApplied).toBe(false);
    expect(result.outcome).toBe("CANDIDATES");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      paymentId: "payment-1",
      strength: "STRONG",
      reasonCodes: ["REFERENCE_EXACT", "AMOUNT_EXACT", "BOOKING_LINKED", "DEPARTURE_GROUP_LINKED", "DATE_SAME_DAY"],
    });
  });

  it("matches references after ignoring case and punctuation, but never partially", () => {
    const loose = matchFinanceEvidenceToPayments({ ...EVIDENCE, amount: null }, [
      payment({ amount: 1, referenceNumber: "TRX 88-231" }),
    ]);
    expect(loose.candidates[0].reasonCodes).toContain("REFERENCE_EXACT");

    const partial = matchFinanceEvidenceToPayments({ ...EVIDENCE, amount: null }, [
      payment({ amount: 1, referenceNumber: "TRX-88231-B" }),
    ]);
    expect(partial.outcome).toBe("UNMATCHED");
  });

  it("ignores references too short to be distinguishing", () => {
    const result = matchFinanceEvidenceToPayments({ ...EVIDENCE, amount: null, reference: "A1" }, [
      payment({ amount: 1, referenceNumber: "A1" }),
    ]);
    expect(result.outcome).toBe("UNMATCHED");
  });

  it("requires an exact amount or reference; a booking link alone is not a candidate", () => {
    const result = matchFinanceEvidenceToPayments(EVIDENCE, [
      payment({ amount: 20000, bookingId: "booking-1", departureGroupId: "group-1" }),
    ]);
    expect(result).toMatchObject({ outcome: "UNMATCHED", candidates: [] });
  });

  it("tolerates a one-cent amount difference only", () => {
    const within = matchFinanceEvidenceToPayments(EVIDENCE, [payment({ amount: 45000.01 })]);
    const outside = matchFinanceEvidenceToPayments(EVIDENCE, [payment({ amount: 45000.02 })]);
    expect(within.candidates).toHaveLength(1);
    expect(outside.candidates).toHaveLength(0);
  });

  it("ranks reference + amount + booking above amount-only, with date as a tiebreaker signal", () => {
    const result = matchFinanceEvidenceToPayments(EVIDENCE, [
      payment({ paymentId: "amount-only", paidAt: "2026-09-30T00:00:00.000Z" }),
      payment({ paymentId: "near-date", paidAt: "2026-09-13T00:00:00.000Z" }),
      payment({ paymentId: "best", referenceNumber: "TRX-88231", bookingId: "booking-1" }),
    ]);
    expect(result.candidates.map((c) => c.paymentId)).toEqual(["best", "near-date", "amount-only"]);
    expect(result.candidates[1].reasonCodes).toContain("DATE_WITHIN_WINDOW");
    expect(result.candidates[2].reasonCodes).toEqual(["AMOUNT_EXACT"]);
  });

  it("marks evidence ambiguous when the top candidates tie, and still applies nothing", () => {
    const result = matchFinanceEvidenceToPayments(EVIDENCE, [
      payment({ paymentId: "a" }),
      payment({ paymentId: "b", paymentReference: "PAY-0002" }),
    ]);
    expect(result.outcome).toBe("AMBIGUOUS");
    expect(result.autoApplied).toBe(false);
    expect(result.candidates.map((c) => c.paymentId)).toEqual(["a", "b"]);
  });

  it("is not ambiguous when a lower-ranked candidate ties only with another lower one", () => {
    const result = matchFinanceEvidenceToPayments(EVIDENCE, [
      payment({ paymentId: "top", bookingId: "booking-1" }),
      payment({ paymentId: "x" }),
      payment({ paymentId: "y" }),
    ]);
    expect(result.outcome).toBe("CANDIDATES");
    expect(result.candidates[0].paymentId).toBe("top");
  });

  it("orders ties deterministically regardless of input order", () => {
    const first = payment({ paymentId: "b", paidAt: "2026-09-10T00:00:00.000Z" });
    const second = payment({ paymentId: "a", paidAt: "2026-09-10T00:00:00.000Z" });
    const forward = matchFinanceEvidenceToPayments(EVIDENCE, [first, second]);
    const backward = matchFinanceEvidenceToPayments(EVIDENCE, [second, first]);
    expect(forward.candidates.map((c) => c.paymentId)).toEqual(backward.candidates.map((c) => c.paymentId));
  });

  it("excludes reversals and non-live payment statuses", () => {
    const result = matchFinanceEvidenceToPayments(EVIDENCE, [
      payment({ paymentId: "reversal", amount: -45000, reversesPaymentId: "payment-0" }),
      payment({ paymentId: "voided", status: "VOIDED" }),
      payment({ paymentId: "failed", status: "FAILED" }),
      payment({ paymentId: "pending", status: "PENDING_VERIFICATION" }),
    ]);
    expect(result.candidates.map((c) => c.paymentId)).toEqual(["pending"]);
  });

  it("returns UNMATCHED with a reason when the evidence has no usable amount or reference", () => {
    const result = matchFinanceEvidenceToPayments({ ...EVIDENCE, amount: null, reference: null }, [payment()]);
    expect(result).toMatchObject({ outcome: "UNMATCHED", candidates: [], unmatchedReason: "NO_USABLE_EVIDENCE" });
  });

  it("does not match evidence that is no longer pending review", () => {
    const result = matchFinanceEvidenceToPayments({ ...EVIDENCE, status: "DISMISSED" }, [payment()]);
    expect(result).toMatchObject({ outcome: "UNMATCHED", unmatchedReason: "NOT_PENDING_REVIEW" });
  });

  it("does not credit a booking link when the evidence has none", () => {
    const result = matchFinanceEvidenceToPayments({ ...EVIDENCE, bookingId: null, departureGroupId: null }, [
      payment({ bookingId: "booking-1", departureGroupId: "group-1" }),
    ]);
    expect(result.candidates[0].reasonCodes).toEqual(["AMOUNT_EXACT", "DATE_SAME_DAY"]);
  });

  it("gives every reason code a plain-language explanation", () => {
    const result = matchFinanceEvidenceToPayments(EVIDENCE, [payment({ referenceNumber: "TRX-88231" })]);
    expect(result.candidates[0].reasons).toEqual([
      "The receipt reference matches this payment's reference.",
      "The receipt amount equals this payment's amount.",
      "The payment was recorded on the same day as the receipt.",
    ]);
  });
});

describe("canReviewFinanceEvidence", () => {
  it("allows only Finance-capable roles", () => {
    expect(canReviewFinanceEvidence("FINANCE")).toBe(true);
    expect(canReviewFinanceEvidence("ADMIN")).toBe(true);
    expect(canReviewFinanceEvidence("CEO")).toBe(true);
    expect(canReviewFinanceEvidence("OPERATIONS")).toBe(false);
    expect(canReviewFinanceEvidence("MARKETING")).toBe(false);
  });
});

describe("canDecideFinanceEvidence", () => {
  it("mirrors the evidence write policy: only ADMIN and FINANCE may match or dismiss", () => {
    expect(canDecideFinanceEvidence("FINANCE")).toBe(true);
    expect(canDecideFinanceEvidence("ADMIN")).toBe(true);
    expect(canDecideFinanceEvidence("CEO")).toBe(false);
    expect(canDecideFinanceEvidence("OPERATIONS")).toBe(false);
  });
});

describe("toFinanceEvidenceIntakeItem", () => {
  const item = {
    evidence: {
      id: "evidence-1",
      agencyId: "agency-1",
      amount: 45000,
      reference: "TRX-88231",
      date: "2026-09-10",
      bookingId: null,
      departureGroupId: null,
      sourceConversationId: "40000000-0000-4000-8000-000000000004",
      sourceMessageId: "50000000-0000-4000-8000-000000000005",
      createdAt: "2026-09-30T00:00:00.000Z",
    },
    match: matchFinanceEvidenceToPayments(EVIDENCE, []),
  };

  it("links to the source conversation only when the viewer can open the Inbox", () => {
    expect(toFinanceEvidenceIntakeItem(item, true).sourceHref).toBe("/inbox?conversation=40000000-0000-4000-8000-000000000004");
    expect(toFinanceEvidenceIntakeItem(item, false).sourceHref).toBeNull();
  });

  it("has no source link when Inbox retention already removed the conversation", () => {
    expect(toFinanceEvidenceIntakeItem({ ...item, evidence: { ...item.evidence, sourceConversationId: null } }, true).sourceHref).toBeNull();
  });

  it("never carries the agency or raw source identifiers to the browser", () => {
    const dto = toFinanceEvidenceIntakeItem(item, true) as unknown as Record<string, unknown>;
    expect(JSON.stringify(dto)).not.toContain("agency-1");
    expect(dto).not.toHaveProperty("sourceMessageId");
    expect(dto).not.toHaveProperty("sourceConversationId");
  });
});
