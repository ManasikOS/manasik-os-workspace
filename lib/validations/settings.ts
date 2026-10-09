import { z } from "zod";

/**
 * Zod schemas for every Settings Server Action input. Mirrors
 * `lib/validations/team.ts`. One schema per section (§5 of the plan), plus
 * branches, templates and integrations, which have their own CRUD.
 */

const ROLES = ["ADMIN", "CEO", "FINANCE", "MARKETING", "OPERATIONS", "VISA", "GUIDE"] as const;
const BRANCH_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"] as const;
const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CARD", "ONLINE", "CHEQUE", "OTHER"] as const;
const TEMPLATE_CATEGORIES = [
  "LEAD_RECEIVED",
  "FIRST_FOLLOW_UP",
  "PACKAGE_QUOTATION",
  "BOOKING_CONFIRMATION",
  "DEPOSIT_REMINDER",
  "PAYMENT_DUE_REMINDER",
  "MISSING_DOCUMENT_REMINDER",
  "DOCUMENT_REWORK_REQUEST",
  "VISA_STATUS_UPDATE",
  "VISA_APPROVED",
  "PRE_DEPARTURE_BRIEFING",
  "GUIDE_CONTACT_MESSAGE",
  "DEPARTURE_REMINDER",
  "POST_TRIP_FEEDBACK_REQUEST",
  "REFUND_UPDATE",
] as const;
const TEMPLATE_CHANNELS = ["WHATSAPP", "EMAIL", "PORTAL", "SMS"] as const;
const TEMPLATE_AUDIENCES = ["LEAD", "BOOKING_CONTACT", "PILGRIM", "GROUP", "STAFF"] as const;
const INTEGRATION_PROVIDERS = [
  "WHATSAPP_BUSINESS",
  "EMAIL",
  "SMS",
  "PAYMENT_GATEWAY",
  "FILE_STORAGE",
  "ACCOUNTING",
  "NUSUK",
] as const;

/* ── §5.1 Organisation ────────────────────────────────────────────────────── */

export const organisationSettingsSchema = z.object({
  agencyName: z.string().trim().min(1, "Enter the agency name."),
  legalName: z.string().trim().max(200).optional(),
  registrationNumber: z.string().trim().max(80).optional(),
  defaultCountry: z.string().trim().min(1, "Choose a country."),
  defaultCurrency: z.string().trim().min(1, "Choose a currency."),
  timezone: z.string().trim().min(1, "Choose a timezone."),
  defaultLanguage: z.string().trim().min(1, "Choose a default language."),
  supportedLanguages: z.array(z.string().trim().min(1)).min(1, "Choose at least one staff language."),
  primaryEmail: z.string().trim().email("Enter a valid email address.").optional().or(z.literal("")),
  primaryWhatsapp: z.string().trim().max(40).optional(),
  officeAddress: z.string().trim().max(500).optional(),
});
export type OrganisationSettingsInput = z.infer<typeof organisationSettingsSchema>;

/* ── §5.2 Branches ────────────────────────────────────────────────────────── */

export const branchSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(1, "Enter a branch name."),
  code: z
    .string()
    .trim()
    .min(1, "Enter a branch code.")
    .max(12, "Keep the branch code short.")
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens only."),
  address: z.string().trim().max(500).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().email("Enter a valid email address.").optional().or(z.literal("")),
  managerId: z.string().trim().optional(),
  managerName: z.string().trim().max(120).optional(),
  defaultCurrency: z.string().trim().min(1, "Choose a currency."),
  status: z.enum(BRANCH_STATUSES),
  isPrimary: z.boolean().default(false),
});
export type BranchInput = z.infer<typeof branchSchema>;

export const branchRulesSchema = z.object({
  restrictStaffToAssignedBranch: z.boolean(),
  allowAdminViewAllBranches: z.boolean(),
  allowCeoViewAllBranches: z.boolean(),
  allowCrossBranchBookingManagement: z.boolean(),
});
export type BranchRulesInput = z.infer<typeof branchRulesSchema>;

export const archiveBranchSchema = z.object({
  branchId: z.string().trim().min(1),
});
export type ArchiveBranchInput = z.infer<typeof archiveBranchSchema>;

/* ── §5.3 Branding & Pilgrim Portal ───────────────────────────────────────── */

