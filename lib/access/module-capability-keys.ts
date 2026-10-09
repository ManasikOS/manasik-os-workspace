/**
 * Generated from the live lib/access/*.ts capability functions — the
 * complete key list per module, used to render the Roles & Permissions
 * editor's toggle grid for every module, including one with no
 * role_permissions row yet (a brand-new custom role). Regenerate with
 * the same approach as supabase/migrations/20260924090000's seed data
 * if a module's Capabilities interface ever gains or loses a field.
 */
import type { PermissionModule } from "@/lib/access/role-permissions-shared";

export const MODULE_LABELS: Record<PermissionModule, string> = {
  departure_groups: "Departure Groups",
  documents: "Documents",
  finance: "Finance",
  leads: "Leads",
  operations: "Operations",
  packages: "Packages",
  pilgrims: "Pilgrims",
  reports: "Reports",
  settings: "Settings",
  suppliers: "Suppliers",
  visa: "Visa",
  team: "Team",
  ai_agent: "Manasik Copilot",
  inbox: "Inbox",
  // Registered in Phase 0 (P0.3) — see
  // docs/modules/manasik-intelligence-implementation-plan.md §1.3 finding F5 and
  // docs/architecture/remaining-modules-master-plan.md §6.
  marketing: "Marketing",
  bookings: "Bookings",
  quotes: "Quotes",
  field_ops: "Field Operations",
  guides: "Guides & Field Team",
  support: "Support & Incidents",
  relationships: "Relationships",
  agents: "Agent Portal",
  analytics: "Analytics",
  insights: "AI Insights",
};

