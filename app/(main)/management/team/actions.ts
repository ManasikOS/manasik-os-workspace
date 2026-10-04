"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { capabilitiesForTeam, type TeamCapabilities } from "@/lib/access/team-access";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  TeamPersistenceError,
  assignGroupToStaff,
  changeStaffRole,
  deactivateStaff,
  extendSeasonalAccess,
  inviteStaff,
  reactivateStaff,
  resendInvitation,
  revokeInvitation,
  revokeSessions,
  sendPasswordReset,
  unassignGroupFromStaff,
  updateStaffProfile,
  type TeamActor,
} from "@/lib/data/team-repository";
import { requireUser } from "@/lib/dal";
import {
  assignGroupSchema,
  changeRoleSchema,
  deactivateStaffSchema,
  extendAccessSchema,
  inviteStaffSchema,
  reactivateStaffSchema,
  resendInvitationSchema,
  revokeInvitationSchema,
  revokeSessionsSchema,
  sendPasswordResetSchema,
  toTeamFieldErrors,
  unassignGroupSchema,
  updateStaffProfileSchema,
} from "@/lib/validations/team";
import { createClient } from "@/utils/supabase/server";

export interface TeamActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

async function db() {
  return createClient(await cookies());
}

function revalidateTeam(staffId?: string, departureGroupId?: string) {
  revalidatePath("/management/team");
  if (staffId) revalidatePath(`/management/team/${staffId}`);
  if (departureGroupId) revalidatePath(`/departure-groups/${departureGroupId}`);
  revalidatePath("/operations");
}

/**
 * `can` is resolved dynamically — `capabilitiesForTeam(role)` (the code
 * default) overridden by whatever this person's assigned role has stored in
 * `role_permissions` for the "team" module, per
 * `supabase/migrations/20260924090000_dynamic_roles_permissions.sql`. Every
 * Team Server Action reads capabilities from here rather than calling
 * `capabilitiesForTeam()` directly, so an Admin's edits in the Roles &
 * Permissions sheet take effect immediately, not just in the UI that renders
 * buttons.
 */
async function currentActor(): Promise<{ actor: TeamActor; role: Awaited<ReturnType<typeof getCurrentStaffRole>>["role"]; can: TeamCapabilities }> {
  const user = await requireUser();
  const { role, roleId, name } = await getCurrentStaffRole();
  const supabase = await db();
  const can = await loadDynamicCapabilities(supabase, roleId, "team", capabilitiesForTeam(role));
  return { actor: { id: user.id, name: name ?? "Staff" }, role, can };
}

/**
 * Runs a Team Server Action body and turns a thrown `TeamPersistenceError`
 * into the same `{ ok: false, error }` shape every dialog already knows how
 * to render, instead of letting it propagate into `error.tsx`'s generic
 * "Could not load the team directory" panel (D2 of
 * docs/modules/team-module-remediation-plan.md). Any other error still throws —
 * only the repository's own typed failure is downgraded.
 */
async function runTeamAction<T extends TeamActionResult>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    if (cause instanceof TeamPersistenceError) {
      console.error("Team action failed", cause);
      return { ok: false, error: "Something went wrong saving that change. Please try again." } as T;
    }
    throw cause;
  }
}

/* ── Invitations ──────────────────────────────────────────────────────────── */

export interface InviteTeamMemberResult extends TeamActionResult {
  staffId?: string;
  whatsappShareUrl?: string | null;
  /** Set only when the invite was refused because the email already belongs
   *  to a DEACTIVATED profile — lets the dialog offer one-click reactivation
   *  instead of a dead end (H3 of docs/modules/team-module-remediation-plan.md). */
  deactivatedStaffId?: string;
}

