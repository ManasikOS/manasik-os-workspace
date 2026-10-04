/**
 * View models for the Dashboard (`/dashboard`, the app's landing route).
 *
 * Built by `lib/data/dashboard-repository.ts` from the same fact sources
 * every other module already reads — `buildOperationsSnapshot()`,
 * `loadLeadStore()`, `loadFinanceReceivables()` — rather than a separate
 * query surface. Components import only the shapes they render.
 */

import type { Tone } from "@/lib/ui/tone";
import type { AgencyOpenProposal, CopilotDailySummary } from "@/lib/data/departure-groups-agent";
import type { RevenueTrendPoint } from "@/lib/data/reports";
import type { AgingBucketRow, CollectionsSummary, PackageProfitabilityRow } from "@/lib/data/reports-finance";
import type { FunnelStageRow, LeadSourceRow, SalesOwnerRow } from "@/lib/data/reports-sales";
import type { SeatPacePoint } from "@/lib/data/dashboard-pace";

export interface StatusLine {
  tone: Tone;
  message: string;
}

export interface AdminKpi {
  id: string;
  title: string;
  value: string;
  trend?: string;
  trendType?: "positive" | "neutral" | "negative";
  supportingText?: string;
  destination: string;
}

/**
 * One row in "My Day" (§5.3) — a task this signed-in staff member owns
 * (`loadTasksForStaff()`), enriched with the group's `daysUntilDeparture`
 * from the already-loaded Operations snapshot. `null` when the task's group
 * could not be matched (should not happen in practice, but a task is never
 * dropped over it).
 */
export interface MyDayTask {
  id: string;
  title: string;
  groupId: string;
  groupName: string;
  dueAt: string;
  dueLabel: string;
  daysUntilDeparture: number | null;
}

export interface MyDayData {
  dueToday: MyDayTask[];
  overdue: MyDayTask[];
  upcoming: MyDayTask[];
  /** `null` for any role without the Unassigned tab (§5.3) — not "zero unassigned". */
  unassignedCount: number | null;
}

export interface DepartureGroupReadiness {
  documents: { completed: number; total: number };
  visas: { completed: number; total: number };
  payments: { completed: number; total: number };
  operationsStatus: string;
}

export interface UpcomingDepartureGroup {
  id: string;
  category: "Umrah" | "Hajj";
  name: string;
  code: string;
  countdownDays: number;
  countdownLabel: string;
  routeAndDates: string;
  pilgrimCount: number;
  totalCapacity: number;
  guideName: string;
  guideArabic: string;
  readiness: DepartureGroupReadiness;
  progressPercentage: number;
  readinessState: "Ready" | "Needs Attention" | "At Risk" | "Selling";
  riskReason: string;
  destination: string;
}

/**
 * One ranked row on the Attention Rail (§5.4) — the merger of the old
 * documents/visa exceptions, lead attention and operational-alerts panels
 * into one ordered list. `minDaysUntilDeparture` is the closest departure
 * this count is tied to — `null` for a row not tied to any one group (e.g.
 * refunds) — and is consumed only by the ranking function, never rendered.
 */
export interface AttentionRow {
  id: string;
  title: string;
  count: number;
  severity: "critical" | "warning" | "info";
  destination: string;
  minDaysUntilDeparture: number | null;
}

export interface LeadAttentionMetric {
  id: string;
  title: string;
  count: number;
  severity: "critical" | "warning" | "info" | "neutral";
  destination: string;
}

export interface CollectionRecord {
  id: string;
  pilgrimName: string;
  groupName: string;
  amount: string;
  statusLabel: string;
  dueDate: string;
  severity: "critical" | "warning" | "info";
  phone: string;
}

export interface RecentActivityItem {
  id: string;
  actor: string;
  action: string;
  target: string;
  timeAgo: string;
  avatarInitials: string;
  type: "document" | "payment" | "visa" | "lead" | "operations";
}

/** Top-risk-first slice of the agent's open queue (§5.7) — `null` for a role without Operations access. */
export interface ApprovalsSummary {
  totalCount: number;
  top: AgencyOpenProposal[];
}

/**
 * Business Health (§5.8) — every figure is a Reports derivation
 * (`buildRevenueTrend`, `buildCollectionsSummary`, `buildReceivablesAging`,
 * `buildPackageProfitability`), never re-computed here. `margin` is `null`
 * for a role without `viewCostAndMargin`, not a zeroed-out table.
 */
export interface BusinessHealthData {
  revenueTrend: RevenueTrendPoint[];
  fromIso: string;
  toIso: string;
  collections: CollectionsSummary;
  receivablesAging: AgingBucketRow[];
  margin: PackageProfitabilityRow[] | null;
}

/** Pipeline (§5.9) — `buildLeadFunnel()` / `buildLeadSourcePerformance()`, unchanged. */
export interface PipelineData {
  funnel: FunnelStageRow[];
  topSources: LeadSourceRow[];
}

export interface DashboardData {
  statusLine: StatusLine;
  kpis: AdminKpi[];
  myDay: MyDayData;
  departureGroups: UpcomingDepartureGroup[];
  attentionRail: AttentionRow[];
  approvals: ApprovalsSummary | null;
  copilotToday: CopilotDailySummary | null;
  businessHealth: BusinessHealthData | null;
  pipeline: PipelineData | null;
  teamPerformance: SalesOwnerRow[] | null;
  seatPace: SeatPacePoint[];
  leadAttention: {
    items: LeadAttentionMetric[];
  };
  collections: {
    thisMonth: string;
    due7Days: string;
    overdue: string;
    pendingRefundsCount: number;
    records: CollectionRecord[];
  } | null;
  recentActivities: RecentActivityItem[];
}
