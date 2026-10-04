import { describe, expect, it } from "vitest";

import { staffAvailabilityInputSchema } from "./availability";

const input = { staffId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", startsAt: "2026-09-21T09:00:00.000Z", endsAt: "2026-09-21T17:00:00.000Z", kind: "SHIFT" };

describe("staffAvailabilityInputSchema", () => {
  it("accepts a bounded shift or leave and rejects invalid time windows", () => {
    expect(staffAvailabilityInputSchema.safeParse(input).success).toBe(true);
    expect(staffAvailabilityInputSchema.safeParse({ ...input, kind: "LEAVE" }).success).toBe(true);
    expect(staffAvailabilityInputSchema.safeParse({ ...input, endsAt: input.startsAt }).success).toBe(false);
    expect(staffAvailabilityInputSchema.safeParse({ ...input, endsAt: "not-a-time" }).success).toBe(false);
  });
});
