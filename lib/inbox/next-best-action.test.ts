import { describe, expect, it } from "vitest";

import type { IntentCode, OfferCheckState, SignalCode, Urgency } from "@/lib/inbox/intelligence/contracts";

import type { InboxIntelligenceData } from "@/lib/inbox/intelligence/rail-view";

import { nextBestActionFor, nextBestActionFromIntelligence, type NextBestActionInput } from "./next-best-action";

const base: NextBestActionInput = { intentCode: null, signalCodes: [], offerCheck: null, hasOffer: false, urgency: "NORMAL" };
const action = (over: Partial<NextBestActionInput>) => nextBestActionFor({ ...base, ...over });
const fresh = "FRESH" as OfferCheckState;

describe("nextBestActionFor", () => {
  it("defaults to drafting a reply", () => {
    expect(action({})).toMatchObject({
      primary: "DRAFT_REPLY",
      reasonCode: "REPLY_RECOMMENDED",
      urgency: "NORMAL",
      destination: { kind: "COMPOSER_DRAFT" },
      availability: { available: true, blocker: null },
    });
    expect(action({ intentCode: "PACKAGE_ENQUIRY" })).toMatchObject({ primary: "DRAFT_REPLY" });
    expect(action({ intentCode: "ITINERARY_QUERY" })).toMatchObject({ primary: "DRAFT_REPLY" });
  });

  it("suggests a quote only when the offer is current", () => {
    expect(action({ intentCode: "PRICE_REQUEST", hasOffer: true, offerCheck: fresh })).toMatchObject({
      primary: "CREATE_QUOTE",
      reasonCode: "LIVE_OFFER_READY",
      destination: { kind: "QUOTE_DRAFT" },
      availability: { available: true },
    });
    expect(action({ intentCode: "PRICE_REQUEST", hasOffer: true, offerCheck: "PRICE_CHANGED" as OfferCheckState })).toMatchObject({
      primary: "REVIEW_OFFER",
      reasonCode: "OFFER_REVIEW_REQUIRED",
      urgency: "HIGH",
      destination: { kind: "OFFER_REVIEW" },
      availability: { available: true },
    });
    expect(action({ intentCode: "PRICE_REQUEST", hasOffer: true, offerCheck: null })).toMatchObject({
      primary: "CREATE_QUOTE",
      reasonCode: "OFFER_CHECK_REQUIRED",
      availability: { available: false, blocker: "Check the matching departure's live price and seats before creating a quote." },
    });
    expect(action({ intentCode: "PRICE_REQUEST", hasOffer: false, offerCheck: fresh })).toMatchObject({
      primary: "CREATE_QUOTE",
      reasonCode: "MATCHING_OFFER_REQUIRED",
      availability: { available: false, blocker: "Find a matching departure with live price and seats before creating a quote." },
    });
  });

  it("sends a payment claim to a payment follow-up, by intent or by signal", () => {
    expect(action({ intentCode: "PAYMENT_CLAIM", urgency: "LOW" })).toMatchObject({
      primary: "CREATE_WORK",
      reasonCode: "PAYMENT_REVIEW_REQUIRED",
      urgency: "HIGH",
      suggestedConversion: "CONVERSATION_PAYMENT_FOLLOW_UP",
      destination: { kind: "CONVERSION_REVIEW", conversionKind: "CONVERSATION_PAYMENT_FOLLOW_UP" },
    });
    expect(action({ signalCodes: ["PAYMENT_CLAIM_UNVERIFIED"] })).toMatchObject({ suggestedConversion: "CONVERSATION_PAYMENT_FOLLOW_UP" });
  });

  it("opens a complaint case for complaints, cancellations and refund requests", () => {
    for (const over of [{ intentCode: "COMPLAINT" as IntentCode }, { intentCode: "CANCELLATION" as IntentCode }, { signalCodes: ["REFUND_REQUEST" as SignalCode] }]) {
      expect(action(over)).toMatchObject({ primary: "CREATE_WORK", suggestedConversion: "CONVERSATION_COMPLAINT_CASE" });
    }
  });

  it("routes visa and document matters to their teams", () => {
    expect(action({ intentCode: "VISA_QUERY" }).suggestedConversion).toBe("CONVERSATION_VISA_TASK");
    expect(action({ intentCode: "DOCUMENT_ISSUE" }).suggestedConversion).toBe("CONVERSATION_DOCUMENT_REQUEST");
    expect(action({ signalCodes: ["SENSITIVE_DOC_RECEIVED"] }).suggestedConversion).toBe("CONVERSATION_DOCUMENT_REQUEST");
  });

  it("puts risk ahead of a price request", () => {
    expect(action({ intentCode: "PRICE_REQUEST", hasOffer: true, offerCheck: fresh, signalCodes: ["PAYMENT_CLAIM_UNVERIFIED"] }).primary).toBe("CREATE_WORK");
  });

  it("preserves a higher conversation urgency and gives every scenario one primary action", () => {
    for (const urgency of ["LOW", "NORMAL", "HIGH", "CRITICAL"] as Urgency[]) {
      const recommendation = action({ intentCode: "VISA_QUERY", urgency });
      expect(recommendation.primary).toBeTruthy();
      expect(recommendation.urgency).toBe(urgency === "CRITICAL" ? "CRITICAL" : urgency === "HIGH" ? "HIGH" : "NORMAL");
    }
  });

  it("always explains itself", () => {
    for (const intentCode of [null, "PRICE_REQUEST", "PAYMENT_CLAIM", "COMPLAINT", "VISA_QUERY"] as Array<IntentCode | null>) {
      expect(action({ intentCode }).reason.length).toBeGreaterThan(10);
    }
  });
});

describe("nextBestActionFromIntelligence", () => {
  const reading = (riskVisible: boolean | undefined) =>
    ({ surfaceEnabled: true, intelligence: null, signals: [{ signalCode: "PAYMENT_CLAIM_UNVERIFIED" }], interventions: [], sourceMessage: null, riskVisible }) as unknown as InboxIntelligenceData;

  it("returns nothing while the reading is loading", () => {
    expect(nextBestActionFromIntelligence(null)).toBeNull();
  });

  it("follows a risk signal once staff can see risk", () => {
    expect(nextBestActionFromIntelligence(reading(true))?.suggestedConversion).toBe("CONVERSATION_PAYMENT_FOLLOW_UP");
  });

  it("puts an open payment review ahead of an ordinary reply", () => {
    const data = reading(true);
    data.signals = [];
    data.interventions = [{ kind: "PAYMENT_CLAIM", status: "OPEN" }] as InboxIntelligenceData["interventions"];
    expect(nextBestActionFromIntelligence(data)).toMatchObject({
      reasonCode: "PAYMENT_REVIEW_REQUIRED",
      suggestedConversion: "CONVERSATION_PAYMENT_FOLLOW_UP",
    });
  });

  it("ignores rule-only risk signals while risk is still hidden from staff", () => {
    expect(nextBestActionFromIntelligence(reading(false))?.primary).toBe("DRAFT_REPLY");
  });

  it("uses the stored conversation urgency", () => {
    const data = reading(true);
    data.intelligence = { urgency: "CRITICAL" } as InboxIntelligenceData["intelligence"];
    expect(nextBestActionFromIntelligence(data)?.urgency).toBe("CRITICAL");
  });
});
