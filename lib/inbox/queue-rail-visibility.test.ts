import { describe, expect, it } from "vitest";

import { railCountLabel, railQueueGroups, railQueueVisibility } from "./queues";

const groups = railQueueGroups();
const codes = (list: Array<{ code: string }>) => list.map((queue) => queue.code);

describe("railQueueVisibility", () => {
  it("always shows the daily working set, even at zero", () => {
    const [inbox] = railQueueVisibility({ groups, countOf: () => 0, activeQueue: null });
    expect(codes(inbox.shown)).toEqual(["ALL", "MINE", "UNASSIGNED", "NEEDS_REPLY", "WAITING_CUSTOMER", "WAITING_TEAM"]);
    expect(codes(inbox.tucked)).toEqual(["RESOLVED", "SPAM"]);
  });

  it("tucks every empty queue outside the working set behind More queues", () => {
    const all = railQueueVisibility({ groups, countOf: () => 0, activeQueue: null });
    const attention = all.find((entry) => entry.group === "OPERATIONS");
    expect(attention?.shown).toEqual([]);
    expect(attention?.tucked.length).toBeGreaterThan(0);
  });

  it("shows a queue as soon as it has conversations", () => {
    const all = railQueueVisibility({ groups, countOf: (queue) => (queue === "PAYMENT_DISCUSSIONS" ? 3 : 0), activeQueue: null });
    const attention = all.find((entry) => entry.group === "OPERATIONS");
    expect(codes(attention?.shown ?? [])).toEqual(["PAYMENT_DISCUSSIONS"]);
  });

  it("never hides the open queue, even when it is empty", () => {
    const all = railQueueVisibility({ groups, countOf: () => 0, activeQueue: "COMPLAINTS" });
    const attention = all.find((entry) => entry.group === "OPERATIONS");
    expect(codes(attention?.shown ?? [])).toEqual(["COMPLAINTS"]);
    expect(codes(attention?.tucked ?? [])).not.toContain("COMPLAINTS");
  });

  it("keeps every queue reachable: shown plus tucked equals the group", () => {
    const all = railQueueVisibility({ groups, countOf: () => 0, activeQueue: null });
    for (const [index, entry] of all.entries()) {
      expect(entry.shown.length + entry.tucked.length).toBe(groups[index].queues.length);
    }
  });
});

describe("railCountLabel", () => {
  it("hides zero and caps large counts", () => {
    expect(railCountLabel(0)).toBeNull();
    expect(railCountLabel(undefined)).toBeNull();
    expect(railCountLabel(7)).toBe("7");
    expect(railCountLabel(99)).toBe("99");
    expect(railCountLabel(100)).toBe("99+");
  });
});
