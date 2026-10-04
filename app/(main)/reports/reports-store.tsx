"use client";

/**
 * Client-side context for the Reports workspace — mirrors
 * `app/(main)/finance/payments/finance-store.tsx`. One route, seven tabs,
 * all reading from the same server-loaded snapshot.
 *
 * Reports is read-only: there is no mutator surface on this context. The
 * only writes in the module are saved-report / schedule definitions, via
 * `app/(main)/reports/actions.ts`.
 */

import React, { createContext, useContext } from "react";

import type { StaffRole } from "@/lib/access/departure-groups-access";
import type { ReportsCapabilities } from "@/lib/access/reports-access";
import type {
  ReportsFinanceSnapshot,
  ReportsGroupsSnapshot,
  ReportsOverviewSnapshot,
  ReportsPilgrimsSnapshot,
  ReportsSalesSnapshot,
  ReportsSuppliersSnapshot,
} from "@/lib/types/reports";

import type { ReportFilters } from "./types";

interface ReportsContextValue {
  filters: ReportFilters;
  overview: ReportsOverviewSnapshot | null;
  sales: ReportsSalesSnapshot | null;
  finance: ReportsFinanceSnapshot | null;
  groups: ReportsGroupsSnapshot | null;
  pilgrims: ReportsPilgrimsSnapshot | null;
  suppliers: ReportsSuppliersSnapshot | null;
  nowIso: string;
  currentStaffName: string | null;
  role: StaffRole;
  can: ReportsCapabilities;
}

const ReportsContext = createContext<ReportsContextValue | null>(null);

export function ReportsProvider({
  children,
  ...value
}: ReportsContextValue & { children: React.ReactNode }) {
  return <ReportsContext.Provider value={value}>{children}</ReportsContext.Provider>;
}

export function useReports(): ReportsContextValue {
  const ctx = useContext(ReportsContext);
  if (!ctx) throw new Error("useReports must be used within ReportsProvider");
  return ctx;
}
