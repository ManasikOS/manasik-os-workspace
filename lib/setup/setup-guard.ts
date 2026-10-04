import "server-only";

import { redirect } from "next/navigation";

import { capabilitiesForSetup } from "@/lib/access/setup-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { getSessionUser } from "@/lib/dal";
import { needsAgencyProvisioning } from "@/lib/onboarding/onboarding-routing";

/**
 * Gate for the setup route and its actions. Signed-out → login; signed in with
 * no agency yet → onboarding; anyone but the administrator → dashboard.
 * Returns the agency id every write must be scoped to.
 */
export async function requireSetupAdmin(): Promise<{ agencyId: string; userId: string }> {
  const [user, { role, agencyId, activity, memberships }] = await Promise.all([getSessionUser(), getCurrentStaffRole()]);

  if (!user) redirect("/login");
  if (needsAgencyProvisioning({ activity, memberships })) redirect("/onboarding");
  if (!agencyId || !capabilitiesForSetup(role).editSetup) redirect("/dashboard");

  return { agencyId, userId: user.id };
}