export const brandingSettingsSchema = z.object({
  logoPath: z.string().trim().optional(),
  portalPrimaryColour: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Enter a hex colour, e.g. #0EA5E9."),
  portalSecondaryColour: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Enter a hex colour, e.g. #0EA5E9.")
    .optional()
    .or(z.literal("")),
  portalWelcomeMessage: z.string().trim().max(500).optional(),
  portalSupportWhatsapp: z.string().trim().max(40).optional(),
  portalSupportEmail: z.string().trim().email("Enter a valid email address.").optional().or(z.literal("")),
  websiteUrl: z.string().trim().url("Enter a valid URL.").optional().or(z.literal("")),
  termsUrl: z.string().trim().url("Enter a valid URL.").optional().or(z.literal("")),
  invoiceFooter: z.string().trim().max(300).optional(),
  portalFlags: z.object({
    allowDocumentUploads: z.boolean(),
    allowViewPaymentSchedule: z.boolean(),
    allowUploadPaymentProof: z.boolean(),
    showItineraryAfterConfirmation: z.boolean(),
    showHotelDetailsAfterConfirmation: z.boolean(),
    showGuideContact7DaysBefore: z.boolean(),
    allowSupportRequests: z.boolean(),
  }),
});
export type BrandingSettingsInput = z.infer<typeof brandingSettingsSchema>;

/* ── §5.4 Operational Defaults ────────────────────────────────────────────── */

export const operationalDefaultsSchema = z
  .object({
    defaultGroupCapacity: z.coerce.number().int().min(1, "Capacity must be at least 1."),
    minimumGroupSize: z.coerce.number().int().min(1, "Minimum group size must be at least 1."),
    defaultSeatHoldHours: z.coerce.number().int().min(1, "Seat hold must be at least 1 hour."),
    defaultGuideRatio: z.coerce.number().int().min(1, "Guide ratio must be at least 1."),
    defaultGroupStatus: z.string().trim().min(1),
    defaultSalesStatus: z.string().trim().min(1),
    waitlistsEnabledByDefault: z.boolean(),
    readinessReadyThreshold: z.coerce.number().int().min(0).max(100),
    readinessAtRiskThreshold: z.coerce.number().int().min(0).max(100),
    criticalFlags: z.object({
      missingFlightsIsCritical: z.boolean(),
      missingHotelConfirmationIsCritical: z.boolean(),
      pendingVisaWithin7DaysIsCritical: z.boolean(),
      overduePaymentsIsHighPriority: z.boolean(),
    }),
    passportValidityMonths: z.coerce.number().int().min(1),
    passportPhotoRequirement: z.string().trim().min(1),
    documentReminderDays: z.coerce.number().int().min(1),
    documentReworkDeadlineHours: z.coerce.number().int().min(1),
    visaEscalationDays: z.coerce.number().int().min(1),
    requireDocumentVerification: z.boolean(),
    requireVisaVerification: z.boolean(),
  })
  .refine((input) => input.defaultGroupCapacity >= input.minimumGroupSize, {
    message: "Default capacity must be at least the minimum group size.",
    path: ["defaultGroupCapacity"],
  })
  .refine((input) => input.readinessReadyThreshold > input.readinessAtRiskThreshold, {
    message: "Ready threshold must be higher than the At Risk threshold.",
    path: ["readinessReadyThreshold"],
  });
export type OperationalDefaultsInput = z.infer<typeof operationalDefaultsSchema>;

/* ── §5.5 Communication Templates ─────────────────────────────────────────── */

export const messageTemplateSchema = z.object({
  id: z.string().trim().optional(),
  category: z.enum(TEMPLATE_CATEGORIES),
  name: z.string().trim().min(1, "Enter a template name."),
  channel: z.enum(TEMPLATE_CHANNELS),
  audience: z.enum(TEMPLATE_AUDIENCES),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1, "Enter the message body."),
  language: z.string().trim().min(1).default("en"),
  isActive: z.boolean().default(true),
  assignedRoles: z.array(z.enum(ROLES)).default([]),
});
export type MessageTemplateInput = z.infer<typeof messageTemplateSchema>;

export const deleteTemplateSchema = z.object({ templateId: z.string().trim().min(1) });
export type DeleteTemplateInput = z.infer<typeof deleteTemplateSchema>;

/* ── §5.6 Finance Defaults ────────────────────────────────────────────────── */

