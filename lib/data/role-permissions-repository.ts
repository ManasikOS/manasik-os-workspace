/**
 * Server-only read/write access for the dynamic Roles & Permissions system —
 * see `supabase/migrations/20260924090000_dynamic_roles_permissions.sql` for
 * the schema and the design rationale (why `base_role` exists, why RLS is
 * untouched, why `role_permissions.capabilities` mirrors each module's
 * TypeScript interface verbatim instead of a generic CRUD shape).
 *
 * Same posture as every other `*-repository.ts` file: the only file that
 * touches Supabase for `staff_roles` and `role_permissions`.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Constants/types shared with Client Components — see that file's own doc
// comment for why they live there and not here: a value import (not just a
// type) from a `server-only`-guarded module pulls this whole file into the
// client bundle, and `server-only` throws there by design.
import { BASE_ROLES, KNOWN_MODULES, type BaseRole, type PermissionModule, type RolePermissionRow, type StaffRoleRow } from "@/lib/access/role-permissions-shared";

export { BASE_ROLES, KNOWN_MODULES };
export type { BaseRole, PermissionModule, RolePermissionRow, StaffRoleRow };

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class RolePermissionsError extends Error {
  /** Postgres error code (e.g. "42P01" undefined_table, "42703" undefined_column), when available. */
  readonly code?: string;

  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update" | "delete",
    cause: unknown,
  ) {
    super(`${operation} on ${table} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "RolePermissionsError";
    this.code = (cause as { code?: string } | null)?.code;
  }
}

/**
 * True when `staff_roles` / `role_permissions` are not reachable yet — two
 * distinct causes worth telling the operator apart:
 *   - "42P01" (raw Postgres "undefined_table") —
 *     `supabase/migrations/20260924090000_dynamic_roles_permissions.sql`
 *     genuinely hasn't been applied to this database yet.
 *   - "PGRST205" (PostgREST "not in schema cache") — the migration WAS
 *     applied, the tables exist, but Supabase's REST layer hasn't picked up
 *     the schema change yet. This happens specifically when a migration is
 *     pasted into the SQL Editor by hand rather than applied through
 *     Supabase's own migration tooling, which auto-notifies PostgREST to
 *     reload — a manual paste doesn't send that notification. Fixed by
 *     running `NOTIFY pgrst, 'reload schema';`, using the dashboard's
 *     "Reload schema" control (Settings → API), or just waiting — Supabase
 *     also refreshes this periodically on its own.
 */
export function isMigrationNotAppliedError(error: unknown): boolean {
  return error instanceof RolePermissionsError && (error.code === "42P01" || error.code === "PGRST205");
}

export function isSchemaCacheStaleError(error: unknown): boolean {
  return error instanceof RolePermissionsError && error.code === "PGRST205";
}

function assertRowAffected<T>(row: T | null, table: string, operation: "insert" | "update" | "delete"): asserts row is T {
  if (!row) {
    throw new RolePermissionsError(
      table,
      operation,
      new Error("No row matched — it may no longer exist, or this account cannot write it."),
    );
  }
}

/* ── Roles ────────────────────────────────────────────────────────────────── */

export async function loadRoles(db: Db): Promise<StaffRoleRow[]> {
  const { data, error } = await db
    .from("staff_roles")
    .select("*")
    .order("is_system", { ascending: false })
    .order("name", { ascending: true });
  if (error) throw new RolePermissionsError("staff_roles", "select", error);
  return (data ?? []) as StaffRoleRow[];
}

export async function loadRole(db: Db, roleId: string): Promise<StaffRoleRow | null> {
  const { data, error } = await db.from("staff_roles").select("*").eq("id", roleId).maybeSingle();
  if (error) throw new RolePermissionsError("staff_roles", "select", error);
  return (data as StaffRoleRow) ?? null;
}

/**
 * Creates a role and seeds it with a starting permission set for every
 * module — copied from `baseRole`'s SYSTEM role (a sensible, safe default:
 * a brand-new "Regional Manager" based on OPERATIONS starts with exactly
 * what Operations can already do, then gets tightened or loosened from
 * there) rather than starting fully denied, which would make a freshly
 * created role useless until every one of 14 modules was hand-configured.
 */
export async function createRole(
  db: Db,
  input: { name: string; description?: string; baseRole: BaseRole },
  agencyId: string,
): Promise<{ ok: true; roleId: string } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Enter a name for the role." };

  const { data: systemRole, error: systemRoleError } = await db
    .from("staff_roles")
    .select("id")
    .eq("agency_id", agencyId)
    .eq("base_role", input.baseRole)
    .eq("is_system", true)
    .maybeSingle();
  if (systemRoleError) throw new RolePermissionsError("staff_roles", "select", systemRoleError);

  const { data: inserted, error: insertError } = await db
    .from("staff_roles")
    .insert({ agency_id: agencyId, name, description: input.description || null, base_role: input.baseRole, is_system: false })
    .select("id")
    .single();
  if (insertError) {
    if ((insertError as { code?: string }).code === "23505") {
      return { ok: false, error: "A role with that name already exists." };
    }
    throw new RolePermissionsError("staff_roles", "insert", insertError);
  }

  const roleId = inserted.id as string;

  if (systemRole) {
    const { data: seedRows, error: seedError } = await db
      .from("role_permissions")
      .select("module, capabilities")
      .eq("role_id", systemRole.id);
    if (seedError) throw new RolePermissionsError("role_permissions", "select", seedError);

    if (seedRows && seedRows.length > 0) {
      const { error: copyError } = await db
        .from("role_permissions")
        .insert(seedRows.map((row: { module: string; capabilities: Record<string, boolean> }) => ({
          role_id: roleId,
          module: row.module,
          capabilities: row.capabilities,
        })));
      if (copyError) throw new RolePermissionsError("role_permissions", "insert", copyError);
    }
  }

  return { ok: true, roleId };
}

export async function updateRole(
  db: Db,
  roleId: string,
  input: { name?: string; description?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { ok: false, error: "Enter a name for the role." };
    payload.name = name;
  }
  if (input.description !== undefined) payload.description = input.description || null;
  if (Object.keys(payload).length === 0) return { ok: true };

  const { data: updated, error } = await db.from("staff_roles").update(payload).eq("id", roleId).select("id").maybeSingle();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, error: "A role with that name already exists." };
    }
    throw new RolePermissionsError("staff_roles", "update", error);
  }
  assertRowAffected(updated, "staff_roles", "update");

  return { ok: true };
}

/**
 * Never deletes a system role (the 7 seeded ones — always at least one
 * assignment target and permissions fallback per base tier), and refuses a
 * custom role still holding any staff assignments so nobody's role silently
 * disappears out from under them — reassign them first.
 */
export async function deleteRole(db: Db, roleId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: role, error: roleError } = await db.from("staff_roles").select("is_system").eq("id", roleId).maybeSingle();
  if (roleError) throw new RolePermissionsError("staff_roles", "select", roleError);
  if (!role) return { ok: true };
  if (role.is_system) return { ok: false, error: "System roles can be edited but not deleted." };

  const { count, error: assigneeError } = await db
    .from("staff_profiles")
    .select("id", { count: "exact", head: true })
    .eq("role_id", roleId);
  if (assigneeError) throw new RolePermissionsError("staff_profiles", "select", assigneeError);
  if ((count ?? 0) > 0) {
    return { ok: false, error: "Reassign every team member on this role before deleting it." };
  }

  const { error } = await db.from("staff_roles").delete().eq("id", roleId);
  if (error) throw new RolePermissionsError("staff_roles", "delete", error);

  return { ok: true };
}

/* ── Permissions ──────────────────────────────────────────────────────────── */

export async function loadRolePermissions(db: Db, roleId: string): Promise<RolePermissionRow[]> {
  const { data, error } = await db.from("role_permissions").select("*").eq("role_id", roleId);
  if (error) throw new RolePermissionsError("role_permissions", "select", error);
  return (data ?? []) as RolePermissionRow[];
}

export async function loadRolePermission(db: Db, roleId: string, module: PermissionModule): Promise<Record<string, boolean> | null> {
  const { data, error } = await db
    .from("role_permissions")
    .select("capabilities")
    .eq("role_id", roleId)
    .eq("module", module)
    .maybeSingle();
  if (error) throw new RolePermissionsError("role_permissions", "select", error);
  return (data?.capabilities as Record<string, boolean>) ?? null;
}

export async function updateRolePermissions(
  db: Db,
  roleId: string,
  module: PermissionModule,
  capabilities: Record<string, boolean>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: role, error: roleError } = await db.from("staff_roles").select("id").eq("id", roleId).maybeSingle();
  if (roleError) throw new RolePermissionsError("staff_roles", "select", roleError);
  if (!role) return { ok: false, error: "Role not found." };

  const { error } = await db
    .from("role_permissions")
    .upsert({ role_id: roleId, module, capabilities }, { onConflict: "role_id,module" });
  if (error) throw new RolePermissionsError("role_permissions", "update", error);

  return { ok: true };
}

/* ── Assignment ───────────────────────────────────────────────────────────── */

/**
 * Sets `staff_profiles.role_id`. `staff_profiles.role` (the text RLS reads)
 * is derived automatically by the `staff_profiles_sync_role_text` trigger
 * from the chosen role's `base_role` — this function never writes it
 * directly, so the two can never drift apart.
 */
export async function assignStaffRole(
  db: Db,
  staffId: string,
  roleId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: role, error: roleError } = await db.from("staff_roles").select("id, base_role").eq("id", roleId).maybeSingle();
  if (roleError) throw new RolePermissionsError("staff_roles", "select", roleError);
  if (!role) return { ok: false, error: "Role not found." };

  const { data: current, error: currentError } = await db
    .from("staff_profiles")
    .select("role, role_id")
    .eq("id", staffId)
    .maybeSingle();
  if (currentError) throw new RolePermissionsError("staff_profiles", "select", currentError);
  if (!current) return { ok: false, error: "Team member not found." };

  // Demoting the last remaining Admin-tier account is already blocked by
  // enforce_last_admin() at the database level once `role` (text) actually
  // changes — this just gives the friendly message on the common,
  // non-concurrent path, same posture as changeStaffRole() in
  // team-repository.ts.
  if (current.role === "ADMIN" && role.base_role !== "ADMIN") {
    const { count, error: adminCountError } = await db
      .from("staff_profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "ADMIN")
      .eq("status", "ACTIVE");
    if (adminCountError) throw new RolePermissionsError("staff_profiles", "select", adminCountError);
    if ((count ?? 0) <= 1) {
      return { ok: false, error: "Cannot change the role of the last remaining Admin." };
    }
  }

  if (current.role_id === roleId) return { ok: true };

  const { data: updated, error } = await db
    .from("staff_profiles")
    .update({ role_id: roleId })
    .eq("id", staffId)
    .select("id")
    .maybeSingle();
  if (error) throw new RolePermissionsError("staff_profiles", "update", error);
  assertRowAffected(updated, "staff_profiles", "update");

  return { ok: true };
}
