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

  // A read error is NOT the same as "no override saved". With no row (a brand-new role with nothing set for this module) the base role's default
  // applies. With an error we cannot know whether this role was restricted, and falling back to the defaults would hand a restricted custom role its
  // base role's full set for as long as the database hiccups — so everything is denied for that request instead (TASK-043 PKG-04).
  if (error) {
    console.error(`[access] could not read the "${module}" permissions for role ${roleId}; denying all capabilities for this request: ${error.message}`);
    return Object.fromEntries(Object.entries(fallback).map(([key, value]) => [key, typeof value === "boolean" ? false : value])) as T;
  }
  if (!data) return fallback;

  // Only a saved boolean counts, and only for a capability this module knows. A string, a number or an unknown key in the stored JSON never grants
  // anything (the database applies the same rule: only JSON `true` grants).
  const saved = data.capabilities;
  if (saved === null || typeof saved !== "object" || Array.isArray(saved)) return fallback;

  const merged: Record<string, unknown> = { ...(fallback as Record<string, unknown>) };
  for (const [key, defaultValue] of Object.entries(fallback)) {
    if (!Object.prototype.hasOwnProperty.call(saved, key)) continue;
    const value = (saved as Record<string, unknown>)[key];
    // Capabilities are booleans; a non-boolean saved for one is read as "not granted". Any other kind of field keeps the old merge.
    merged[key] = typeof defaultValue === "boolean" ? value === true : value;
  }
  return merged as T;
}
