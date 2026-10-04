import { describe, expect, it } from "vitest";

import { groupThreadMessages, type ThreadGroupRow } from "./group-thread-messages";

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 9, minutes));
function row(overrides: Partial<ThreadGroupRow> & { minutes: number }): ThreadGroupRow {
  const { minutes, ...rest } = overrides;
  return { kind: "message", senderKey: "user:CUSTOMER", createdAt: at(minutes), failed: false, startsNewDay: false, ...rest };
}

describe("groupThreadMessages", () => {
  it("prints the meta line once for a burst from one sender", () => {
    const placements = groupThreadMessages([row({ minutes: 0 }), row({ minutes: 1 }), row({ minutes: 2 })]);
    expect(placements.map((p) => p.startsGroup)).toEqual([true, false, false]);
    expect(placements.map((p) => p.showMeta)).toEqual([false, false, true]);
  });

  it("breaks the group when the sender changes", () => {
    const placements = groupThreadMessages([row({ minutes: 0 }), row({ minutes: 1, senderKey: "staff:STAFF" })]);
    expect(placements.map((p) => p.showMeta)).toEqual([true, true]);
    expect(placements.map((p) => p.startsGroup)).toEqual([true, true]);
  });

  it("breaks the group after a pause longer than the window, but not at exactly the window", () => {
    expect(groupThreadMessages([row({ minutes: 0 }), row({ minutes: 5 })]).map((p) => p.showMeta)).toEqual([false, true]);
    expect(groupThreadMessages([row({ minutes: 0 }), row({ minutes: 6 })]).map((p) => p.showMeta)).toEqual([true, true]);
  });

  it("breaks the group at a new day and around an internal note", () => {
    expect(groupThreadMessages([row({ minutes: 0 }), row({ minutes: 1, startsNewDay: true })]).map((p) => p.showMeta)).toEqual([true, true]);
    const withNote = groupThreadMessages([row({ minutes: 0 }), row({ minutes: 1, kind: "note" }), row({ minutes: 2 })]);
    expect(withNote.map((p) => p.startsGroup)).toEqual([true, true, true]);
  });

  it("never hides the meta line of a message that failed to send", () => {
    const placements = groupThreadMessages([
      row({ minutes: 0, senderKey: "staff:STAFF" }),
      row({ minutes: 1, senderKey: "staff:STAFF", failed: true }),
      row({ minutes: 2, senderKey: "staff:STAFF" }),
    ]);
    expect(placements.map((p) => p.showMeta)).toEqual([false, true, true]);
  });

  it("handles an empty thread and a single message", () => {
    expect(groupThreadMessages([])).toEqual([]);
    expect(groupThreadMessages([row({ minutes: 0 })])).toEqual([{ startsGroup: true, endsGroup: true, showMeta: true }]);
  });
});
