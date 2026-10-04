import { cookies } from "next/headers";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { getAgencySettings, listBranches } from "@/lib/data/settings-repository";
import { createClient } from "@/utils/supabase/server";
import { PermissionDenied } from "@/components/ui/tone-badge";

import { SectionShell } from "../components/section-shell";
import { DangerActions } from "./danger-actions";

/**
 * Admin-only, its own route, visually separated by a `danger`-toned nav
 * entry. Every action is behind a typed-confirmation dialog and none of
 * them sit beside a normal Save button. See the Settings plan §5.10 / D13.
 */
export const dynamic = "force-dynamic";

export default async function DangerZoneSettingsPage() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);

  if (!can.viewDangerZone) {
    return <PermissionDenied what="Danger Zone" />;
  }

  const supabase = createClient(await cookies());
  const [settings, branches] = await Promise.all([getAgencySettings(supabase), listBranches(supabase)]);

  const archivable = branches
    .filter((b) => b.status !== "ARCHIVED")
    .map((b) => ({ id: b.id, name: b.name, code: b.code }));

  return (
    <SectionShell
      title="Danger Zone"
      description="Deliberate, irreversible-feeling actions. Every one of these requires typing a confirmation phrase — there is no plain OK button here."
    >
      <DangerActions branches={archivable} portalActive={settings.portal_active} />
    </SectionShell>
  );
}
