"use client";

import PageHeader from "@/components/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/animate-ui/components/animate/tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, MoreVertical, Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import React, { useMemo, useState } from "react";

import { REPORT_TAB_IDS, type ReportTabId } from "@/lib/access/reports-access";

import { useReports } from "../reports-store";
import { ReportFilterBar } from "./report-filter-bar";
import OverviewTab from "./tabs/overview-tab";
import SalesTab from "./tabs/sales-tab";
import FinanceTab from "./tabs/finance-tab";
import GroupsTab from "./tabs/groups-tab";
import PilgrimsTab from "./tabs/pilgrims-tab";
import SuppliersTab from "./tabs/suppliers-tab";
import SavedTab from "./tabs/saved-tab";

const TAB_LABELS: Record<ReportTabId, string> = {
  overview: "Overview",
  sales: "Sales & Leads",
  finance: "Finance",
  groups: "Departure Groups",
  pilgrims: "Pilgrims & Compliance",
  suppliers: "Suppliers & Operations",
  saved: "Saved Reports",
};

export default function ReportsWorkspace() {
  const { can, filters } = useReports();
  const searchParams = useSearchParams();

  const visibleTabs = useMemo(() => REPORT_TAB_IDS.filter((id) => tabIsVisible(id, can)), [can]);

  // Tab is client-only state, seeded once from the URL for deep-linking.
  // Switching tabs must never re-run the Server Component — every tab's
  // snapshot is already loaded once by `page.tsx`, so a `router.replace()`
  // here would silently re-fetch all six snapshots on every click. The URL
  // is still kept in sync (via `history.replaceState`, not the router) so a
  // deep link / refresh / share still lands on the right tab.
  const [tab, setTabState] = useState<ReportTabId>(() => {
    const fromUrl = searchParams.get("tab") as ReportTabId | null;
    if (fromUrl && visibleTabs.includes(fromUrl)) return fromUrl;
    return visibleTabs[0] ?? "overview";
  });

  const setTab = (next: ReportTabId) => {
    setTabState(next);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      params.set("tab", next);
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const renderTab = () => {
    switch (tab) {
      case "overview":
        return <OverviewTab />;
      case "sales":
        return <SalesTab />;
      case "finance":
        return <FinanceTab />;
      case "groups":
        return <GroupsTab />;
      case "pilgrims":
        return <PilgrimsTab />;
      case "suppliers":
        return <SuppliersTab />;
      case "saved":
        return <SavedTab />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={[
          { title: "Home", link: "/dashboard" },
          { title: "Reports", link: "/reports" },
        ]}
        title="Reports"
        subTitle="Analyse sales, collections, group readiness, profitability, and operational performance."
        action={
          <div className="flex items-center gap-2">
            {can.createCustomReports && (
              <Button variant="secondary" disabled>
                <Plus /> Create Custom Report
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline_without_border"><MoreVertical /></Button>} />
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>More</DropdownMenuLabel>
                {can.scheduleReports && <DropdownMenuItem disabled>Schedule Report</DropdownMenuItem>}
                {(can.exportCsv || can.exportExcel || can.exportPdf) && (
                  <DropdownMenuItem disabled>
                    <Download /> Export Center
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <ReportFilterBar filters={filters} showBranch={can.viewAllBranches} />

      <div>
        <Tabs value={tab} onValueChange={(next) => setTab(next as ReportTabId)}>
          <TabsList className="flex-wrap h-auto">
            {visibleTabs.map((id) => (
              <TabsTrigger key={id} value={id}>
                {TAB_LABELS[id]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="min-h-100 mt-5">{renderTab()}</div>
      </div>
    </div>
  );
}

function tabIsVisible(id: ReportTabId, can: ReturnType<typeof useReports>["can"]): boolean {
  switch (id) {
    case "overview":
      return can.viewOverview;
    case "sales":
      return can.viewSales;
    case "finance":
      return can.viewFinance;
    case "groups":
      return can.viewGroups;
    case "pilgrims":
      return can.viewPilgrims;
    case "suppliers":
      return can.viewSuppliers;
    case "saved":
      return can.viewSaved;
    default:
      return false;
  }
}
