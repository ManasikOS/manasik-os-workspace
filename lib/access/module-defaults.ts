/**
 * A shared builder for the 10 modules registered in Phase 0 (P0.3) whose
 * pages/executors have not landed yet (bookings, quotes, marketing was
 * already hand-written before this, field_ops, guides, support,
 * relationships, agents, analytics, insights). Each of those modules'
 * `lib/access/<module>-access.ts` file is a placeholder capability set —
 * ADMIN/CEO get everything, every other non-denied role gets `viewModule`
 * only — until that module's real page (Phase 1+ of
 * docs/modules/manasik-intelligence-build-roadmap.md) defines what each role
 * should actually see. This mirrors the "absent config means permissive
 * enough to not silently break, restrictive enough to not silently leak"
 * posture the rest of this codebase already takes (see
 * `lib/access/dynamic-capabilities.ts`'s own doc comment) — a placeholder
 * grant is `viewModule` only, never a write capability.
 *
 * Regenerate a module's real `CAPABILITIES` map by hand, per-role, the
 * moment its page ships — this helper is explicitly a starting point, not
 * a permanent design.
 */

import type { StaffRole } from "@/lib/access/departure-groups-access";
import { STAFF_ROLES } from "@/lib/access/departure-groups-access";

export function buildPlaceholderCapabilities<T extends object>(keys: readonly (keyof T)[]): Record<StaffRole, T> {
  const allFalse = Object.fromEntries(keys.map((k) => [k, false])) as T;
  const allTrue = Object.fromEntries(keys.map((k) => [k, true])) as T;
  const viewOnly = { ...allFalse, viewModule: true } as T;

  const result: Partial<Record<StaffRole, T>> = {};
  for (const role of STAFF_ROLES) {
    result[role] = role === "ADMIN" || role === "CEO" ? allTrue : viewOnly;
  }
  return result as Record<StaffRole, T>;
}
