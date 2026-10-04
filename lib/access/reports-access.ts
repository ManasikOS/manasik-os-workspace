import type { StaffRole } from "@/lib/access/departure-groups-access";

/**
 * Role-based access for Reports.
 *
 * Same posture as `finance-access.ts`: pure functions over a role string,
 * usable from Server and Client Components. Capabilities decide what is
 * *fetched*, not merely what is rendered — `reports-repository.ts` nulls out
 * cost/margin fields for roles without `viewCostAndMargin` before a row ever
 * reaches a Client Component.
 *
 * Reports is the only read-only module in the codebase. There is no writer
 * capability here for report *data* — only for saved-report/schedule
 * definitions (see `app/(main)/reports/actions.ts`).
 */

export interface ReportsCapabilities {
  viewModule: boolean;

  viewOverview: boolean;
  viewSales: boolean;
  viewFinance: boolean;
  viewGroups: boolean;
  viewPilgrims: boolean;
  viewSuppliers: boolean;
  viewSaved: boolean;

  /** Supplier cost, package/group margin, profitability reports. */
  viewCostAndMargin: boolean;
  /** Branch-comparison slicing across the whole agency. */
  viewAllBranches: boolean;
  /** Guide: reports scoped to groups they are assigned to. */
  ownGroupsOnly: boolean;

  createCustomReports: boolean;
  saveReports: boolean;
  shareSavedReports: boolean;
  scheduleReports: boolean;

  exportCsv: boolean;
  exportExcel: boolean;
  exportPdf: boolean;
}

const NONE: ReportsCapabilities = {
  viewModule: false,
  viewOverview: false,
  viewSales: false,
  viewFinance: false,
  viewGroups: false,
  viewPilgrims: false,
  viewSuppliers: false,
  viewSaved: false,
  viewCostAndMargin: false,
  viewAllBranches: false,
  ownGroupsOnly: false,
  createCustomReports: false,
  saveReports: false,
  shareSavedReports: false,
  scheduleReports: false,
  exportCsv: false,
  exportExcel: false,
  exportPdf: false,
};

const CAPABILITIES: Record<StaffRole, ReportsCapabilities> = {
  ADMIN: {
    ...NONE,
    viewModule: true,
    viewOverview: true,
    viewSales: true,
    viewFinance: true,
    viewGroups: true,
    viewPilgrims: true,
    viewSuppliers: true,
    viewSaved: true,
    viewCostAndMargin: true,
    viewAllBranches: true,
    createCustomReports: true,
    saveReports: true,
    shareSavedReports: true,
    scheduleReports: true,
    exportCsv: true,
    exportExcel: true,
    exportPdf: true,
  },
  CEO: {
    ...NONE,
    viewModule: true,
    viewOverview: true,
    viewSales: true,
    viewFinance: true,
    viewGroups: true,
    viewPilgrims: true,
    viewSuppliers: true,
    viewSaved: true,
    viewCostAndMargin: true,
    viewAllBranches: true,
    saveReports: true,
    shareSavedReports: true,
    scheduleReports: true,
    exportCsv: true,
    exportExcel: true,
    exportPdf: true,
  },
  FINANCE: {
    ...NONE,
    viewModule: true,
    viewOverview: true,
    viewFinance: true,
    viewGroups: true,
    viewSaved: true,
    viewCostAndMargin: true,
    saveReports: true,
    exportCsv: true,
    exportExcel: true,
  },
  MARKETING: {
    ...NONE,
    viewModule: true,
    viewOverview: true,
    viewSales: true,
    viewSaved: true,
    saveReports: true,
    exportCsv: true,
  },
  OPERATIONS: {
    ...NONE,
    viewModule: true,
    viewOverview: true,
    viewGroups: true,
    viewSuppliers: true,
    viewPilgrims: true,
    viewSaved: true,
    saveReports: true,
    exportCsv: true,
    exportExcel: true,
  },
  VISA: {
    ...NONE,
    viewModule: true,
    viewPilgrims: true,
    viewSaved: true,
    exportCsv: true,
  },
  GUIDE: {
    ...NONE,
    viewModule: true,
    viewGroups: true,
    viewPilgrims: true,
    ownGroupsOnly: true,
    exportPdf: true,
  },
};

export function capabilitiesForReports(role: StaffRole): ReportsCapabilities {
  return CAPABILITIES[role];
}

export const REPORT_TAB_IDS = [
  "overview",
  "sales",
  "finance",
  "groups",
  "pilgrims",
  "suppliers",
  "saved",
] as const;

export type ReportTabId = (typeof REPORT_TAB_IDS)[number];

/** Hides whole tabs a role may not see at all. */
export function visibleReportTabs(role: StaffRole): ReportTabId[] {
  const can = capabilitiesForReports(role);
  const tabs: ReportTabId[] = [];

  if (can.viewOverview) tabs.push("overview");
  if (can.viewSales) tabs.push("sales");
  if (can.viewFinance) tabs.push("finance");
  if (can.viewGroups) tabs.push("groups");
  if (can.viewPilgrims) tabs.push("pilgrims");
  if (can.viewSuppliers) tabs.push("suppliers");
  if (can.viewSaved) tabs.push("saved");

  return tabs;
}
