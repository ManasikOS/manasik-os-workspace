import { notFound } from "next/navigation";

import { cookies } from "next/headers";

import { capabilitiesForReports } from "@/lib/access/reports-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  loadReportsFinanceSnapshot,
  loadReportsGroupsSnapshot,
  loadReportsOverviewSnapshot,
  loadReportsPilgrimsSnapshot,
  loadReportsSalesSnapshot,
  loadReportsSuppliersSnapshot,
} from "@/lib/data/reports-repository";
import { createClient } from "@/utils/supabase/server";

import ReportsWorkspace from "./components/reports-workspace";
import { ReportsProvider } from "./reports-store";
import { periodParamsFromSearchParams } from "./types";

/**
 * Reports — the agency's decision and export center. A Server Component so
 * every period/comparison window is resolved against a clock decided once
 * and serialised down, same reasoning as `app/(main)/finance/payments/page.tsx`.
 *
 * Reports is the only read-only module in the codebase: it never writes
 * operational data, only saved-report/schedule definitions (see
 * `app/(main)/reports/actions.ts`, added in a later phase). Every number
 * shown here is computed by the same derivation functions the owning module
 * already uses — see `docs/modules/reports-module-implementation-plan.md`.
 */
export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { role, name } = await getCurrentStaffRole();
  const can = capabilitiesForReports(role);
  if (!can.viewModule) notFound();

  const resolvedSearchParams = await searchParams;
  const params = new URLSearchParams(
    Object.entries(resolvedSearchParams).flatMap(([key, value]) =>
      value === undefined ? [] : Array.isArray(value) ? value.map((v) => [key, v] as [string, string]) : [[key, value] as [string, string]],
    ),
  );
  const filters = periodParamsFromSearchParams(params);
  const nowIso = new Date().toISOString();

  const supabase = createClient(await cookies());
  const [overview, sales, finance, groups, pilgrims, suppliers] = await Promise.all([
    can.viewOverview ? loadReportsOverviewSnapshot(supabase, filters, nowIso, can) : Promise.resolve(null),
    can.viewSales ? loadReportsSalesSnapshot(supabase, filters, nowIso) : Promise.resolve(null),
    can.viewFinance ? loadReportsFinanceSnapshot(supabase, filters, nowIso, can) : Promise.resolve(null),
    can.viewGroups ? loadReportsGroupsSnapshot(supabase, filters, can) : Promise.resolve(null),
    can.viewPilgrims ? loadReportsPilgrimsSnapshot(supabase, filters) : Promise.resolve(null),
    can.viewSuppliers ? loadReportsSuppliersSnapshot(supabase, filters, can) : Promise.resolve(null),
  ]);

  return (
    <ReportsProvider
      filters={filters}
      overview={overview}
      sales={sales}
      finance={finance}
      groups={groups}
      pilgrims={pilgrims}
      suppliers={suppliers}
      nowIso={nowIso}
      currentStaffName={name}
      role={role}
      can={can}
    >
      <ReportsWorkspace />
    </ReportsProvider>
  );
}
