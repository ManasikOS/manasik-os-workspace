import { cookies } from "next/headers";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { createClient } from "@/utils/supabase/server";
import { PermissionDenied } from "@/components/ui/tone-badge";

import { SectionShell } from "../components/section-shell";
import { TemplateManager } from "./template-manager";
import type { WhatsAppTemplateRow } from "@/lib/types/whatsapp";

/**
 * Message templates synced with the agency's WABA — §5 E8 of
 * docs/modules/whatsapp-meta-connection-implementation-plan.md. Required for any
 * outbound message outside the 24-hour service window, and required
 * evidence for Meta's App Review (video 2).
 */
export const dynamic = "force-dynamic";

export default async function WhatsAppTemplatesSettingsPage() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);

  if (!can.viewIntegrations) {
    return <PermissionDenied what="WhatsApp templates" />;
  }

  const supabase = createClient(await cookies());
  const [{ data: templates }, { data: integration }] = await Promise.all([
    supabase.from("whatsapp_templates").select("*").order("created_at", { ascending: false }),
    supabase.from("whatsapp_integrations").select("status").maybeSingle(),
  ]);

  return (
    <SectionShell
      title="WhatsApp Templates"
      description="Message templates approved by Meta for use outside the 24-hour conversation window — marketing, order updates, and authentication codes."
    >
      <TemplateManager
        templates={(templates ?? []) as WhatsAppTemplateRow[]}
        canEdit={can.editIntegrations}
        connected={integration?.status === "CONNECTED"}
      />
    </SectionShell>
  );
}
