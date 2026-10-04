import type { StaffRole } from "@/lib/access/departure-groups-access";

/**
 * Role-based access for the Supplier Directory.
 *
 * Same posture as `pilgrims-access.ts` and `operations-access.ts`: pure
 * functions over a role string, usable from Server and Client Components.
 * Capabilities decide what is *fetched*, not merely what is rendered —
 * `suppliers-repository.ts` nulls out cost, payment-terms, internal-notes and
 * non-emergency contact fields for roles without the matching capability
 * before a supplier ever reaches a Client Component.
 */

export interface SupplierCapabilities {
  viewModule: boolean;

  createSupplier: boolean;
  editSupplier: boolean;
  deactivateSupplier: boolean;
  setReliability: boolean;

  viewContacts: boolean;
  viewEmergencyContactsOnly: boolean;
  manageContacts: boolean;

  viewCommitments: boolean;
  createCommitment: boolean;
  requestCommitment: boolean;
  confirmCommitment: boolean;
  uploadEvidence: boolean;
  disputeCommitment: boolean;

  viewCosts: boolean;
  viewPayments: boolean;
  recordPayment: boolean;
  viewInternalNotes: boolean;

  importExport: boolean;

  /** CEO / Finance: no directory or commitment mutation, read-only surfaces only. */
  readOnly: boolean;
  /** Guide: restricted to their own assigned groups' commitments. */
  assignedGroupOnly: boolean;
}

const NONE: SupplierCapabilities = {
  viewModule: false,
  createSupplier: false,
  editSupplier: false,
  deactivateSupplier: false,
  setReliability: false,
  viewContacts: false,
  viewEmergencyContactsOnly: false,
  manageContacts: false,
  viewCommitments: false,
  createCommitment: false,
  requestCommitment: false,
  confirmCommitment: false,
  uploadEvidence: false,
  disputeCommitment: false,
  viewCosts: false,
  viewPayments: false,
  recordPayment: false,
  viewInternalNotes: false,
  importExport: false,
  readOnly: false,
  assignedGroupOnly: false,
};

const FULL_OPERATOR: SupplierCapabilities = {
  ...NONE,
  viewModule: true,
  createSupplier: true,
  editSupplier: true,
  deactivateSupplier: true,
  setReliability: true,
  viewContacts: true,
  manageContacts: true,
  viewCommitments: true,
  createCommitment: true,
  requestCommitment: true,
  confirmCommitment: true,
  uploadEvidence: true,
  disputeCommitment: true,
  viewCosts: true,
  viewInternalNotes: true,
  importExport: true,
};

const CAPABILITIES: Record<StaffRole, SupplierCapabilities> = {
  ADMIN: { ...FULL_OPERATOR, viewPayments: true, recordPayment: true },
  // Negotiate rates and manage commitments, but do not touch the payment
  // ledger — that is Finance's surface.
  OPERATIONS: { ...FULL_OPERATOR, viewPayments: false, recordPayment: false },
  // Money only. No supplier editing, no commitment mutation, no internal notes.
  FINANCE: {
    ...NONE,
    viewModule: true,
    viewContacts: true,
    viewCommitments: true,
    viewCosts: true,
    viewPayments: true,
    recordPayment: true,
    readOnly: true,
  },
  // Full visibility, read-only, for reporting and exceptions.
  CEO: {
    ...NONE,
    viewModule: true,
    viewContacts: true,
    viewCommitments: true,
    viewCosts: true,
    viewPayments: true,
    viewInternalNotes: true,
    importExport: true,
    readOnly: true,
  },
  // No supplier costs, no private contacts, no commitments — public
  // package-service summaries belong in Packages, not here.
  MARKETING: { ...NONE },
  // Assigned group only; emergency contacts and their own groups' service
  // details, never costs, payments or notes.
  GUIDE: {
    ...NONE,
    viewModule: true,
    viewCommitments: true,
    viewEmergencyContactsOnly: true,
    assignedGroupOnly: true,
  },
  // No general supplier access in V1 — flip on a VISA_PARTNER-scoped view
  // only when the visa-partner workflow needs it.
  VISA: { ...NONE },
};

export function capabilitiesForSuppliers(role: StaffRole): SupplierCapabilities {
  return CAPABILITIES[role];
}

export const SUPPLIER_TAB_IDS = [
  "overview",
  "commitments",
  "services",
  "contacts",
  "payments",
  "activity",
] as const;

export type SupplierTabId = (typeof SUPPLIER_TAB_IDS)[number];

/** Hides whole tabs a role may not see at all. */
export function visibleTabsForSupplier(role: StaffRole): SupplierTabId[] {
  const can = capabilitiesForSuppliers(role);
  const tabs: SupplierTabId[] = ["overview"];

  if (can.viewCommitments) tabs.push("commitments");
  if (can.viewCosts) tabs.push("services");
  if (can.viewContacts || can.viewEmergencyContactsOnly) tabs.push("contacts");
  if (can.viewPayments) tabs.push("payments");
  if (!can.assignedGroupOnly && role !== "MARKETING") tabs.push("activity");

  return tabs;
}
