import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForSuppliers, visibleTabsForSupplier, type SupplierTabId } from "@/lib/access/suppliers-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { buildSupplierProfile } from "@/lib/data/suppliers";
import { loadDepartureGroupPickerOptions, loadSupplierProfile } from "@/lib/data/suppliers-repository";
import { createClient } from "@/utils/supabase/server";

import SupplierDetailView from "./components/supplier-detail";

export const dynamic = "force-dynamic";

export default async function SupplierProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ supplierId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ supplierId }, { tab }] = await Promise.all([params, searchParams]);
  const { role, name } = await getCurrentStaffRole();
  const can = capabilitiesForSuppliers(role);
  if (!can.viewModule) notFound();

  const supabase = createClient(await cookies());
  const [bundle, groups] = await Promise.all([
    loadSupplierProfile(supabase, supplierId, can),
    can.createCommitment ? loadDepartureGroupPickerOptions(supabase) : Promise.resolve([]),
  ]);
  if (!bundle) notFound();

  const nowIso = new Date().toISOString();
  const profile = buildSupplierProfile(bundle);
  const groupOptions = groups.map((g) => ({ id: g.id, groupName: g.group_name, groupCode: g.group_code }));

  const tabs: SupplierTabId[] = visibleTabsForSupplier(role);
  const initialTab = tabs.includes(tab as SupplierTabId) ? (tab as SupplierTabId) : "overview";

  return (
    <SupplierDetailView
      profile={profile}
      nowIso={nowIso}
      currentStaffName={name}
      role={role}
      can={can}
      groupOptions={groupOptions}
      visibleTabs={tabs}
      initialTab={initialTab}
    />
  );
}
