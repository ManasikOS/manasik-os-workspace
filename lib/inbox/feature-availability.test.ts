import { describe, expect, it } from "vitest";

import type { Entitlements } from "@/lib/billing/entitlements";
import { inboxFeatureIsAvailable, resolveInboxFeatureAvailability } from "./feature-availability";

const entitlement = (planCode: string, features: Entitlements["features"], autonomyCeiling: Entitlements["autonomyCeiling"] = "L1"): Entitlements => ({
  planCode, aiConversationAllowance: 100, autonomyCeiling, overageOptIn: false, usage: 0, features, grandfathered: planCode === "ENTERPRISE",
});

describe("resolveInboxFeatureAvailability — FIX9", () => {
  it.each([
    ["STARTER", { payment_claim_risk: true }, false, "NONE"],
    ["GROWTH", { offer_matching: true, identity_resolution: true, sla: true, media_intelligence: true, owner_panel: "read_only" }, true, "READ_ONLY"],
    ["PROFESSIONAL", { offer_matching: true, identity_resolution: true, sla: true, media_intelligence: true, answer_cache: true, owner_panel: true, audit_export: true }, true, "FULL"],
    ["ENTERPRISE", { all: true }, true, "FULL"],
  ] as const)("uses %s plan features as the one entitlement input", (planCode, features, offerMatching, ownerPanel) => {
    const availability = resolveInboxFeatureAvailability({ entitlements: entitlement(planCode, features), inboxQueuesV2: false });
    expect(availability.offerMatching).toBe(offerMatching);
    expect(availability.ownerPanel).toBe(ownerPanel);
    expect(availability.queues).toBe(false);
  });

  it("keeps a grandfathered agency entitled by its assigned plan", () => {
    expect(resolveInboxFeatureAvailability({ entitlements: entitlement("ENTERPRISE", { all: true }, "L3"), inboxQueuesV2: true }).answerCache).toBe(true);
  });

  it("does not turn baseline human replies or deterministic payment protection into paid features", () => {
    const availability = resolveInboxFeatureAvailability({ entitlements: null, inboxQueuesV2: false });
    expect(inboxFeatureIsAvailable(availability, "OFFER_MATCHING")).toBe(false);
    expect(availability.autonomyCeiling).toBe("L0");
  });
});
