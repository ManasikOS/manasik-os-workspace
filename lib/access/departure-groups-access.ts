import type {
  DepartureGroupTabId,
  DepartureGroupListItem,
} from "@/app/(main)/departure-groups/types";

/**
 * Role-based access for the Departure Groups module.
 *
 * Pure functions over a role string so both Server Components and Client
 * Components can call them. The role itself is resolved once per request by
 * `getCurrentStaffRole()` in `lib/data/departure-groups.ts` and threaded down
 * as a prop — components never guess it.
 *
 * Note on `internal_cost` and the finance ledger: capabilities here decide
 * whether the data is *fetched at all*, not merely whether it is rendered. The
 * repository nulls out supplier costs for roles without `viewSupplierCosts`.
 */

export const STAFF_ROLES = [
  "ADMIN",
  "CEO",
  "FINANCE",
  "MARKETING",
  "OPERATIONS",
  "VISA",
  "GUIDE",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export interface DepartureGroupCapabilities {
  /** See the module at all. */
  viewModule: boolean;
  createGroup: boolean;
  editGroupDetails: boolean;
  /**
   * Archiving and cancelling. There is deliberately no hard-delete capability:
   * a group carries bookings, money and an activity trail, so it is archived or
   * cancelled — both reversible and both auditable — never erased.
   */
  cancelOrArchiveGroup: boolean;
  overrideCapacityAndPrice: boolean;
  manageFlights: boolean;
  manageAccommodation: boolean;
  manageTransport: boolean;
  manageRooming: boolean;
  /**
   * Reverts a LOCKED room assignment back to ASSIGNED. Kept narrower than
   * `manageRooming` — a lock is meant to hold against day-to-day rooming
   * changes, so undoing one is restricted to the same tier trusted to
   * override capacity and price.
   */
  unlockRoomAssignments: boolean;
  manageReadiness: boolean;
  manageTasks: boolean;
  manageDocumentsAndVisa: boolean;
  addBookings: boolean;
  /** Payments tab, invoices, refunds. */
  viewFinance: boolean;
  recordPayments: boolean;
  /** Supplier `internal_cost` on hotels and transport, and margin figures. */
  viewSupplierCosts: boolean;
  /** Passport numbers, visa IDs, uploaded traveller documents. */
  viewSensitiveTravellerData: boolean;
  sendGroupCommunications: boolean;
  exportReports: boolean;
  /** Guides only ever see the groups they are assigned to. */
  restrictedToAssignedGroups: boolean;
  /**
   * Request a per-traveller deviation and add a non-negative charge (add-on,
   * surcharge). Does not by itself allow discounts or base-fare edits — those
   * are `approveDiscounts` / `overrideCapacityAndPrice`.
   */
  manageTravellerCustomisations: boolean;
  /** Sign off a discount, price correction, or any charge flagged `requiresApproval`. */
  approveDiscounts: boolean;
  /** See a traveller's price breakdown at all. Guides see the deviation, never the amount. */
  viewPilgrimPricing: boolean;
}

const NONE: DepartureGroupCapabilities = {
  viewModule: false,
  createGroup: false,
  editGroupDetails: false,
  cancelOrArchiveGroup: false,
  overrideCapacityAndPrice: false,
  manageFlights: false,
  manageAccommodation: false,
  manageTransport: false,
  manageRooming: false,
  unlockRoomAssignments: false,
  manageReadiness: false,
  manageTasks: false,
  manageDocumentsAndVisa: false,
  addBookings: false,
  viewFinance: false,
  recordPayments: false,
  viewSupplierCosts: false,
  viewSensitiveTravellerData: false,
  sendGroupCommunications: false,
  exportReports: false,
  restrictedToAssignedGroups: false,
  manageTravellerCustomisations: false,
  approveDiscounts: false,
  viewPilgrimPricing: false,
};

const CAPABILITIES: Record<StaffRole, DepartureGroupCapabilities> = {
  ADMIN: {
    ...NONE,
    viewModule: true,
    createGroup: true,
    editGroupDetails: true,
    cancelOrArchiveGroup: true,
    overrideCapacityAndPrice: true,
    manageFlights: true,
    manageAccommodation: true,
    manageTransport: true,
    manageRooming: true,
    unlockRoomAssignments: true,
    manageReadiness: true,
    manageTasks: true,
    manageDocumentsAndVisa: true,
    addBookings: true,
    viewFinance: true,
    recordPayments: true,
    viewSupplierCosts: true,
    viewSensitiveTravellerData: true,
    sendGroupCommunications: true,
    exportReports: true,
    manageTravellerCustomisations: true,
    approveDiscounts: true,
    viewPilgrimPricing: true,
  },
  // Full visibility, read-only day to day. Escalation happens through tasks,
  // which is why `manageTasks` stays on.
  CEO: {
    ...NONE,
    viewModule: true,
    viewFinance: true,
    viewSupplierCosts: true,
    viewSensitiveTravellerData: true,
    manageTasks: true,
    exportReports: true,
    viewPilgrimPricing: true,
  },
  FINANCE: {
    ...NONE,
    viewModule: true,
    viewFinance: true,
    recordPayments: true,
    viewSupplierCosts: true,
    manageReadiness: true,
    manageTasks: true,
    exportReports: true,
    approveDiscounts: true,
    viewPilgrimPricing: true,
  },
  // Sells the group. No supplier costs, no visa data, no traveller documents.
  // Can request customisations (an upsold add-on, a discount ask) but never
  // self-approve a discount — that still needs Admin or Finance.
  MARKETING: {
    ...NONE,
    viewModule: true,
    addBookings: true,
    sendGroupCommunications: true,
    manageTravellerCustomisations: true,
    viewPilgrimPricing: true,
  },
  OPERATIONS: {
    ...NONE,
    viewModule: true,
    createGroup: true,
    editGroupDetails: true,
    manageFlights: true,
    manageAccommodation: true,
    manageTransport: true,
    manageRooming: true,
    manageReadiness: true,
    manageTasks: true,
    manageDocumentsAndVisa: true,
    addBookings: true,
    viewSupplierCosts: true,
    viewSensitiveTravellerData: true,
    sendGroupCommunications: true,
    exportReports: true,
    manageTravellerCustomisations: true,
    viewPilgrimPricing: true,
  },
  VISA: {
    ...NONE,
    viewModule: true,
    manageFlights: true,
    manageAccommodation: true,
    manageTransport: true,
    manageRooming: true,
    manageReadiness: true,
    manageTasks: true,
    manageDocumentsAndVisa: true,
    viewSensitiveTravellerData: true,
    exportReports: true,
    // A DOCUMENT_REQUIREMENT deviation (a mahram letter, a minor's consent
    // form) is theirs to raise; it carries no price.
    manageTravellerCustomisations: true,
  },
  GUIDE: {
    ...NONE,
    viewModule: true,
    manageTasks: true,
    restrictedToAssignedGroups: true,
  },
};

export function capabilitiesFor(role: StaffRole): DepartureGroupCapabilities {
  return CAPABILITIES[role];
}

/** Tabs a role may open. Hidden tabs are never rendered, not merely disabled. */
export function visibleTabsFor(role: StaffRole): DepartureGroupTabId[] {
  const can = capabilitiesFor(role);
  const tabs: DepartureGroupTabId[] = ["overview", "pilgrims", "flights"];

  tabs.push("hotels", "transport");
  if (can.viewFinance) tabs.push("payments");
  if (can.manageDocumentsAndVisa || can.viewSensitiveTravellerData) {
    tabs.push("documents");
  }
  tabs.push("readiness", "guide", "agent");
  // The activity trail replays before/after values, including money changes.
  if (role !== "MARKETING" && role !== "GUIDE") tabs.push("activity");

  return tabs;
}

/**
 * Guides only see their own groups; everyone else sees the branch's groups.
 *
 * Matches on `staff_group_assignments`, not `primary_guide_name` — a display
 * name is not a stable key, so renaming a guide used to silently drop them
 * from every group they were assigned to. See `loadAssignedGroupIds()` in
 * `lib/data/team-repository.ts`.
 */
export function filterGroupsForRole<T extends DepartureGroupListItem>(
  groups: T[],
  role: StaffRole,
  assignedGroupIds: string[],
): T[] {
  if (!capabilitiesFor(role).restrictedToAssignedGroups) return groups;
  if (assignedGroupIds.length === 0) return [];
  const assigned = new Set(assignedGroupIds);
  return groups.filter((g) => assigned.has(g.id));
}

/** Marketing can only work groups that are actually sellable. */
export function canRoleOpenGroup(
  group: DepartureGroupListItem,
  role: StaffRole,
  assignedGroupIds: string[],
): boolean {
  if (role === "GUIDE") return assignedGroupIds.includes(group.id);
  if (role === "MARKETING") {
    return (
      group.salesStatus === "SELLING" ||
      group.salesStatus === "LIMITED_AVAILABILITY" ||
      group.salesStatus === "WAITLIST"
    );
  }
  return true;
}

export const ROLE_LABELS: Record<StaffRole, string> = {
  ADMIN: "Admin",
  CEO: "CEO",
  FINANCE: "Finance",
  MARKETING: "Marketing",
  OPERATIONS: "Operations",
  VISA: "Visa",
  GUIDE: "Guide",
};
