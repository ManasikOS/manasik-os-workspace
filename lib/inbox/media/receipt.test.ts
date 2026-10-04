import { describe, expect, it } from "vitest";

import {
  financeEvidenceItemHref,
  receiptFinancePromotionAvailability,
  settleReceiptFinancePromotion,
} from "@/lib/finance/finance-evidence";

import {
  receiptReview,
  type ReceiptCandidate,
} from "./receipt";

const candidate = (over: Partial<ReceiptCandidate> = {}): ReceiptCandidate => ({ amount: 10_000, reference: "TX1", paidAt: "2026-09-20", confidence: 0.8, ...over });

describe("receiptReview", () => {
  it("opens a blocking payment-claim review that points at the proof attachment", () => {
    expect(receiptReview(candidate(), "att-1")).toEqual({
      paymentStateMutation: null,
      intervention: { kind: "PAYMENT_CLAIM", severity: "BLOCK", proofAttachmentId: "att-1", candidate: candidate() },
    });
  });

  it("never changes payment state, however confident the reading", () => {
    expect(receiptReview(candidate({ confidence: 1 }), "att-1").paymentStateMutation).toBeNull();
  });

  it("stays blocking at full confidence, because only a person can confirm a payment", () => {
    expect(receiptReview(candidate({ confidence: 1 }), "att-1").intervention.severity).toBe("BLOCK");
  });

  it("stays blocking when the reading found nothing at all", () => {
    const result = receiptReview({ amount: null, reference: null, paidAt: null, confidence: 0 }, "att-2");

    expect(result.intervention).toMatchObject({ kind: "PAYMENT_CLAIM", severity: "BLOCK", proofAttachmentId: "att-2", candidate: { amount: null, reference: null, paidAt: null } });
  });

  it("passes the candidate through unchanged, including a zero amount", () => {
    const zero = candidate({ amount: 0 });

    expect(receiptReview(zero, "att-1").intervention.candidate).toEqual(zero);
  });

  it("does not modify the candidate it is given", () => {
    const frozen = Object.freeze(candidate());

    expect(() => receiptReview(frozen, "att-1")).not.toThrow();
  });

  it("gives the same answer every time for the same input", () => {
    expect(receiptReview(candidate(), "att-1")).toEqual(receiptReview(candidate(), "att-1"));
  });
});

describe("receiptFinancePromotionAvailability", () => {
  const eligibleReceipt = {
    kind: "RECEIPT",
    status: "REVIEW_REQUIRED",
    mimeType: "image/jpeg",
    canOpenFinanceReview: true,
  } as const;

  it("allows an authorised reviewer to copy supported receipt evidence", () => {
    expect(receiptFinancePromotionAvailability(eligibleReceipt)).toEqual({
      state: "READY",
    });
  });

  it("makes a denied supported receipt explicit without exposing the action", () => {
    expect(
      receiptFinancePromotionAvailability({
        ...eligibleReceipt,
        canOpenFinanceReview: false,
      }),
    ).toEqual({
      state: "DENIED",
      reason: "Finance review access is required to copy this receipt.",
    });
  });

  it.each([
    { kind: "PASSPORT", status: "REVIEW_REQUIRED", mimeType: "image/jpeg" },
    { kind: "RECEIPT", status: "PENDING", mimeType: "image/jpeg" },
    { kind: "RECEIPT", status: "FAILED", mimeType: "image/jpeg" },
    { kind: "RECEIPT", status: "REVIEW_REQUIRED", mimeType: "image/gif" },
    { kind: "RECEIPT", status: "REVIEW_REQUIRED", mimeType: null },
  ])("hides the action for unsupported media: $kind / $status / $mimeType", (input) => {
    expect(
      receiptFinancePromotionAvailability({
        ...input,
        canOpenFinanceReview: true,
      }),
    ).toEqual({ state: "HIDDEN" });
  });

  it.each([
    "application/pdf",
    "image/heic",
    "image/jpeg",
    "image/png",
    "image/webp",
  ])("supports %s receipt evidence", (mimeType) => {
    expect(
      receiptFinancePromotionAvailability({ ...eligibleReceipt, mimeType }),
    ).toEqual({ state: "READY" });
  });

  it("accepts a MIME type with parameters using the same rule as Finance storage", () => {
    expect(
      receiptFinancePromotionAvailability({
        ...eligibleReceipt,
        mimeType: "image/jpeg; charset=binary",
      }),
    ).toEqual({ state: "READY" });
  });

  it("builds a deep link to the copied Finance evidence item", () => {
    expect(
      financeEvidenceItemHref("40000000-0000-4000-8000-000000000004"),
    ).toBe(
      "/finance?view=receivables&subview=payments&evidenceId=40000000-0000-4000-8000-000000000004",
    );
  });

  it("maps a successful copy to an unambiguous completed state", () => {
    expect(
      settleReceiptFinancePromotion({
        ok: true,
        evidenceId: "40000000-0000-4000-8000-000000000004",
        message:
          "Receipt copied for Finance review. No payment was created or verified.",
      }),
    ).toEqual({
      state: "COPIED",
      evidenceId: "40000000-0000-4000-8000-000000000004",
      message:
        "Receipt copied for Finance review. No payment was created or verified.",
    });
  });

  it("maps a failed copy to a recoverable error state", () => {
    expect(
      settleReceiptFinancePromotion({
        ok: false,
        error: "Could not copy the receipt to Finance. Try again.",
      }),
    ).toEqual({
      state: "ERROR",
      message: "Could not copy the receipt to Finance. Try again.",
    });
  });
});
