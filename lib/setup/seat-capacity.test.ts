import { describe, expect, it } from "vitest";

import { computeSeatCapacity } from "./seat-capacity";

describe("computeSeatCapacity", () => {
  it("counts active staff and open invitations against plan seats plus purchased seats", () => {
    expect(computeSeatCapacity({ planAllowance: 3, seatsPurchased: 0, activeStaff: 1, pendingInvitations: 1 })).toEqual({
      limit: 3,
      used: 2,
      remaining: 1,
      atLimit: false,
    });
  });

  it("adds purchased seats to the plan allowance", () => {
    expect(computeSeatCapacity({ planAllowance: 3, seatsPurchased: 2, activeStaff: 3, pendingInvitations: 0 }).remaining).toBe(2);
  });

  it("reports the limit as reached, never negative", () => {
    const capacity = computeSeatCapacity({ planAllowance: 3, seatsPurchased: 0, activeStaff: 3, pendingInvitations: 2 });
    expect(capacity.atLimit).toBe(true);
    expect(capacity.remaining).toBe(0);
  });

  it("treats a plan with no seat allowance as unlimited", () => {
    expect(computeSeatCapacity({ planAllowance: null, seatsPurchased: 0, activeStaff: 40, pendingInvitations: 5 })).toEqual({
      limit: null,
      used: 45,
      remaining: null,
      atLimit: false,
    });
  });

  it("does not block anyone when the agency has no subscription row", () => {
    expect(computeSeatCapacity({ planAllowance: undefined, seatsPurchased: 0, activeStaff: 2, pendingInvitations: 0 }).atLimit).toBe(false);
  });
});
