import { describe, expect, it } from "vitest";

import { buildHistory, historyEntryFor, type HistoryEventRow } from "./history";

const event = (over: Partial<HistoryEventRow> & { data?: Record<string, unknown> }): HistoryEventRow => ({
  id: "e1",
  kind: "OWNER_CHANGED",
  occurred_at: "2026-09-24T10:00:00.000Z",
  data: {},
  ...over,
});

describe("historyEntryFor", () => {
  it("words each kind of owner change", () => {
    expect(historyEntryFor(event({ data: { from_name: "Amina", to_name: "Nadeesha", changed_by_name: "Admin" } }))?.label).toBe("Owner changed from Amina to Nadeesha by Admin");
    expect(historyEntryFor(event({ data: { to_name: "Nadeesha" } }))?.label).toBe("Assigned to Nadeesha");
    expect(historyEntryFor(event({ data: { from_name: "Amina", changed_by_name: "Admin" } }))?.label).toBe("Owner Amina removed by Admin");
  });

  it("says when routing chose the owner, and why", () => {
    expect(historyEntryFor(event({ kind: "OWNER_ASSIGNED_BY_ROUTING", data: { to_name: "Nadeesha", reason: "Already this customer's owner." } }))?.label).toBe("Assigned to Nadeesha by routing: Already this customer's owner.");
    expect(historyEntryFor(event({ kind: "OWNER_ASSIGNED_BY_ROUTING", data: { to_name: "Nadeesha" } }))?.label).toBe("Assigned to Nadeesha by routing");
    expect(historyEntryFor(event({ kind: "OWNER_ASSIGNED_BY_ROUTING", data: { reason: "x" } }))).toBeNull();
  });

  it("says when the customer reopened a closed chat", () => {
    expect(historyEntryFor(event({ kind: "CUSTOMER_REOPENED" }))).toEqual({ id: "e1", at: "2026-09-24T10:00:00.000Z", label: "Reopened by the customer" });
  });

  it("BUG-9: says who closed a chat, or just that it was closed", () => {
    expect(historyEntryFor(event({ kind: "CONVERSATION_CLOSED", data: { actorName: "Nadeesha" } }))?.label).toBe("Closed by Nadeesha");
    expect(historyEntryFor(event({ kind: "CONVERSATION_CLOSED" }))?.label).toBe("Closed");
  });

  it("leaves out events it cannot describe", () => {
    expect(historyEntryFor(event({ kind: "SOMETHING_ELSE" }))).toBeNull();
    expect(historyEntryFor(event({ data: {} }))).toBeNull();
    expect(historyEntryFor(event({ data: { to_name: "  " } }))).toBeNull();
  });
});

describe("buildHistory", () => {
  const startedAt = "2026-09-20T08:00:00.000Z";

  it("lists changes newest first and ends with when the chat started", () => {
    const entries = buildHistory({
      startedAt,
      events: [
        event({ id: "old", occurred_at: "2026-09-21T09:00:00.000Z", data: { to_name: "Amina" } }),
        event({ id: "new", occurred_at: "2026-09-24T09:00:00.000Z", data: { from_name: "Amina", to_name: "Nadeesha" } }),
      ],
    });
    expect(entries.map((entry) => entry.id)).toEqual(["new", "old", "conversation-started"]);
    expect(entries.at(-1)).toMatchObject({ label: "Conversation started", at: startedAt });
  });

  it("still says when it started with no events", () => {
    expect(buildHistory({ startedAt, events: [] })).toEqual([{ id: "conversation-started", label: "Conversation started", at: startedAt }]);
  });

  it("caps the list but always keeps the start", () => {
    const events = Array.from({ length: 20 }, (_, index) => event({ id: `e${index}`, occurred_at: `2026-09-${String(1 + index).padStart(2, "0")}T00:00:00.000Z`, data: { to_name: `P${index}` } }));
    const entries = buildHistory({ startedAt, events, limit: 5 });
    expect(entries).toHaveLength(5);
    expect(entries.at(-1)?.id).toBe("conversation-started");
  });
});
