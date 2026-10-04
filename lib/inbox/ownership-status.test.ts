import { describe, expect, it } from "vitest";

import { ownershipStatusFor } from "./ownership-status";

const base = { assignedToName: "Nadeesha", assignedToId: "s1", currentStaffId: "s2" } as const;

describe("ownershipStatusFor", () => {
  it("says the assistant is active while the assistant owns the reply", () => {
    for (const state of ["AI_ACTIVE", "AI_RESUMED"] as const) {
      const status = ownershipStatusFor({ ...base, state });
      expect(status.statusLabel).toBe("Assistant active");
      expect(status.nextResponder).toBe("ASSISTANT");
    }
  });

  it("asks for staff when the assistant has stopped", () => {
    const status = ownershipStatusFor({ ...base, state: "HUMAN_REQUESTED" });
    expect(status).toMatchObject({ statusLabel: "Staff action needed", nextResponder: "STAFF", tone: "action" });
  });

  it("shows the assistant as paused when staff own the chat", () => {
    expect(ownershipStatusFor({ ...base, state: "HUMAN_ACTIVE" })).toMatchObject({ statusLabel: "Assistant paused", nextResponder: "STAFF" });
  });

  it("expects nobody to reply once closed", () => {
    expect(ownershipStatusFor({ ...base, state: "CLOSED" })).toMatchObject({ statusLabel: "Closed", nextResponder: "NOBODY" });
  });

  it("names the owner, says 'you' for the current person, and says Unassigned when there is none", () => {
    expect(ownershipStatusFor({ ...base, state: "HUMAN_ACTIVE" }).ownerLabel).toBe("Assigned to Nadeesha");
    expect(ownershipStatusFor({ ...base, state: "HUMAN_ACTIVE", currentStaffId: "s1" }).ownerLabel).toBe("Assigned to you");
    expect(ownershipStatusFor({ ...base, state: "AI_ACTIVE", assignedToName: null, assignedToId: null }).ownerLabel).toBe("Unassigned");
    expect(ownershipStatusFor({ ...base, state: "AI_ACTIVE", assignedToName: "  ", assignedToId: null }).ownerLabel).toBe("Unassigned");
  });

  it("never exposes a raw state name", () => {
    for (const state of ["AI_ACTIVE", "AI_RESUMED", "HUMAN_REQUESTED", "HUMAN_ACTIVE", "CLOSED"] as const) {
      const status = ownershipStatusFor({ ...base, state });
      expect(`${status.statusLabel} ${status.description}`).not.toMatch(/[A-Z]+_[A-Z]+/);
    }
  });
});
