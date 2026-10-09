"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { createAdminClient } from "@/utils/supabase/admin";
import { extractTemplateTokens, TEMPLATE_VARIABLES } from "@/lib/data/settings-copy";
import { intersectMarginVisibleRoles, isTemplateAssignedToRole } from "@/lib/data/settings";
import {
  deleteMessageTemplate,
  listMessageTemplates,
  saveBranch,
  saveMessageTemplate,
  updateBranchRules,
  updateBrandingSettings,
  updateFinanceDefaults,
  archiveBranch,
  requestFullExport,
  resetAgencyBusinessData,
  setPortalActive,
  updateIntegrationNotes,
  updateOperationalDefaults,
  updateOrganisationSettings,
  updateRetentionSettings,
  updateSecurityDefaults,
  type SettingsActor,
} from "@/lib/data/settings-repository";
import type { BranchRow, MessageTemplateRow } from "@/lib/types/settings";
import { requireUser } from "@/lib/dal";
import {
  archiveBranchConfirmSchema,
  branchRulesSchema,
  branchSchema,
  brandingSettingsSchema,
  deleteTemplateSchema,
  financeDefaultsSchema,
  messageTemplateSchema,
  operationalDefaultsSchema,
  packageApprovalPolicySchema,
  organisationSettingsSchema,
  requestFullExportSchema,
  resetAgencyDataSchema,
  RESET_AGENCY_DATA_PHRASE,
  retentionSettingsSchema,
  securityDefaultsSchema,
  setPortalActiveSchema,
  toSettingsFieldErrors,
  updateIntegrationNotesSchema,
} from "@/lib/validations/settings";
import { createClient } from "@/utils/supabase/server";

export interface SettingsActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

async function db() {
  return createClient(await cookies());
}

/**
 * Settings reach nearly every route (currency, timezone, logo, invoice
 * footer). A settings write revalidates the whole layout rather than one
 * path, same reasoning as the Settings plan §9.7.
 */
function revalidateSettings() {
  revalidatePath("/", "layout");
}

async function currentActor(): Promise<{ actor: SettingsActor; role: Awaited<ReturnType<typeof getCurrentStaffRole>>["role"] }> {
  const user = await requireUser();
  const { role, name } = await getCurrentStaffRole();
  return { actor: { id: user.id, name: name ?? "Staff" }, role };
}

/* ── §5.1 Organisation ────────────────────────────────────────────────────── */

export async function updateOrganisationSettingsAction(input: unknown): Promise<SettingsActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSettings(role);
  if (!can.editOrganisation) return { ok: false, error: "Your role cannot edit Organisation settings." };

  const parsed = organisationSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toSettingsFieldErrors(parsed.error) };
  }

  const supabase = await db();
  await updateOrganisationSettings(supabase, parsed.data, actor);

  revalidateSettings();
  return { ok: true };
}

/* ── §5.2 Branches ────────────────────────────────────────────────────────── */

export interface SaveBranchActionResult extends SettingsActionResult {
  branch?: BranchRow;
}

export async function saveBranchAction(input: unknown): Promise<SaveBranchActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSettings(role);
  if (!can.editBranches) return { ok: false, error: "Your role cannot edit branches." };

  const parsed = branchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toSettingsFieldErrors(parsed.error) };
  }

  const supabase = await db();
  const result = await saveBranch(supabase, parsed.data, actor);
  if (!result.ok) return { ok: false, error: result.error };

  revalidateSettings();
  return { ok: true, branch: result.branch };
}

export async function updateBranchRulesAction(input: unknown): Promise<SettingsActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSettings(role);
  if (!can.editBranches) return { ok: false, error: "Your role cannot edit branch rules." };

  const parsed = branchRulesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toSettingsFieldErrors(parsed.error) };
  }

  const supabase = await db();
  await updateBranchRules(supabase, parsed.data, actor);

  revalidateSettings();
  return { ok: true };
}

/* ── §5.6 Finance Defaults ────────────────────────────────────────────────── */

