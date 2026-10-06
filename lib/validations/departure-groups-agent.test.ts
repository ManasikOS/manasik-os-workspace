import { describe, expect, it } from "vitest";

import {
  approveAgentProposalSchema,
  muteAgentOnGroupSchema,
  rejectAgentProposalSchema,
} from "./departure-groups";

const ID = "11111111-1111-4111-8111-111111111111";

describe("muteAgentOnGroupSchema", () => {
  it("accepts a bounded mute and an un-mute", () => {
    expect(muteAgentOnGroupSchema.safeParse({ groupId: ID, days: 7, reason: "Handled by phone" }).success).toBe(true);
    expect(muteAgentOnGroupSchema.safeParse({ groupId: ID, days: null, reason: "" }).success).toBe(true);
  });

  it("refuses values that used to reach Date.toISOString() and throw", () => {
    for (const days of [Number.NaN, -1, 0, 1.5, 91, 1e12, Infinity]) {
      expect(muteAgentOnGroupSchema.safeParse({ groupId: ID, days, reason: "x" }).success, String(days)).toBe(false);
    }
  });

  it("refuses a non-uuid group and an oversized reason", () => {
    expect(muteAgentOnGroupSchema.safeParse({ groupId: "abc", days: 3, reason: "x" }).success).toBe(false);
    expect(muteAgentOnGroupSchema.safeParse({ groupId: ID, days: 3, reason: "x".repeat(301) }).success).toBe(false);
  });
});

describe("approve / reject schemas", () => {
  it("requires a uuid proposal id", () => {
    expect(approveAgentProposalSchema.safeParse({ proposalId: "nope" }).success).toBe(false);
    expect(rejectAgentProposalSchema.safeParse({ proposalId: "nope" }).success).toBe(false);
    expect(approveAgentProposalSchema.safeParse({ proposalId: ID }).success).toBe(true);
  });

  it("caps the edited payload and the decision note", () => {
    const big = { text: "x".repeat(25_000) };
    expect(approveAgentProposalSchema.safeParse({ proposalId: ID, editedPayload: big }).success).toBe(false);
    expect(approveAgentProposalSchema.safeParse({ proposalId: ID, editedPayload: { a: 1 } }).success).toBe(true);
    expect(rejectAgentProposalSchema.safeParse({ proposalId: ID, decisionNote: "n".repeat(501) }).success).toBe(false);
  });
});
