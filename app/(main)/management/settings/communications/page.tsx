import { cookies } from "next/headers";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { isTemplateAssignedToRole } from "@/lib/data/settings";
import { listMessageTemplates } from "@/lib/data/settings-repository";
import { createClient } from "@/utils/supabase/server";
import { PermissionDenied } from "@/components/ui/tone-badge";

import { TemplateList } from "./template-list";

/**
 * Reusable WhatsApp / Email / Portal / SMS copy. See the Settings plan §5.5.
 * Marketing and Visa see only the categories assigned to their role;
 * everyone with `viewCommunications` sees the full library read-only-aware.
 */
export const dynamic = "force-dynamic";

export default async function CommunicationsSettingsPage() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);

  if (!can.viewCommunications) {
    return <PermissionDenied what="Communication templates" />;
  }

  const supabase = createClient(await cookies());
  const allTemplates = await listMessageTemplates(supabase);
  const templates = can.communicationsScopedToOwnRole
    ? allTemplates.filter((t) => isTemplateAssignedToRole(t.assigned_roles, role))
    : allTemplates;

  return <TemplateList templates={templates} canEdit={can.editCommunications} scopedRole={can.communicationsScopedToOwnRole ? role : null} />;
}