export async function updateFinanceDefaultsAction(input: unknown): Promise<SettingsActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSettings(role);
  if (!can.editFinance) return { ok: false, error: "Your role cannot edit Finance defaults." };

  const parsed = financeDefaultsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toSettingsFieldErrors(parsed.error) };
  }

  // Margin visibility can only ever narrow the roles capabilitiesForFinance()
  // / capabilitiesForSuppliers() already grant viewCosts to — never widen it
  // to Marketing, Operations, Visa or Guide. See D4.
  const data = { ...parsed.data, marginVisibleRoles: intersectMarginVisibleRoles(parsed.data.marginVisibleRoles) };

  const supabase = await db();
  await updateFinanceDefaults(supabase, data, actor);

  revalidateSettings();
  return { ok: true };
}

/* ── §5.4 Operational Defaults ────────────────────────────────────────────── */

export async function updateOperationalDefaultsAction(input: unknown): Promise<SettingsActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSettings(role);
  if (!can.editOperations) return { ok: false, error: "Your role cannot edit Operational defaults." };

  const parsed = operationalDefaultsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toSettingsFieldErrors(parsed.error) };
  }

  const supabase = await db();
  await updateOperationalDefaults(supabase, parsed.data, actor);

  revalidateSettings();
  return { ok: true };
}

/* ── Package change approval (TASK-043) ────────────────────────────────────── */

/**
 * Whether a change to a live package's payment/contract terms (Tier 1) or booking/operations terms (Tier 2) needs a second person's approval.
 * The database refuses anyone but an administrator whose permissions do not withhold `managePackageApprovalPolicy`, and logs every change.
 */
export async function updatePackageApprovalPolicyAction(input: unknown): Promise<SettingsActionResult> {
  const { role } = await currentActor();
  const can = capabilitiesForSettings(role);
  if (!can.managePackageApprovalPolicy) return { ok: false, error: "Your role cannot change the package approval policy." };

  const parsed = packageApprovalPolicySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose on or off for each kind of change." };

  const { agencyId } = await getCurrentStaffRole();
  if (!agencyId) return { ok: false, error: "Your session has no active agency." };

  const supabase = await db();
  const { data, error } = await supabase
    .from("agency_settings")
    .update({
      package_approval_money_contract: parsed.data.moneyAndContract,
      package_approval_bookings_ops: parsed.data.bookingsAndOperations,
    })
    .eq("agency_id", agencyId)
    .select("agency_id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.code === "42501" ? "Your role cannot change the package approval policy." : "The policy could not be saved. Please try again." };
  }
  if (!data) return { ok: false, error: "Your agency's settings could not be found." };

  revalidateSettings();
  return { ok: true };
}

/* ── §5.3 Branding & Pilgrim Portal ───────────────────────────────────────── */

export async function updateBrandingSettingsAction(input: unknown): Promise<SettingsActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSettings(role);
  if (!can.editBranding) return { ok: false, error: "Your role cannot edit Branding settings." };

  const parsed = brandingSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toSettingsFieldErrors(parsed.error) };
  }

  const supabase = await db();
  await updateBrandingSettings(supabase, parsed.data, actor);

  revalidateSettings();
  return { ok: true };
}

/* ── §5.7 Integrations ────────────────────────────────────────────────────── */

export async function updateIntegrationNotesAction(input: unknown): Promise<SettingsActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSettings(role);
  if (!can.editIntegrations) return { ok: false, error: "Your role cannot edit integrations." };

  const parsed = updateIntegrationNotesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toSettingsFieldErrors(parsed.error) };
  }

  const supabase = await db();
  await updateIntegrationNotes(supabase, parsed.data, actor);

  revalidateSettings();
  return { ok: true };
}

/* ── §5.9 Data & Audit ────────────────────────────────────────────────────── */

export async function updateRetentionSettingsAction(input: unknown): Promise<SettingsActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSettings(role);
  if (!can.editData) return { ok: false, error: "Your role cannot edit data retention settings." };

  const parsed = retentionSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toSettingsFieldErrors(parsed.error) };
  }

  const supabase = await db();
  await updateRetentionSettings(supabase, parsed.data, actor);

  revalidateSettings();
  return { ok: true };
}

/* ── §5.8 Security & Access ───────────────────────────────────────────────── */