export async function inviteTeamMemberAction(input: unknown): Promise<InviteTeamMemberResult> {
  return runTeamAction(async () => {
    const { actor, can } = await currentActor();
    if (!can.inviteStaff) return { ok: false, error: "Your role cannot invite team members." };

    const parsed = inviteStaffSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Check the highlighted fields.", fieldErrors: toTeamFieldErrors(parsed.error) };
    }

    const supabase = await db();
    const result = await inviteStaff(supabase, parsed.data, actor);
    if (!result.ok) return result;

    revalidateTeam(result.staffId);
    return { ok: true, staffId: result.staffId, whatsappShareUrl: result.whatsappShareUrl };
  });
}

export async function resendInvitationAction(input: unknown): Promise<InviteTeamMemberResult> {
  return runTeamAction(async () => {
    const { actor, can } = await currentActor();
    if (!can.inviteStaff) return { ok: false, error: "Your role cannot resend invitations." };

    const parsed = resendInvitationSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid request.", fieldErrors: toTeamFieldErrors(parsed.error) };

    const supabase = await db();
    const result = await resendInvitation(supabase, parsed.data.staffId, actor);
    if (!result.ok) return result;

    revalidateTeam(parsed.data.staffId);
    return { ok: true, staffId: result.staffId, whatsappShareUrl: result.whatsappShareUrl };
  });
}

export async function revokeInvitationAction(input: unknown): Promise<TeamActionResult> {
  return runTeamAction(async () => {
    const { actor, can } = await currentActor();
    if (!can.inviteStaff) return { ok: false, error: "Your role cannot revoke invitations." };

    const parsed = revokeInvitationSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid request.", fieldErrors: toTeamFieldErrors(parsed.error) };

    const supabase = await db();
    const result = await revokeInvitation(supabase, parsed.data.staffId, actor);
    if (!result.ok) return result;

    revalidateTeam(parsed.data.staffId);
    return { ok: true };
  });
}

/* ── Profile ──────────────────────────────────────────────────────────────── */

export async function updateStaffProfileAction(input: unknown): Promise<TeamActionResult> {
  return runTeamAction(async () => {
    const { actor, can } = await currentActor();
    if (!can.editProfile) return { ok: false, error: "Your role cannot edit team member profiles." };

    const parsed = updateStaffProfileSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: toTeamFieldErrors(parsed.error) };

    const supabase = await db();
    const result = await updateStaffProfile(supabase, parsed.data, actor);
    if (!result.ok) return result;

    revalidateTeam(parsed.data.staffId);
    return { ok: true };
  });
}

/* ── Role ─────────────────────────────────────────────────────────────────── */

export async function changeStaffRoleAction(input: unknown): Promise<TeamActionResult> {
  return runTeamAction(async () => {
    const { actor, can } = await currentActor();
    if (!can.changeRole) return { ok: false, error: "Your role cannot change another team member's role." };

    const parsed = changeRoleSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid request.", fieldErrors: toTeamFieldErrors(parsed.error) };

    const supabase = await db();
    const result = await changeStaffRole(supabase, parsed.data.staffId, parsed.data.role, actor);
    if (!result.ok) return result;

    revalidateTeam(parsed.data.staffId);
    return { ok: true };
  });
}

/* ── Account lifecycle ────────────────────────────────────────────────────── */

export async function deactivateStaffAction(input: unknown): Promise<TeamActionResult> {
  return runTeamAction(async () => {
    const { actor, can } = await currentActor();
    if (!can.deactivateStaff) return { ok: false, error: "Your role cannot deactivate team members." };

    const parsed = deactivateStaffSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid request.", fieldErrors: toTeamFieldErrors(parsed.error) };

    const supabase = await db();
    const result = await deactivateStaff(supabase, parsed.data.staffId, parsed.data.reason, actor);
    if (!result.ok) return result;

    revalidateTeam(parsed.data.staffId);
    return { ok: true };
  });
}

