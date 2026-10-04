import { describe, expect, it } from "vitest";

import type { OpenReview } from "@/lib/inbox/risk/protection-gate";

import { automatedInboxSendGate } from "./send-gate";

const SAFE_TEXT = "We received your question and a colleague will reply shortly.";
const PAYMENT_CONFIRMATION_TEXT = "We have received your payment, thank you.";

const blockingPaymentReview: OpenReview = { kind: "PAYMENT_CLAIM", severity: "BLOCK", headline: "Payment claim needs Finance" };
const nonBlockingSlaReview: OpenReview = { kind: "SLA_BREACH", severity: "REVIEW", headline: "Reply is overdue" };

describe("automatedInboxSendGate", () => {
  describe("autonomy levels that need a person", () => {
    it.each(["L0", "L1"] as const)("refuses every source at %s, even for safe approved text", (level) => {
      const decision = automatedInboxSendGate({ level, text: SAFE_TEXT, source: "APPROVED_TEMPLATE", openReviews: [] });

      expect(decision.allowed).toBe(false);
      expect(decision.reasons).toEqual(["This autonomy level cannot send without human approval."]);
    });
  });

  describe("L2 approved-set rule", () => {
    it.each(["APPROVED_TEMPLATE", "APPROVED_ANSWER"] as const)("allows safe text from %s", (source) => {
      const decision = automatedInboxSendGate({ level: "L2", text: SAFE_TEXT, source, openReviews: [] });

      expect(decision).toEqual({ allowed: true, reasons: [] });
    });

    it.each(["GENERATED", "INTAKE_FLOW"] as const)("refuses safe text from %s", (source) => {
      const decision = automatedInboxSendGate({ level: "L2", text: SAFE_TEXT, source, openReviews: [] });

      expect(decision.allowed).toBe(false);
      expect(decision.reasons).toEqual(["L2 may send only approved templates or approved cached answers."]);
    });
  });

  describe("L3", () => {
    it.each(["APPROVED_TEMPLATE", "APPROVED_ANSWER", "INTAKE_FLOW", "GENERATED"] as const)("allows safe text from %s", (source) => {
      const decision = automatedInboxSendGate({ level: "L3", text: SAFE_TEXT, source, openReviews: [] });

      expect(decision).toEqual({ allowed: true, reasons: [] });
    });
  });

  describe("protection gate is applied at every level", () => {
    it.each(["L2", "L3"] as const)("refuses a payment confirmation at %s even from an approved template", (level) => {
      const decision = automatedInboxSendGate({ level, text: PAYMENT_CONFIRMATION_TEXT, source: "APPROVED_TEMPLATE", openReviews: [] });

      expect(decision.allowed).toBe(false);
      expect(decision.reasons[0]).toContain("confirm that a payment was received");
    });

    it("refuses safe text while a blocking review is open", () => {
      const decision = automatedInboxSendGate({ level: "L3", text: SAFE_TEXT, source: "APPROVED_TEMPLATE", openReviews: [blockingPaymentReview] });

      expect(decision.allowed).toBe(false);
      expect(decision.reasons).toHaveLength(1);
      expect(decision.reasons[0]).toContain("Payment claim needs Finance");
    });

    it("ignores an open review that is not blocking", () => {
      const decision = automatedInboxSendGate({ level: "L3", text: SAFE_TEXT, source: "APPROVED_TEMPLATE", openReviews: [nonBlockingSlaReview] });

      expect(decision.allowed).toBe(true);
    });
  });

  describe("entitlementCeiling — the gate re-applies the plan's cap itself, not just the caller's", () => {
    it("refuses an L3-source send when the level exceeds the given ceiling, even if the caller forgot to cap it first", () => {
      const decision = automatedInboxSendGate({ level: "L3", text: SAFE_TEXT, source: "GENERATED", openReviews: [], entitlementCeiling: "L1" });

      expect(decision.allowed).toBe(false);
      expect(decision.reasons).toEqual(["This autonomy level cannot send without human approval."]);
    });

    it("is a no-op when the caller already capped level at or below the ceiling", () => {
      const decision = automatedInboxSendGate({ level: "L2", text: SAFE_TEXT, source: "APPROVED_TEMPLATE", openReviews: [], entitlementCeiling: "L3" });

      expect(decision).toEqual({ allowed: true, reasons: [] });
    });

    it("trusts level as given when no ceiling is passed at all (unchanged behaviour for older callers)", () => {
      const decision = automatedInboxSendGate({ level: "L3", text: SAFE_TEXT, source: "GENERATED", openReviews: [] });

      expect(decision).toEqual({ allowed: true, reasons: [] });
    });
  });

  describe("reasons accumulate rather than short-circuit", () => {
    it("reports the level, source and protection reasons together", () => {
      const decision = automatedInboxSendGate({ level: "L1", text: PAYMENT_CONFIRMATION_TEXT, source: "GENERATED", openReviews: [blockingPaymentReview] });

      expect(decision.allowed).toBe(false);
      expect(decision.reasons).toHaveLength(3);
      expect(decision.reasons).toContain("This autonomy level cannot send without human approval.");
    });

    it("does not add the L2 source reason at L3 for generated text", () => {
      const decision = automatedInboxSendGate({ level: "L3", text: PAYMENT_CONFIRMATION_TEXT, source: "GENERATED", openReviews: [] });

      expect(decision.reasons.some((reason) => reason.includes("L2 may send only"))).toBe(false);
    });
  });
});
