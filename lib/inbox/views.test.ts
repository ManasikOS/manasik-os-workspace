import { describe, expect, it } from "vitest";

import { QUEUE_CODES, type QueueCode } from "@/lib/inbox/intelligence/contracts";
import { ALL_QUEUE_CODES, QUEUE_CATALOGUE, QUEUE_GROUP_LABEL, RAIL_QUEUE_ORDER, railQueueGroups } from "@/lib/inbox/queues";
import { INBOX_VIEWS, VIEW_QUEUE, countsByView, loadedListBadge, queueForView, viewForQueue } from "@/lib/inbox/views";

describe("views map onto queue codes — one predicate, not two", () => {
  it("every view has exactly one queue, and the original nine keep their meaning", () => {
    expect(new Set(INBOX_VIEWS).size).toBe(INBOX_VIEWS.length);
    expect(queueForView("all")).toBe("ALL");
    expect(queueForView("unassigned")).toBe("UNASSIGNED");
    expect(queueForView("assigned-to-me")).toBe("MINE");
    expect(queueForView("whatsapp")).toBe("WHATSAPP");
    expect(queueForView("instagram")).toBe("INSTAGRAM");
    expect(queueForView("messenger")).toBe("MESSENGER");
    expect(queueForView("email")).toBe("EMAIL");
    expect(queueForView("closed")).toBe("RESOLVED");
    expect(queueForView("spam")).toBe("SPAM");
  });

  it("no two views share a queue, and viewForQueue is the inverse", () => {
    const queues = INBOX_VIEWS.map((view) => VIEW_QUEUE[view]);
    expect(new Set(queues).size).toBe(queues.length);
    for (const view of INBOX_VIEWS) expect(viewForQueue(VIEW_QUEUE[view])).toBe(view);
  });

  it("a queue whose predicate is not built yet has no view, so nothing can select it", () => {
    for (const code of ["DEPARTURE_CHANGES", "GROUP_CHANGES"] as const) {
      expect(viewForQueue(code)).toBeNull();
      expect(QUEUE_CATALOGUE[code].available).toBe(false);
    }
  });

  it("every available queue is reachable from a view (nothing is built and unreachable)", () => {
    for (const code of QUEUE_CODES) {
      if (QUEUE_CATALOGUE[code].available) expect(viewForQueue(code)).not.toBeNull();
    }
  });
});

describe("countsByView", () => {
  it("maps queue counts to view counts and treats a missing queue as zero", () => {
    const counts = countsByView({ ALL: 12, MINE: 3, NEEDS_REPLY: 5, RESOLVED: 40 });
    expect(counts).toMatchObject({ all: 12, "assigned-to-me": 3, "needs-reply": 5, closed: 40, whatsapp: 0, spam: 0 });
    expect(Object.keys(counts).sort()).toEqual([...INBOX_VIEWS].sort());
  });
});

describe("loadedListBadge", () => {
  it("is the length of the list that was actually loaded", () => {
    expect(loadedListBadge(1, false)).toBe("1");
    expect(loadedListBadge(37, false)).toBe("37");
  });

  it("shows nothing for an empty list, so 'Clear all chats' leaves no phantom count", () => {
    expect(loadedListBadge(0, false)).toBeNull();
    expect(loadedListBadge(0, true)).toBeNull();
    expect(loadedListBadge(-3, false)).toBeNull();
    expect(loadedListBadge(Number.NaN, false)).toBeNull();
  });

  it("reads as a floor, 'N+', while another page of the view exists", () => {
    expect(loadedListBadge(100, true)).toBe("100+");
    expect(loadedListBadge(200, true)).toBe("200+");
  });
});

describe("queue catalogue", () => {
  it("defines every queue code exactly once, with a label and a plain-language description", () => {
    expect(Object.keys(QUEUE_CATALOGUE).sort()).toEqual([...ALL_QUEUE_CODES].sort());
    for (const code of ALL_QUEUE_CODES) {
      const definition = QUEUE_CATALOGUE[code as QueueCode];
      expect(definition.code).toBe(code);
      expect(definition.label.trim().length).toBeGreaterThan(0);
      expect(definition.description.trim().endsWith(".")).toBe(true);
    }
  });

  it("gives every queue exactly one rail position", () => {
    expect([...RAIL_QUEUE_ORDER].sort()).toEqual([...ALL_QUEUE_CODES].sort());
  });

  it("groups the rail as Inbox / Sales / Needs attention / Channels; the Sales queues arrived with MI3.4", () => {
    const groups = railQueueGroups();
    expect(groups.map((entry) => entry.group)).toEqual(["INBOX", "COMMERCIAL", "OPERATIONS", "CHANNELS"]);
    expect(groups.map((entry) => entry.label)).toEqual([QUEUE_GROUP_LABEL.INBOX, QUEUE_GROUP_LABEL.COMMERCIAL, QUEUE_GROUP_LABEL.OPERATIONS, QUEUE_GROUP_LABEL.CHANNELS]);
    const shown = groups.flatMap((entry) => entry.queues.map((queue) => queue.code));
    expect(groups.find((entry) => entry.group === "COMMERCIAL")?.queues.map((queue) => queue.code)).toEqual(["NEW_ENQUIRIES", "QUALIFIED", "BOOKING_READY", "QUOTE_SENT"]);
    // The deadline queues arrived with MI2.6.
    expect(shown).toEqual(expect.arrayContaining(["ALL", "MINE", "NEEDS_REPLY", "ESCALATIONS", "NEARING_DEADLINE", "SLA_BREACHED", "WHATSAPP", "EMAIL"]));
    expect(new Set(shown).size).toBe(shown.length);
  });

  it("puts the most urgent operations queue first", () => {
    const operations = railQueueGroups().find((entry) => entry.group === "OPERATIONS");
    expect(operations?.queues[0].code).toBe("ESCALATIONS");
  });
});
