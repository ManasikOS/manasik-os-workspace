/**
 * Role-based access for the Analytics module — Phase 0 (P0.3)
 * registration; real page lands in Phase 5 (P5.1) of
 * docs/modules/manasik-intelligence-build-roadmap.md. Placeholder capability set —
 * see `lib/access/module-defaults.ts`.
 */

import { buildPlaceholderCapabilities } from "@/lib/access/module-defaults";
import type { StaffRole } from "@/lib/access/departure-groups-access";

export interface AnalyticsCapabilities {
  viewModule: boolean;
  viewGrowth: boolean;
  viewSales: boolean;
  viewFinance: boolean;
  viewMargin: boolean;
  viewSupplier: boolean;
  viewServiceQuality: boolean;
  viewAllBranches: boolean;
  exportAnalytics: boolean;
}

const CAPABILITIES: Record<StaffRole, AnalyticsCapabilities> = buildPlaceholderCapabilities<AnalyticsCapabilities>([
  "viewModule",
  "viewGrowth",
  "viewSales",
  "viewFinance",
  "viewMargin",
  "viewSupplier",
  "viewServiceQuality",
  "viewAllBranches",
  "exportAnalytics",
]);

export function capabilitiesForAnalytics(role: StaffRole): AnalyticsCapabilities {
  return CAPABILITIES[role];
}
