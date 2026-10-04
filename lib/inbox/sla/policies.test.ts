import { describe, expect, it } from "vitest";

import { SLA_INTERVENTION_QUEUE_CODES } from "@/lib/inbox/intelligence/contracts";

import { DEFAULT_SLA_POLICIES, MAX_SLA_MINUTES, SLA_POLICY_QUEUE_CODES, mergeSlaPolicies, slaPolicyInputSchema } from "./policies";

const validPolicyInput = { queueCode: "COMPLAINTS", firstReplyMinutes: 15, resolutionMinutes: null, clock: "ALWAYS", opensInterventionOnBreach: true };

describe("DEFAULT_SLA_POLICIES (Architecture §16 R2)", () => {
  it("states every target in minutes, queue by queue", () => {
    const table = DEFAULT_SLA_POLICIES.map((entry) => [entry.queueCode, entry.firstReplyMinutes, entry.resolutionMinutes, entry.clock]);

    expect(table).toEqual([
      ["ESCALATIONS", 15, 1440, "ALWAYS"],
      ["COMPLAINTS", 15, 1440, "ALWAYS"],
      ["BOOKING_READY", 15, 240, "BUSINESS_HOURS"],
      ["PAYMENT_DISCUSSIONS", 30, 240, "BUSINESS_HOURS"],
      ["NEW_ENQUIRIES", 30, 480, "BUSINESS_HOURS"],
      ["NEEDS_REPLY", 60, null, "BUSINESS_HOURS"],
      ["DEPARTURE_CHANGES", 120, 1440, "BUSINESS_HOURS"],
      ["GROUP_CHANGES", 120, 1440, "BUSINESS_HOURS"],
      ["QUALIFIED", 120, 2880, "BUSINESS_HOURS"],
      ["QUOTE_SENT", 120, 2880, "BUSINESS_HOURS"],
      ["DOCUMENTS", 240, 1440, "BUSINESS_HOURS"],
      ["VISA_ISSUES", 240, 1440, "BUSINESS_HOURS"],
    ]);
  });

  it("opens an intervention on breach for exactly the four queues that are allowed to", () => {
    const opening = DEFAULT_SLA_POLICIES.filter((entry) => entry.opensInterventionOnBreach).map((entry) => entry.queueCode);

    expect([...opening].sort()).toEqual([...SLA_INTERVENTION_QUEUE_CODES].sort());
    expect(opening).toHaveLength(4);
  });

  it("has no policy for the paused queues, so their clocks never run", () => {
    for (const paused of ["WAITING_CUSTOMER", "WAITING_TEAM", "RESOLVED"] as const) {
      expect(SLA_POLICY_QUEUE_CODES).not.toContain(paused);
    }
  });

  it("lists each queue once", () => {
    expect(new Set(SLA_POLICY_QUEUE_CODES).size).toBe(SLA_POLICY_QUEUE_CODES.length);
  });
});

describe("slaPolicyInputSchema", () => {
  it("accepts the smallest and the largest allowed target", () => {
    expect(slaPolicyInputSchema.safeParse({ ...validPolicyInput, firstReplyMinutes: 1 }).success).toBe(true);
    expect(slaPolicyInputSchema.safeParse({ ...validPolicyInput, firstReplyMinutes: MAX_SLA_MINUTES }).success).toBe(true);
  });

  it("accepts null for either target, meaning that target is not tracked", () => {
    const result = slaPolicyInputSchema.safeParse({ ...validPolicyInput, firstReplyMinutes: null, resolutionMinutes: null });

    expect(result.success).toBe(true);
  });

  it("rejects a fractional number of minutes", () => {
    expect(slaPolicyInputSchema.safeParse({ ...validPolicyInput, resolutionMinutes: 90.5 }).success).toBe(false);
  });

  it("applies the same limits to the resolution target as to the first-reply target", () => {
    expect(slaPolicyInputSchema.safeParse({ ...validPolicyInput, resolutionMinutes: 0 }).success).toBe(false);
    expect(slaPolicyInputSchema.safeParse({ ...validPolicyInput, resolutionMinutes: MAX_SLA_MINUTES + 1 }).success).toBe(false);
  });

  it("tells staff in plain words why a target was refused", () => {
    const tooSmall = slaPolicyInputSchema.safeParse({ ...validPolicyInput, firstReplyMinutes: 0 });
    const tooLarge = slaPolicyInputSchema.safeParse({ ...validPolicyInput, firstReplyMinutes: MAX_SLA_MINUTES + 1 });

    expect(tooSmall.success ? [] : tooSmall.error.issues.map((issue) => issue.message)).toContain("Enter at least 1 minute");
    expect(tooLarge.success ? [] : tooLarge.error.issues.map((issue) => issue.message)).toContain("That is longer than 60 days");
  });

  it("rejects a missing flag rather than defaulting it", () => {
    const { opensInterventionOnBreach, ...withoutFlag } = validPolicyInput;
    void opensInterventionOnBreach;

    expect(slaPolicyInputSchema.safeParse(withoutFlag).success).toBe(false);
  });
});

describe("mergeSlaPolicies", () => {
  it("returns exactly the defaults when the agency has no rows", () => {
    const merged = mergeSlaPolicies([]);

    expect([...merged.values()]).toEqual([...DEFAULT_SLA_POLICIES]);
  });

  it("does not mutate the shared defaults when a row overrides one", () => {
    const before = DEFAULT_SLA_POLICIES.map((entry) => ({ ...entry }));

    mergeSlaPolicies([{ queue_code: "NEEDS_REPLY", first_reply_minutes: 5, resolution_minutes: 30, clock: "ALWAYS", opens_intervention_on_breach: true }]);

    expect(DEFAULT_SLA_POLICIES).toEqual(before);
  });

  it("lets a later row for the same queue win", () => {
    const merged = mergeSlaPolicies([
      { queue_code: "QUALIFIED", first_reply_minutes: 10, resolution_minutes: null, clock: "ALWAYS", opens_intervention_on_breach: false },
      { queue_code: "QUALIFIED", first_reply_minutes: 20, resolution_minutes: null, clock: "ALWAYS", opens_intervention_on_breach: false },
    ]);

    expect(merged.get("QUALIFIED")?.firstReplyMinutes).toBe(20);
  });

  it("ignores a row for a paused queue instead of giving it a clock", () => {
    const merged = mergeSlaPolicies([{ queue_code: "WAITING_CUSTOMER", first_reply_minutes: 10, resolution_minutes: null, clock: "ALWAYS", opens_intervention_on_breach: false }]);

    expect(merged.has("WAITING_CUSTOMER")).toBe(false);
  });

  it("ignores a row with an unknown clock and keeps the default for that queue", () => {
    const merged = mergeSlaPolicies([{ queue_code: "VISA_ISSUES", first_reply_minutes: 10, resolution_minutes: null, clock: "WEEKENDS", opens_intervention_on_breach: false }]);

    expect(merged.get("VISA_ISSUES")).toEqual(DEFAULT_SLA_POLICIES.find((entry) => entry.queueCode === "VISA_ISSUES"));
  });
});