export async function reactivateStaffAction(input: unknown): Promise<TeamActionResult> {
  return runTeamAction(async () => {
    const { actor, can } = await currentActor();
    if (!can.deactivateStaff) return { ok: false, error: "Your role cannot reactivate team members." };

    const parsed = reactivateStaffSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid request.", fieldErrors: toTeamFieldErrors(parsed.error) };

    const supabase = await db();
    const result = await reactivateStaff(supabase, parsed.data.staffId, actor);
    if (!result.ok) return result;

    revalidateTeam(parsed.data.staffId);
    return { ok: true };
  });
}

/* ── Group assignments ────────────────────────────────────────────────────── */

export interface AssignGroupResult extends TeamActionResult {
  assignmentId?: string;
}

export async function assignGroupAction(input: unknown): Promise<AssignGroupResult> {
  return runTeamAction(async () => {
    const { actor, can } = await currentActor();
    if (!can.assignGroups) return { ok: false, error: "Your role cannot assign Departure Groups." };

    const parsed = assignGroupSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: toTeamFieldErrors(parsed.error) };

    const supabase = await db();
    const result = await assignGroupToStaff(
      supabase,
      { staffId: parsed.data.staffId, departureGroupId: parsed.data.departureGroupId, responsibility: parsed.data.responsibility },
      actor,
    );
    if (!result.ok) return result;

    revalidateTeam(parsed.data.staffId, parsed.data.departureGroupId);
    return { ok: true, assignmentId: result.assignmentId };
  });
}

export async function unassignGroupAction(input: unknown): Promise<TeamActionResult> {
  return runTeamAction(async () => {
    const { actor, can } = await currentActor();
    if (!can.assignGroups) return { ok: false, error: "Your role cannot unassign Departure Groups." };

    const parsed = unassignGroupSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid request.", fieldErrors: toTeamFieldErrors(parsed.error) };

    const supabase = await db();
    const result = await unassignGroupFromStaff(supabase, parsed.data.assignmentId, actor);
    if (!result.ok) return result;

    revalidateTeam();
    return { ok: true };
  });
}

/* ── Seasonal access ──────────────────────────────────────────────────────── */

export async function extendSeasonalAccessAction(input: unknown): Promise<TeamActionResult> {
  return runTeamAction(async () => {
    const { actor, can } = await currentActor();
    if (!can.editProfile) return { ok: false, error: "Your role cannot extend seasonal access." };

    const parsed = extendAccessSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid request.", fieldErrors: toTeamFieldErrors(parsed.error) };

    const supabase = await db();
    const result = await extendSeasonalAccess(supabase, parsed.data.staffId, parsed.data.accessEndsOn, actor);
    if (!result.ok) return result;

    revalidateTeam(parsed.data.staffId);
    return { ok: true };
  });
}

/* ── Activity & security ──────────────────────────────────────────────────── */

export async function sendPasswordResetAction(input: unknown): Promise<TeamActionResult> {
  return runTeamAction(async () => {
    const { actor, can } = await currentActor();
    if (!can.manageSessionsAndPasswords) return { ok: false, error: "Your role cannot reset another team member's password." };

    const parsed = sendPasswordResetSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid request.", fieldErrors: toTeamFieldErrors(parsed.error) };

    const supabase = await db();
    const result = await sendPasswordReset(supabase, parsed.data.staffId, actor);
    if (!result.ok) return result;

    // H4 of the remediation plan: every sibling action revalidates so the
    // PASSWORD_RESET_SENT activity entry shows up without a manual refresh —
    // this one skipped it.
    revalidateTeam(parsed.data.staffId);
    return { ok: true };
  });
}

export async function revokeSessionsAction(input: unknown): Promise<TeamActionResult> {
  return runTeamAction(async () => {
    const { actor, can } = await currentActor();
    if (!can.manageSessionsAndPasswords) return { ok: false, error: "Your role cannot revoke another team member's sessions." };

    const parsed = revokeSessionsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid request.", fieldErrors: toTeamFieldErrors(parsed.error) };

    const supabase = await db();
    const result = await revokeSessions(supabase, parsed.data.staffId, actor);
    if (!result.ok) return result;

    revalidateTeam(parsed.data.staffId);
    return { ok: true };
  });
}
