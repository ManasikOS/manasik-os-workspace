import type { StaffRole } from "@/lib/access/departure-groups-access";

/**
 * Role-based access for the agency setup guide (docs/onboarding/plan.md §7.2).
 * Same posture as every other `*-access.ts`: pure functions over a role string,
 * enforced in the UI *and* in every mutation. Only the administrator — the
 * owner who created the workspace — sees or edits setup.
 */
export interface SetupCapabilities {
  viewSetup: boolean;
  editSetup: boolean;
}

export function capabilitiesForSetup(role: StaffRole): SetupCapabilities {
  const isAdmin = role === "ADMIN";
  return { viewSetup: isAdmin, editSetup: isAdmin };
}
