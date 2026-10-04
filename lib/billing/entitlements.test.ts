import { describe, expect, it } from "vitest";
import { resolveAiDegradation, type Entitlements } from "./entitlements";

const plan = (usage: number, overageOptIn = false): Entitlements => ({ planCode: "GROWTH", aiConversationAllowance: 100, autonomyCeiling: "L2", overageOptIn, usage, features: {}, grandfathered: false });
describe("AI degradation", () => {
  it.each([[79, "FULL"], [80, "ON_DEMAND_DRAFTS"], [100, "RULES_AND_MATCHING_ONLY"], [120, "DETERMINISTIC_ONLY"]] as const)("maps %s%% to %s", (usage, expected) => expect(resolveAiDegradation(plan(usage))).toBe(expected));
  it("keeps overage model calls until the hard 120% stop", () => expect(resolveAiDegradation(plan(110, true))).toBe("ON_DEMAND_DRAFTS"));
});
