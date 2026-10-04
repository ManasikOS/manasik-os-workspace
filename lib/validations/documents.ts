import { z } from "zod";

/**
 * Zod schemas for every Documents Operations Server Action input. Mirrors
 * `lib/validations/pilgrims.ts`.
 */

export const requestReworkSchema = z.object({
  documentId: z.string().min(1),
  reasonCode: z.enum(["BLURRED", "EXPIRY_INSUFFICIENT", "MISSING_PAGE", "NAME_MISMATCH", "OTHER"]),
  message: z.string().trim().min(3, "Say what is wrong with the document."),
  channel: z.enum(["WHATSAPP", "PORTAL", "NONE"]).default("NONE"),
});

export const verifyDocumentSchema = z.object({
  documentId: z.string().min(1),
  overrideReason: z.string().trim().optional(),
});

export const assignReviewerSchema = z.object({
  documentIds: z.array(z.string().min(1)).min(1),
  assignedTo: z.string().min(1).nullable(),
  assignedToName: z.string().trim().min(1).nullable(),
});

export const bulkReminderSchema = z.object({
  documentIds: z.array(z.string().min(1)).min(1),
});

export const bulkReworkSchema = z.object({
  documentIds: z.array(z.string().min(1)).min(1),
  reasonCode: z.enum(["BLURRED", "EXPIRY_INSUFFICIENT", "MISSING_PAGE", "NAME_MISMATCH", "OTHER"]),
  message: z.string().trim().min(3),
});

export const bulkNotRequiredSchema = z.object({
  documentIds: z.array(z.string().min(1)).min(1),
  reason: z.string().trim().min(3),
});

export const uploadOnBehalfSchema = z.object({
  documentId: z.string().min(1),
  filePath: z.string().min(1),
  fileName: z.string().min(1),
  fileSizeBytes: z.number().int().positive(),
});

export const updateExpirySchema = z.object({
  documentId: z.string().min(1),
  expiresAt: z.string().nullable(),
});

export type RequestReworkInput = z.infer<typeof requestReworkSchema>;
export type VerifyDocumentInput = z.infer<typeof verifyDocumentSchema>;
export type AssignReviewerInput = z.infer<typeof assignReviewerSchema>;
export type BulkReminderInput = z.infer<typeof bulkReminderSchema>;
export type BulkReworkInput = z.infer<typeof bulkReworkSchema>;
export type BulkNotRequiredInput = z.infer<typeof bulkNotRequiredSchema>;
export type UploadOnBehalfInput = z.infer<typeof uploadOnBehalfSchema>;
export type UpdateExpiryInput = z.infer<typeof updateExpirySchema>;

export function toDocumentFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_root";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
