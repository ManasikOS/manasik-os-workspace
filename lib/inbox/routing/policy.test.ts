import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  COORDINATOR_ROLES,
  DEFAULT_COORDINATOR_ROLES,
  DEFAULT_ROUTING_POLICY,
  LOAD_BALANCE_MODES,
  ROUTING_TOPICS,
  policyFromRow,
  policyToRow,
  routingPolicyInputSchema,
  type RoutingPolicyInput,
} from "./policy";

const validInput = (over: Partial<RoutingPolicyInput> = {}): RoutingPolicyInput => ({
  stickyEnabled: true,
  groupThreshold: 10,
  loadBalanceMode: "LEAST_LOADED",
  respectShifts: true,
  coordinatorRoles: { GROUP: "OPERATIONS", VISA_ISSUES: "VISA", DOCUMENTS: "OPERATIONS" },
  ...over,
});

describe("the defaults", () => {
  it("send a group enquiry to Operations, a visa question to Visa and a documents question to Operations", () => {
    expect(DEFAULT_COORDINATOR_ROLES).toEqual({ GROUP: "OPERATIONS", VISA_ISSUES: "VISA", DOCUMENTS: "OPERATIONS" });
  });

  it("only ever name roles a conversation may be routed to, never Guide or CEO", () => {
    expect([...COORDINATOR_ROLES].sort()).toEqual(["ADMIN", "FINANCE", "MARKETING", "OPERATIONS", "VISA"]);
    for (const role of Object.values(DEFAULT_COORDINATOR_ROLES)) expect(COORDINATOR_ROLES).toContain(role);
  });

  it("cover every routing topic", () => {
    expect(Object.keys(DEFAULT_COORDINATOR_ROLES).sort()).toEqual([...ROUTING_TOPICS].sort());
  });

  it("are themselves a policy the settings form is allowed to save", () => {
    expect(routingPolicyInputSchema.safeParse(DEFAULT_ROUTING_POLICY).success).toBe(true);
  });
});

