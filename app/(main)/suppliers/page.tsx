import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForSuppliers } from "@/lib/access/suppliers-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { toSupplierListItems } from "@/lib/data/suppliers";
import { loadDepartureGroupPickerOptions, loadSupplierDirectory } from "@/lib/data/suppliers-repository";
import { createClient } from "@/utils/supabase/server";

import SuppliersList from "./components/suppliers-list";
import { SuppliersProvider } from "./suppliers-store";

/**
 * Supplier Directory list. A Server Component so every KPI / confirmation
 * health derivation is measured against a clock decided once and serialised
 * down — same reasoning as `app/(main)/pilgrims/page.tsx` and
 * `app/(main)/operations/page.tsx`.
 *
 * Reads `supplier_directory_rows`, the view aggregating each supplier's
 * commitments (see `supabase/migrations/20260817090000_supplier_directory.sql`).
 */
export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const { role, name } = await getCurrentStaffRole();
  const can = capabilitiesForSuppliers(role);
  if (!can.viewModule) notFound();

  const supabase = createClient(await cookies());
  const [rows, groups] = await Promise.all([
    loadSupplierDirectory(supabase, can),
    can.createCommitment ? loadDepartureGroupPickerOptions(supabase) : Promise.resolve([]),
  ]);
  const nowIso = new Date().toISOString();

  const suppliers = toSupplierListItems(rows);
  const groupOptions = groups.map((g) => ({ id: g.id, groupName: g.group_name, groupCode: g.group_code }));

  return (
    <SuppliersProvider
      suppliers={suppliers}
      groupOptions={groupOptions}
      nowIso={nowIso}
      currentStaffName={name}
      role={role}
      capabilities={can}
    >
      <SuppliersList />
    </SuppliersProvider>
  );
}
