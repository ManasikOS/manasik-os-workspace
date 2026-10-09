import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { getSessionUser } from "@/lib/dal";
import {
  canRoleViewPackage,
  capabilitiesForPackages,
} from "@/lib/access/packages-access";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  getPackageActivity,
  getPackageDetail,
  getPackageUsage,
  listDepartureGroupsForPackage,
  listPackageChangeHistory,
  listPendingPackageChanges,
} from "@/lib/data/packages-repository";
import { isUuid } from "@/lib/utils";
import { createClient } from "@/utils/supabase/server";

import PackageDetail from "./components/package-detail";
import type { PackageDetailTabId } from "./components/package-detail";

export default async function PackageDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ packageId: string }>;
  searchParams: Promise<{ tab?: string; edit?: string }>;
}) {
  const [{ packageId }, { tab, edit }] = await Promise.all([params, searchParams]);
  if (!isUuid(packageId)) notFound();

  const { role, roleId } = await getCurrentStaffRole();

  const supabase = createClient(await cookies());
  // A custom role's saved overrides, merged over its base role's hardcoded
  // default — see docs/modules/packages-production-readiness-plan.md, finding A4.
  const can = await loadDynamicCapabilities(supabase, roleId, "packages", capabilitiesForPackages(role));
  if (!can.viewModule) notFound();

  const user = await getSessionUser();
  const pkg = await getPackageDetail(packageId, can.viewInternalFinance);
  if (!pkg) notFound();

  if (!canRoleViewPackage(pkg.status, role, pkg.owner_id, user?.id ?? null)) {
    notFound();
  }

  const [usage, groups, activity, pendingChanges, changeHistory] = await Promise.all([
    getPackageUsage(packageId),
    // Revenue is fetched only for roles that may see finance figures (TASK-043 PKG-12).
    listDepartureGroupsForPackage(packageId, can.viewInternalFinance),
    getPackageActivity(packageId),
    listPendingPackageChanges(packageId),
    listPackageChangeHistory(packageId),
  ]);

  const validTabs: PackageDetailTabId[] = [
    "overview",
    "pricing",
    "journey",
    "services",
    "requirements",
    "group-defaults",
    "groups",
    "activity",
  ];
  const initialTab = validTabs.includes(tab as PackageDetailTabId)
    ? (tab as PackageDetailTabId)
    : "overview";

  return (
    <PackageDetail
      pkg={pkg}
      usage={usage}
      groups={groups}
      activity={activity}
      pendingChanges={pendingChanges}
      changeHistory={changeHistory}
      currentUserId={user?.id ?? null}
      can={can}
      initialTab={initialTab}
      autoOpenEdit={edit === "1"}
    />
  );
}
