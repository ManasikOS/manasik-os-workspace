import { cookies } from "next/headers";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { getBillingSummary } from "@/lib/data/whatsapp-billing-view";
import { createClient } from "@/utils/supabase/server";
import { PermissionDenied } from "@/components/ui/tone-badge";

import { SectionShell } from "../components/section-shell";
import { BillingDashboard } from "./billing-dashboard";
import type { WhatsAppBillingBudgetRow, WhatsAppVolumeTierRow } from "@/lib/types/whatsapp";

/**
 * WhatsApp billing and usage tracker — §5 E10 of
 * docs/modules/whatsapp-meta-connection-implementation-plan.md. Meta bills each
 * agency directly; this screen makes that spend visible and attributable
 * without the agency ever opening WhatsApp Manager.
 */
export const dynamic = "force-dynamic";

export default async function WhatsAppBillingSettingsPage() {
  const { role, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);

  if (!can.viewFinance) {
    return <PermissionDenied what="WhatsApp billing" />;
  }
  if (!agencyId) {
    return <p className="text-sm text-muted-foreground">No agency resolved for your account.</p>;
  }

  const supabase = createClient(await cookies());
  const [summary, { data: budget }, { data: tiers }, { data: integration }] = await Promise.all([
    getBillingSummary(supabase, agencyId),
    supabase.from("whatsapp_billing_budgets").select("*").eq("agency_id", agencyId).maybeSingle(),
    supabase.from("whatsapp_volume_tiers").select("*").eq("agency_id", agencyId),
    supabase.from("whatsapp_integrations").select("status").maybeSingle(),
  ]);

  return (
    <SectionShell
      title="WhatsApp Billing"
      description="Meta bills your agency directly for WhatsApp usage — this is your spend, as Meta reports it, attributed to the leads and conversations that caused it."
    >
      <BillingDashboard
        summary={summary}
        budget={(budget as WhatsAppBillingBudgetRow | null) ?? null}
        tiers={(tiers ?? []) as WhatsAppVolumeTierRow[]}
        canEditBudget={can.editFinance}
        hasData={integration?.status === "CONNECTED"}
      />
    </SectionShell>
  );
}
