import { describe, expect, it } from "vitest";

import { BULK_ACTION_LIMIT, bulkResultSummary, planBulkAction, type BulkConversationInput } from "./bulk-actions";

const chat = (id: string, state: BulkConversationInput["state"], assignedToId: string | null = null): BulkConversationInput => ({ id, state, assignedToId });
const nadeesha = { id: "s1", name: "Nadeesha" };

describe("planBulkAction close", () => {
  it("closes every open chat with the same one-field change as the single Close button", () => {
    const plan = planBulkAction({ kind: "CLOSE" }, [chat("a", "AI_ACTIVE"), chat("b", "HUMAN_ACTIVE", "s9"), chat("c", "HUMAN_REQUESTED")]);
    expect(plan.changed).toEqual([
      { id: "a", patch: { state: "CLOSED" } },
      { id: "b", patch: { state: "CLOSED" } },
      { id: "c", patch: { state: "CLOSED" } },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("leaves a chat that is already closed alone", () => {
    const plan = planBulkAction({ kind: "CLOSE" }, [chat("a", "CLOSED"), chat("b", "AI_ACTIVE")]);
    expect(plan.changed.map((item) => item.id)).toEqual(["b"]);
    expect(plan.skipped).toEqual([{ id: "a", reason: "Already closed." }]);
  });
});

describe("planBulkAction assign", () => {
  it("gives open chats to the person and pauses the assistant on each", () => {
    const plan = planBulkAction({ kind: "ASSIGN", target: nadeesha }, [chat("a", "AI_ACTIVE"), chat("b", "HUMAN_REQUESTED", "s9")]);
    expect(plan.changed).toEqual([
      { id: "a", patch: { assigned_to_id: "s1", assigned_to_name: "Nadeesha", state: "HUMAN_ACTIVE" } },
      { id: "b", patch: { assigned_to_id: "s1", assigned_to_name: "Nadeesha", state: "HUMAN_ACTIVE" } },
    ]);
  });

  it("skips closed chats and chats the person already owns, saying why", () => {
    const plan = planBulkAction({ kind: "ASSIGN", target: nadeesha }, [chat("a", "CLOSED"), chat("b", "HUMAN_ACTIVE", "s1"), chat("c", "AI_ACTIVE")]);
    expect(plan.changed.map((item) => item.id)).toEqual(["c"]);
    expect(plan.skipped).toEqual([
      { id: "a", reason: expect.stringContaining("closed") },
      { id: "b", reason: "Already has this owner." },
    ]);
  });

  it("removes owners, returning staff-owned chats to 'waiting for staff'", () => {
    const plan = planBulkAction({ kind: "ASSIGN", target: null }, [chat("a", "HUMAN_ACTIVE", "s1"), chat("b", "AI_ACTIVE", null)]);
    expect(plan.changed).toEqual([{ id: "a", patch: { assigned_to_id: null, assigned_to_name: null, state: "HUMAN_REQUESTED" } }]);
    expect(plan.skipped.map((item) => item.id)).toEqual(["b"]);
  });
});

describe("bulkResultSummary", () => {
  it("says what happened and what was left alone", () => {
    expect(bulkResultSummary({ action: "CLOSE", changed: 3, skipped: 1 })).toBe("Closed 3 conversations. 1 was left alone.");
    expect(bulkResultSummary({ action: "ASSIGN", changed: 1, skipped: 2 })).toBe("Changed the owner of 1 conversation. 2 were left alone.");
    expect(bulkResultSummary({ action: "CLOSE", changed: 0, skipped: 2 })).toBe("Nothing was changed. 2 were left alone.");
  });

  it("has a sensible cap", () => {
    expect(BULK_ACTION_LIMIT).toBe(50);
  });
});

describe("planBulkAction mark spam", () => {
  const spamChat = (id: string, overrides: Partial<BulkConversationInput> = {}): BulkConversationInput => ({
    id,
    state: "AI_ACTIVE",
    assignedToId: null,
    lifecycleStatus: "OPEN",
    leadIsSpam: false,
    hasBooking: false,
    hasOpenReview: false,
    ...overrides,
  });

  it("marks open and closed chats as spam with a one-field change that leaves the state alone", () => {
    const plan = planBulkAction({ kind: "MARK_SPAM" }, [spamChat("a"), spamChat("b", { state: "CLOSED", lifecycleStatus: "CLOSED" })]);
    expect(plan.changed).toEqual([
      { id: "a", patch: { lifecycle_status: "SPAM" } },
      { id: "b", patch: { lifecycle_status: "SPAM" } },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("leaves a chat that is already spam alone", () => {
    const plan = planBulkAction({ kind: "MARK_SPAM" }, [spamChat("a", { lifecycleStatus: "SPAM" })]);
    expect(plan.skipped).toEqual([{ id: "a", reason: "Already marked as spam." }]);
  });

  it("refuses a chat with a booking, an open review or a spam lead, saying why", () => {
    const plan = planBulkAction({ kind: "MARK_SPAM" }, [
      spamChat("booked", { hasBooking: true }),
      spamChat("review", { hasOpenReview: true }),
      spamChat("lead", { leadIsSpam: true }),
      spamChat("fine"),
    ]);
    expect(plan.changed.map((item) => item.id)).toEqual(["fine"]);
    expect(plan.skipped).toEqual([
      { id: "booked", reason: expect.stringMatching(/booking/i) },
      { id: "review", reason: expect.stringMatching(/review/i) },
      { id: "lead", reason: expect.stringMatching(/already treated as spam/i) },
    ]);
  });

  it("never touches a booking or review chat even when it is also closed", () => {
    const plan = planBulkAction({ kind: "MARK_SPAM" }, [spamChat("a", { state: "CLOSED", lifecycleStatus: "CLOSED", hasBooking: true })]);
    expect(plan.changed).toEqual([]);
  });

  it("treats missing safety facts as unknown and refuses, so it fails closed", () => {
    const plan = planBulkAction({ kind: "MARK_SPAM" }, [{ id: "a", state: "AI_ACTIVE", assignedToId: null }]);
    expect(plan.changed).toEqual([]);
    expect(plan.skipped).toEqual([{ id: "a", reason: expect.stringMatching(/could not be checked/i) }]);
  });
});

describe("planBulkAction not spam", () => {
  const spam = (id: string, overrides: Partial<BulkConversationInput> = {}): BulkConversationInput => ({
    id,
    state: "AI_ACTIVE",
    assignedToId: null,
    lifecycleStatus: "SPAM",
    leadIsSpam: false,
    hasBooking: false,
    hasOpenReview: false,
    ...overrides,
  });

  it("restores a chat to Open, or Closed when its state is closed, from the chat's own state", () => {
    const plan = planBulkAction({ kind: "UNMARK_SPAM" }, [spam("a"), spam("b", { state: "CLOSED" }), spam("c", { state: "HUMAN_ACTIVE", assignedToId: "s1" })]);
    expect(plan.changed).toEqual([
      { id: "a", patch: { lifecycle_status: "OPEN" } },
      { id: "b", patch: { lifecycle_status: "CLOSED" } },
      { id: "c", patch: { lifecycle_status: "OPEN" } },
    ]);
  });

  it("leaves a chat that is not marked spam alone", () => {
    const plan = planBulkAction({ kind: "UNMARK_SPAM" }, [spam("a", { lifecycleStatus: "OPEN" })]);
    expect(plan.skipped).toEqual([{ id: "a", reason: "Not marked as spam." }]);
  });

  it("refuses a chat that would stay in Spam because its lead is marked spam", () => {
    const plan = planBulkAction({ kind: "UNMARK_SPAM" }, [spam("a", { leadIsSpam: true })]);
    expect(plan.changed).toEqual([]);
    expect(plan.skipped[0].reason).toMatch(/lead/i);
  });

  it("round-trips: marking then unmarking returns the chat to where it started", () => {
    for (const state of ["AI_ACTIVE", "HUMAN_ACTIVE", "HUMAN_REQUESTED", "AI_RESUMED", "CLOSED"] as const) {
      const lifecycle = state === "CLOSED" ? "CLOSED" : "OPEN";
      const start: BulkConversationInput = { id: "a", state, assignedToId: null, lifecycleStatus: lifecycle, leadIsSpam: false, hasBooking: false, hasOpenReview: false };
      const marked = planBulkAction({ kind: "MARK_SPAM" }, [start]).changed[0].patch.lifecycle_status;
      expect(marked).toBe("SPAM");
      const restored = planBulkAction({ kind: "UNMARK_SPAM" }, [{ ...start, lifecycleStatus: "SPAM" }]).changed[0].patch.lifecycle_status;
      expect(restored).toBe(lifecycle);
    }
  });
});

describe("bulkResultSummary spam", () => {
  it("describes marking and restoring in plain words", () => {
    expect(bulkResultSummary({ action: "MARK_SPAM", changed: 2, skipped: 1 })).toBe("Marked 2 conversations as spam. 1 was left alone.");
    expect(bulkResultSummary({ action: "UNMARK_SPAM", changed: 1, skipped: 0 })).toBe("Restored 1 conversation from spam.");
  });
});
