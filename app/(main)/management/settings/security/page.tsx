import { cookies } from "next/headers";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { getAgencySettings, listStaffForSessionsCard } from "@/lib/data/settings-repository";
import { createClient } from "@/utils/supabase/server";
import { PermissionDenied } from "@/components/ui/tone-badge";

import { SecurityForm } from "./security-form";
import { SessionsCard } from "./sessions-card";

/**
 * Admin-only. See the Settings plan §5.8 / F6 — password policy, 2FA
 * enforcement and per-session device/location are Supabase Auth project
 * config, not application config, and render read-only with the reason
 * stated inline (D15) rather than as switches that flip and enforce nothing.
 */
export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage() {
  const { role, staffId } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);

  if (!can.viewSecurity) {
    return <PermissionDenied what="Security & Access settings" />;
  }

  const supabase = createClient(await cookies());
  const [settings, staff] = await Promise.all([getAgencySettings(supabase), listStaffForSessionsCard(supabase)]);

  return (
    <div className="flex flex-col gap-8">
      <SecurityForm settings={settings} canEdit={can.editSecurity} />
      <SessionsCard staff={staff} currentStaffId={staffId} canManage={can.editSecurity} />
    </div>
  );
}
