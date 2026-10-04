import type { StaffRole } from "@/lib/access/departure-groups-access";

/**
 * Role-based access for the Operations Control Center.
 *
 * Same posture as `documents-access.ts` and `visa-access.ts`: pure functions
 * over a role string, usable from Server and Client Components. Capabilities
 * decide what is *fetched*, not merely what is rendered — supplier cost
 * figures and finance data are nulled in `operations-repository.ts` before
 * they leave the module, never merely hidden in the UI.
 */

export interface OperationsCapabilities {
  viewModule: boolean;
  createTask: boolean;
  editTask: boolean;
  reassignTask: boolean;
  bulkUpdateTasks: boolean;
  completeTask: boolean;
  viewSupplierBoard: boolean;
  requestSupplier: boolean;
  confirmSupplier: boolean;
  addSupplierBooking: boolean;
  manageFlights: boolean;
  manageAccommodation: boolean;
  manageRooming: boolean;
  manageTransport: boolean;
  assignGuide: boolean;
  generateRunSheet: boolean;
  exportManifest: boolean;
  viewReadinessMatrix: boolean;
  viewSupplierCosts: boolean;
  viewFinanceBlockers: boolean;
  viewPilgrimContactDetails: boolean;
  exportOperationsReport: boolean;
  acknowledgeInboxHandoff: boolean;
  /** CEO / Finance / Marketing / Guide: no queue actions, read-only surfaces only. */
  readOnly: boolean;
  /** Guide: restricted to their own assigned groups. */
  assignedGroupOnly: boolean;
}

const NONE: OperationsCapabilities = {
  viewModule: false,
  createTask: false,
  editTask: false,
  reassignTask: false,
  bulkUpdateTasks: false,
  completeTask: false,
  viewSupplierBoard: false,
  requestSupplier: false,
  confirmSupplier: false,
  addSupplierBooking: false,
  manageFlights: false,
  manageAccommodation: false,
  manageRooming: false,
  manageTransport: false,
  assignGuide: false,
  generateRunSheet: false,
  exportManifest: false,
  viewReadinessMatrix: false,
  viewSupplierCosts: false,
  viewFinanceBlockers: false,
  viewPilgrimContactDetails: false,
  exportOperationsReport: false,
  acknowledgeInboxHandoff: false,
  readOnly: false,
  assignedGroupOnly: false,
};

const FULL_OPERATOR: OperationsCapabilities = {
  ...NONE,
  viewModule: true,
  createTask: true,
  editTask: true,
  reassignTask: true,
  bulkUpdateTasks: true,
  completeTask: true,
  viewSupplierBoard: true,
  requestSupplier: true,
  confirmSupplier: true,
  addSupplierBooking: true,
  manageFlights: true,
  manageAccommodation: true,
  manageRooming: true,
  manageTransport: true,
  assignGuide: true,
  generateRunSheet: true,
  exportManifest: true,
  viewReadinessMatrix: true,
  viewSupplierCosts: true,
  viewPilgrimContactDetails: true,
  exportOperationsReport: true,
  acknowledgeInboxHandoff: true,
};

const CAPABILITIES: Record<StaffRole, OperationsCapabilities> = {
  ADMIN: { ...FULL_OPERATOR, viewFinanceBlockers: true },
  // Full visibility, read-only by default. May still escalate by creating a task.
  CEO: {
    ...NONE,
    viewModule: true,
    createTask: true,
    viewSupplierBoard: true,
    viewReadinessMatrix: true,
    viewSupplierCosts: true,
    viewFinanceBlockers: true,
    viewPilgrimContactDetails: true,
    exportOperationsReport: true,
    readOnly: true,
  },
  OPERATIONS: { ...FULL_OPERATOR, viewFinanceBlockers: true },
  // Visa- and document-related tasks and readiness only. May request a
  // supplier service but not confirm it.
  VISA: {
    ...NONE,
    viewModule: true,
    createTask: true,
    editTask: true,
    completeTask: true,
    viewSupplierBoard: true,
    requestSupplier: true,
    viewReadinessMatrix: true,
    viewPilgrimContactDetails: true,
  },
  // Payment blockers and supplier payables only — no broad task editing, no
  // supplier confirmation.
  FINANCE: {
    ...NONE,
    viewModule: true,
    viewSupplierBoard: true,
    viewSupplierCosts: true,
    viewFinanceBlockers: true,
    viewReadinessMatrix: true,
    readOnly: true,
  },
  // Group sales status and approved communications only — no supplier costs,
  // no pilgrim contact details.
  MARKETING: {
    ...NONE,
    viewModule: true,
    viewReadinessMatrix: true,
    readOnly: true,
  },
  // Assigned group tasks, run sheet, pilgrim travel details, rooming — no
  // finance or supplier cost access.
  GUIDE: {
    ...NONE,
    viewModule: true,
    completeTask: true,
    generateRunSheet: true,
    exportManifest: true,
    viewPilgrimContactDetails: true,
    assignedGroupOnly: true,
  },
};

export function capabilitiesForOperations(role: StaffRole): OperationsCapabilities {
  return CAPABILITIES[role];
}
