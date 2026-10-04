import { describe, expect, it } from "vitest";

import { conversationWeight, loadByStaff } from "./load";
import { DEFAULT_ROUTING_POLICY, policyFromRow, routingPolicyInputSchema, type RoutingPolicy } from "./policy";
import { byLoadThenTurn, resolveOwner, topicOfIntent, type RoutingCandidate, type RoutingInput } from "./resolve-owner";

const person = (id: string, over: Partial<RoutingCandidate> = {}): RoutingCandidate => ({ id, name: `Staff ${id}`, role: "MARKETING", active: true, availableNow: true, handlesInbox: true, load: 0, lastAssignedAt: null, ...over });

const policy = (over: Partial<RoutingPolicy> = {}): RoutingPolicy => ({ ...DEFAULT_ROUTING_POLICY, ...over });

const input = (over: Partial<RoutingInput> = {}): RoutingInput => ({
  policy: policy(),
  candidates: [person("a"), person("b")],
  existingOwnerId: null,
  partySize: null,
  topic: null,
  officeOpen: true,
  defaultOwnerId: null,
  ...over,
});

describe("1 · owner-sticky", () => {
  it("a known customer reaches their existing owner even when someone else is less loaded", () => {
    const decision = resolveOwner(input({ existingOwnerId: "busy", candidates: [person("busy", { load: 30 }), person("free", { load: 0 })] }));
    expect(decision).toMatchObject({ ownerId: "busy", step: "STICKY" });
  });

  it("loses when the owner is not available: deactivated, off shift, on leave, or the office is closed", () => {
    const gone = resolveOwner(input({ existingOwnerId: "owner", candidates: [person("owner", { active: false }), person("other")] }));
    expect(gone).toMatchObject({ ownerId: "other", step: "LEAST_LOADED" });
    const closed = resolveOwner(input({ existingOwnerId: "owner", officeOpen: false, candidates: [person("owner"), person("other")] }));
    expect(closed).toMatchObject({ ownerId: null, step: "UNASSIGNED" });
    const leave = resolveOwner(input({ existingOwnerId: "owner", candidates: [person("owner", { availableNow: false }), person("other")] }));
    expect(leave).toMatchObject({ ownerId: "other", step: "LEAST_LOADED" });
  });

  it("is skipped when the agency turned it off", () => {
    const decision = resolveOwner(input({ policy: policy({ stickyEnabled: false }), existingOwnerId: "busy", candidates: [person("busy", { load: 9 }), person("free")] }));
    expect(decision.ownerId).toBe("free");
  });

  it("an owner who is not on this agency's staff list is ignored", () => {
    expect(resolveOwner(input({ existingOwnerId: "stranger" })).step).toBe("LEAST_LOADED");
  });
});

describe("2 · designated coordinator", () => {
  const staff = [person("ops", { role: "OPERATIONS", load: 5 }), person("visa", { role: "VISA", handlesInbox: true }), person("sales", { role: "MARKETING", load: 0 })];

  it("a party of 12 routes to the group coordinator, not the least loaded person", () => {
    expect(resolveOwner(input({ candidates: staff, partySize: 12 }))).toMatchObject({ ownerId: "ops", step: "COORDINATOR" });
  });

  it("a party under the threshold is not a group", () => {
    expect(resolveOwner(input({ candidates: staff, partySize: 9 })).step).toBe("LEAST_LOADED");
    expect(resolveOwner(input({ candidates: staff, partySize: 10 })).step).toBe("COORDINATOR");
  });

  it("uses the agency's own group size", () => {
    expect(resolveOwner(input({ policy: policy({ groupThreshold: 4 }), candidates: staff, partySize: 5 })).step).toBe("COORDINATOR");
  });

  it("VISA_ISSUES routes to the visa role, and DOCUMENTS to the documents role", () => {
    expect(resolveOwner(input({ candidates: staff, topic: "VISA_ISSUES" }))).toMatchObject({ ownerId: "visa", step: "COORDINATOR" });
    expect(resolveOwner(input({ candidates: staff, topic: "DOCUMENTS" }))).toMatchObject({ ownerId: "ops", step: "COORDINATOR" });
  });

  it("the topic wins over party size: a visa question from twelve goes to visa", () => {
    expect(resolveOwner(input({ candidates: staff, topic: "VISA_ISSUES", partySize: 12 })).ownerId).toBe("visa");
  });

  it("follows the role the agency chose", () => {
    const custom = policy({ coordinatorRoles: { ...DEFAULT_ROUTING_POLICY.coordinatorRoles, GROUP: "MARKETING" } });
    expect(resolveOwner(input({ policy: custom, candidates: staff, partySize: 12 }))).toMatchObject({ ownerId: "sales", step: "COORDINATOR" });
  });

  it("picks the least loaded coordinator, then the one longest without a conversation", () => {
    const team = [person("o1", { role: "OPERATIONS", load: 3 }), person("o2", { role: "OPERATIONS", load: 1 })];
    expect(resolveOwner(input({ candidates: team, partySize: 12 })).ownerId).toBe("o2");
  });

  it("falls through to the chain when no coordinator is available", () => {
    const decision = resolveOwner(input({ candidates: [person("ops", { role: "OPERATIONS", active: false }), person("sales")], partySize: 12 }));
    expect(decision).toMatchObject({ ownerId: "sales", step: "LEAST_LOADED" });
  });

  it("never assigns a coordinator who cannot send Inbox messages", () => {
    const decision = resolveOwner(input({ candidates: [person("visa", { role: "VISA", handlesInbox: false }), person("sales")], topic: "VISA_ISSUES" }));
    expect(decision).toMatchObject({ ownerId: "sales", step: "LEAST_LOADED" });
  });
});