describe("policyFromRow: a bad or missing knob falls back to its own default and never breaks the others", () => {
  it("turns an empty row into the default policy", () => {
    expect(policyFromRow({})).toEqual(DEFAULT_ROUTING_POLICY);
  });

  it.each([
    ["a string", "true"],
    ["a number", 1],
    ["null", null],
    ["undefined", undefined],
  ])("ignores %s where a yes/no was expected", (_label, bad) => {
    const policy = policyFromRow({ sticky_enabled: bad, respect_shifts: bad });

    expect(policy.stickyEnabled).toBe(DEFAULT_ROUTING_POLICY.stickyEnabled);
    expect(policy.respectShifts).toBe(DEFAULT_ROUTING_POLICY.respectShifts);
  });

  it("keeps a stored false, which is a real choice and not a missing value", () => {
    const policy = policyFromRow({ sticky_enabled: false, respect_shifts: false });

    expect(policy.stickyEnabled).toBe(false);
    expect(policy.respectShifts).toBe(false);
  });

  it.each([
    ["one below the minimum", 1],
    ["zero", 0],
    ["negative", -5],
    ["fractional", 6.5],
    ["not a number", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
    ["a numeric string", "6"],
    ["null", null],
  ])("uses the default group size when the stored one is %s", (_label, bad) => {
    expect(policyFromRow({ group_threshold: bad }).groupThreshold).toBe(DEFAULT_ROUTING_POLICY.groupThreshold);
  });

  it("accepts the smallest group size, 2", () => {
    expect(policyFromRow({ group_threshold: 2 }).groupThreshold).toBe(2);
  });

  it("uses the default balancing mode for an unknown or differently-cased one", () => {
    expect(policyFromRow({ load_balance_mode: "round_robin" }).loadBalanceMode).toBe("LEAST_LOADED");
    expect(policyFromRow({ load_balance_mode: 3 }).loadBalanceMode).toBe("LEAST_LOADED");
  });

  it.each(LOAD_BALANCE_MODES)("keeps the valid balancing mode %s", (mode) => {
    expect(policyFromRow({ load_balance_mode: mode }).loadBalanceMode).toBe(mode);
  });

  it.each([
    ["null", null],
    ["a string", "OPERATIONS"],
    ["a number", 7],
    ["an array", ["ADMIN"]],
  ])("uses every default role when the role map is %s", (_label, bad) => {
    expect(policyFromRow({ coordinator_role_by_queue: bad }).coordinatorRoles).toEqual(DEFAULT_COORDINATOR_ROLES);
  });

  it("falls back per topic: one bad role does not disturb a good one", () => {
    const policy = policyFromRow({ coordinator_role_by_queue: { GROUP: "FINANCE", VISA_ISSUES: "nobody", DOCUMENTS: "MARKETING" } });

    expect(policy.coordinatorRoles).toEqual({ GROUP: "FINANCE", VISA_ISSUES: "VISA", DOCUMENTS: "MARKETING" });
  });

  it.each(["GUIDE", "CEO", "admin", "", 5, null])("does not route to %p", (bad) => {
    expect(policyFromRow({ coordinator_role_by_queue: { GROUP: bad } }).coordinatorRoles.GROUP).toBe("OPERATIONS");
  });

  it("ignores topics it does not know", () => {
    const policy = policyFromRow({ coordinator_role_by_queue: { REFUNDS: "FINANCE", GROUP: "ADMIN" } });

    expect(policy.coordinatorRoles).toEqual({ GROUP: "ADMIN", VISA_ISSUES: "VISA", DOCUMENTS: "OPERATIONS" });
    expect(policy.coordinatorRoles).not.toHaveProperty("REFUNDS");
  });

  it("returns a role map of its own, so changing one policy cannot change the shared defaults", () => {
    const before = { ...DEFAULT_COORDINATOR_ROLES };
    const policy = policyFromRow({});

    policy.coordinatorRoles.GROUP = "ADMIN";

    expect(DEFAULT_COORDINATOR_ROLES).toEqual(before);
  });
});

describe("policyToRow", () => {
  it("writes exactly the stored columns, in the database's own names", () => {
    expect(policyToRow(validInput({ stickyEnabled: false, groupThreshold: 12, loadBalanceMode: "ROUND_ROBIN", respectShifts: false }))).toEqual({
      sticky_enabled: false,
      group_threshold: 12,
      load_balance_mode: "ROUND_ROBIN",
      respect_shifts: false,
      coordinator_role_by_queue: { GROUP: "OPERATIONS", VISA_ISSUES: "VISA", DOCUMENTS: "OPERATIONS" },
    });
  });

  it("does not write columns the caller must not choose, such as the agency or who last edited", () => {
    const row = policyToRow(validInput());

    expect(row).not.toHaveProperty("agency_id");
    expect(row).not.toHaveProperty("updated_by");
  });

  it("round-trips: what the form saves is what routing reads back", () => {
    const input = validInput({ stickyEnabled: false, groupThreshold: 25, loadBalanceMode: "ROUND_ROBIN", respectShifts: false, coordinatorRoles: { GROUP: "ADMIN", VISA_ISSUES: "FINANCE", DOCUMENTS: "MARKETING" } });

    expect(policyFromRow(policyToRow(input))).toEqual(input);
  });
});

describe("routingPolicyInputSchema", () => {
  it("accepts the smallest and largest group size", () => {
    expect(routingPolicyInputSchema.safeParse(validInput({ groupThreshold: 2 })).success).toBe(true);
    expect(routingPolicyInputSchema.safeParse(validInput({ groupThreshold: 500 })).success).toBe(true);
  });

  it("refuses a group size above 500, below 2, or fractional", () => {
    expect(routingPolicyInputSchema.safeParse(validInput({ groupThreshold: 501 })).success).toBe(false);
    expect(routingPolicyInputSchema.safeParse(validInput({ groupThreshold: 1 })).success).toBe(false);
    expect(routingPolicyInputSchema.safeParse(validInput({ groupThreshold: 2.5 })).success).toBe(false);
  });

  it("explains a too-small group size in plain words", () => {
    const result = routingPolicyInputSchema.safeParse(validInput({ groupThreshold: 1 }));

    expect(result.success ? [] : result.error.issues.map((issue) => issue.message)).toContain("A group is at least 2 people.");
  });

  it.each(COORDINATOR_ROLES)("accepts %s as the coordinator for every topic", (role) => {
    const roles = { GROUP: role, VISA_ISSUES: role, DOCUMENTS: role };

    expect(routingPolicyInputSchema.safeParse(validInput({ coordinatorRoles: roles })).success).toBe(true);
  });

  it("refuses a policy that leaves out a topic's coordinator", () => {
    const { DOCUMENTS, ...missing } = validInput().coordinatorRoles;
    void DOCUMENTS;

    expect(routingPolicyInputSchema.safeParse(validInput({ coordinatorRoles: missing as never })).success).toBe(false);
  });

  it("refuses yes/no fields given as text", () => {
    expect(routingPolicyInputSchema.safeParse({ ...validInput(), stickyEnabled: "true" }).success).toBe(false);
    expect(routingPolicyInputSchema.safeParse({ ...validInput(), respectShifts: "false" }).success).toBe(false);
  });

  it("drops fields it does not know instead of passing them on to the database", () => {
    const parsed = routingPolicyInputSchema.safeParse({ ...validInput(), agencyId: "someone-elses-agency" });

    expect(parsed.success).toBe(true);
    expect(parsed.success && "agencyId" in parsed.data).toBe(false);
  });
});

describe("the migration and the code agree", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261202091500_mi3_5_inbox_routing_policy.sql"), "utf8");

  it("allows the same group sizes", () => {
    expect(sql).toContain("check (group_threshold between 2 and 500)");
    expect(routingPolicyInputSchema.safeParse(validInput({ groupThreshold: 500 })).success).toBe(true);
    expect(routingPolicyInputSchema.safeParse(validInput({ groupThreshold: 501 })).success).toBe(false);
  });

  it("allows the same balancing modes", () => {
    for (const mode of LOAD_BALANCE_MODES) expect(sql).toContain(`'${mode}'`);
  });

  it("starts from the same defaults the code falls back to", () => {
    expect(sql).toContain(`group_threshold            integer not null default ${DEFAULT_ROUTING_POLICY.groupThreshold}`);
    expect(sql).toContain(`default '${DEFAULT_ROUTING_POLICY.loadBalanceMode}'`);
    expect(sql).toContain("sticky_enabled             boolean not null default true");
    expect(sql).toContain("respect_shifts             boolean not null default true");
  });
});
