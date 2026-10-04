import type { StaffRole } from "@/lib/access/departure-groups-access";

/**
 * Role-based access for the Leads module.
 *
 * Same posture as `lib/access/departure-groups-access.ts` and
 * `lib/access/packages-access.ts`: pure functions over a role string, usable
 * from Server and Client Components. Capabilities decide what is *fetched*,
 * not merely what is rendered — `filterLeadsForRole` and
 * `nullPipelineValueForRole` are applied in the repository before a lead ever
 * reaches a Client Component.
 */

export interface LeadCapabilities {
  viewModule: boolean;
  createLead: boolean;
  editLead: boolean;
  changeStage: boolean;
  assignLeads: boolean;
  logContact: boolean;
  addNote: boolean;
  sendQuote: boolean;
  findGroups: boolean;
  convertToBooking: boolean;
  mergeDuplicates: boolean;
  deleteLead: boolean;
  manageSourcesAndAutomation: boolean;
  /** Estimated value / pipeline totals; Operations & Visa never see money. */
  viewPipelineValue: boolean;
  viewAnalytics: boolean;
  /** Everyone else's leads, not just the signed-in owner's. */
  viewAllOwners: boolean;
  /** Only converted leads (i.e. those with a booking) are visible at all. */
  convertedOnly: boolean;

  /* ── Manasik Sales Intelligence (Lead Drawer → Manasik Decision) ── */
  /** Build offers, compare options and Ask Manasik. CEO gets this read-only. */
  useCopilot: boolean;
  /** Analyse enquiries, apply extracted intent and select an offer onto the lead. */
  applyCopilotChanges: boolean;
  /** Generate and save customer reply drafts. */
  draftCustomerReply: boolean;
  /** Save quote drafts. Never creates a booking or holds seats. */
  createQuoteDraft: boolean;
  /** Discounts without approval. Without it, a discounted quote is saved as PENDING_APPROVAL. */
  applyUnrestrictedDiscount: boolean;
  /** Quote list and amounts in the Lead Drawer. */
  viewQuotes: boolean;
}

const NONE: LeadCapabilities = {
  viewModule: false,
  createLead: false,
  editLead: false,
  changeStage: false,
  assignLeads: false,
  logContact: false,
  addNote: false,
  sendQuote: false,
  findGroups: false,
  convertToBooking: false,
  mergeDuplicates: false,
  deleteLead: false,
  manageSourcesAndAutomation: false,
  viewPipelineValue: false,
  viewAnalytics: false,
  viewAllOwners: false,
  convertedOnly: false,
  useCopilot: false,
  applyCopilotChanges: false,
  draftCustomerReply: false,
  createQuoteDraft: false,
  applyUnrestrictedDiscount: false,
  viewQuotes: false,
};

const CAPABILITIES: Record<StaffRole, LeadCapabilities> = {
  ADMIN: {
    ...NONE,
    viewModule: true,
    createLead: true,
    editLead: true,
    changeStage: true,
    assignLeads: true,
    logContact: true,
    addNote: true,
    sendQuote: true,
    findGroups: true,
    convertToBooking: true,
    mergeDuplicates: true,
    deleteLead: true,
    manageSourcesAndAutomation: true,
    viewPipelineValue: true,
    viewAnalytics: true,
    viewAllOwners: true,
    useCopilot: true,
    applyCopilotChanges: true,
    draftCustomerReply: true,
    createQuoteDraft: true,
    applyUnrestrictedDiscount: true,
    viewQuotes: true,
  },
  // Read-only overview: pipeline visibility and conversion reporting, no editing.
  // Sees Copilot offers, comparisons and quotes; cannot draft, apply or save.
  CEO: {
    ...NONE,
    viewModule: true,
    viewPipelineValue: true,
    viewAnalytics: true,
    viewAllOwners: true,
    useCopilot: true,
    viewQuotes: true,
  },
  MARKETING: {
    ...NONE,
    viewModule: true,
    createLead: true,
    editLead: true,
    changeStage: true,
    assignLeads: true,
    logContact: true,
    addNote: true,
    sendQuote: true,
    findGroups: true,
    convertToBooking: true,
    viewPipelineValue: true,
    viewAnalytics: true,
    viewAllOwners: true,
    // Discounts are allowed but land as PENDING_APPROVAL for an Admin.
    useCopilot: true,
    applyCopilotChanges: true,
    draftCustomerReply: true,
    createQuoteDraft: true,
    viewQuotes: true,
  },
  // Sees booking/deposit status once a lead has converted; no pipeline editing.
  // Can view quote/deposit data; cannot draft sales replies.
  FINANCE: {
    ...NONE,
    viewModule: true,
    viewPipelineValue: true,
    viewAnalytics: true,
    viewAllOwners: true,
    convertedOnly: true,
    viewQuotes: true,
  },
  // Handover details on converted bookings only; no lead-pipeline editing.
  OPERATIONS: {
    ...NONE,
    viewModule: true,
    viewAllOwners: true,
    convertedOnly: true,
  },
  VISA: {
    ...NONE,
    viewModule: true,
    viewAllOwners: true,
    convertedOnly: true,
  },
  // No general Leads access.
  GUIDE: { ...NONE },
};

export function capabilitiesForLeads(role: StaffRole): LeadCapabilities {
  return CAPABILITIES[role];
}