export async function updateSecurityDefaultsAction(input: unknown): Promise<SettingsActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSettings(role);
  if (!can.editSecurity) return { ok: false, error: "Your role cannot edit Security & Access defaults." };

  const parsed = securityDefaultsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toSettingsFieldErrors(parsed.error) };
  }

  const supabase = await db();
  await updateSecurityDefaults(supabase, parsed.data, actor);

  revalidateSettings();
  return { ok: true };
}

/* ── §5.5 Communication Templates ─────────────────────────────────────────── */

export interface SaveTemplateActionResult extends SettingsActionResult {
  template?: MessageTemplateRow;
}

export async function saveMessageTemplateAction(input: unknown): Promise<SaveTemplateActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSettings(role);
  if (!can.editCommunications) return { ok: false, error: "Your role cannot edit communication templates." };

  const parsed = messageTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toSettingsFieldErrors(parsed.error) };
  }

  // Unknown `{{token}}` is a save-time validation error, never a silently
  // broken outbound message. See the Settings plan §5.5 / D7.
  const unknownTokens = extractTemplateTokens(parsed.data.body).filter(
    (token) => !(TEMPLATE_VARIABLES as readonly string[]).includes(token),
  );
  if (unknownTokens.length > 0) {
    return {
      ok: false,
      error: "This template uses variables that don't exist.",
      fieldErrors: { body: `Unknown variable${unknownTokens.length > 1 ? "s" : ""}: ${unknownTokens.map((t) => `{{${t}}}`).join(", ")}` },
    };
  }

  const supabase = await db();

  // Marketing/Visa may only edit templates assigned to their own role — never
  // someone else's category, and never remove themselves from assignedRoles
  // in a way that locks them out of a template only they could see.
  if (can.communicationsScopedToOwnRole && parsed.data.id) {
    const existing = (await listMessageTemplates(supabase)).find((t) => t.id === parsed.data.id);
    if (existing && !isTemplateAssignedToRole(existing.assigned_roles, role)) {
      return { ok: false, error: "This template is not assigned to your role." };
    }
  }
  if (can.communicationsScopedToOwnRole && parsed.data.assignedRoles.length > 0 && !parsed.data.assignedRoles.includes(role)) {
    return { ok: false, error: "You must keep this template assigned to your own role." };
  }

  const result = await saveMessageTemplate(supabase, parsed.data, actor);
  if (!result.ok) return { ok: false, error: result.error };

  revalidateSettings();
  return { ok: true, template: result.template };
}

export async function deleteMessageTemplateAction(input: unknown): Promise<SettingsActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSettings(role);
  if (!can.editCommunications) return { ok: false, error: "Your role cannot delete communication templates." };

  const parsed = deleteTemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request.", fieldErrors: toSettingsFieldErrors(parsed.error) };

  const supabase = await db();

  if (can.communicationsScopedToOwnRole) {
    const existing = (await listMessageTemplates(supabase)).find((t) => t.id === parsed.data.templateId);
    if (existing && !isTemplateAssignedToRole(existing.assigned_roles, role)) {
      return { ok: false, error: "This template is not assigned to your role." };
    }
  }

  await deleteMessageTemplate(supabase, parsed.data.templateId, actor);

  revalidateSettings();
  return { ok: true };
}

/* ── §5.10 Danger Zone ────────────────────────────────────────────────────── */
/* Deliberately its own block, never beside a normal Save button — see D13. */

export async function archiveBranchConfirmAction(input: unknown): Promise<SettingsActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSettings(role);
  if (!can.viewDangerZone) return { ok: false, error: "Your role cannot archive a branch." };

  const parsed = archiveBranchConfirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request.", fieldErrors: toSettingsFieldErrors(parsed.error) };

  const supabase = await db();

  const { data: branch, error: branchError } = await supabase
    .from("branches")
    .select("code")
    .eq("id", parsed.data.branchId)
    .maybeSingle();
  if (branchError) return { ok: false, error: branchError.message };
  if (!branch) return { ok: false, error: "That branch no longer exists." };
  if (branch.code.toUpperCase() !== parsed.data.confirmCode.trim().toUpperCase()) {
    return { ok: false, error: "Branch code does not match.", fieldErrors: { confirmCode: "Type the branch code exactly to confirm." } };
  }

  const result = await archiveBranch(supabase, { branchId: parsed.data.branchId }, actor);
  if (!result.ok) return { ok: false, error: result.error };

  revalidateSettings();
  return { ok: true };
}

