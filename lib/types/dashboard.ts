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
import type { DashboardPanelId } from "@/lib/data/dashboard-layout";

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
  /** The departure group the event happened on - every row is a door into it. */
  destination: string;
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

/** One group on the Visa queue block - group-level counts only, never a pilgrim. */
export interface VisaQueueGroupRow {
  groupId: string;
  groupName: string;
  groupCode: string;
  daysToDeparture: number;
  pilgrimCount: number;
  readyToSubmit: number;
  submitted: number;
  reworkRequired: number;
  rejected: number;
  issued: number;
  readinessPercent: number;
  riskBand: "GREEN" | "AMBER" | "RED";
  /** The single most urgent next step, worded as a verb ("Submit 8"). */
  action: string;
  blockers: string[];
}

/** Visa queue (spec section 3.2) - the visa module's own KPI and per-group derivations, trimmed to what the block shows. */
export interface VisaQueueData {
  counts: { readyToSubmit: number; submittedPending: number; visaIssues: number; issued: number };
  groups: VisaQueueGroupRow[];
  /** Groups needing action in total - `groups` is only the top few. */
  actionableGroupCount: number;
  totalApplications: number;
}

/** One group on the Document review block - group-level counts only, never a traveller. */
export interface DocumentReviewGroupRow {
  groupId: string;
  groupName: string;
  groupCode: string;
  daysToDeparture: number;
  pilgrimCount: number;
  readinessPercent: number;
  awaitingReview: number;
  expiringSoon: number;
  rejected: number;
  missingDocuments: number;
  /** The single most urgent next step, worded as a verb ("Review 4"). */
  action: string;
  blockers: string[];
}

/** Document review (spec section 3.2) - the Documents module's own derivations, trimmed to what the block shows. */
export interface DocumentReviewData {
  counts: { missingDocuments: number; awaitingReview: number; rejected: number; aiFlagged: number; expiringSoon: number };
  groups: DocumentReviewGroupRow[];
  /** Groups needing attention in total - `groups` is only the top few. */
  actionableGroupCount: number;
  totalDocuments: number;
}

/** One supplier on the Supplier payables block - business-level amounts only, no contact details. */
export interface SupplierPayableRow {
  supplierId: string;
  name: string;
  supplierType: string;
  currency: string;
  outstandingAmount: number;
  dueAt: string;
  /** Negative when overdue. */
  daysUntilDue: number;
  overdue: boolean;
  hasIssue: boolean;
}

/** Supplier payables (spec section 3.2) - the suppliers module's own KPI derivation, trimmed to what the block shows. */
export interface SupplierPayablesData {
  /** Per currency - nothing is converted. */
  paymentsDueByCurrency: Record<string, number>;
  confirmationsPending: number;
  supplierIssues: number;
  /** Suppliers with a payment due in total - `suppliers` is only the soonest few. */
  dueSupplierCount: number;
  suppliers: SupplierPayableRow[];
  totalSuppliers: number;
}

/** A sent quote about to lapse - a reference and a date, no customer or price. */
export interface QuoteExpiringRow {
  quoteId: string;
  reference: string;
  validUntil: string;
  daysLeft: number;
}

/** Quotes pending (spec section 3.2) - the Quotes page's own pipeline definitions, counted. */
export interface QuotePipelineData {
  counts: { drafts: number; awaitingApproval: number; awaitingReply: number; expiringSoon: number; accepted: number };
  /** Drafts, pending approval, sent and viewed - `OPEN_QUOTE_STATUSES`. */
  open: number;
  total: number;
  /** Accepted over every quote, as the Quotes page shows it; `null` with no quotes. */
  acceptRatePercent: number | null;
  /** The soonest-lapsing few - `counts.expiringSoon` is the full number. */
  expiring: QuoteExpiringRow[];
}

/** One active campaign on the Campaign pulse block - progress against its own targets, no spend or revenue. */
export interface CampaignPulseRow {
  campaignId: string;
  name: string;
  channel: string;
  /** Negative when the end date has passed; `null` when the campaign has none. */
  daysToEnd: number | null;
  /** Still ACTIVE after its end date - one to close or extend. */
  pastEnd: boolean;
  leads: number;
  targetLeads: number | null;
  qualifiedLeads: number;
  bookings: number;
  targetBookings: number | null;
  /** Live seats left on the linked departure; `null` when the campaign has none linked. */
  seatsLeft: number | null;
  linkedGroupName: string | null;
}

/** Campaign pulse (spec section 3.2) - the Campaigns module's own per-campaign metrics, trimmed. */
export interface CampaignPulseData {
  counts: { active: number; scheduled: number; paused: number };
  /** The ending-soonest active campaigns - `counts.active` is the full number. */
  campaigns: CampaignPulseRow[];
  total: number;
}

export interface DashboardData {
  statusLine: StatusLine;
  /**
   * Blocks whose own data could not be read this render. The page shows a
   * muted error card in their place instead of an empty block that would
   * read as "nothing to do" (`null` data alone cannot tell "not allowed"
   * from "failed"). Only blocks the role actually renders appear here.
   */
  blockErrors: Partial<Record<DashboardPanelId, true>>;
  kpis: AdminKpi[];
  myDay: MyDayData;
  departureGroups: UpcomingDepartureGroup[];
  attentionRail: AttentionRow[];
  approvals: ApprovalsSummary | null;
  copilotToday: CopilotDailySummary | null;
  businessHealth: BusinessHealthData | null;
  pipeline: PipelineData | null;
  /** `null` for a role without the Visa queue block (or without Visa access). */
  visaQueue: VisaQueueData | null;
  /** `null` for a role without the Document review block (or without Documents access). */
  documentReview: DocumentReviewData | null;
  /** `null` for a role that may not see supplier payments. */
  supplierPayables: SupplierPayablesData | null;
  /** `null` for a role without the Quotes module. */
  quotePipeline: QuotePipelineData | null;
  /** `null` for a role without the Campaign pulse block (or without the Marketing module). */
  campaignPulse: CampaignPulseData | null;
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
