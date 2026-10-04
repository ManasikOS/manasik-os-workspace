"use server";

/**
 * Server Actions for the dynamic Roles & Permissions system — see
 * `supabase/migrations/20260924090000_dynamic_roles_permissions.sql` and
 * `lib/data/role-permissions-repository.ts`. Kept separate from
 * `actions.ts` (Team member CRUD) since roles are consumed by every module,
 * not just Team, even though the editor UI lives on the Team page.
 */

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { capabilitiesForTeam } from "@/lib/access/team-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  BASE_ROLES,
  KNOWN_MODULES,
  RolePermissionsError,
  assignStaffRole,
  createRole,
  deleteRole,
  isMigrationNotAppliedError,
  isSchemaCacheStaleError,
  loadRole,
  loadRolePermission,
  loadRolePermissions,
  loadRoles,
  updateRole,
  updateRolePermissions,
  type PermissionModule,
  type RolePermissionRow,
  type StaffRoleRow,
} from "@/lib/data/role-permissions-repository";
import { createClient } from "@/utils/supabase/server";

export interface RoleActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

async function db() {
  return createClient(await cookies());
}

function revalidateRoles() {
  revalidatePath("/management/team");
}

/**
 * Same guard as every Team Server Action: only Admin manages roles and
 * permissions. Not `capabilitiesForTeam(role).changeRole` — role/permission
 * MANAGEMENT is a distinct, agency-wide administrative capability from
 * changing one person's assignment, so it is gated on `viewFullDirectory`
 * (Admin-only in practice today) rather than reusing a Team-specific flag.
 */
async function requireAdmin(): Promise<{ ok: true; agencyId: string } | { ok: false; error: string }> {
  const { role, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesForTeam(role);
  if (!can.viewFullDirectory || !agencyId) {
    return { ok: false, error: "Your role cannot manage roles and permissions." };
  }
  return { ok: true, agencyId };
}

/**
 * Wraps every Server Action in this file, read or write — a plain
 * `RolePermissionsError` (any Postgres failure from `staff_roles` /
 * `role_permissions`) becomes an honest `{ ok: false }` instead of an
 * unhandled server-action crash (a 500 and an unhandled-rejection in the
 * browser console). Gives a specific, actionable message when the cause is
 * the tables not existing yet — by far the most likely failure the first
 * time anyone opens this panel, since it means
 * `supabase/migrations/20260924090000_dynamic_roles_permissions.sql` simply
 * hasn't been applied to this database yet, not a bug to chase.
 */
async function runRoleAction<T extends RoleActionResult>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    if (cause instanceof RolePermissionsError) {
      console.error("Role action failed", cause);
      if (isSchemaCacheStaleError(cause)) {
        return {
          ok: false,
          error:
            "The database was just updated but Supabase's API hasn't picked it up yet. Run NOTIFY pgrst, 'reload schema'; in the SQL Editor (or wait a minute), then try again.",
        } as T;
      }
      if (isMigrationNotAppliedError(cause)) {
        return {
          ok: false,
          error: "Roles & Permissions isn't set up on this database yet — ask your developer to apply the latest migration.",
        } as T;
      }
      return { ok: false, error: "Something went wrong. Please try again." } as T;
    }
    throw cause;
  }
}

/* ── Reads ────────────────────────────────────────────────────────────────── */

export async function listRolesAction(): Promise<{ ok: true; roles: StaffRoleRow[] } | { ok: false; error: string }> {
  return runRoleAction(async () => {
    const guard = await requireAdmin();
    if (!guard.ok) return guard;
    const supabase = await db();
    const roles = await loadRoles(supabase);
    return { ok: true, roles };
  });
}

export async function listRolePermissionsAction(
  roleId: string,
): Promise<{ ok: true; permissions: RolePermissionRow[] } | { ok: false; error: string }> {
  return runRoleAction(async () => {
    const guard = await requireAdmin();
    if (!guard.ok) return guard;
    const supabase = await db();
    const permissions = await loadRolePermissions(supabase, roleId);
    return { ok: true, permissions };
  });
}

