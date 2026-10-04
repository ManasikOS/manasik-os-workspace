import type { StaffRole } from "@/lib/access/departure-groups-access";

/**
 * Role-based access for the Visa Operations module.
 *
 * Same posture as `lib/access/documents-access.ts`: pure functions over a
 * role string, usable from Server and Client Components. Capabilities decide
 * what is *fetched*, not merely what is rendered — Finance's payment-blocker
 * scope and Guide's group restriction are query filters in
 * `lib/data/visa-repository.ts`, not UI conditionals. Passport and visa
 * numbers are masked by default for every role and only unmasked behind
 * `viewFullPassportNumber` / `viewVisaNumberAndFile`.
 */

export interface VisaCapabilities {
  viewModule: boolean;
  viewApplicationDetail: boolean;
  viewVisaNumberAndFile: boolean;
  viewFullPassportNumber: boolean;
  createBatch: boolean;
  manageBatch: boolean;
  markSubmitted: boolean;
  recordStatusCheck: boolean;
  recordIssuedVisa: boolean;
  verifyIssuedVisa: boolean;
  amendIssuedVisa: boolean;
  recordRejection: boolean;
  requestRework: boolean;
  assignOfficer: boolean;
  uploadVisaEvidence: boolean;
  sendReminders: boolean;
  runAiAssistant: boolean;
  exportSubmissionPack: boolean;
  exportRiskReport: boolean;
  viewGroupRiskBoard: boolean;
  /** Finance: pilgrim, group and outstanding balance only — no passport/visa fields. */
  viewPaymentBlockersOnly: boolean;
  /** CEO / Finance / Marketing / Guide: no queue actions, read-only surfaces only. */
  readOnly: boolean;
  /** Guide: the risk board, restricted to their assigned group. */
  assignedGroupOnly: boolean;
  configureThresholds: boolean;
}

const NONE: VisaCapabilities = {
  viewModule: false,
  viewApplicationDetail: false,
  viewVisaNumberAndFile: false,
  viewFullPassportNumber: false,
  createBatch: false,
  manageBatch: false,
  markSubmitted: false,
  recordStatusCheck: false,
  recordIssuedVisa: false,
  verifyIssuedVisa: false,
  amendIssuedVisa: false,
  recordRejection: false,
  requestRework: false,
  assignOfficer: false,
  uploadVisaEvidence: false,
  sendReminders: false,
  runAiAssistant: false,
  exportSubmissionPack: false,
  exportRiskReport: false,
  viewGroupRiskBoard: false,
  viewPaymentBlockersOnly: false,
  readOnly: false,
  assignedGroupOnly: false,
  configureThresholds: false,
};

const FULL_OPERATOR: VisaCapabilities = {
  ...NONE,
  viewModule: true,
  viewApplicationDetail: true,
  viewVisaNumberAndFile: true,
  viewFullPassportNumber: true,
  createBatch: true,
  manageBatch: true,
  markSubmitted: true,
  recordStatusCheck: true,
  recordIssuedVisa: true,
  recordRejection: true,
  requestRework: true,
  assignOfficer: true,
  uploadVisaEvidence: true,
  sendReminders: true,
  runAiAssistant: true,
  exportSubmissionPack: true,
  exportRiskReport: true,
  viewGroupRiskBoard: true,
};

const CAPABILITIES: Record<StaffRole, VisaCapabilities> = {
  ADMIN: {
    ...FULL_OPERATOR,
    verifyIssuedVisa: true,
    amendIssuedVisa: true,
    configureThresholds: true,
  },
  // Read-only risk overview — KPI strip, group board, escalations. No queue actions, no batches.
  CEO: {
    ...NONE,
    viewModule: true,
    viewApplicationDetail: true,
    viewVisaNumberAndFile: true,
    viewFullPassportNumber: true,
    runAiAssistant: true,
    exportRiskReport: true,
    viewGroupRiskBoard: true,
    readOnly: true,
  },
  // Payment-related blockers only — never passport, visa numbers or files.
  FINANCE: {
    ...NONE,
    viewModule: true,
    viewPaymentBlockersOnly: true,
    readOnly: true,
  },
  // Aggregate "visa pending" counts only — no row-level access, no PII.
  MARKETING: {
    ...NONE,
    viewModule: true,
    sendReminders: true,
    readOnly: true,
  },
  OPERATIONS: {
    ...FULL_OPERATOR,
    // Operations may record an issue but not verify it — verification is the
    // Visa team's signature and is what the readiness board treats as green.
    verifyIssuedVisa: false,
    amendIssuedVisa: false,
  },
  VISA: {
    ...FULL_OPERATOR,
    verifyIssuedVisa: true,
    amendIssuedVisa: true,
  },
  // Read-only readiness board for their assigned group only. No visa file access.
  GUIDE: {
    ...NONE,
    viewModule: true,
    viewGroupRiskBoard: true,
    readOnly: true,
    assignedGroupOnly: true,
  },
};

export function capabilitiesForVisa(role: StaffRole): VisaCapabilities {
  return CAPABILITIES[role];
}

export const VISA_ISSUE_TYPE_LABELS: Record<string, string> = {
  DOCUMENT_BLOCKER: "Document blocker",
  PHOTO_REJECTED: "Photo rejected",
  NAME_MISMATCH: "Name mismatch",
  DOB_MISMATCH: "Date of birth mismatch",
  PASSPORT_VALIDITY: "Passport validity",
  PORTAL_ERROR: "Portal / submission error",
  REFUSED: "Refused by authority",
  OTHER: "Other",
};

export const VISA_EVIDENCE_SOURCE_LABELS: Record<string, string> = {
  PORTAL_SCREENSHOT: "Portal screenshot",
  AGENT_EMAIL: "Agent / sponsor email",
  PDF: "Official PDF",
  OTHER: "Other",
};
