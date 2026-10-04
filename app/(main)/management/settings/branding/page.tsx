import { cookies } from "next/headers";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { getAgencySettings } from "@/lib/data/settings-repository";
import { createClient } from "@/utils/supabase/server";
import { PermissionDenied } from "@/components/ui/tone-badge";

import { agencyAssetSignedUrl } from "./logo-storage";
import { BrandingForm } from "./branding-form";

/**
 * How the agency appears to customers — logo, portal colours, welcome
 * message, invoice footer and the seven pilgrim-portal toggles. See the
 * Settings plan §5.3 / F5: no pilgrim portal exists yet, so this section
 * says so rather than silently configuring nothing.
 */
export const dynamic = "force-dynamic";

export default async function BrandingSettingsPage() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);

  if (!can.viewBranding) {
    return <PermissionDenied what="Branding settings" />;
  }

  const supabase = createClient(await cookies());
  const settings = await getAgencySettings(supabase);
  const logoUrl = settings.logo_path ? await agencyAssetSignedUrl(settings.logo_path) : null;

  return <BrandingForm settings={settings} logoUrl={logoUrl} canEdit={can.editBranding} />;
}