describe("3 · least loaded, or in turn", () => {
  it("the least loaded available person", () => {
    expect(resolveOwner(input({ candidates: [person("a", { load: 4 }), person("b", { load: 1 }), person("c", { load: 2 })] }))).toMatchObject({ ownerId: "b", step: "LEAST_LOADED" });
  });

  it("round-robin breaks a load tie deterministically by last_assigned_at, oldest first", () => {
    const tied = [person("a", { load: 2, lastAssignedAt: "2026-09-21T10:00:00Z" }), person("b", { load: 2, lastAssignedAt: "2026-09-21T08:00:00Z" }), person("c", { load: 2, lastAssignedAt: "2026-09-21T09:00:00Z" })];
    expect(resolveOwner(input({ candidates: tied })).ownerId).toBe("b");
    expect(resolveOwner(input({ candidates: [...tied].reverse() })).ownerId).toBe("b");
  });

  it("someone never assigned goes before everyone who has been, and equal turns fall back to the id", () => {
    expect(resolveOwner(input({ candidates: [person("a", { lastAssignedAt: "2026-09-21T08:00:00Z" }), person("z")] })).ownerId).toBe("z");
    expect(resolveOwner(input({ candidates: [person("m"), person("k")] })).ownerId).toBe("k");
  });

  it("ROUND_ROBIN ignores load and takes the next in turn", () => {
    const decision = resolveOwner(input({ policy: policy({ loadBalanceMode: "ROUND_ROBIN" }), candidates: [person("a", { load: 0, lastAssignedAt: "2026-09-21T10:00:00Z" }), person("b", { load: 9, lastAssignedAt: "2026-09-21T08:00:00Z" })] }));
    expect(decision).toMatchObject({ ownerId: "b", step: "ROUND_ROBIN" });
  });

  it("only people who can work the inbox are in the pool", () => {
    const decision = resolveOwner(input({ candidates: [person("guide", { role: "GUIDE", handlesInbox: false }), person("sales", { load: 8 })] }));
    expect(decision.ownerId).toBe("sales");
  });
});

describe("nobody unavailable is ever assigned — the conversation stays UNASSIGNED", () => {
  it("off-shift, on leave or deactivated staff are never picked", () => {
    const decision = resolveOwner(input({ candidates: [person("a", { active: false }), person("b", { availableNow: false })], defaultOwnerId: "a" }));
    expect(decision).toMatchObject({ ownerId: null, step: "UNASSIGNED" });
  });

  it("with the office closed and shifts respected, nobody is picked at any step, even the default owner", () => {
    const decision = resolveOwner(input({ officeOpen: false, existingOwnerId: "a", partySize: 20, candidates: [person("a", { role: "OPERATIONS" }), person("b")], defaultOwnerId: "b" }));
    expect(decision).toMatchObject({ ownerId: null, step: "UNASSIGNED" });
  });

  it("with office-hours disabled, individual availability still cannot be bypassed", () => {
    const relaxed = policy({ respectShifts: false });
    expect(resolveOwner(input({ policy: relaxed, officeOpen: false })).ownerId).toBe("a");
    expect(resolveOwner(input({ policy: relaxed, officeOpen: false, candidates: [person("a", { active: false })] })).ownerId).toBeNull();
    expect(resolveOwner(input({ policy: relaxed, officeOpen: false, candidates: [person("a", { availableNow: false })] })).ownerId).toBeNull();
  });
});

