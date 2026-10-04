/**
 * Reads a role's stored `role_permissions` row for one module and merges it
 * over a code-level fallback (normally that module's own `capabilitiesFor*()`
 * result for the person's `role`) — see
 * `supabase/migrations/20260924090000_dynamic_roles_permissions.sql` for why
 * this exists and what it deliberately does not change (RLS).
 *
 * The merge, not a straight replace, is what makes this resilient to schema
 * drift: if a module's Capabilities interface gains a new field after a
 * custom role's permissions were last saved, that field falls back to the
 * code-level default (from `capabilitiesFor*(role)`) instead of silently
 * becoming `undefined`/falsy for every existing custom role.
 */

import "server-only";

import type { Db, PermissionModule } from "@/lib/data/role-permissions-repository";

export async function loadDynamicCapabilities<T extends object>(
  db: Db,
  roleId: string | null,
  module: PermissionModule,
  fallback: T,
): Promise<T> {
  if (!roleId) return fallback;

  const { data, error } = await db
    .from("role_permissions")
    .select("capabilities")
    .eq("role_id", roleId)
    .eq("module", module)
    .maybeSingle();

  // Best-effort: a missing row (brand-new role with no override for this
  // module yet) or a read error both fall back to the code-level default
  // rather than denying everything — the same posture `getCurrentStaffRole()`
  // takes on its own failure modes.
  if (error || !data) return fallback;

  return { ...fallback, ...(data.capabilities as Partial<T>) };
}
