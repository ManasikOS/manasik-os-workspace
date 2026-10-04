import type { StaffRole } from "@/lib/access/departure-groups-access";

/**
 * Role-based access for the Pilgrims module.
 *
 * Same posture as `lib/access/leads-access.ts` and
 * `lib/access/departure-groups-access.ts`: pure functions over a role string,
 * usable from Server and Client Components. Capabilities decide what is
 * *fetched*, not merely what is rendered — the repository nulls out passport,
 * medical and payment fields for roles without the matching capability before
 * a pilgrim ever reaches a Client Component.
 *
 * This module splits the single `viewSensitiveTravellerData` boolean
 * Departure Groups uses into separate capabilities, because Pilgrims puts
 * passport, medical and money on one profile page and the roles that may see
 * one must not automatically see the others (Finance sees money, never
 * medical; Marketing sees neither; Guide sees a reduced medical instruction
 * but no finance).
 */

export interface PilgrimCapabilities {
  viewModule: boolean;
  createPilgrim: boolean;
  editPersonalDetails: boolean;
  viewPassportAndIdentity: boolean;

  viewDocuments: boolean;
  uploadDocuments: boolean;
  verifyDocuments: boolean;

  manageVisa: boolean;

  viewPayments: boolean;
  recordPayments: boolean;

  manageTravelAndRooming: boolean;

  viewMedical: boolean;
  editMedical: boolean;
  manageSupportRequests: boolean;

  viewEmergencyContact: boolean;
  sendCommunications: boolean;

  moveOrCancelPilgrim: boolean;
  managePortalAccess: boolean;
  exportPilgrims: boolean;

  /** Guides only ever see pilgrims in the groups they are assigned to. */
  assignedGroupOnly: boolean;
}

const NONE: PilgrimCapabilities = {
  viewModule: false,
  createPilgrim: false,
  editPersonalDetails: false,
  viewPassportAndIdentity: false,
  viewDocuments: false,
  uploadDocuments: false,
  verifyDocuments: false,
  manageVisa: false,
  viewPayments: false,
  recordPayments: false,
  manageTravelAndRooming: false,
  viewMedical: false,
  editMedical: false,
  manageSupportRequests: false,
  viewEmergencyContact: false,
  sendCommunications: false,
  moveOrCancelPilgrim: false,
  managePortalAccess: false,
  exportPilgrims: false,
  assignedGroupOnly: false,
};

const CAPABILITIES: Record<StaffRole, PilgrimCapabilities> = {
  ADMIN: {
    ...NONE,
    viewModule: true,
    createPilgrim: true,
    editPersonalDetails: true,
    viewPassportAndIdentity: true,
    viewDocuments: true,
    uploadDocuments: true,
    verifyDocuments: true,
    manageVisa: true,
    viewPayments: true,
    recordPayments: true,
    manageTravelAndRooming: true,
    viewMedical: true,
    editMedical: true,
    manageSupportRequests: true,
    viewEmergencyContact: true,
    sendCommunications: true,
    moveOrCancelPilgrim: true,
    managePortalAccess: true,
    exportPilgrims: true,
  },
  // Broad visibility, read-only, for reporting and exceptions.
  CEO: {
    ...NONE,
    viewModule: true,
    viewPassportAndIdentity: true,
    viewDocuments: true,
    viewPayments: true,
    viewEmergencyContact: true,
    exportPilgrims: true,
  },
  // Money only — never medical, never passport/documents.
  FINANCE: {
    ...NONE,
    viewModule: true,
    viewPayments: true,
    recordPayments: true,
    exportPilgrims: true,
  },
  // Basic contact and booking/group status; no passport/visa/medical by default.
  MARKETING: {
    ...NONE,
    viewModule: true,
    editPersonalDetails: true, // contact fields only — enforced field-by-field in the action
    sendCommunications: true,
  },
  // Group assignment, travel, rooms, documents, support — the operational core.
  OPERATIONS: {
    ...NONE,
    viewModule: true,
    createPilgrim: true,
    editPersonalDetails: true,
    viewPassportAndIdentity: true,
    viewDocuments: true,
    uploadDocuments: true,
    verifyDocuments: true,
    manageTravelAndRooming: true,
    viewMedical: true,
    editMedical: true,
    manageSupportRequests: true,
    viewEmergencyContact: true,
    sendCommunications: true,
    moveOrCancelPilgrim: true,
    managePortalAccess: true,
    exportPilgrims: true,
  },
  VISA: {
    ...NONE,
    viewModule: true,
    editPersonalDetails: true,
    viewPassportAndIdentity: true,
    viewDocuments: true,
    uploadDocuments: true,
    verifyDocuments: true,
    manageVisa: true,
    viewEmergencyContact: true,
    sendCommunications: true,
    exportPilgrims: true,
  },
  // Assigned group only; name, contact, room, flight, emergency/support — no
  // finance, no documents, no editable medical (a reduced instruction only).
  GUIDE: {
    ...NONE,
    viewModule: true,
    viewEmergencyContact: true,
    viewMedical: true,
    manageSupportRequests: true,
    sendCommunications: true,
    assignedGroupOnly: true,
  },
};

export function capabilitiesForPilgrims(role: StaffRole): PilgrimCapabilities {
  return CAPABILITIES[role];
}

export const PILGRIM_TAB_IDS = [
  "overview",
  "personal",
  "documents",
  "visa",
  "payments",
  "travel",
  "support",
  "activity",
] as const;

export type PilgrimTabId = (typeof PILGRIM_TAB_IDS)[number];

/** Hides whole tabs a role may not see at all — partial sections inside a
 * visible tab are still gated field-by-field with `PermissionDenied`. */
export function visibleTabsForPilgrim(role: StaffRole): PilgrimTabId[] {
  const can = capabilitiesForPilgrims(role);
  const tabs: PilgrimTabId[] = ["overview", "personal"];

  if (can.viewDocuments) tabs.push("documents");
  if (can.manageVisa || can.viewPassportAndIdentity) tabs.push("visa");
  if (can.viewPayments) tabs.push("payments");
  tabs.push("travel");
  if (can.viewMedical || can.manageSupportRequests) tabs.push("support");
  if (role !== "MARKETING") tabs.push("activity");

  return tabs;
}
