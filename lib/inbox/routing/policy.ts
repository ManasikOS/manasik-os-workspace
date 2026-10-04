/**
 * The routing policy's shape and defaults — MI3.5 of docs/inbox/implementation-plan.md (Architecture §16 R3). Pure and client-safe.
 * `null` means "the agency has no `inbox_routing_policy` row": the chain is off and nothing changes from before the slice.
 */

import { z } from "zod";

/** Roles a conversation can be routed to on purpose. GUIDE and CEO are not inbox staff. */
export const COORDINATOR_ROLES = ["ADMIN", "MARKETING", "OPERATIONS", "FINANCE", "VISA"] as const;
export type CoordinatorRole = (typeof COORDINATOR_ROLES)[number];

/** What a conversation is about, as far as routing cares. Topic wins over party size: a visa question from 12 goes to visa. */
export const ROUTING_TOPICS = ["GROUP", "VISA_ISSUES", "DOCUMENTS"] as const;
export type RoutingTopic = (typeof ROUTING_TOPICS)[number];

export const LOAD_BALANCE_MODES = ["LEAST_LOADED", "ROUND_ROBIN"] as const;
export type LoadBalanceMode = (typeof LOAD_BALANCE_MODES)[number];

export const DEFAULT_COORDINATOR_ROLES: Record<RoutingTopic, CoordinatorRole> = {
  GROUP: "OPERATIONS",
  VISA_ISSUES: "VISA",
  DOCUMENTS: "OPERATIONS",
};

export interface RoutingPolicy {
  stickyEnabled: boolean;
  /** A party of at least this many is a group enquiry. */
  groupThreshold: number;
  loadBalanceMode: LoadBalanceMode;
  /** Also require agency office hours; individual shift and leave availability is always required. */
  respectShifts: boolean;
  coordinatorRoles: Record<RoutingTopic, CoordinatorRole>;
}

export const routingPolicyInputSchema = z.object({
  stickyEnabled: z.boolean(),
  groupThreshold: z.number().int().min(2, "A group is at least 2 people.").max(500),
  loadBalanceMode: z.enum(LOAD_BALANCE_MODES),
  respectShifts: z.boolean(),
  coordinatorRoles: z.object({
    GROUP: z.enum(COORDINATOR_ROLES),
    VISA_ISSUES: z.enum(COORDINATOR_ROLES),
    DOCUMENTS: z.enum(COORDINATOR_ROLES),
  }),
});
export type RoutingPolicyInput = z.infer<typeof routingPolicyInputSchema>;

/** The policy the code uses when a row is created without touching a knob. */
export const DEFAULT_ROUTING_POLICY: RoutingPolicy = {
  stickyEnabled: true,
  groupThreshold: 10,
  loadBalanceMode: "LEAST_LOADED",
  respectShifts: true,
  coordinatorRoles: DEFAULT_COORDINATOR_ROLES,
};

interface RoutingPolicyRow {
  sticky_enabled?: unknown;
  group_threshold?: unknown;
  load_balance_mode?: unknown;
  respect_shifts?: unknown;
  coordinator_role_by_queue?: unknown;
}

/** A stored row → a policy. A bad or missing knob falls back to its default rather than breaking routing. */
export function policyFromRow(row: RoutingPolicyRow): RoutingPolicy {
  const stored = row.coordinator_role_by_queue && typeof row.coordinator_role_by_queue === "object" ? (row.coordinator_role_by_queue as Record<string, unknown>) : {};
  const roleFor = (topic: RoutingTopic): CoordinatorRole => {
    const value = stored[topic];
    return (COORDINATOR_ROLES as readonly unknown[]).includes(value) ? (value as CoordinatorRole) : DEFAULT_COORDINATOR_ROLES[topic];
  };
  const threshold = typeof row.group_threshold === "number" && Number.isInteger(row.group_threshold) && row.group_threshold >= 2 ? row.group_threshold : DEFAULT_ROUTING_POLICY.groupThreshold;
  return {
    stickyEnabled: typeof row.sticky_enabled === "boolean" ? row.sticky_enabled : DEFAULT_ROUTING_POLICY.stickyEnabled,
    groupThreshold: threshold,
    loadBalanceMode: (LOAD_BALANCE_MODES as readonly unknown[]).includes(row.load_balance_mode) ? (row.load_balance_mode as LoadBalanceMode) : DEFAULT_ROUTING_POLICY.loadBalanceMode,
    respectShifts: typeof row.respect_shifts === "boolean" ? row.respect_shifts : DEFAULT_ROUTING_POLICY.respectShifts,
    coordinatorRoles: { GROUP: roleFor("GROUP"), VISA_ISSUES: roleFor("VISA_ISSUES"), DOCUMENTS: roleFor("DOCUMENTS") },
  };
}

export function policyToRow(input: RoutingPolicyInput) {
  return {
    sticky_enabled: input.stickyEnabled,
    group_threshold: input.groupThreshold,
    load_balance_mode: input.loadBalanceMode,
    respect_shifts: input.respectShifts,
    coordinator_role_by_queue: input.coordinatorRoles,
  };
}