export const financeDefaultsSchema = z.object({
  defaultCurrency: z.string().trim().min(1, "Choose a currency."),
  supportedCurrencies: z.array(z.string().trim().min(1)).min(1, "Choose at least one currency."),
  invoicePrefix: z
    .string()
    .trim()
    .min(1, "Enter an invoice prefix.")
    .max(10)
    .regex(/^[A-Z0-9-]+$/, "Use uppercase letters, numbers and hyphens only."),
  receiptPrefix: z
    .string()
    .trim()
    .min(1, "Enter a receipt prefix.")
    .max(10)
    .regex(/^[A-Z0-9-]+$/, "Use uppercase letters, numbers and hyphens only."),
  paymentPrefix: z
    .string()
    .trim()
    .min(1, "Enter a payment prefix.")
    .max(10)
    .regex(/^[A-Z0-9-]+$/, "Use uppercase letters, numbers and hyphens only."),
  supplierBillPrefix: z
    .string()
    .trim()
    .min(1, "Enter a supplier bill prefix.")
    .max(10)
    .regex(/^[A-Z0-9-]+$/, "Use uppercase letters, numbers and hyphens only."),
  defaultPaymentTerms: z.string().trim().max(200).optional(),
  enabledPaymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1, "Enable at least one payment method."),
  invoiceFooter: z.string().trim().max(300).optional(),
  autoGenerateReceipt: z.boolean(),
  requireBankProof: z.boolean(),
  marginVisibleRoles: z.array(z.enum(ROLES)),
});
export type FinanceDefaultsInput = z.infer<typeof financeDefaultsSchema>;

/* ── §5.7 Integrations ────────────────────────────────────────────────────── */

export const updateIntegrationNotesSchema = z.object({
  provider: z.enum(INTEGRATION_PROVIDERS),
  notes: z.string().trim().max(1000).optional(),
});
export type UpdateIntegrationNotesInput = z.infer<typeof updateIntegrationNotesSchema>;

/* ── §5.8 Security & Access ───────────────────────────────────────────────── */

export const packageApprovalPolicySchema = z.object({
  moneyAndContract: z.boolean(),
  bookingsAndOperations: z.boolean(),
});

export const securityDefaultsSchema = z.object({
  defaultStaffRole: z.enum(ROLES),
  requireAccountApproval: z.boolean(),
  seasonalAutoExpiryEnabled: z.boolean(),
  seasonalExpiryDays: z.coerce.number().int().min(1),
  sessionIdleTimeoutMinutes: z.coerce.number().int().min(5),
  accessRestrictionFlags: z.object({
    restrictGuidesToAssignedGroups: z.boolean(),
    restrictMarketingFromPassportVisaData: z.boolean(),
    restrictGuidesFromFinanceData: z.boolean(),
    restrictFinanceFromMedicalRecords: z.boolean(),
  }),
});
export type SecurityDefaultsInput = z.infer<typeof securityDefaultsSchema>;

/* ── §5.9 Data & Audit ────────────────────────────────────────────────────── */

export const retentionSettingsSchema = z.object({
  documentRetentionYears: z.coerce.number().int().min(1),
  archivedGroupRetentionYears: z.coerce.number().int().min(1),
  deactivatedUserRetentionYears: z.coerce.number().int().min(1),
  immutableFinanceHistory: z.boolean(),
  keepDocumentVerificationHistory: z.boolean(),
});
export type RetentionSettingsInput = z.infer<typeof retentionSettingsSchema>;

export const exportDataSchema = z.object({
  entity: z.enum(["PILGRIMS", "BOOKINGS", "PAYMENTS", "INVOICES", "REPORTS", "AUDIT_LOG"]),
});
export type ExportDataInput = z.infer<typeof exportDataSchema>;

/* ── §5.10 Danger Zone ────────────────────────────────────────────────────── */

export const archiveBranchConfirmSchema = z.object({
  branchId: z.string().trim().min(1),
  confirmCode: z.string().trim().min(1, "Type the branch code to confirm."),
});
export type ArchiveBranchConfirmInput = z.infer<typeof archiveBranchConfirmSchema>;

export const setPortalActiveSchema = z.object({
  active: z.boolean(),
  confirmText: z.string().trim().min(1, "Type CONFIRM to proceed."),
});
export type SetPortalActiveInput = z.infer<typeof setPortalActiveSchema>;

export const requestFullExportSchema = z.object({
  confirmText: z.string().trim().min(1, "Type CONFIRM to proceed."),
});
export type RequestFullExportInput = z.infer<typeof requestFullExportSchema>;

/** The reset phrase is deliberately longer than the other Danger Zone confirmations — this one has no undo. */
export const RESET_AGENCY_DATA_PHRASE = "DELETE ALL DATA";
export const resetAgencyDataSchema = z.object({
  confirmText: z.string().trim().min(1, `Type ${RESET_AGENCY_DATA_PHRASE} to proceed.`),
});
export type ResetAgencyDataInput = z.infer<typeof resetAgencyDataSchema>;

/** Flattens a zod error into `{ field: message }`, same shape as `toTeamFieldErrors`. */
export function toSettingsFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_root";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
