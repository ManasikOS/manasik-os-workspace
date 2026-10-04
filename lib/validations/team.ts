import { z } from "zod";

/**
 * Zod schemas for every Team Server Action input. Mirrors
 * `lib/validations/suppliers.ts` / `lib/validations/pilgrims.ts`.
 */

const ROLES = ["ADMIN", "CEO", "FINANCE", "MARKETING", "OPERATIONS", "VISA", "GUIDE"] as const;
const EMPLOYMENT_TYPES = ["PERMANENT", "SEASONAL", "CONTRACT", "EXTERNAL_PARTNER"] as const;
const INVITATION_CHANNELS = ["EMAIL", "WHATSAPP"] as const;
const RESPONSIBILITIES = [
  "PRIMARY_GUIDE",
  "BACKUP_GUIDE",
  "OPERATIONS_OWNER",
  "BACKUP_OPERATIONS",
  "VISA_OWNER",
  "FINANCE_OWNER",
  "MARKETING_OWNER",
] as const;

export const inviteStaffSchema = z
  .object({
    fullName: z.string().trim().min(1, "Enter the team member's full name."),
    email: z.string().trim().min(1, "Enter an email address.").email("Enter a valid email address."),
    whatsapp: z.string().trim().optional(),
    role: z.enum(ROLES),
    // A per-agency branches table now exists (20260821090000_agency_settings.sql)
    // — the hardcoded COLOMBO/KANDY/ALL enum was the defect (H2 of
    // docs/modules/team-module-remediation-plan.md). `branchId` names the row; the
    // repository resolves its display name server-side rather than trusting
    // one from the client.
    branchId: z.string().trim().min(1, "Choose a branch."),
    employmentType: z.enum(EMPLOYMENT_TYPES).default("PERMANENT"),
    accessStartsOn: z.string().trim().optional(),
    accessEndsOn: z.string().trim().optional(),
    jobTitle: z.string().trim().max(120).optional(),
    sendVia: z.array(z.enum(INVITATION_CHANNELS)).min(1, "Choose at least one way to send the invitation."),
  })
  .refine((input) => input.employmentType !== "SEASONAL" || Boolean(input.accessEndsOn), {
    message: "Seasonal staff need an end date so their access expires automatically.",
    path: ["accessEndsOn"],
  })
  .refine(
    (input) =>
      !input.accessStartsOn || !input.accessEndsOn || input.accessEndsOn >= input.accessStartsOn,
    { message: "End date must be on or after the start date.", path: ["accessEndsOn"] },
  )
  .refine((input) => !input.sendVia.includes("WHATSAPP") || Boolean(input.whatsapp), {
    // H6 of the remediation plan: a WhatsApp send was silently dropped when
    // the number was left blank, with no field-level error shown for it.
    message: "Enter a WhatsApp number, or unselect Send invitation via WhatsApp.",
    path: ["whatsapp"],
  });
export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;

export const resendInvitationSchema = z.object({
  staffId: z.string().trim().min(1),
});
export type ResendInvitationInput = z.infer<typeof resendInvitationSchema>;

export const revokeInvitationSchema = z.object({
  staffId: z.string().trim().min(1),
});
export type RevokeInvitationInput = z.infer<typeof revokeInvitationSchema>;

export const updateStaffProfileSchema = z.object({
  staffId: z.string().trim().min(1),
  fullName: z.string().trim().min(1).optional(),
  whatsapp: z.string().trim().optional(),
  jobTitle: z.string().trim().max(120).optional(),
  branchId: z.string().trim().min(1).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  accessStartsOn: z.string().trim().nullable().optional(),
  accessEndsOn: z.string().trim().nullable().optional(),
});
export type UpdateStaffProfileInput = z.infer<typeof updateStaffProfileSchema>;

export const changeRoleSchema = z.object({
  staffId: z.string().trim().min(1),
  role: z.enum(ROLES),
});
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

export const assignGroupSchema = z.object({
  staffId: z.string().trim().min(1, "Choose a team member."),
  departureGroupId: z.string().trim().min(1, "Choose a departure group."),
  responsibility: z.enum(RESPONSIBILITIES),
});
export type AssignGroupInput = z.infer<typeof assignGroupSchema>;

export const unassignGroupSchema = z.object({
  assignmentId: z.string().trim().min(1),
});
export type UnassignGroupInput = z.infer<typeof unassignGroupSchema>;

export const deactivateStaffSchema = z.object({
  staffId: z.string().trim().min(1),
  reason: z.string().trim().max(500).optional(),
});
export type DeactivateStaffInput = z.infer<typeof deactivateStaffSchema>;

export const reactivateStaffSchema = z.object({
  staffId: z.string().trim().min(1),
});
export type ReactivateStaffInput = z.infer<typeof reactivateStaffSchema>;

export const extendAccessSchema = z.object({
  staffId: z.string().trim().min(1),
  accessEndsOn: z.string().trim().min(1, "Choose a new end date."),
});
export type ExtendAccessInput = z.infer<typeof extendAccessSchema>;

export const sendPasswordResetSchema = z.object({
  staffId: z.string().trim().min(1),
});
export type SendPasswordResetInput = z.infer<typeof sendPasswordResetSchema>;

export const revokeSessionsSchema = z.object({
  staffId: z.string().trim().min(1),
});
export type RevokeSessionsInput = z.infer<typeof revokeSessionsSchema>;

/** Flattens a zod error into `{ field: message }`, same shape as `toSupplierFieldErrors`. */
export function toTeamFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_root";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
