import { cookies } from "next/headers";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { getAgencySettings, listBranches } from "@/lib/data/settings-repository";
import { createClient } from "@/utils/supabase/server";
import { PermissionDenied } from "@/components/ui/tone-badge";

import { BranchList } from "./branch-list";
import { BranchRulesCard } from "./branch-rules-card";

/**
 * Branch directory + branch rules. See the Settings plan §5.2 / F1 — this is
 * the section that turns "Add Branch" from a schema migration into a row
 * insert.
 */
export const dynamic = "force-dynamic";

export default async function BranchesSettingsPage() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForSettings(role);

  if (!can.viewBranches) {
    return <PermissionDenied what="Branches" />;
  }

  const supabase = createClient(await cookies());
  const [branches, settings, managersRes] = await Promise.all([
    listBranches(supabase),
    getAgencySettings(supabase),
    supabase
      .from("staff_profiles")
      .select("id, full_name")
      .eq("status", "ACTIVE")
      .order("full_name", { ascending: true }),
  ]);

  const managers = (managersRes.data ?? []).map((m) => ({ id: m.id as string, name: m.full_name as string }));

  return (
    <div className="flex flex-col gap-8">
      <BranchList branches={branches} managers={managers} canEdit={can.editBranches} />
      <BranchRulesCard rules={settings.branch_rules} canEdit={can.editBranches} />
    </div>
  );
}
