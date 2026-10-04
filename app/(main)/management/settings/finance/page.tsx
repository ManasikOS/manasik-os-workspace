import { cookies } from "next/headers";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { listApprovedPaymentAccounts } from "@/lib/data/agency-payment-accounts-repository";
import { getAgencySettings } from "@/lib/data/settings-repository";
import { createClient } from "@/utils/supabase/server";
import { PermissionDenied } from "@/components/ui/tone-badge";

import { FinanceDefaultsForm } from "./finance-defaults-form";
import { ApprovedPaymentAccountsCard } from "./payment-accounts-card";

/**
 * Currency, numbering prefixes, payment methods and margin visibility. See
 * the Settings plan §5.6 — the section with the most immediately observable
 * effect, since `nextReferenceNumber()` reads these prefixes directly.
 */
export const dynamic = "force-dynamic";

export default async function FinanceSettingsPage() {
  const { role, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);

  if (!can.viewFinance) {
    return <PermissionDenied what="Finance defaults" />;
  }

  const supabase = createClient(await cookies());
  const settings = await getAgencySettings(supabase);
  const accounts = agencyId
    ? await listApprovedPaymentAccounts(supabase, agencyId).catch((cause) => {
        console.error("Could not load the approved bank accounts:", cause instanceof Error ? cause.message : cause);
        return null;
      })
    : null;

  return (
    <div className="space-y-6">
      <FinanceDefaultsForm settings={settings} canEdit={can.editFinance} />
      {accounts && <ApprovedPaymentAccountsCard accounts={accounts} canEdit={can.editFinance} />}
    </div>
  );
}
