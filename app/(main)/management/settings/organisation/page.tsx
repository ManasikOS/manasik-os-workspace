import { cookies } from "next/headers";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { getAgencySettings } from "@/lib/data/settings-repository";
import { createClient } from "@/utils/supabase/server";
import { PermissionDenied } from "@/components/ui/tone-badge";

import { OrganisationForm } from "./organisation-form";

/**
 * Agency identity used across invoices, receipts, WhatsApp templates, the
 * pilgrim portal and PDF reports. See the Settings plan §5.1.
 */
export const dynamic = "force-dynamic";

export default async function OrganisationSettingsPage() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);

  if (!can.viewOrganisation) {
    return <PermissionDenied what="Organisation settings" />;
  }

  const supabase = createClient(await cookies());
  const settings = await getAgencySettings(supabase);

  return <OrganisationForm settings={settings} canEdit={can.editOrganisation} />;
}
