/**
 * Client-safe derivations over Agency Settings — no Supabase import, safe in
 * both Server and Client Components. Mirrors `lib/data/team.ts`'s split from
 * `team-repository.ts`.
 */

import type { StaffRole } from "@/lib/access/departure-groups-access";
import { MARGIN_VISIBILITY_ELIGIBLE_ROLES, type ReadinessBand } from "@/lib/data/settings-copy";
import type { AgencySettingsRow } from "@/lib/types/settings";

/**
 * Bands a 0–100 readiness percentage against the agency's configured
 * thresholds. `BLOCKED` is always derived — never a third stored value — so
 * the three bands can never overlap or leave a gap. See the Settings plan §9.3.
 */
export function bandReadiness(
  percent: number,
  settings: Pick<AgencySettingsRow, "readiness_ready_threshold" | "readiness_at_risk_threshold">,
): ReadinessBand {
  if (percent >= settings.readiness_ready_threshold) return "READY";
  if (percent >= settings.readiness_at_risk_threshold) return "AT_RISK";
  return "BLOCKED";
}

/** `INV-2026-00001` — the exact string `nextReferenceNumber()` would produce today. */
export function previewReferenceNumber(prefix: string, sequence = 1): string {
  const year = new Date().getFullYear();
  return `${prefix || "PFX"}-${year}-${String(sequence).padStart(5, "0")}`;
}

/**
 * Intersects a settings row's `margin_visible_roles` with the roles that are
 * actually *eligible* to see cost/margin data. A settings write can only
 * narrow visibility from what `capabilitiesForFinance()` / `capabilitiesForSuppliers()`
 * already grant — never widen it to a role like Marketing or Guide. See D4.
 */
export function intersectMarginVisibleRoles(requested: StaffRole[]): StaffRole[] {
  return requested.filter((role) => MARGIN_VISIBILITY_ELIGIBLE_ROLES.includes(role));
}

/** Whether a communication template category is visible to a scoped role (Marketing/Visa). */
export function isTemplateAssignedToRole(assignedRoles: StaffRole[], role: StaffRole): boolean {
  return assignedRoles.length === 0 || assignedRoles.includes(role);
}
