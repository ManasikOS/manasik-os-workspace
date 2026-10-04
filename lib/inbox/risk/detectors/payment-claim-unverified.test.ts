import { describe, expect, it } from "vitest";

import { customerMessage, facts, MESSAGE_ID } from "../fixtures";
import type { RiskFacts } from "../types";
import { claimedAmount, detectPaymentClaimUnverified } from "./payment-claim-unverified";

const said = (text: string, payments: RiskFacts["payments"] = null) => detectPaymentClaimUnverified(facts({ latest: customerMessage(text), payments }));
const finance = (over: Partial<NonNullable<RiskFacts["payments"]>> = {}) => ({ confirmedTotal: 0, confirmedCount: 0, pendingCount: 0, ...over });

describe("PAYMENT_CLAIM_UNVERIFIED", () => {
  it("fires when a customer says they paid LKR 250 000 and no payment is recorded (the brief's worked example)", () => {
    const finding = said("Assalamu alaikum, I have paid LKR 250,000 to your account yesterday", finance());
    expect(finding).toMatchObject({ code: "PAYMENT_CLAIM_UNVERIFIED", messageId: MESSAGE_ID, confidence: 0.95 });
    expect(finding?.evidence[0].snippet).toContain("250,000");
  });

  it("fires for a claim on a conversation with no booking at all", () => {
    expect(said("we already transferred the advance")).not.toBeNull();
    expect(said("payment done, bank slip attached")).not.toBeNull();
    expect(said("ගෙව්වා මම")).not.toBeNull();
  });

  it("does NOT fire when finance has confirmed a payment that covers the claim", () => {
    expect(said("I have paid LKR 250,000", finance({ confirmedTotal: 250000, confirmedCount: 1 }))).toBeNull();
    expect(said("I have paid", finance({ confirmedTotal: 100000, confirmedCount: 1 }))).toBeNull();
  });

  it("still fires when the confirmed total is short of the amount claimed, or the payment is only pending verification", () => {
    expect(said("I have paid LKR 250,000", finance({ confirmedTotal: 100000, confirmedCount: 1 }))).not.toBeNull();
    expect(said("I have paid LKR 250,000", finance({ pendingCount: 1 }))).not.toBeNull();
  });

  it("near-miss: a question or a promise is not a claim", () => {
    for (const text of ["How do I pay?", "When should I pay the advance?", "I will pay tomorrow", "Can I pay by card", "Have I paid already?", "I want to pay the deposit", "if I pay today is the price fixed"]) expect(said(text), text).toBeNull();
  });

  it("negative: no payment words, and an empty message", () => {
    expect(said("Which hotel is close to the Haram?")).toBeNull();
    expect(said("   ")).toBeNull();
    expect(detectPaymentClaimUnverified(facts())).toBeNull();
  });

  it("reads amounts the way people write them", () => {
    expect([claimedAmount("paid LKR 250,000"), claimedAmount("Rs. 250 000 sent"), claimedAmount("250000/= done"), claimedAmount("paid 250k"), claimedAmount("I paid")]).toEqual([250000, 250000, 250000, 250000, null]);
  });
});
