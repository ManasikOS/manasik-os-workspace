import { capabilitiesFor, type StaffRole } from "@/lib/access/departure-groups-access";
import { capabilitiesForDocuments } from "@/lib/access/documents-access";
import { capabilitiesForFinance } from "@/lib/access/finance-access";
import { capabilitiesForVault } from "@/lib/access/vault-access";
import { capabilitiesForVisa } from "@/lib/access/visa-access";

/**
 * Role-based access for the WhatsApp Inbox. Same posture as every other
 * `*-access.ts` file: pure functions over a role string, usable from Server
 * and Client Components. See §10.2 of
 * docs/modules/whatsapp-ai-agent-implementation-plan.md.
 */

export interface InboxCapabilities {
  viewModule: boolean;
  takeControl: boolean;
  releaseToAi: boolean;
  sendMessage: boolean;
  closeConversation: boolean;
  /** Permanently delete a whole conversation, its messages and its files. Administrators only: it cannot be undone. */
  deleteConversation: boolean;
  assignConversation: boolean;
  retryFailedJob: boolean;
  /** Turn a conversation into work: a task, a visa or payment follow-up, a complaint case (MI4.6). */
  convertConversation: boolean;
  /** Create/edit/delete a saved reply — matches `saved_replies`' own RLS write policy exactly. */
  manageSavedReplies: boolean;
  /** Copy a customer's passport into the traveller's document checklist. Needs Documents upload rights and sensitive-data access too. */
  saveAttachmentToDocuments: boolean;
  /** Open the Finance payments page to check a payment proof. Needs the payments ledger. */
  openFinanceReview: boolean;
  /** Give a traveller's visa file to a visa officer from their passport. Needs visa assignment and sensitive-data access. */
  assignVisaOfficer: boolean;
  /** Confirm a passport's number and expiry and write them to the traveller's record. Same rights as editing that record elsewhere. */
  reviewPassportFields: boolean;
  /** Copy a customer's brochure or other file into the Document Vault. Needs vault write access; the vault is readable by every staff role, so passports and receipts never go there. */
  saveMediaToVault: boolean;
}

type InboxRoleCapabilities = Omit<InboxCapabilities, "saveAttachmentToDocuments" | "openFinanceReview" | "assignVisaOfficer" | "reviewPassportFields" | "saveMediaToVault">;

const NONE: InboxRoleCapabilities = {
  viewModule: false,
  takeControl: false,
  releaseToAi: false,
  sendMessage: false,
  closeConversation: false,
  deleteConversation: false,
  assignConversation: false,
  retryFailedJob: false,
  convertConversation: false,
  manageSavedReplies: false,
};

const CAPABILITIES: Record<StaffRole, InboxRoleCapabilities> = {
  ADMIN: {
    viewModule: true,
    takeControl: true,
    releaseToAi: true,
    sendMessage: true,
    closeConversation: true,
    deleteConversation: true,
    assignConversation: true,
    retryFailedJob: true,
    convertConversation: true,
    manageSavedReplies: true,
  },
  // Overview visibility only — matches its posture in every other module.
  CEO: { ...NONE, viewModule: true },
  MARKETING: {
    viewModule: true,
    takeControl: true,
    releaseToAi: true,
    sendMessage: true,
    closeConversation: true,
    deleteConversation: false,
    assignConversation: true,
    retryFailedJob: false,
    convertConversation: true,
    manageSavedReplies: true,
  },
  OPERATIONS: {
    viewModule: true,
    takeControl: true,
    releaseToAi: true,
    sendMessage: true,
    closeConversation: true,
    deleteConversation: false,
    assignConversation: true,
    retryFailedJob: false,
    convertConversation: true,
    manageSavedReplies: true,
  },
  FINANCE: { ...NONE, viewModule: true },
  VISA: { ...NONE, viewModule: true },
  GUIDE: { ...NONE },
};

export function capabilitiesForInbox(role: StaffRole): InboxCapabilities {
  const inbox = CAPABILITIES[role];
  return {
    ...inbox,
    saveAttachmentToDocuments:
      inbox.viewModule && capabilitiesForDocuments(role).uploadOnBehalf && capabilitiesFor(role).viewSensitiveTravellerData,
    openFinanceReview: inbox.viewModule && capabilitiesForFinance(role).viewLedger,
    reviewPassportFields: inbox.viewModule && capabilitiesFor(role).manageDocumentsAndVisa && capabilitiesFor(role).viewSensitiveTravellerData,
    saveMediaToVault: inbox.viewModule && capabilitiesForVault(role).manageVault,
    assignVisaOfficer: inbox.viewModule && capabilitiesForVisa(role).assignOfficer && capabilitiesFor(role).viewSensitiveTravellerData,
  };
}
