import type { AgencyMembership } from "@/lib/data/departure-groups";

/**
 * True when a signed-in user belongs to no agency at all: no staff profile
 * (`activity` is null exactly when there is no profile row) and no active
 * membership.
 *
 * An invited staff member already has a profile, so they are never sent to
 * onboarding. Only someone who confirmed a signup link but never reached
 * provisioning — for example because the invite email template sent them
 * straight to the dashboard (docs/onboarding/plan.md D1) — matches.
 */
export function needsAgencyProvisioning(input: {
  activity: { status: string | null; lastActiveAt: string | null } | null;
  memberships: AgencyMembership[];
}): boolean {
  return input.activity === null && input.memberships.length === 0;
}
