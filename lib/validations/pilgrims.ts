import { z } from "zod";

/**
 * Validation for Pilgrims module inputs. Same pattern as
 * `lib/validations/leads.ts`: one schema shared by the client (instant
 * feedback) and the Server Action (the real gate).
 */

const GENDERS = ["MALE", "FEMALE"] as const;
const CONTACT_CHANNELS = ["WHATSAPP", "CALL", "EMAIL", "SMS", "IN_PERSON"] as const;
const RELATIONSHIPS = ["SELF", "SPOUSE", "CHILD", "PARENT", "SIBLING", "OTHER"] as const;
const SUPPORT_CATEGORIES = [
  "MOBILITY",
  "MEDICAL",
  "DIETARY",
  "FLIGHT",
  "ROOMING",
  "DOCUMENT",
  "PAYMENT",
  "COMPLAINT",
  "OTHER",
] as const;
const SUPPORT_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

export const createPilgrimSchema = z.object({
  fullName: z.string().trim().min(1, "Enter the pilgrim's full name."),
  gender: z.enum(GENDERS).default("MALE"),
  dateOfBirth: z.string().nullable(),
  nationality: z.string(),
  nationalId: z.string(),
  city: z.string(),
  preferredLanguage: z.string(),
  whatsappNumber: z.string().min(1, "A WhatsApp / mobile number is required."),
  mobileNumber: z.string(),
  email: z.string(),
  preferredChannel: z.enum(CONTACT_CHANNELS).default("WHATSAPP"),
  passportNumber: z.string(),
  passportExpiry: z.string().nullable(),
  emergencyContactName: z.string(),
  emergencyContactRelationship: z.string(),
  emergencyContactPhone: z.string(),

  bookingId: z.string().trim().min(1, "Select the booking this traveller belongs to."),
  relationshipToPrimary: z.enum(RELATIONSHIPS).default("SELF"),
});
export type CreatePilgrimFormInput = z.infer<typeof createPilgrimSchema>;

export const updatePersonalDetailsSchema = z.object({
  pilgrimId: z.string().min(1),
  fullName: z.string().trim().min(1, "Enter the pilgrim's full name.").optional(),
  preferredName: z.string().optional(),
  gender: z.enum(GENDERS).optional(),
  dateOfBirth: z.string().nullable().optional(),
  nationality: z.string().optional(),
  nationalId: z.string().optional(),
  countryOfResidence: z.string().optional(),
  city: z.string().optional(),
  preferredLanguage: z.string().optional(),
  whatsappNumber: z.string().optional(),
  mobileNumber: z.string().optional(),
  email: z.string().optional(),
  preferredChannel: z.enum(CONTACT_CHANNELS).optional(),
  passportNumber: z.string().optional(),
  passportExpiry: z.string().nullable().optional(),
  passportIssueCountry: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactRelationship: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  emergencyContactAltPhone: z.string().optional(),
});
export type UpdatePersonalDetailsInput = z.infer<typeof updatePersonalDetailsSchema>;

export const updateMedicalRecordSchema = z.object({
  pilgrimId: z.string().min(1),
  mobilitySupport: z.boolean(),
  wheelchairRequired: z.boolean(),
  dietaryRequirement: z.string(),
  allergyInformation: z.string(),
  medicationNote: z.string(),
  accessibilityNote: z.string(),
  specialAssistance: z.string(),
});
export type UpdateMedicalRecordInput = z.infer<typeof updateMedicalRecordSchema>;

export const createSupportRequestSchema = z.object({
  pilgrimId: z.string().min(1),
  departureGroupId: z.string().nullable(),
  title: z.string().trim().min(1, "Describe the request."),
  detail: z.string(),
  category: z.enum(SUPPORT_CATEGORIES).default("OTHER"),
  priority: z.enum(SUPPORT_PRIORITIES).default("NORMAL"),
  assignedRole: z.string().default("OPERATIONS"),
});
export type CreateSupportRequestInput = z.infer<typeof createSupportRequestSchema>;

const STAFF_ROLES = ["ADMIN", "CEO", "FINANCE", "MARKETING", "OPERATIONS", "VISA", "GUIDE"] as const;

export const addSupportCaseCommentSchema = z.object({
  pilgrimId: z.string().min(1),
  requestId: z.string().min(1),
  message: z.string().trim().min(1, "Write a comment before adding it."),
});
export type AddSupportCaseCommentInput = z.infer<typeof addSupportCaseCommentSchema>;

export const escalateSupportRequestSchema = z.object({
  pilgrimId: z.string().min(1),
  requestId: z.string().min(1),
  toRole: z.enum(STAFF_ROLES),
  reason: z.string().trim().min(1, "Give a reason for the escalation."),
});
export type EscalateSupportRequestInput = z.infer<typeof escalateSupportRequestSchema>;

export const linkSupportCaseSupplierSchema = z.object({
  pilgrimId: z.string().min(1),
  requestId: z.string().min(1),
  supplierId: z.string().nullable(),
  supplierName: z.string().nullable(),
});
export type LinkSupportCaseSupplierInput = z.infer<typeof linkSupportCaseSupplierSchema>;

export const recordSupportCaseAttachmentSchema = z.object({
  pilgrimId: z.string().min(1),
  requestId: z.string().min(1),
  filePath: z.string().trim().min(1),
  fileName: z.string().trim().min(1),
  contentType: z.string().trim().min(1),
  sizeBytes: z.number().positive(),
});
export type RecordSupportCaseAttachmentInput = z.infer<typeof recordSupportCaseAttachmentSchema>;

export const removeSupportCaseAttachmentSchema = z.object({
  pilgrimId: z.string().min(1),
  requestId: z.string().min(1),
  attachmentId: z.string().min(1),
});
export type RemoveSupportCaseAttachmentInput = z.infer<typeof removeSupportCaseAttachmentSchema>;

export const recordPilgrimPaymentSchema = z.object({
  milestoneId: z.string().min(1),
  amount: z.number().positive("Enter an amount greater than zero."),
  note: z.string(),
});
export type RecordPilgrimPaymentInput = z.infer<typeof recordPilgrimPaymentSchema>;

/** Flattens a zod error into `{ field: message }`, same shape as `toLeadFieldErrors`. */
export function toPilgrimFieldErrors(
  error: z.ZodError,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}