export const MODULE_CAPABILITY_KEYS: Record<PermissionModule, string[]> = {
  departure_groups: ["viewModule", "createGroup", "editGroupDetails", "cancelOrArchiveGroup", "overrideCapacityAndPrice", "manageFlights", "manageAccommodation", "manageTransport", "manageRooming", "unlockRoomAssignments", "manageReadiness", "manageTasks", "manageDocumentsAndVisa", "addBookings", "cancelBookings", "viewFinance", "recordPayments", "viewSupplierCosts", "viewSensitiveTravellerData", "sendGroupCommunications", "exportReports", "restrictedToAssignedGroups", "manageTravellerCustomisations", "approveDiscounts", "viewPilgrimPricing", "eraseTravellerData"],
  documents: ["viewModule", "viewDocumentFile", "uploadOnBehalf", "verifyDocuments", "requestRework", "waiveRequirement", "assignReviewer", "sendReminders", "runAiScan", "viewAiFindings", "overrideAiFinding", "manageAgentSettings", "bulkActions", "exportChecklist", "exportVisaPack", "downloadVerifiedFiles", "readOnly", "scopedToPaymentProof"],
  finance: ["viewModule", "viewReceivables", "viewLedger", "viewInvoices", "viewSupplierPayables", "viewRefunds", "viewReconciliation", "recordPayments", "verifyPayments", "reversePayments", "createInvoices", "sendInvoices", "voidInvoices", "recordSupplierPayments", "requestRefunds", "approveRefunds", "applyAdjustments", "approveAdjustments", "changeMilestoneDueDates", "assignFinanceOwner", "sendReminders", "exportFinanceReport", "viewPaymentStatusOnly", "readOnly"],
  leads: ["viewModule", "createLead", "editLead", "changeStage", "assignLeads", "logContact", "addNote", "sendQuote", "findGroups", "convertToBooking", "mergeDuplicates", "deleteLead", "manageSourcesAndAutomation", "viewPipelineValue", "viewAnalytics", "viewAllOwners", "convertedOnly", "useCopilot", "applyCopilotChanges", "draftCustomerReply", "createQuoteDraft", "applyUnrestrictedDiscount", "viewQuotes"],
  operations: ["viewModule", "createTask", "editTask", "reassignTask", "bulkUpdateTasks", "completeTask", "viewSupplierBoard", "requestSupplier", "confirmSupplier", "addSupplierBooking", "manageFlights", "manageAccommodation", "manageRooming", "manageTransport", "assignGuide", "generateRunSheet", "exportManifest", "viewReadinessMatrix", "viewSupplierCosts", "viewFinanceBlockers", "viewPilgrimContactDetails", "exportOperationsReport", "readOnly", "assignedGroupOnly"],
  packages: ["viewModule", "createPackage", "editPackage", "publishPackage", "duplicatePackage", "archiveOrRestorePackage", "deletePackage", "toggleFeatured", "viewInternalFinance", "exportCatalogue", "createGroupFromPackage", "editSensitiveTerms", "approvePackageChanges"],
  pilgrims: ["viewModule", "createPilgrim", "editPersonalDetails", "viewPassportAndIdentity", "viewDocuments", "uploadDocuments", "verifyDocuments", "manageVisa", "viewPayments", "recordPayments", "manageTravelAndRooming", "viewMedical", "editMedical", "manageSupportRequests", "viewEmergencyContact", "sendCommunications", "moveOrCancelPilgrim", "managePortalAccess", "exportPilgrims", "assignedGroupOnly"],
  reports: ["viewModule", "viewOverview", "viewSales", "viewFinance", "viewGroups", "viewPilgrims", "viewSuppliers", "viewSaved", "viewCostAndMargin", "viewAllBranches", "ownGroupsOnly", "createCustomReports", "saveReports", "shareSavedReports", "scheduleReports", "exportCsv", "exportExcel", "exportPdf"],
  settings: ["viewModule", "viewOrganisation", "editOrganisation", "viewBranches", "editBranches", "viewBranding", "editBranding", "viewOperations", "editOperations", "viewCommunications", "editCommunications", "communicationsScopedToOwnRole", "viewFinance", "editFinance", "viewIntegrations", "editIntegrations", "viewSecurity", "editSecurity", "viewAuditLog", "editData", "exportData", "importData", "viewDangerZone"],
  suppliers: ["viewModule", "createSupplier", "editSupplier", "deactivateSupplier", "setReliability", "viewContacts", "viewEmergencyContactsOnly", "manageContacts", "viewCommitments", "createCommitment", "requestCommitment", "confirmCommitment", "uploadEvidence", "disputeCommitment", "viewCosts", "viewPayments", "recordPayment", "viewInternalNotes", "importExport", "readOnly", "assignedGroupOnly"],
  visa: ["viewModule", "viewApplicationDetail", "viewVisaNumberAndFile", "viewFullPassportNumber", "createBatch", "manageBatch", "markSubmitted", "recordStatusCheck", "recordIssuedVisa", "verifyIssuedVisa", "amendIssuedVisa", "recordRejection", "requestRework", "assignOfficer", "uploadVisaEvidence", "sendReminders", "runAiAssistant", "exportSubmissionPack", "exportRiskReport", "viewGroupRiskBoard", "viewPaymentBlockersOnly", "readOnly", "assignedGroupOnly", "configureThresholds"],
  team: ["viewModule", "viewFullDirectory", "inviteStaff", "editProfile", "changeRole", "deactivateStaff", "assignGroups", "viewWorkload", "viewSecurityTab", "manageSessionsAndPasswords", "exportTeamList", "exportAccessAudit", "viewOwnProfileOnly"],
  ai_agent: ["viewModule", "editSettings", "manageKnowledgeBase", "viewAnalytics"],
  inbox: ["viewModule", "takeControl", "releaseToAi", "sendMessage", "closeConversation", "assignConversation", "retryFailedJob", "convertConversation"],
  // Registered in Phase 0 (P0.3). marketing's keys mirror the live
  // `MarketingCapabilities` interface in lib/access/marketing-access.ts
  // exactly; the other nine are transcribed verbatim from
  // docs/architecture/remaining-modules-master-plan.md §6, since their pages/executors
  // land in later phases and there is no live interface to generate from
  // yet — regenerate this list from a real Capabilities interface the
  // moment one exists, per this file's own header instruction.
  marketing: ["viewModule", "manageCampaigns", "manageCampaignStatus", "editSpend", "useAudienceForBroadcast", "manageContent", "viewAttribution", "actOnDiagnosis"],
  bookings: ["viewModule", "createBooking", "editCommercials", "addTraveller", "changePackageOrGroup", "transferBooking", "cancelBooking", "approveDiscount", "viewFinancials", "viewSensitiveTravellerData", "assignOwners", "exportBookings", "assignedGroupOnly"],
  quotes: ["viewModule", "createQuote", "editQuote", "sendQuote", "applyDiscount", "applyUnrestrictedDiscount", "approveDiscount", "acceptOnBehalf", "rejectQuote", "convertToBooking", "viewMargin"],
  field_ops: ["viewModule", "manageFlights", "issueTickets", "manageHotelContracts", "manageRooming", "unlockRoomAssignments", "manageTransport", "manageItinerary", "publishItinerary", "exportManifest", "viewSupplierCosts", "assignedGroupOnly"],
  guides: ["viewModule", "manageRoster", "assignGuides", "viewGuideWorkload", "viewAssignedManifest", "submitCheckin", "recordHandover", "viewPilgrimContacts", "viewMedicalFlags"],
  support: ["viewModule", "createCase", "assignCase", "escalate", "resolveCase", "closeCase", "viewMedicalDetail", "viewComplaints", "runPostTripReview"],
  relationships: ["viewModule", "configurePortal", "managePortalAccess", "draftAnnouncement", "approveAnnouncement", "sendAnnouncement", "manageSurveys", "viewResponses", "manageLoyalty", "awardCredit"],
  agents: ["viewModule", "onboardAgent", "setCreditLimit", "allocatePackages", "approveAgentBooking", "viewAgentMargin", "settleCommissions"],
  analytics: ["viewModule", "viewGrowth", "viewSales", "viewFinance", "viewMargin", "viewSupplier", "viewServiceQuality", "viewAllBranches", "exportAnalytics"],
  insights: ["viewModule", "viewInsight", "dismissInsight", "actOnInsight", "manageAiSettings", "viewAiActionHistory", "viewShadowResults", "manageAiSurfaces", "reviewAiFeedback", "runGenerators", "approveInboxAnswer"],
};
