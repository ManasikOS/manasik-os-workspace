import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForPilgrims } from "@/lib/access/pilgrims-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { getAgencySettings } from "@/lib/data/settings-repository";
import { listPortalPilgrimSummaries } from "@/lib/data/portal-access-repository";
import { createClient } from "@/utils/supabase/server";

import PilgrimPortalView from "./components/pilgrim-portal-view";

/**
 * Pilgrim Portal (M13 remainder) — access lifecycle and engagement, for the
 * pilgrim-facing portal whose *content* is already configured in Settings →
 * Branding (agency_settings.portal_flags / portal_active). See
 * supabase/migrations/20261018090000_pilgrim_portal_access.sql for why
 * this is staff-side access management rather than the portal login itself.
 */
export default async function PilgrimPortalPage() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForPilgrims(role);
  if (!can.viewModule) notFound();

  const supabase = createClient(await cookies());
  const [pilgrims, agencySettings] = await Promise.all([
    listPortalPilgrimSummaries(supabase).catch(() => []),
    getAgencySettings(supabase),
  ]);

  return (
    <PilgrimPortalView
      pilgrims={pilgrims}
      portalActive={agencySettings.portal_active}
      canManage={can.managePortalAccess}
    />
  );
}