describe("4 · fallback", () => {
  it("does not use a configured default owner who cannot send Inbox messages", () => {
    const decision = resolveOwner(input({ candidates: [person("boss", { handlesInbox: false })], defaultOwnerId: "boss" }));
    expect(decision).toMatchObject({ ownerId: null, step: "UNASSIGNED" });
  });

  it("an unavailable default owner is not used", () => {
    expect(resolveOwner(input({ candidates: [person("boss", { handlesInbox: false, active: false })], defaultOwnerId: "boss" })).ownerId).toBeNull();
  });
});

describe("an agency with no policy behaves exactly as it does today", () => {
  it("returns the configured default owner, unchecked, whatever the shifts or load", () => {
    const decision = resolveOwner(input({ policy: null, officeOpen: false, existingOwnerId: "other", partySize: 40, defaultOwnerId: "boss", candidates: [person("boss", { active: false, load: 99 }), person("other")] }));
    expect(decision).toMatchObject({ ownerId: "boss", step: "LEGACY_DEFAULT" });
  });

  it("returns nobody when there is no default owner either", () => {
    expect(resolveOwner(input({ policy: null })).ownerId).toBeNull();
  });
});

describe("helpers", () => {
  it("byLoadThenTurn is a total order", () => {
    const list = [person("c", { load: 1 }), person("a", { load: 1 }), person("b", { load: 0 })];
    expect([...list].sort(byLoadThenTurn).map((entry) => entry.id)).toEqual(["b", "a", "c"]);
  });

  it("only visa and document intents are topics; group comes from party size", () => {
    expect(topicOfIntent("VISA_QUERY")).toBe("VISA_ISSUES");
    expect(topicOfIntent("DOCUMENT_ISSUE")).toBe("DOCUMENTS");
    for (const code of ["GROUP_ENQUIRY", "PACKAGE_ENQUIRY", "FAQ", null]) expect(topicOfIntent(code)).toBeNull();
  });
});

describe("load", () => {
  it("weights a conversation by how urgent it is: 1, plus one per 100 priority points, up to 4", () => {
    expect([0, 99, 100, 250, 550, 5000, -20].map(conversationWeight)).toEqual([1, 1, 2, 3, 4, 4, 1]);
  });

  it("sums per person and ignores unassigned conversations", () => {
    const load = loadByStaff([
      { assignedToId: "a", priorityRank: 0 },
      { assignedToId: "a", priorityRank: 300 },
      { assignedToId: "b", priorityRank: 0 },
      { assignedToId: null, priorityRank: 500 },
    ]);
    expect([...load.entries()].sort()).toEqual([["a", 5], ["b", 1]]);
  });
});

describe("policy", () => {
  it("a stored row becomes a policy; a bad knob falls back to its default instead of breaking routing", () => {
    expect(policyFromRow({ sticky_enabled: false, group_threshold: 6, load_balance_mode: "ROUND_ROBIN", respect_shifts: false, coordinator_role_by_queue: { GROUP: "ADMIN", VISA_ISSUES: "SUPERHERO" } })).toEqual({
      stickyEnabled: false,
      groupThreshold: 6,
      loadBalanceMode: "ROUND_ROBIN",
      respectShifts: false,
      coordinatorRoles: { GROUP: "ADMIN", VISA_ISSUES: "VISA", DOCUMENTS: "OPERATIONS" },
    });
    expect(policyFromRow({ group_threshold: 1, load_balance_mode: "RANDOM", coordinator_role_by_queue: [] })).toEqual(DEFAULT_ROUTING_POLICY);
  });

  it("validates what a form may save", () => {
    const valid = { stickyEnabled: true, groupThreshold: 10, loadBalanceMode: "LEAST_LOADED", respectShifts: true, coordinatorRoles: { GROUP: "OPERATIONS", VISA_ISSUES: "VISA", DOCUMENTS: "OPERATIONS" } };
    expect(routingPolicyInputSchema.safeParse(valid).success).toBe(true);
    expect(routingPolicyInputSchema.safeParse({ ...valid, groupThreshold: 1 }).success).toBe(false);
    expect(routingPolicyInputSchema.safeParse({ ...valid, coordinatorRoles: { ...valid.coordinatorRoles, GROUP: "GUIDE" } }).success).toBe(false);
    expect(routingPolicyInputSchema.safeParse({ ...valid, loadBalanceMode: "RANDOM" }).success).toBe(false);
  });
});
