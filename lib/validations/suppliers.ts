import { z } from "zod";

/**
 * Zod schemas for every Supplier Directory Server Action input. Mirrors
 * `lib/validations/operations.ts` / `lib/validations/pilgrims.ts`.
 */

const SUPPLIER_TYPES = [
  "BROKER",
  "HOTEL",
  "TRANSPORT",
  "CATERING",
  "TICKETING",
  "VISA_PARTNER",
  "INSURANCE",
  "GUIDE_PARTNER",
  "ZIYARAH",
  "ANCILLARY",
  "OTHER",
] as const;

const SUPPLIER_STATUSES = ["ACTIVE", "INACTIVE"] as const;
const RELIABILITY_STATES = ["RELIABLE", "NEEDS_ATTENTION", "ON_HOLD", "INACTIVE"] as const;
const CURRENCIES = ["SAR", "LKR", "USD", "AED", "OTHER"] as const;
const COMMITMENT_CURRENCIES = ["SAR", "LKR", "USD", "AED"] as const;
const PAYMENT_TERMS = ["DEPOSIT_REQUIRED", "PAY_AFTER_CONFIRMATION", "CUSTOM"] as const;
const PREFERRED_CHANNELS = ["WHATSAPP", "PHONE", "EMAIL"] as const;

const SERVICE_CATEGORIES = [
  "MAKKAH_ACCOMMODATION",
  "MADINAH_ACCOMMODATION",
  "ACCOMMODATION_OTHER",
  "AIRPORT_TRANSFER",
  "INTERCITY_TRANSPORT",
  "ZIYARAH_TRANSPORT",
  "CATERING",
  "TICKETING",
  "VISA_SERVICE",
  "INSURANCE",
  "GUIDE_SERVICE",
  "ANCILLARY",
  "OTHER",
] as const;

const SEASONS = ["STANDARD", "RAMADAN", "HAJJ", "PEAK", "OTHER"] as const;

const COMMITMENT_STATUSES = [
  "DRAFT",
  "REQUESTED",
  "SUPPLIER_RESPONDED",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
  "DISPUTED",
] as const;

const LINKED_ENTITY_TYPES = ["ACCOMMODATION", "TRANSPORT", "FLIGHT"] as const;

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1, "Enter the supplier or company name."),
  supplierCode: z.string().trim().min(1, "Enter a supplier code.").max(40),
  supplierType: z.enum(SUPPLIER_TYPES),
  serviceCategories: z.array(z.enum(SERVICE_CATEGORIES)).default([]),
  status: z.enum(SUPPLIER_STATUSES).default("ACTIVE"),
  city: z.string().trim().optional(),
  country: z.string().trim().optional(),
  contactName: z.string().trim().optional(),
  whatsappNumber: z.string().trim().min(1, "A WhatsApp / phone number is required."),
  email: z.string().trim().optional(),
  preferredChannel: z.enum(PREFERRED_CHANNELS).optional(),
  arabicSpeaking: z.boolean().default(false),
  currency: z.enum(CURRENCIES).default("SAR"),
  paymentTerms: z.enum(PAYMENT_TERMS).default("PAY_AFTER_CONFIRMATION"),
  paymentTermsNote: z.string().trim().max(500).optional(),
  leadTimeDays: z.number().int().min(0).nullable().optional(),
  internalNotes: z.string().trim().max(2000).optional(),
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

export const updateSupplierSchema = z.object({
  supplierId: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  supplierType: z.enum(SUPPLIER_TYPES).optional(),
  status: z.enum(SUPPLIER_STATUSES).optional(),
  city: z.string().trim().optional(),
  country: z.string().trim().optional(),
  currency: z.enum(CURRENCIES).optional(),
  paymentTerms: z.enum(PAYMENT_TERMS).optional(),
  paymentTermsNote: z.string().trim().max(500).optional(),
  leadTimeDays: z.number().int().min(0).nullable().optional(),
  internalNotes: z.string().trim().max(2000).optional(),
});
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

export const setReliabilitySchema = z.object({
  supplierId: z.string().trim().min(1),
  reliability: z.enum(RELIABILITY_STATES),
  reason: z.string().trim().max(500).optional(),
});
export type SetReliabilityInput = z.infer<typeof setReliabilitySchema>;

