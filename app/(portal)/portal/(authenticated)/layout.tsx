import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { getPortalSession, isPortalActiveForAgency, linkPortalPilgrimIfNeeded } from "@/lib/data/pilgrim-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

/**
 * Guards everything under `/portal` except `/portal/login`, which is a
 * sibling route outside this `(authenticated)` group specifically so it
 * never hits this same auth requirement. Three checks, in order: is there a
 * session at all; is it linked to an invited pilgrim (auto-links on first
 * visit after a successful magic-link sign-in); is the portal switched on
 * for that pilgrim's agency (agency_settings.portal_active — the Danger
 * Zone kill switch a staff admin can flip).
 */
export default async function PortalAuthenticatedLayout({ children }: { children: ReactNode }) {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/portal/login");

  const admin = createAdminClient();
  if (user.email) {
    await linkPortalPilgrimIfNeeded(admin, user.id, user.email);
  }

  const session = await getPortalSession(supabase);
  if (!session) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background p-6 text-sm">
        <p className="font-medium text-foreground">We couldn&apos;t find your portal access</p>
        <p className="text-muted-foreground">
          This email isn&apos;t recognised as an active portal invitation. Contact your travel agency if you
          believe this is a mistake.
        </p>
      </div>
    );
  }

  const portalActive = await isPortalActiveForAgency(admin, session.agencyId);
  if (!portalActive) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background p-6 text-sm">
        <p className="font-medium text-foreground">Portal temporarily unavailable</p>
        <p className="text-muted-foreground">Your travel agency has this portal switched off right now. Please check back later.</p>
      </div>
    );
  }

  return <>{children}</>;
}
