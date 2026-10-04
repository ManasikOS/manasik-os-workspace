import type { StaffRole } from "@/lib/access/departure-groups-access";

/**
 * Role-based access for the Documents Operations module.
 *
 * Same posture as `lib/access/pilgrims-access.ts`: pure functions over a role
 * string, usable from Server and Client Components. Capabilities decide what
 * is *fetched*, not merely what is rendered — Finance's scope to payment-proof
 * documents and Marketing's exclusion from sensitive files are query filters
 * in `lib/data/documents-repository.ts`, not UI conditionals.
 */

export interface DocumentCapabilities {
  viewModule: boolean;
  viewDocumentFile: boolean;
  uploadOnBehalf: boolean;
  verifyDocuments: boolean;
  requestRework: boolean;
  waiveRequirement: boolean;
  assignReviewer: boolean;
  sendReminders: boolean;
  runAiScan: boolean;
  viewAiFindings: boolean;
  overrideAiFinding: boolean;
  manageAgentSettings: boolean;
  bulkActions: boolean;
  exportChecklist: boolean;
  exportVisaPack: boolean;
  downloadVerifiedFiles: boolean;
  /** CEO: compact read-only KPI/alert/risk surface, no queue actions. */
  readOnly: boolean;
  /** Finance: scoped to document_type = PAYMENT_PROOF in the repository's where clause. */
  scopedToPaymentProof: boolean;
}

const NONE: DocumentCapabilities = {
  viewModule: false,
  viewDocumentFile: false,
  uploadOnBehalf: false,
  verifyDocuments: false,
  requestRework: false,
  waiveRequirement: false,
  assignReviewer: false,
  sendReminders: false,
  runAiScan: false,
  viewAiFindings: false,
  overrideAiFinding: false,
  manageAgentSettings: false,
  bulkActions: false,
  exportChecklist: false,
  exportVisaPack: false,
  downloadVerifiedFiles: false,
  readOnly: false,
  scopedToPaymentProof: false,
};

const CAPABILITIES: Record<StaffRole, DocumentCapabilities> = {
  ADMIN: {
    ...NONE,
    viewModule: true,
    viewDocumentFile: true,
    uploadOnBehalf: true,
    verifyDocuments: true,
    requestRework: true,
    waiveRequirement: true,
    assignReviewer: true,
    sendReminders: true,
    runAiScan: true,
    viewAiFindings: true,
    overrideAiFinding: true,
    manageAgentSettings: true,
    bulkActions: true,
    exportChecklist: true,
    exportVisaPack: true,
    downloadVerifiedFiles: true,
  },
  // Compact read-only KPI/alert/risk view. No queue, no file access beyond that.
  CEO: {
    ...NONE,
    viewModule: true,
    viewAiFindings: true,
    exportChecklist: true,
    readOnly: true,
  },
  // Payment proofs only, scoped at the query.
  FINANCE: {
    ...NONE,
    viewModule: true,
    viewDocumentFile: true,
    uploadOnBehalf: true,
    verifyDocuments: true,
    requestRework: true,
    sendReminders: true,
    exportChecklist: true,
    scopedToPaymentProof: true,
  },
  // Approved reminders only — never passports, NIC, or medical files.
  MARKETING: {
    ...NONE,
    viewModule: true,
    sendReminders: true,
  },
  OPERATIONS: {
    ...NONE,
    viewModule: true,
    viewDocumentFile: true,
    uploadOnBehalf: true,
    verifyDocuments: true,
    requestRework: true,
    waiveRequirement: true,
    assignReviewer: true,
    sendReminders: true,
    runAiScan: true,
    viewAiFindings: true,
    overrideAiFinding: true,
    manageAgentSettings: true,
    bulkActions: true,
    exportChecklist: true,
    exportVisaPack: true,
    downloadVerifiedFiles: true,
  },
  VISA: {
    ...NONE,
    viewModule: true,
    viewDocumentFile: true,
    uploadOnBehalf: true,
    verifyDocuments: true,
    requestRework: true,
    waiveRequirement: true,
    // Assignment within visa-gated stages only — enforced at the call site.
    assignReviewer: true,
    sendReminders: true,
    runAiScan: true,
    viewAiFindings: true,
    overrideAiFinding: true,
    bulkActions: true,
    exportChecklist: true,
    exportVisaPack: true,
    downloadVerifiedFiles: true,
  },
  GUIDE: { ...NONE },
};

export function capabilitiesForDocuments(role: StaffRole): DocumentCapabilities {
  return CAPABILITIES[role];
}

export const REWORK_REASON_LABELS: Record<string, string> = {
  BLURRED: "Image is blurred",
  EXPIRY_INSUFFICIENT: "Passport expiry insufficient",
  MISSING_PAGE: "Missing page",
  NAME_MISMATCH: "Name mismatch",
  OTHER: "Other",
};
