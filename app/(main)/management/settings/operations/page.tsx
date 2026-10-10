import { cookies } from "next/headers";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { listRoutingStaff, listStaffAvailability, loadRoutingPolicy } from "@/lib/data/inbox-routing-repository";
import { listSignalsForReview, loadSignalPrecision } from "@/lib/data/inbox-signal-review-repository";
import { loadSlaSettings } from "@/lib/data/inbox-sla-repository";
import { SIGNAL_REVIEW_ROLES } from "@/lib/inbox/risk/precision";
import { getAgencySettings } from "@/lib/data/settings-repository";
import { workingHoursToFormText } from "@/lib/inbox/sla/working-hours-form";
import { createClient } from "@/utils/supabase/server";
import { PermissionDenied } from "@/components/ui/tone-badge";

import { InboxRoutingForm } from "./inbox-routing-form";
import { InboxStaffAvailabilityCard } from "./inbox-staff-availability-card";
import { InboxSlaForm } from "./inbox-sla-form";
import { SignalReviewCard } from "./signal-review-card";
import { OperationalDefaultsForm } from "./operational-defaults-form";
import { PackageApprovalPolicyCard } from "./package-approval-policy-card";

/**
 * Departure group defaults, readiness thresholds and document/visa defaults
 * — the section with the most consumer wiring. See the Settings plan §5.4 / F4.
 */
export const dynamic = "force-dynamic";

export default async function OperationsSettingsPage() {
  const { role, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);

  if (!can.viewOperations) {
    return <PermissionDenied what="Operational defaults" />;
  }

  const supabase = createClient(await cookies());
  const settings = await getAgencySettings(supabase);
  const sla = agencyId ? await loadSlaSettings(supabase, agencyId) : null;
  const { data: aiRow } = agencyId ? await supabase.from("ai_settings").select("working_hours").eq("agency_id", agencyId).maybeSingle() : { data: null };

  // The package change approval switches, and how many administrators could approve (TASK-043). A failed read shows the safe default: approval on.
  const [{ data: approvalRow }, { count: approverCount }] = agencyId
    ? await Promise.all([
        supabase.from("agency_settings").select("package_approval_money_contract, package_approval_bookings_ops").eq("agency_id", agencyId).maybeSingle(),
        supabase.from("staff_profiles").select("id", { count: "exact", head: true }).eq("agency_id", agencyId).eq("role", "ADMIN").eq("status", "ACTIVE"),
      ])
    : [{ data: null }, { count: 0 }];

  // A failed read hides the review card instead of breaking the whole settings page.
  const signalReview = agencyId
    ? await Promise.all([loadSignalPrecision(supabase, agencyId), listSignalsForReview(supabase, agencyId)]).catch((cause) => {
        console.error("Could not load the Copilot accuracy check:", cause instanceof Error ? cause.message : cause);
        return null;
      })
    : null;

  return (
    <div className="space-y-6">
      <OperationalDefaultsForm settings={settings} canEdit={can.editOperations} />
      {agencyId && (
        <PackageApprovalPolicyCard
          moneyAndContract={approvalRow?.package_approval_money_contract ?? true}
          bookingsAndOperations={approvalRow?.package_approval_bookings_ops ?? true}
          approverCount={approverCount ?? 0}
          canEdit={can.managePackageApprovalPolicy}
        />
      )}
      {agencyId && <InboxRoutingForm policy={await loadRoutingPolicy(supabase, agencyId)} canEdit={can.editOperations} />}
      {agencyId && <InboxStaffAvailabilityCard staff={await listRoutingStaff(supabase, agencyId)} entries={await listStaffAvailability(supabase, agencyId)} canEdit={can.editOperations} />}
      {sla && (
        <InboxSlaForm
          policies={[...sla.policies.values()]}
          workingHours={workingHoursToFormText((aiRow as { working_hours?: unknown } | null)?.working_hours)}
          canEdit={can.editOperations}
        />
      )}
      {signalReview && (
        <SignalReviewCard precision={signalReview[0]} queue={signalReview[1]} canReview={(SIGNAL_REVIEW_ROLES as readonly string[]).includes(role)} />
      )}
    </div>
  );
}