export async function setPortalActiveAction(input: unknown): Promise<SettingsActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSettings(role);
  if (!can.viewDangerZone) return { ok: false, error: "Your role cannot change the pilgrim portal's status." };

  const parsed = setPortalActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request.", fieldErrors: toSettingsFieldErrors(parsed.error) };
  if (parsed.data.confirmText.trim().toUpperCase() !== "CONFIRM") {
    return { ok: false, error: "Type CONFIRM to proceed.", fieldErrors: { confirmText: "Type CONFIRM exactly." } };
  }

  const supabase = await db();
  await setPortalActive(supabase, parsed.data.active, actor);

  revalidateSettings();
  return { ok: true };
}

export async function requestFullExportAction(input: unknown): Promise<SettingsActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSettings(role);
  if (!can.viewDangerZone) return { ok: false, error: "Your role cannot request a full agency export." };

  const parsed = requestFullExportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request.", fieldErrors: toSettingsFieldErrors(parsed.error) };
  if (parsed.data.confirmText.trim().toUpperCase() !== "CONFIRM") {
    return { ok: false, error: "Type CONFIRM to proceed.", fieldErrors: { confirmText: "Type CONFIRM exactly." } };
  }

  const supabase = await db();
  await requestFullExport(supabase, actor);

  return { ok: true };
}

export interface ResetAgencyDataActionResult extends SettingsActionResult {
  totalRowsDeleted?: number;
}

/**
 * "Reset to factory state" — deletes every business record for the caller's
 * own agency (packages, departure groups, pilgrims, bookings, payments,
 * suppliers, leads, visa records, activity/conversation history). Keeps
 * staff accounts, agency settings, branches, and catalog/config rows intact,
 * so the software is immediately usable afterward — see
 * `reset_agency_business_data()` (migration 20260912090000) and
 * docs/modules/bucket-c-dead-fields-removal-plan.md's sibling,
 * docs/architecture/package-departure-architecture-master-plan.md, for the reasoning.
 *
 * Three independent gates, all required:
 *   1. `viewDangerZone` (ADMIN only).
 *   2. Non-production environment — this has no undo, so it is refused
 *      outright in production regardless of role or confirmation text.
 *   3. The typed confirmation phrase, checked here (never trust the client
 *      dialog's own check alone).
 *
 * These checks are the real gate: the database function is executable by the
 * service role only (migration 20261126090001), so a browser session can no
 * longer call it directly and skip them.
 */
export async function resetAgencyDataAction(
  input: unknown,
): Promise<ResetAgencyDataActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSettings(role);
  if (!can.viewDangerZone) {
    return { ok: false, error: "Your role cannot reset agency data." };
  }

  if (process.env.NODE_ENV === "production") {
    return {
      ok: false,
      error:
        "Resetting all data is disabled in production. This action has no undo and is only available in development or demo environments.",
    };
  }

  const parsed = resetAgencyDataSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request.", fieldErrors: toSettingsFieldErrors(parsed.error) };
  }
  if (parsed.data.confirmText.trim().toUpperCase() !== RESET_AGENCY_DATA_PHRASE) {
    return {
      ok: false,
      error: `Type ${RESET_AGENCY_DATA_PHRASE} to proceed.`,
      fieldErrors: { confirmText: `Type ${RESET_AGENCY_DATA_PHRASE} exactly.` },
    };
  }

  const { agencyId } = await getCurrentStaffRole();
  if (!agencyId) return { ok: false, error: "No agency resolved for your account." };

  const supabase = await db();
  const result = await resetAgencyBusinessData(supabase, createAdminClient(), agencyId, actor);
  if (!result.ok) return { ok: false, error: result.error ?? "Could not reset agency data." };

  revalidateSettings();
  return { ok: true, totalRowsDeleted: result.totalRowsDeleted };
}
