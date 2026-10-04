import { z } from "zod";

/**
 * Zod schemas for every Visa Operations Server Action input. Mirrors
 * `lib/validations/documents.ts`.
 */

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

const storageObjectPath = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.includes(".."), "Invalid file reference.");

export const createBatchSchema = z.object({
  departureGroupId: z.string().trim().min(1),
  visaType: z.string().trim().min(1, "Choose a visa type."),
  journeyIds: z.array(z.string().trim().min(1)).min(1, "Select at least one pilgrim."),
  ownerId: z.string().trim().min(1).nullable(),
  ownerName: z.string().trim().min(1, "Enter a submission owner."),
  batchReference: z.string().trim().min(1, "Enter a batch reference."),
  submissionDeadline: z.string().trim().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const markBatchSubmittedSchema = z.object({
  batchId: z.string().trim().min(1),
});

export const assignOfficerSchema = z.object({
  journeyIds: z.array(z.string().trim().min(1)).min(1),
  assignedTo: z.string().trim().min(1).nullable(),
  assignedToName: z.string().trim().min(1).nullable(),
});

export const statusCheckSchema = z.object({
  journeyIds: z.array(z.string().trim().min(1)).min(1),
  note: z.string().trim().max(500).nullable().optional(),
});

export const recordIssueSchema = z.object({
  id: z.string().trim().min(1),
  departureGroupId: z.string().trim().min(1),
  visaId: z.string().trim().min(1, "Enter the visa number as issued.").max(60),
  issueDate: isoDate.nullable().optional(),
  expiryDate: isoDate.nullable().optional(),
  validUntil: isoDate.nullable().optional(),
  entryType: z.enum(["SINGLE", "MULTIPLE"]).nullable().optional(),
  evidenceSource: z.enum(["PORTAL_SCREENSHOT", "AGENT_EMAIL", "PDF", "OTHER"]).nullable().optional(),
  filePath: storageObjectPath.nullable().optional(),
  issueNote: z.string().trim().max(500).nullable().optional(),
});

export const verifyIssueSchema = z.object({
  id: z.string().trim().min(1),
});

export const recordRejectionSchema = z.object({
  id: z.string().trim().min(1),
  departureGroupId: z.string().trim().min(1),
  reason: z.string().trim().min(3, "Record the refusal reason.").max(500),
  issueType: z.enum([
    "DOCUMENT_BLOCKER",
    "PHOTO_REJECTED",
    "NAME_MISMATCH",
    "DOB_MISMATCH",
    "PASSPORT_VALIDITY",
    "PORTAL_ERROR",
    "REFUSED",
    "OTHER",
  ]),
  canReapply: z.boolean(),
});

export const referenceEditSchema = z.object({
  id: z.string().trim().min(1),
  reference: z.string().trim().max(120).nullable(),
});

export type CreateBatchInput = z.infer<typeof createBatchSchema>;
export type AssignOfficerInput = z.infer<typeof assignOfficerSchema>;
export type StatusCheckInput = z.infer<typeof statusCheckSchema>;
export type RecordIssueInput = z.infer<typeof recordIssueSchema>;
export type RecordRejectionInput = z.infer<typeof recordRejectionSchema>;

export function toVisaFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_root";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