export const upsertContactSchema = z.object({
  contactId: z.string().trim().optional(),
  supplierId: z.string().trim().min(1),
  name: z.string().trim().min(1, "Enter the contact's name."),
  roleTitle: z.string().trim().optional(),
  whatsappNumber: z.string().trim().optional(),
  phoneNumber: z.string().trim().optional(),
  email: z.string().trim().optional(),
  languages: z.string().trim().optional(),
  isPrimary: z.boolean().default(false),
  isEmergency: z.boolean().default(false),
  preferredTimeFrom: z.string().trim().nullable().optional(),
  preferredTimeTo: z.string().trim().nullable().optional(),
  timezone: z.string().trim().optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type UpsertContactInput = z.infer<typeof upsertContactSchema>;

export const upsertSupplierServiceSchema = z.object({
  supplierId: z.string().trim().min(1),
  category: z.enum(SERVICE_CATEGORIES),
  typicalService: z.string().trim().max(300).optional(),
  typicalRate: z.number().min(0).nullable().optional(),
  rateCurrency: z.enum(COMMITMENT_CURRENCIES).optional(),
  rateUnit: z.string().trim().max(80).optional(),
  season: z.enum(SEASONS).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type UpsertSupplierServiceInput = z.infer<typeof upsertSupplierServiceSchema>;

export const createCommitmentSchema = z.object({
  supplierId: z.string().trim().min(1, "Choose a supplier."),
  departureGroupId: z.string().trim().min(1, "Choose a departure group."),
  serviceCategory: z.enum(SERVICE_CATEGORIES),
  serviceLabel: z.string().trim().max(160).optional(),
  serviceDetails: z.string().trim().max(1000).optional(),
  serviceStartDate: z.string().trim().nullable().optional(),
  serviceEndDate: z.string().trim().nullable().optional(),
  bookingReference: z.string().trim().max(120).optional(),
  status: z.enum(["DRAFT", "REQUESTED", "CONFIRMED"]).default("REQUESTED"),
  linkedEntityType: z.enum(LINKED_ENTITY_TYPES).nullable().optional(),
  linkedEntityId: z.string().trim().nullable().optional(),
  ownerName: z.string().trim().max(120).optional(),
  amount: z.number().min(0).nullable().optional(),
  currency: z.enum(COMMITMENT_CURRENCIES).default("SAR"),
  paymentTermsNote: z.string().trim().max(300).optional(),
  paymentDueAt: z.string().trim().nullable().optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateCommitmentInput = z.infer<typeof createCommitmentSchema>;

export const updateCommitmentStatusSchema = z.object({
  commitmentId: z.string().trim().min(1),
  status: z.enum(COMMITMENT_STATUSES),
  note: z.string().trim().max(500).optional(),
});
export type UpdateCommitmentStatusInput = z.infer<typeof updateCommitmentStatusSchema>;

export const confirmCommitmentSchema = z.object({
  commitmentId: z.string().trim().min(1),
});
export type ConfirmCommitmentInput = z.infer<typeof confirmCommitmentSchema>;

export const attachCommitmentEvidenceSchema = z.object({
  commitmentId: z.string().trim().min(1),
  evidencePath: z.string().trim().min(1),
});
export type AttachCommitmentEvidenceInput = z.infer<typeof attachCommitmentEvidenceSchema>;

export const recordSupplierPaymentSchema = z.object({
  commitmentId: z.string().trim().min(1),
  amount: z.number().positive("Enter an amount greater than zero."),
  currency: z.enum(COMMITMENT_CURRENCIES),
  paidAt: z.string().trim().min(1, "Enter the payment date."),
  method: z.string().trim().max(80).optional(),
  reference: z.string().trim().max(120).optional(),
});
export type RecordSupplierPaymentInput = z.infer<typeof recordSupplierPaymentSchema>;

/**
 * Records money a supplier refunded back to the agency — the mirror of
 * `recordSupplierPaymentSchema`, capped server-side at what has actually
 * been paid on the commitment (see `recordSupplierRefund` in
 * lib/data/suppliers-repository.ts).
 */
export const recordSupplierRefundSchema = z.object({
  commitmentId: z.string().trim().min(1),
  amount: z.number().positive("Enter an amount greater than zero."),
  currency: z.enum(COMMITMENT_CURRENCIES),
  refundedAt: z.string().trim().min(1, "Enter the refund date."),
  method: z.string().trim().max(80).optional(),
  reference: z.string().trim().max(120).optional(),
  reason: z.string().trim().max(500).optional(),
});
export type RecordSupplierRefundInput = z.infer<typeof recordSupplierRefundSchema>;

export const addSupplierNoteSchema = z.object({
  supplierId: z.string().trim().min(1),
  note: z.string().trim().min(1, "Enter a note."),
});
export type AddSupplierNoteInput = z.infer<typeof addSupplierNoteSchema>;

/** Flattens a zod error into `{ field: message }`, same shape as `toPilgrimFieldErrors`. */
export function toSupplierFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_root";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
