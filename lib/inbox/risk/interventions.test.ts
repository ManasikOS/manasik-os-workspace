import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { INTERVENTION_KINDS, RULE_ONLY_SIGNAL_CODES } from "@/lib/inbox/intelligence/contracts";
import { openInterventionInputSchema } from "@/lib/data/conversation-intelligence-repository";

import { canCloseIntervention, closingCapability, INTERVENTION_FOR_SIGNAL, interventionForSignal } from "./interventions";

describe("signals that become review cards", () => {
  it("every card is valid for the table: headline, guidance, action and kind", () => {
    for (const [code, spec] of Object.entries(INTERVENTION_FOR_SIGNAL)) {
      const parsed = openInterventionInputSchema.safeParse({ conversationId: "3f1d2c4e-5a6b-4c7d-8e9f-000000000001", ...spec });
      expect(parsed.success, code).toBe(true);
      expect(INTERVENTION_KINDS).toContain(spec!.kind);
    }
  });

  it("the money reviews block; the rest ask for a look", () => {
    for (const code of ["PAYMENT_CLAIM_UNVERIFIED", "BANK_DETAIL_MISMATCH", "REFUND_REQUEST", "DISTRESS_LANGUAGE"] as const) expect(interventionForSignal(code)?.severity, code).toBe("BLOCK");
    for (const code of ["STALE_PRICE_QUOTED", "GROUP_FULL_REQUESTED", "PASSPORT_EXPIRY_RISK", "SENSITIVE_DOC_RECEIVED", "MINOR_OR_ASSISTANCE_NEEDED", "UNRECORDED_BOOKING_CLAIM"] as const) expect(interventionForSignal(code)?.severity, code).toBe("REVIEW");
  });

  it("clock and composer signals stay signals: nothing to sign off", () => {
    for (const code of ["WINDOW_CLOSING_SOON", "CONCURRENT_COMPOSER", "LOW_CONFIDENCE_DRAFT"] as const) expect(interventionForSignal(code), code).toBeNull();
  });

  it("the payment claim goes to Finance to verify, and its guidance says not to confirm", () => {
    expect(interventionForSignal("PAYMENT_CLAIM_UNVERIFIED")).toMatchObject({ kind: "PAYMENT_CLAIM", assignedRole: "FINANCE", requiredActionCode: "VERIFY_PAYMENT" });
    expect(interventionForSignal("PAYMENT_CLAIM_UNVERIFIED")?.guidance).toContain("Do not confirm");
  });

  it("each rule-only detector is either a card or deliberately a signal, never forgotten", () => {
    const signalOnly = ["WINDOW_CLOSING_SOON", "CONCURRENT_COMPOSER", "LOW_CONFIDENCE_DRAFT"];
    for (const code of RULE_ONLY_SIGNAL_CODES) expect(Boolean(interventionForSignal(code)) || signalOnly.includes(code), code).toBe(true);
  });
});

describe("who may close a review", () => {
  it("the money reviews only Finance and Admin", () => {
    for (const kind of ["PAYMENT_CLAIM", "BANK_DETAIL_MISMATCH", "REFUND_REQUEST", "FRAUD_CONCERN"] as const) {
      expect(canCloseIntervention("FINANCE", kind), kind).toBe(true);
      expect(canCloseIntervention("ADMIN", kind), kind).toBe(true);
      for (const role of ["MARKETING", "OPERATIONS", "VISA", "GUIDE", "CEO"]) expect(canCloseIntervention(role, kind), `${role} ${kind}`).toBe(false);
    }
  });

  it("the others only the people who answer customers in the Inbox: never Finance, a guide, the CEO or Visa", () => {
    for (const kind of ["GROUP_FULL", "COMPLAINT", "MEDICAL_URGENCY", "DISTRESSED_CUSTOMER"] as const) {
      for (const role of ["ADMIN", "MARKETING", "OPERATIONS"]) expect(canCloseIntervention(role, kind), `${role} ${kind}`).toBe(true);
      for (const role of ["FINANCE", "GUIDE", "CEO", "VISA"]) expect(canCloseIntervention(role, kind), `${role} ${kind}`).toBe(false);
    }
  });

  it("asks for the Inbox permission that fits the review: seeing it for money, replying for the rest", () => {
    expect(closingCapability("PAYMENT_CLAIM")).toBe("viewModule");
    expect(closingCapability("COMPLAINT")).toBe("sendMessage");
  });
});

describe("the judgement flags become cards too (MI4.3)", () => {
  it("fraud and medical urgency block; a complaint and a ruling request ask for a look", () => {
    expect(interventionForSignal("FRAUD_CONCERN")).toMatchObject({ kind: "FRAUD_CONCERN", severity: "BLOCK", assignedRole: "FINANCE" });
    expect(interventionForSignal("MEDICAL_URGENCY")).toMatchObject({ kind: "MEDICAL_URGENCY", severity: "BLOCK", assignedRole: "OPERATIONS" });
    expect(interventionForSignal("COMPLAINT_ESCALATION")).toMatchObject({ kind: "COMPLAINT", severity: "REVIEW" });
    expect(interventionForSignal("RELIGIOUS_RULING_REQUEST")).toMatchObject({ kind: "RELIGIOUS_RULING", severity: "REVIEW" });
  });

  it("their guidance keeps a person from doing what the never-autonomous list forbids", () => {
    expect(interventionForSignal("MEDICAL_URGENCY")?.guidance).toContain("Do not give medical advice");
    expect(interventionForSignal("RELIGIOUS_RULING_REQUEST")?.guidance).toContain("Do not give a ruling");
    expect(interventionForSignal("FRAUD_CONCERN")?.guidance).toContain("Do not send bank details");
  });

  it("the fraud review is a money review: only Finance or Admin can close it", () => {
    expect(canCloseIntervention("MARKETING", "FRAUD_CONCERN")).toBe(false);
    expect(canCloseIntervention("FINANCE", "FRAUD_CONCERN")).toBe(true);
  });
});
