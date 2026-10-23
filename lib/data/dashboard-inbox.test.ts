import { describe, expect, it } from "vitest";

import { buildInboxSla } from "./dashboard-inbox";

describe("buildInboxSla", () => {
  it("states the Inbox rail's own queue counts", () => {
    const data = buildInboxSla(
      { MINE: 4, NEEDS_REPLY: 9, UNASSIGNED: 3, SLA_BREACHED: 2, NEARING_DEADLINE: 5 },
      true,
    );
    expect(data).toEqual({
      mine: 4,
      needsReply: 9,
      unassigned: 3,
      slaBreached: 2,
      nearingDeadline: 5,
      slaAvailable: true,
    });
  });

  it("treats a queue the RPC did not return as empty - the read succeeded, there is nothing in it", () => {
    const data = buildInboxSla({}, true);
    expect(data).toMatchObject({ mine: 0, needsReply: 0, unassigned: 0, slaBreached: 0, nearingDeadline: 0 });
  });

  it("leaves the SLA figures out entirely when the plan does not include SLA", () => {
    const data = buildInboxSla({ MINE: 4, SLA_BREACHED: 7, NEARING_DEADLINE: 1 }, false);
    expect(data.slaAvailable).toBe(false);
    expect(data.slaBreached).toBeNull();
    expect(data.nearingDeadline).toBeNull();
    expect(data.mine).toBe(4);
  });
});
