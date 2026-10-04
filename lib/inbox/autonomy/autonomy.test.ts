import { describe, expect, it } from "vitest";
import { AUTONOMY_LEVELS } from "@/lib/inbox/intelligence/contracts";
import { NEVER_AUTONOMOUS } from "@/lib/inbox/risk/never-promise";
import { resolveEffectiveAutonomy, resolveEffectiveAutonomyPolicy } from "./level";
import { autonomyDemotionTarget, evaluateAutonomyPromotion, narrowPromotionWindowAllows } from "./promotion";
import { automatedInboxSendGate } from "./send-gate";

describe("Inbox autonomy", () => {
  it("the entitlement ceiling wins over settings", () => expect(resolveEffectiveAutonomy({ entitlementCeiling: "L1", surfaceMode: "ACTIVE", configuredLevel: "L3", conversationHumanActive: false })).toBe("L1"));

  const unrestrictedPolicy = {
    setting: { enabled: true, mode: "ACTIVE", requestedLevel: "L3" },
    entitlementCeiling: "L3",
    channelAvailable: true,
    conversationHumanActive: false,
    evidenceCeiling: "L3",
    channelPolicyEligible: true,
    protectionGateAllowed: true,
  } as const;

  it.each(AUTONOMY_LEVELS)("returns a typed effective policy for requested %s", (requestedLevel) => {
    const policy = resolveEffectiveAutonomyPolicy({
      ...unrestrictedPolicy,
      setting: { ...unrestrictedPolicy.setting, requestedLevel },
    });

    expect(policy).toMatchObject({
      requestedLevel,
      entitlementCeiling: "L3",
      surfaceMode: "ACTIVE",
      channelAvailable: true,
      conversationHumanActive: false,
      evidenceCeiling: "L3",
      channelPolicyEligible: true,
      protectionGateAllowed: true,
      level: requestedLevel,
      limitingAuthority: "AGENCY_SETTING",
      reasonCodes: [],
      reasons: [],
    });
  });

  it("returns the plan ceiling and a stable reason when an agency requests too much autonomy", () => {
    expect(resolveEffectiveAutonomyPolicy({ ...unrestrictedPolicy, entitlementCeiling: "L1" })).toMatchObject({
      level: "L1",
      limitingAuthority: "PLAN_ENTITLEMENT",
      reasonCodes: ["PLAN_CEILING_LIMIT"],
      reasons: ["The agency plan limits Inbox autonomy to L1."],
    });
  });

  it("fails closed when the surface setting is missing", () => {
    expect(resolveEffectiveAutonomyPolicy({ ...unrestrictedPolicy, setting: null })).toMatchObject({
      requestedLevel: null,
      entitlementCeiling: "L3",
      channelAvailable: true,
      conversationHumanActive: false,
      evidenceCeiling: "L3",
      channelPolicyEligible: true,
      protectionGateAllowed: true,
      level: "L0",
      limitingAuthority: "POLICY_INPUT",
      reasonCodes: ["SETTING_MISSING"],
    });
  });

  it.each([
    { setting: { enabled: true, mode: "ACTIVE", requestedLevel: "L4" }, entitlementCeiling: "L3" },
    { setting: { enabled: true, mode: "AUTOMATIC", requestedLevel: "L3" }, entitlementCeiling: "L3" },
    { setting: { enabled: "yes", mode: "ACTIVE", requestedLevel: "L3" }, entitlementCeiling: "L3" },
    { setting: { enabled: true, mode: "ACTIVE", requestedLevel: "L3" }, entitlementCeiling: "ENTERPRISE" },
  ])("fails closed for malformed policy facts: $setting", ({ setting, entitlementCeiling }) => {
    expect(resolveEffectiveAutonomyPolicy({ ...unrestrictedPolicy, setting, entitlementCeiling })).toMatchObject({
      level: "L0",
      limitingAuthority: "POLICY_INPUT",
      reasonCodes: ["POLICY_FACTS_MALFORMED"],
    });
  });

  it.each([
    {
      patch: { setting: { enabled: false, mode: "ACTIVE", requestedLevel: "L3" } },
      level: "L0",
      authority: "SURFACE_SETTING",
      code: "SURFACE_DISABLED",
    },
    {
      patch: { setting: { enabled: true, mode: "PROPOSE", requestedLevel: "L3" } },
      level: "L1",
      authority: "SURFACE_MODE",
      code: "SURFACE_MODE_LIMIT",
    },
    {
      patch: { channelAvailable: false },
      level: "L0",
      authority: "CHANNEL_AVAILABILITY",
      code: "CHANNEL_UNAVAILABLE",
    },
    {
      patch: { conversationHumanActive: true },
      level: "L0",
      authority: "HUMAN_OWNERSHIP",
      code: "HUMAN_OWNERSHIP_ACTIVE",
    },
    {
      patch: { evidenceCeiling: "L1" },
      level: "L1",
      authority: "PROMOTION_EVIDENCE",
      code: "EVIDENCE_LIMIT",
    },
    {
      patch: { channelPolicyEligible: false },
      level: "L0",
      authority: "CHANNEL_POLICY",
      code: "CHANNEL_POLICY_BLOCKED",
    },
    {
      patch: { protectionGateAllowed: false },
      level: "L0",
      authority: "PROTECTION_GATE",
      code: "PROTECTION_GATE_BLOCKED",
    },
  ])("clamps unsafe policy facts through $authority", ({ patch, level, authority, code }) => {
    expect(resolveEffectiveAutonomyPolicy({ ...unrestrictedPolicy, ...patch })).toMatchObject({
      level,
      limitingAuthority: authority,
      reasonCodes: [code],
    });
  });
  it("7 days with 150 decisions is not promotion evidence", () => expect(evaluateAutonomyPromotion({ observedDays: 7, decisions: 150, triageAccuracy: 0.9, paymentClaimPrecision: 0.98, denyListViolations: 0, rejectionRate: 0.1, rejectionThreshold: 0.4 }).eligible).toBe(false));
  it("promotes only when every R5 threshold holds", () => expect(evaluateAutonomyPromotion({ observedDays: 7, decisions: 200, triageAccuracy: 0.85, paymentClaimPrecision: 0.95, denyListViolations: 0, rejectionRate: 0.39, rejectionThreshold: 0.4 }).eligible).toBe(true));
  it("demotes one level with the same threshold reasons", () => expect(autonomyDemotionTarget("L2", { observedDays: 7, decisions: 220, triageAccuracy: 0.9, paymentClaimPrecision: 0.98, denyListViolations: 0, rejectionRate: 0.4, rejectionThreshold: 0.4 })).toMatchObject({ level: "L1", reasons: [expect.stringContaining("rejection rate")] }));
  it("the first fortnight allows only narrow out-of-hours actions", () => {
    const promotedAt = new Date("2026-09-20"); const now = new Date("2026-09-21");
    expect(narrowPromotionWindowAllows({ promotedAt, now, outsideOfficeHours: false, action: "ACKNOWLEDGEMENT" })).toBe(false);
    expect(narrowPromotionWindowAllows({ promotedAt, now, outsideOfficeHours: true, action: "ACKNOWLEDGEMENT" })).toBe(true);
  });
  it("L2 sends only from the approved set", () => expect(automatedInboxSendGate({ level: "L2", text: "We received your question.", source: "GENERATED", openReviews: [] }).allowed).toBe(false));
  it("every never-autonomous item is refused at L3", () => {
    const examples: Record<string, string> = { CONFIRM_PAYMENT: "Your payment is confirmed.", PROMISE_VISA_APPROVAL: "We guarantee your visa.", GRANT_DISCOUNT: "We give you a discount.", CONFIRM_UNAVAILABLE_INVENTORY: "Those seats are guaranteed.", MATERIAL_BOOKING_CHANGE: "We changed your booking.", SEND_UNAPPROVED_BANK_DETAILS: "Pay bank account 123456789.", COMMIT_REFUND_OR_CANCELLATION: "We will refund you.", RELIGIOUS_RULING: "This is halal.", HEALTH_OR_SAFETY_ADVICE: "You should take your medicine.", CLOSE_COMPLAINT: "Your complaint is closed.", MARKETING_BROADCAST: "We will send this offer to all customers." };
    for (const item of NEVER_AUTONOMOUS) for (const level of AUTONOMY_LEVELS) expect(automatedInboxSendGate({ level, text: examples[item.id], source: "INTAKE_FLOW", openReviews: [] }).allowed, item.id).toBe(false);
  });
});