/* ── Role CRUD ────────────────────────────────────────────────────────────── */

const createRoleSchema = z.object({
  name: z.string().trim().min(1, "Enter a name for the role."),
  description: z.string().trim().max(300).optional(),
  baseRole: z.enum(BASE_ROLES),
});

export interface CreateRoleResult extends RoleActionResult {
  roleId?: string;
}

export async function createRoleAction(input: unknown): Promise<CreateRoleResult> {
  return runRoleAction(async () => {
    const guard = await requireAdmin();
    if (!guard.ok) return guard;

    const parsed = createRoleSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Check the highlighted fields.", fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])) };
    }

    const supabase = await db();
    const result = await createRole(supabase, parsed.data, guard.agencyId);
    if (!result.ok) return result;

    revalidateRoles();
    return { ok: true, roleId: result.roleId };
  });
}

const updateRoleSchema = z.object({
  roleId: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().max(300).nullable().optional(),
});

export async function updateRoleAction(input: unknown): Promise<RoleActionResult> {
  return runRoleAction(async () => {
    const guard = await requireAdmin();
    if (!guard.ok) return guard;

    const parsed = updateRoleSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid request." };

    const supabase = await db();
    const role = await loadRole(supabase, parsed.data.roleId);
    if (!role) return { ok: false, error: "Role not found." };

    const result = await updateRole(supabase, parsed.data.roleId, { name: parsed.data.name, description: parsed.data.description ?? undefined });
    if (!result.ok) return result;

    revalidateRoles();
    return { ok: true };
  });
}

const deleteRoleSchema = z.object({ roleId: z.string().trim().min(1) });

export async function deleteRoleAction(input: unknown): Promise<RoleActionResult> {
  return runRoleAction(async () => {
    const guard = await requireAdmin();
    if (!guard.ok) return guard;

    const parsed = deleteRoleSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid request." };

    const supabase = await db();
    const result = await deleteRole(supabase, parsed.data.roleId);
    if (!result.ok) return result;

    revalidateRoles();
    return { ok: true };
  });
}

/* ── Permissions ──────────────────────────────────────────────────────────── */

const moduleEnum = z.enum(KNOWN_MODULES);

const updatePermissionsSchema = z.object({
  roleId: z.string().trim().min(1),
  module: moduleEnum,
  capabilities: z.record(z.string(), z.boolean()),
});

export async function updateRolePermissionsAction(input: unknown): Promise<RoleActionResult> {
  return runRoleAction(async () => {
    const guard = await requireAdmin();
    if (!guard.ok) return guard;

    const parsed = updatePermissionsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid request." };

    const supabase = await db();
    const result = await updateRolePermissions(supabase, parsed.data.roleId, parsed.data.module as PermissionModule, parsed.data.capabilities);
    if (!result.ok) return result;

    revalidateRoles();
    return { ok: true };
  });
}

export async function getRolePermissionAction(
  roleId: string,
  module: PermissionModule,
): Promise<{ ok: true; capabilities: Record<string, boolean> | null } | { ok: false; error: string }> {
  return runRoleAction(async () => {
    const guard = await requireAdmin();
    if (!guard.ok) return guard;
    const supabase = await db();
    const capabilities = await loadRolePermission(supabase, roleId, module);
    return { ok: true, capabilities };
  });
}

/* ── Assignment ───────────────────────────────────────────────────────────── */

const assignRoleSchema = z.object({
  staffId: z.string().trim().min(1),
  roleId: z.string().trim().min(1),
});

export async function assignStaffRoleAction(input: unknown): Promise<RoleActionResult> {
  return runRoleAction(async () => {
    const guard = await requireAdmin();
    if (!guard.ok) return guard;

    const parsed = assignRoleSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid request." };

    const supabase = await db();
    const result = await assignStaffRole(supabase, parsed.data.staffId, parsed.data.roleId);
    if (!result.ok) return result;

    revalidatePath("/management/team");
    revalidatePath(`/management/team/${parsed.data.staffId}`);
    return { ok: true };
  });
}
