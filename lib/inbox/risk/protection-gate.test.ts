import { describe, expect, it } from "vitest";

import type { InterventionKind } from "@/lib/inbox/intelligence/contracts";

import { AUTONOMY_LEVELS } from "./never-promise";
import { evaluateProtection, INTERVENTION_GUARDS, PROTECTION_AUDIENCES, refusalMessage, type OpenReview } from "./protection-gate";

const review = (kind: InterventionKind, severity: OpenReview["severity"] = "BLOCK"): OpenReview => ({ kind, severity, headline: `${kind} review` });
const CONFIRMS_PAYMENT = "Good news, we have received your payment. Thank you!";
const ACKNOWLEDGES = "Thank you for letting us know. A colleague will check your payment and come back to you.";

describe("an open PAYMENT_CLAIM review (the brief's worked example)", () => {
  const open = [review("PAYMENT_CLAIM")];

  it("blocks a draft that confirms the payment", () => {
    const decision = evaluateProtection({ text: CONFIRMS_PAYMENT, audience: "AI_DRAFT", openReviews: open });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.map((reason) => reason.code)).toContain("OPEN_REVIEW_GUARD");
  });

  it("blocks a person's own message that confirms the payment, until Finance resolves the review", () => {
    const decision = evaluateProtection({ text: CONFIRMS_PAYMENT, audience: "STAFF_SEND", openReviews: open });
    expect(decision.allowed).toBe(false);
    expect(refusalMessage(decision)).toContain("PAYMENT_CLAIM review");
    expect(refusalMessage(decision)).toContain("Resolve it first");
  });

  it("lets a draft or message that only acknowledges through", () => {
    for (const audience of ["AI_DRAFT", "STAFF_SEND"] as const) expect(evaluateProtection({ text: ACKNOWLEDGES, audience, openReviews: open }).allowed, audience).toBe(true);
  });

  it("resolving the review unblocks: with no open review a person may confirm", () => {
    expect(evaluateProtection({ text: CONFIRMS_PAYMENT, audience: "STAFF_SEND", openReviews: [] }).allowed).toBe(true);
  });

  it("only a BLOCK review guards: a REVIEW-severity one never stops a send", () => {
    expect(evaluateProtection({ text: CONFIRMS_PAYMENT, audience: "STAFF_SEND", openReviews: [review("PAYMENT_CLAIM", "REVIEW")] }).allowed).toBe(true);
  });
});

describe("the audiences", () => {
  it("names exactly three", () => {
    expect([...PROTECTION_AUDIENCES]).toEqual(["AUTOMATED_SEND", "AI_DRAFT", "STAFF_SEND"]);
  });

  it("an automated send that says something never-autonomous is refused with no review open at all", () => {
    const decision = evaluateProtection({ text: "We will refund you in full.", audience: "AUTOMATED_SEND", openReviews: [] });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons[0]).toMatchObject({ code: "NEVER_AUTONOMOUS", entry: "COMMIT_REFUND_OR_CANCELLATION" });
  });

  it("an AI draft is held to the never-autonomous list too", () => {
    expect(evaluateProtection({ text: "We can give you a discount.", audience: "AI_DRAFT", openReviews: [] }).allowed).toBe(false);
  });

  it("a person is NOT held to the never-autonomous list: the list is about automation", () => {
    expect(evaluateProtection({ text: "We can give you a discount.", audience: "STAFF_SEND", openReviews: [] }).allowed).toBe(true);
    expect(evaluateProtection({ text: "We will refund you in full.", audience: "STAFF_SEND", openReviews: [] }).allowed).toBe(true);
  });

  it("an automated send is refused outright while ANY blocking review is open, even an innocent one", () => {
    const decision = evaluateProtection({ text: "Assalamu alaikum, how can I help?", audience: "AUTOMATED_SEND", openReviews: [review("DISTRESSED_CUSTOMER")] });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons[0].code).toBe("OPEN_BLOCKING_REVIEW");
  });

  it("but not while only a REVIEW-severity card is open", () => {
    expect(evaluateProtection({ text: "How can I help?", audience: "AUTOMATED_SEND", openReviews: [review("STALE_PRICE", "REVIEW")] }).allowed).toBe(true);
  });

  it("no autonomy level changes any answer", () => {
    const text = "Your payment is confirmed";
    for (const audience of PROTECTION_AUDIENCES) {
      const answers = AUTONOMY_LEVELS.map((level) => JSON.stringify(evaluateProtection({ text, audience, openReviews: [review("PAYMENT_CLAIM")], level })));
      expect(new Set(answers).size, audience).toBe(1);
    }
  });
});

describe("each review guards what it should", () => {
  const sayings: Array<[InterventionKind, string]> = [
    ["REFUND_REQUEST", "We will refund you in full."],
    ["COMPLAINT", "Your complaint is resolved."],
    ["GROUP_FULL", "Your seats are guaranteed."],
    ["MEDICAL_URGENCY", "It is safe for you to travel with your condition."],
    ["RELIGIOUS_RULING", "That is permissible."],
    ["BANK_DETAIL_MISMATCH", "Please transfer to bank account 8001 2345 6789."],
    ["FRAUD_CONCERN", "Your payment is confirmed."],
  ];
  for (const [kind, text] of sayings) {
    it(`${kind} stops a person saying it`, () => {
      expect(evaluateProtection({ text, audience: "STAFF_SEND", openReviews: [review(kind)] }).allowed).toBe(false);
      expect(evaluateProtection({ text, audience: "STAFF_SEND", openReviews: [] }).allowed).toBe(true);
    });
  }

  it("every kind of review has an entry, so none is forgotten", () => {
    expect(Object.keys(INTERVENTION_GUARDS)).toHaveLength(15);
  });

  it("a review does not guard what it does not name", () => {
    expect(evaluateProtection({ text: CONFIRMS_PAYMENT, audience: "STAFF_SEND", openReviews: [review("STALE_PRICE")] }).allowed).toBe(true);
  });
});
