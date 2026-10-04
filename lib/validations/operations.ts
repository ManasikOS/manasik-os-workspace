import { z } from "zod";

/**
 * Zod schemas for every Operations Server Action input. Mirrors
 * `lib/validations/visa.ts`.
 */

const isoDateTime = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date.");

/**
 * Unlike `createGroupTaskSchema` in `lib/validations/departure-groups.ts`,
 * `ownerName` is optional here — Operations is where "Unassigned Operations
 * Work" is a first-class KPI, so a task may be created with no owner and
 * assigned later.
 */
export const createOperationsTaskSchema = z.object({
  departureGroupId: z.string().trim().min(1, "Choose a departure group."),
  title: z
    .string()
    .trim()
    .min(3, "Give the task a title of at least 3 characters.")
    .max(160, "Keep the title under 160 characters."),
  description: z.string().trim().max(2000).nullable().optional(),
  ownerName: z.string().trim().max(120).optional(),
  dueAt: isoDateTime,
  category: z.enum(["OPERATIONS", "VISA", "FINANCE", "GUIDE", "MARKETING", "OTHER"]),
  linkedReadinessItemId: z.string().trim().nullable().optional(),
});

export const reassignOperationsTaskSchema = z.object({
  id: z.string().trim().min(1),
  departureGroupId: z.string().trim().min(1),
  ownerName: z.string().trim().max(120),
});

export const updateOperationsTaskStatusSchema = z.object({
  id: z.string().trim().min(1),
  departureGroupId: z.string().trim().min(1),
  status: z.enum(["OPEN", "IN_PROGRESS", "COMPLETE", "OVERDUE"]),
});

export const bulkUpdateOperationsTasksSchema = z.object({
  taskIds: z.array(z.object({ id: z.string().trim().min(1), departureGroupId: z.string().trim().min(1) })).min(1),
  status: z.enum(["OPEN", "IN_PROGRESS", "COMPLETE"]).optional(),
  ownerName: z.string().trim().max(120).optional(),
});

/**
 * Records the supplier's name and/or reference — the two facts the
 * confirmation-evidence gate on `markAccommodationConfirmedInStore` /
 * `markTransportConfirmedInStore` requires before a service can be confirmed.
 */
export const recordSupplierDetailsSchema = z.object({
  id: z.string().trim().min(1),
  departureGroupId: z.string().trim().min(1),
  serviceKind: z.enum(["ACCOMMODATION", "TRANSPORT"]),
  serviceLabel: z.string().trim().min(1).max(160).optional(),
  supplierName: z.string().trim().min(1).max(160).optional(),
  supplierId: z.string().trim().nullable().optional(),
  bookingReference: z.string().trim().min(1).max(120).optional(),
});

export const confirmSupplierServiceSchema = z.object({
  id: z.string().trim().min(1),
  departureGroupId: z.string().trim().min(1),
  serviceKind: z.enum(["ACCOMMODATION", "TRANSPORT"]),
});

export const assignGuideSchema = z.object({
  groupId: z.string().trim().min(1),
  staffId: z.string().trim().min(1, "Choose a guide."),
});

export function toOperationsFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_root";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
