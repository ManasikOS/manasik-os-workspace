import { cookies } from "next/headers";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { listServiceAddons } from "@/lib/data/service-addons";
import { createClient } from "@/utils/supabase/server";
import { PermissionDenied } from "@/components/ui/tone-badge";

import ServiceAddonsManager from "./service-addons-manager";

export const dynamic = "force-dynamic";

export default async function ServiceAddonsPage() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);

  if (!can.viewOperations) {
    return <PermissionDenied what="Service add-ons" />;
  }

  const supabase = createClient(await cookies());
  const addons = await listServiceAddons(supabase);

  return (
    <ServiceAddonsManager
      addons={addons}
      canEdit={can.editOperations}
    />
  );
}
