/**
 * Server-only reads for the Dashboard (`/dashboard`).
 *
 * Deliberately builds on the same fact-producing calls every other module's
 * page already makes rather than a fresh query surface:
 *  - `buildOperationsSnapshot()` (Operations) for today's tasks and the
 *    upcoming-departures readiness figures.
 *  - `loadLeadStore()` (Leads) for the pipeline funnel and attention items.
 *  - `loadFinanceReceivables()` / `loadFinancePayments()` /
 *    `loadRefundsPendingSummary()` (Finance) for collections.
 *
 * Each section is capability-gated the same way its owning module gates it —
 * a role with no Finance access gets `collections: null` rather than a
 * zeroed-out block, and Leads figures are simply omitted from the KPI row
 * for a role with no Leads access — so this file adds no new access rules,
 * it only assembles ones that already exist.
 */

import "server-only";

import { cookies } from "next/headers";

import { capabilitiesForFinance } from "@/lib/access/finance-access";
import { capabilitiesForLeads } from "@/lib/access/leads-access";
import { capabilitiesForOperations } from "@/lib/access/operations-access";
import { capabilitiesForReports } from "@/lib/access/reports-access";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import { buildOperationsSnapshot } from "@/lib/data/operations-repository";
import { computeOperationsKpis } from "@/lib/data/operations";
import { loadAssignedGroupIds, loadTasksForStaff, type StaffTaskWithGroup } from "@/lib/data/team-repository";
import { loadLeadDashboardFacts, type DashboardLeadFacts } from "@/lib/data/leads-repository";
import { getCopilotDailySummary, listAgencyOpenProposals } from "@/lib/data/departure-groups-agent";
import {
  loadFinancePayments,
  loadFinanceReceivables,
  loadRefundsPendingSummary,
} from "@/lib/data/finance-repository";
import { loadReportsFinanceSnapshot, loadReportsSalesSnapshot } from "@/lib/data/reports-repository";
import { buildRevenueTrend } from "@/lib/data/reports";
import { buildCollectionsSummary, buildReceivablesAging, buildPackageProfitability } from "@/lib/data/reports-finance";
import { buildLeadFunnel, buildLeadSourcePerformance, buildSalesTeamPerformance } from "@/lib/data/reports-sales";
import {
  dashboardPeriodLabel,
  formatKpiDelta,
  buildStatusLine,
  toReportPeriod,
  trendGranularityFor,
  type DashboardPeriod,
} from "@/lib/data/dashboard";
import { rankAttentionRows } from "@/lib/data/dashboard-attention";
import { buildSeatPacePoints } from "@/lib/data/dashboard-pace";
import { resolveComparison, resolvePeriod } from "@/lib/data/reports-period";
import { DEFAULT_REPORT_FILTERS, type ReportFilters } from "@/app/(main)/reports/types";
import type { OperationsFlightItem, OperationsGroupSummary } from "@/lib/types/operations";
import { createClient } from "@/utils/supabase/server";

import type {
  AdminKpi,
  ApprovalsSummary,
  AttentionRow,
  BusinessHealthData,
  DashboardData,
  LeadAttentionMetric,
  MyDayData,
  MyDayTask,
  PipelineData,
  UpcomingDepartureGroup,
} from "@/lib/types/dashboard";
import { bucketPipelineValue, type PipelineValueBucket } from "@/lib/inbox/pipeline-value";
import { ownerInboxMetricsFromRow } from "@/lib/inbox/owner-kpis";
import { resolveEntitlements } from "@/lib/billing/entitlements";
import { resolveInboxFeatureAvailability } from "@/lib/inbox/feature-availability";

async function db() {
  return createClient(await cookies());
}

export interface InboxOwnerIntelligence {
  metrics: Array<{ label: string; value: number; queueCode: string }>;
  pipeline: PipelineValueBucket[];
  languageBuckets: Array<{ languageCode: string; conversations: number }>;
}

export async function loadInboxOwnerIntelligence(role: StaffRole, agencyId: string | null): Promise<InboxOwnerIntelligence | null> {
  if (!agencyId || (role !== "ADMIN" && role !== "CEO")) return null;
  const client = await db();
  const availability = resolveInboxFeatureAvailability({ entitlements: await resolveEntitlements(client, agencyId), inboxQueuesV2: false });
  if (availability.ownerPanel === "NONE") return null;
  const [{ data: kpi }, { data: qualifiedMembership }, { data: settings }, { data: languageRows }] = await Promise.all([
    client.from("inbox_owner_kpis").select("*").eq("agency_id", agencyId).maybeSingle(),
    client.from("conversation_queue_membership").select("conversation_id").eq("agency_id", agencyId).eq("queue_code", "QUALIFIED"),
    client.from("agency_settings").select("default_currency").eq("agency_id", agencyId).maybeSingle(),
    client.from("inbox_language_kpis_daily").select("language_code, conversations").eq("agency_id", agencyId).gte("day", new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)),
  ]);
  const qualifiedIds = ((qualifiedMembership ?? []) as Array<{ conversation_id: string }>).map((row) => row.conversation_id);
  const { data: intelligence } = qualifiedIds.length > 0
    ? await client.from("conversation_intelligence").select("matched_offer").eq("agency_id", agencyId).in("conversation_id", qualifiedIds).not("matched_offer", "is", null)
    : { data: [] };
  const row = (kpi ?? {}) as Record<string, unknown>;
  const metrics = ownerInboxMetricsFromRow(row);
  const offers = ((intelligence ?? []) as Array<{ matched_offer: { currency?: string; totalPrice?: number; pricePerPerson?: number } | null }>).flatMap(({ matched_offer }) => {
    if (!matched_offer?.currency) return [];
    const amount = matched_offer.totalPrice ?? matched_offer.pricePerPerson;
    return amount === undefined ? [] : [{ currency: matched_offer.currency, amountCents: Math.round(amount * 100) }];
  });
  const languageBuckets = new Map<string, number>();
  for (const row of (languageRows ?? []) as Array<{ language_code: string; conversations: number | string }>) languageBuckets.set(row.language_code, (languageBuckets.get(row.language_code) ?? 0) + Number(row.conversations));
  return { metrics, pipeline: bucketPipelineValue(offers, (settings?.default_currency as string | undefined) ?? "LKR"), languageBuckets: [...languageBuckets].map(([languageCode, conversations]) => ({ languageCode, conversations })) };
}

const numberFormatter = new Intl.NumberFormat("en-US");

/** `5_200_000` → `LKR 5.2M`. Same shape as every other module's money KPI. */
function formatCurrencyLKR(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "LKR 0";
  if (value >= 1_000_000) {
    return `LKR ${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1_000) {
    return `LKR ${(value / 1_000).toFixed(0)}K`;
  }
  return `LKR ${numberFormatter.format(value)}`;
}

function formatExactLKR(value: number): string {
  return `LKR ${numberFormatter.format(Math.round(value))}`;
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" });
const dateYearFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

function timeAgo(iso: string, nowMs: number): string {
  const diffMs = nowMs - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function isWithinIso(iso: string, fromIso: string, toIso: string): boolean {
  const t = new Date(iso).getTime();
  return t >= new Date(fromIso).getTime() && t <= new Date(toIso).getTime();
}

/* ── KPIs ─────────────────────────────────────────────────────────────────── */

/** `previous` is `null` whenever the underlying data isn't a periodic figure (no delta to show). */
interface PeriodCount {
  current: number;
  previous: number;
}

function buildKpis(input: {
  groups: OperationsGroupSummary[];
  outstandingBalance: number;
  periodLabel: string;
  newInquiries: PeriodCount | null;
  collections: PeriodCount | null;
}): AdminKpi[] {
  const kpis: AdminKpi[] = [];
  const activeGroups = input.groups.filter((g) => g.groupStatus !== "COMPLETED" && g.groupStatus !== "CLOSED" && g.groupStatus !== "CANCELLED");

  if (input.newInquiries) {
    const trend = formatKpiDelta(input.newInquiries.current, input.newInquiries.previous, "previous period");
    kpis.push({
      id: "new-inquiries",
      title: "New Inquiries",
      value: String(input.newInquiries.current),
      supportingText: input.periodLabel,
      trend: trend?.trend,
      trendType: trend?.trendType,
      destination: "/leads",
    });
  }

  kpis.push({
    id: "active-pilgrims",
    title: "Active Pilgrims",
    value: String(activeGroups.reduce((sum, g) => sum + g.pilgrimCount, 0)),
    supportingText: `Across ${activeGroups.length} active group${activeGroups.length === 1 ? "" : "s"}`,
    destination: "/pilgrims",
  });

  const departingSoon = activeGroups.filter((g) => g.daysUntilDeparture >= 0 && g.daysUntilDeparture <= 30);
  kpis.push({
    id: "departing-30",
    title: "Departing in 30 Days",
    value: String(departingSoon.reduce((sum, g) => sum + g.pilgrimCount, 0)),
    supportingText: `Across ${departingSoon.length} departure group${departingSoon.length === 1 ? "" : "s"}`,
    destination: "/departure-groups",
  });

  if (input.collections) {
    const trend = formatKpiDelta(input.collections.current, input.collections.previous, "previous period");
    kpis.push({
      id: "collections-period",
      title: `Collections (${input.periodLabel})`,
      value: formatCurrencyLKR(input.collections.current),
      trend: trend?.trend,
      trendType: trend?.trendType,
      destination: "/finance?view=receivables&subview=payments",
    });
    kpis.push({
      id: "outstanding-balance",
      title: "Outstanding Balance",
      value: formatCurrencyLKR(input.outstandingBalance),
      // Point-in-time balance — no historical snapshot to diff against, so
      // no delta rather than a fabricated one (open question in
      // docs/modules/dashboard-module-implementation-plan.md §13.4).
      destination: "/finance?view=receivables&subview=balances",
    });
  }

  const readyCount = activeGroups.filter((g) => g.readinessStatus === "READY").length;
  kpis.push({
    id: "group-readiness",
    title: "Group Readiness",
    value: `${readyCount} Ready`,
    supportingText: "Next 30 days departures",
    destination: "/departure-groups",
  });

  return kpis;
}

/* ── My Day ───────────────────────────────────────────────────────────────── */

/**
 * A personal work queue, not the agency-wide task list the old
 * `todays-operation.tsx` rendered (§5.3) — sourced from
 * `loadTasksForStaff(staffId)`, which filters on real `owner_id`, not a
 * name match. `groupDaysById` enriches each row with the group's
 * `daysUntilDeparture` from the Operations snapshot already loaded for this
 * render, so overdue tasks can sort by "which departure this bites first"
 * rather than by raw due date alone.
 */
function buildMyDay(input: {
  tasks: StaffTaskWithGroup[];
  groupDaysById: Map<string, number>;
  nowMs: number;
  unassignedCount: number | null;
}): MyDayData {
  const endOfToday = new Date(input.nowMs);
  endOfToday.setHours(23, 59, 59, 999);

  const rows: MyDayTask[] = input.tasks.map((t) => {
    const dueMs = new Date(t.due_at).getTime();
    const overdue = dueMs < input.nowMs;
    const dueLabel = overdue
      ? `Overdue since ${dateFormatter.format(new Date(t.due_at))}`
      : dueMs <= endOfToday.getTime()
        ? `Due ${timeFormatter.format(new Date(t.due_at))}`
        : `Due ${dateFormatter.format(new Date(t.due_at))}`;

    return {
      id: t.id,
      title: t.title,
      groupId: t.departure_group_id,
      groupName: t.group_name,
      dueAt: t.due_at,
      dueLabel,
      daysUntilDeparture: input.groupDaysById.get(t.departure_group_id) ?? null,
    };
  });

  const overdue = rows
    .filter((r) => new Date(r.dueAt).getTime() < input.nowMs)
    .sort((a, b) => (a.daysUntilDeparture ?? Infinity) - (b.daysUntilDeparture ?? Infinity));
  const dueToday = rows
    .filter((r) => {
      const t = new Date(r.dueAt).getTime();
      return t >= input.nowMs && t <= endOfToday.getTime();
    })
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  const upcoming = rows
    .filter((r) => new Date(r.dueAt).getTime() > endOfToday.getTime())
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

  return { overdue, dueToday, upcoming, unassignedCount: input.unassignedCount };
}

/* ── Upcoming departures ──────────────────────────────────────────────────── */

function readinessStateFor(group: OperationsGroupSummary): UpcomingDepartureGroup["readinessState"] {
  if (group.groupStatus === "PLANNING" && group.daysUntilDeparture > 60) return "Selling";
  if (group.readinessStatus === "READY") return "Ready";
  if (group.readinessStatus === "BLOCKED") return "At Risk";
  return "Needs Attention";
}

function buildDepartureGroups(groups: OperationsGroupSummary[]): UpcomingDepartureGroup[] {
  return groups
    .filter((g) => g.groupStatus !== "COMPLETED" && g.groupStatus !== "CLOSED" && g.groupStatus !== "CANCELLED")
    .sort((a, b) => a.daysUntilDeparture - b.daysUntilDeparture)
    .slice(0, 3)
    .map((g) => {
      const documentsComplete = Math.max(g.pilgrimCount - g.documentsMissingCount, 0);
      const visasComplete = Math.max(g.pilgrimCount - g.visaPendingCount, 0);
      const paymentsComplete = Math.max(g.pilgrimCount - g.paymentsOverdueCount, 0);
      const departureLabel = g.departureDate ? dateFormatter.format(new Date(g.departureDate)) : "";
      const returnLabel = g.returnDate ? dateYearFormatter.format(new Date(g.returnDate)) : "";

      return {
        id: g.id,
        category: g.journeyType === "UMRAH" ? "Umrah" : "Hajj",
        name: g.groupName,
        code: g.groupCode,
        countdownDays: g.daysUntilDeparture,
        countdownLabel: g.salesStatus === "SELLING" && g.groupStatus === "PLANNING" ? "Selling" : `Departs in ${g.daysUntilDeparture} days`,
        routeAndDates: `${g.branch} · ${departureLabel}–${returnLabel}`,
        pilgrimCount: g.pilgrimCount,
        totalCapacity: g.capacity,
        guideName: g.primaryGuideName ?? "Unassigned",
        guideArabic: "مشرف المجموعة",
        readiness: {
          documents: { completed: documentsComplete, total: g.pilgrimCount },
          visas: { completed: visasComplete, total: g.pilgrimCount },
          payments: { completed: paymentsComplete, total: g.pilgrimCount },
          operationsStatus: g.blockers[0]?.message ?? "On track",
        },
        progressPercentage: g.readinessScore,
        readinessState: readinessStateFor(g),
        riskReason: g.blockers[0]?.message ?? "All core requirements on track",
        destination: `/departure-groups/${g.id}`,
      };
    });
}

/* ── Attention Rail ───────────────────────────────────────────────────────── */

function minDays(groups: { daysUntilDeparture: number }[]): number | null {
  return groups.length === 0 ? null : Math.min(...groups.map((g) => g.daysUntilDeparture));
}

/**
 * Candidate rows for the Attention Rail (§5.4) — every count here comes
 * straight from data already loaded for this render (the Operations
 * snapshot, the lead-attention items, the refunds summary). Nothing is
 * queried again. `rankAttentionRows()` (pure, in `dashboard-attention.ts`)
 * does the ordering; this function only builds the pool it ranks from.
 */
function buildAttentionCandidates(input: {
  activeGroups: OperationsGroupSummary[];
  flights: OperationsFlightItem[];
  supplierConfirmationsPending: number;
  minSupplierDays: number | null;
  leadItems: LeadAttentionMetric[];
  refundsPendingCount: number | null;
}): AttentionRow[] {
  const rows: AttentionRow[] = [];

  const withDocsMissing = input.activeGroups.filter((g) => g.documentsMissingCount > 0);
  const documentsMissing = withDocsMissing.reduce((sum, g) => sum + g.documentsMissingCount, 0);
  rows.push({
    id: "docs-missing",
    title: `Chase ${documentsMissing} missing document${documentsMissing === 1 ? "" : "s"}`,
    count: documentsMissing,
    severity: "warning",
    destination: "/documents",
    minDaysUntilDeparture: minDays(withDocsMissing),
  });

  const withVisaPending = input.activeGroups.filter((g) => g.visaPendingCount > 0);
  const visaPending = withVisaPending.reduce((sum, g) => sum + g.visaPendingCount, 0);
  rows.push({
    id: "visa-pending",
    title: `Submit ${visaPending} pending visa application${visaPending === 1 ? "" : "s"}`,
    count: visaPending,
    severity: "critical",
    destination: "/visa",
    minDaysUntilDeparture: minDays(withVisaPending),
  });

  const withPaymentsOverdue = input.activeGroups.filter((g) => g.paymentsOverdueCount > 0);
  const paymentsOverdue = withPaymentsOverdue.reduce((sum, g) => sum + g.paymentsOverdueCount, 0);
  rows.push({
    id: "payments-overdue",
    title: `Collect from ${paymentsOverdue} overdue pilgrim${paymentsOverdue === 1 ? "" : "s"}`,
    count: paymentsOverdue,
    severity: "warning",
    destination: "/finance?view=receivables&subview=balances",
    minDaysUntilDeparture: minDays(withPaymentsOverdue),
  });

  const overdueFlights = input.flights.filter((f) => f.riskState === "OVERDUE");
  rows.push({
    id: "flights-overdue",
    title: `Ticket ${overdueFlights.length} flight${overdueFlights.length === 1 ? "" : "s"} past deadline`,
    count: overdueFlights.length,
    severity: "critical",
    destination: "/operations",
    minDaysUntilDeparture: minDays(overdueFlights),
  });

  const mismatchFlights = input.flights.filter((f) => f.nameMismatchCount > 0);
  const nameMismatches = mismatchFlights.reduce((sum, f) => sum + f.nameMismatchCount, 0);
  rows.push({
    id: "name-mismatches",
    title: `Fix ${nameMismatches} passenger name mismatch${nameMismatches === 1 ? "" : "es"}`,
    count: nameMismatches,
    severity: "warning",
    destination: "/operations",
    minDaysUntilDeparture: minDays(mismatchFlights),
  });

  rows.push({
    id: "suppliers-pending",
    title: `Confirm ${input.supplierConfirmationsPending} supplier booking${input.supplierConfirmationsPending === 1 ? "" : "s"}`,
    count: input.supplierConfirmationsPending,
    severity: "warning",
    destination: "/operations",
    minDaysUntilDeparture: input.minSupplierDays,
  });

  const withRoomingIncomplete = input.activeGroups.filter((g) => g.pilgrimCount > 0 && g.roomingAssignedCount < g.pilgrimCount);
  const roomingIncomplete = withRoomingIncomplete.reduce((sum, g) => sum + (g.pilgrimCount - g.roomingAssignedCount), 0);
  rows.push({
    id: "rooming-incomplete",
    title: `Assign rooming for ${roomingIncomplete} pilgrim${roomingIncomplete === 1 ? "" : "s"}`,
    count: roomingIncomplete,
    severity: "info",
    destination: "/departure-groups",
    minDaysUntilDeparture: minDays(withRoomingIncomplete),
  });

  const unassignedLeads = input.leadItems.find((i) => i.id === "lat-unassigned");
  if (unassignedLeads) {
    rows.push({
      id: "leads-unassigned",
      title: `Assign ${unassignedLeads.count} unassigned inquir${unassignedLeads.count === 1 ? "y" : "ies"}`,
      count: unassignedLeads.count,
      severity: "critical",
      destination: unassignedLeads.destination,
      minDaysUntilDeparture: null,
    });
  }

  const staleLeads = input.leadItems.find((i) => i.id === "lat-not-contacted");
  if (staleLeads) {
    rows.push({
      id: "leads-not-contacted",
      title: `Call ${staleLeads.count} lead${staleLeads.count === 1 ? "" : "s"} not contacted in 24h`,
      count: staleLeads.count,
      severity: "warning",
      destination: staleLeads.destination,
      minDaysUntilDeparture: null,
    });
  }

  if (input.refundsPendingCount !== null) {
    rows.push({
      id: "refunds-pending",
      title: `Approve ${input.refundsPendingCount} pending refund${input.refundsPendingCount === 1 ? "" : "s"}`,
      count: input.refundsPendingCount,
      severity: "info",
      destination: "/finance?view=receivables&subview=adjustments",
      minDaysUntilDeparture: null,
    });
  }

  return rows;
}

/* ── Lead attention ───────────────────────────────────────────────────────── */

/**
 * Feeds two rows into the Attention Rail (§5.4). The funnel and top-source
 * insight this function used to compute as well were never rendered by any
 * component past Phase 0 — Pipeline (§5.9) now covers that ground properly,
 * on `buildLeadFunnel()` / `buildLeadSourcePerformance()` from Reports,
 * which carry real stage-to-stage conversion instead of a percentage
 * against "New" alone.
 */
function buildLeadAttention(leads: DashboardLeadFacts[], nowMs: number) {
  const working = leads.filter((l) => !["LOST", "POSTPONED", "DUPLICATE", "SPAM"].includes(l.stage));

  const unassigned = working.filter((l) => !l.assigned_to_id).length;
  const notContacted24h = working.filter(
    (l) => (l.stage === "NEW_LEAD" || l.stage === "CONTACTED") && (!l.last_contacted_at || nowMs - new Date(l.last_contacted_at).getTime() > 24 * 60 * 60 * 1000),
  ).length;

  const items: LeadAttentionMetric[] = [
    { id: "lat-unassigned", title: "New inquiries unassigned", count: unassigned, severity: "critical", destination: "/leads?status=unassigned" },
    { id: "lat-not-contacted", title: "Leads not contacted within 24 hours", count: notContacted24h, severity: "warning", destination: "/leads?status=overdue_contact" },
  ];

  return { items };
}

/* ── Main entry point ─────────────────────────────────────────────────────── */

export async function loadDashboardData(
  role: StaffRole,
  staffId: string | null,
  agencyId: string | null,
  period: DashboardPeriod = "THIS_QUARTER",
): Promise<DashboardData> {
  const supabase = await db();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const monthStart = new Date(nowMs);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  // Drives L1 KPI deltas and L3 trend charts (§6) — L2 panels stay pinned
  // to "this calendar month" / "live", never the selector.
  const resolvedPeriod = resolvePeriod(toReportPeriod(period), null, null, nowIso);
  const comparisonPeriod = resolveComparison(resolvedPeriod, "PREVIOUS_PERIOD");
  const periodLabel = dashboardPeriodLabel(period);
  // Business Health / Pipeline / Team Performance read the same six-filter
  // shape Reports itself resolves from `searchParams` — the dashboard just
  // has no branch/journey/package/group filters of its own to set.
  const reportFilters: ReportFilters = { ...DEFAULT_REPORT_FILTERS, period: toReportPeriod(period) };

  const financeCan = capabilitiesForFinance(role);
  const leadsCan = capabilitiesForLeads(role);
  const opsCan = capabilitiesForOperations(role);
  const reportsCan = capabilitiesForReports(role);

  // `staff_group_assignments` scoping, not a name match — see the comment on
  // `loadActiveStore()` in `lib/data/operations-repository.ts`.
  const assignedGroupIds =
    role === "GUIDE" && staffId ? await loadAssignedGroupIds(supabase, staffId) : [];

  const [snapshot, leadFacts, receivables, payments, refundsPending, myTasks, openProposals, copilotToday, financeReport, salesReport] =
    await Promise.all([
      buildOperationsSnapshot(supabase, role, assignedGroupIds),
      leadsCan.viewModule ? loadLeadDashboardFacts(supabase) : Promise.resolve(null),
      financeCan.viewLedger ? loadFinanceReceivables(supabase, financeCan) : Promise.resolve(null),
      financeCan.viewLedger ? loadFinancePayments(supabase) : Promise.resolve(null),
      financeCan.viewLedger ? loadRefundsPendingSummary(supabase) : Promise.resolve(null),
      staffId ? loadTasksForStaff(supabase, staffId) : Promise.resolve([]),
      opsCan.viewModule && agencyId ? listAgencyOpenProposals(agencyId, supabase) : Promise.resolve(null),
      opsCan.viewModule && agencyId ? getCopilotDailySummary(agencyId, supabase) : Promise.resolve(null),
      // Business Health (§5.8) — gated on `viewFinance` alone since every
      // figure it shows (revenue, bookings, collections, receivables,
      // margin) is finance-flavoured; `viewCostAndMargin` narrows the
      // margin tab specifically, below.
      reportsCan.viewFinance ? loadReportsFinanceSnapshot(supabase, reportFilters, nowIso, reportsCan) : Promise.resolve(null),
      // Pipeline (§5.9) and Team Performance (§5.10) share one fact set.
      reportsCan.viewSales ? loadReportsSalesSnapshot(supabase, reportFilters, nowIso) : Promise.resolve(null),
    ]);

  const leads = leadFacts ?? [];

  const outstandingBalance = receivables?.reduce((sum, r) => sum + r.outstanding_balance, 0) ?? 0;
  const collectedThisMonth =
    payments
      ?.filter((p) => p.status === "COMPLETED" && new Date(p.paid_at).getTime() >= monthStart.getTime())
      .reduce((sum, p) => sum + p.amount, 0) ?? 0;
  const overdueBalanceAmount = receivables?.filter((r) => r.next_due_at && new Date(r.next_due_at).getTime() < nowMs).reduce((sum, r) => sum + r.outstanding_balance, 0) ?? 0;

  const sumCompletedPayments = (fromIso: string, toIso: string): number =>
    payments
      ?.filter((p) => p.status === "COMPLETED" && new Date(p.paid_at).getTime() >= new Date(fromIso).getTime() && new Date(p.paid_at).getTime() <= new Date(toIso).getTime())
      .reduce((sum, p) => sum + p.amount, 0) ?? 0;

  const collectionsKpi: PeriodCount | null =
    financeCan.viewLedger && payments && comparisonPeriod
      ? {
          current: sumCompletedPayments(resolvedPeriod.fromIso, resolvedPeriod.toIso),
          previous: sumCompletedPayments(comparisonPeriod.fromIso, comparisonPeriod.toIso),
        }
      : null;

  const newInquiriesKpi: PeriodCount | null =
    leadsCan.viewModule && comparisonPeriod
      ? {
          current: leads.filter((l) => isWithinIso(l.created_at, resolvedPeriod.fromIso, resolvedPeriod.toIso)).length,
          previous: leads.filter((l) => isWithinIso(l.created_at, comparisonPeriod.fromIso, comparisonPeriod.toIso)).length,
        }
      : null;

  const collections = financeCan.viewLedger && receivables
    ? {
        thisMonth: formatCurrencyLKR(collectedThisMonth),
        due7Days: formatCurrencyLKR(
          receivables
            .filter((r) => r.next_due_at && new Date(r.next_due_at).getTime() <= nowMs + 7 * 24 * 60 * 60 * 1000 && new Date(r.next_due_at).getTime() >= nowMs)
            .reduce((sum, r) => sum + Math.min(r.outstanding_balance, r.next_milestone_amount ?? r.outstanding_balance), 0),
        ),
        overdue: formatCurrencyLKR(overdueBalanceAmount),
        pendingRefundsCount: refundsPending?.count ?? 0,
        records: receivables
          .filter((r) => r.outstanding_balance > 0)
          .sort((a, b) => (a.next_due_at ?? "9999").localeCompare(b.next_due_at ?? "9999"))
          .slice(0, 6)
          .map((r) => {
            const overdue = r.next_due_at ? new Date(r.next_due_at).getTime() < nowMs : false;
            return {
              id: r.booking_id,
              pilgrimName: r.primary_contact_name,
              groupName: r.group_name,
              amount: formatExactLKR(r.outstanding_balance),
              statusLabel: r.next_due_at ? (overdue ? "Overdue" : `Due ${dateFormatter.format(new Date(r.next_due_at))}`) : "No due date set",
              dueDate: r.next_due_at ? dateFormatter.format(new Date(r.next_due_at)) : "—",
              severity: (overdue ? "critical" : "warning") as "critical" | "warning",
              phone: r.primary_contact_phone,
            };
          }),
      }
    : null;

  const activity = snapshot.activity.slice(0, 8).map((a) => ({
    id: a.id,
    actor: a.isSystem ? "System" : a.actorName,
    action: a.message,
    target: a.groupName,
    timeAgo: timeAgo(a.createdAt, nowMs),
    avatarInitials: a.isSystem ? "SY" : initials(a.actorName),
    type: "operations" as const,
  }));

  // `computeOperationsKpis()` is Operations' own derivation — reused here
  // rather than re-defining "at risk" or "supplier confirmations pending" a
  // second time (the plan's core rule, §7 and §5.4).
  const opsKpis = computeOperationsKpis(snapshot);

  const activeGroupsForStatus = snapshot.groups.filter(
    (g) => g.groupStatus !== "COMPLETED" && g.groupStatus !== "CLOSED" && g.groupStatus !== "CANCELLED",
  );
  const overdueTaskCount = snapshot.tasks.filter(
    (t) => t.status !== "COMPLETE" && (t.status === "OVERDUE" || new Date(t.dueAt).getTime() < nowMs),
  ).length;
  const statusLine = buildStatusLine({
    groupsAtRiskCount: opsKpis.groupsAtRisk,
    groupsBlockedCount: activeGroupsForStatus.filter((g) => g.readinessStatus === "BLOCKED").length,
    overdueTaskCount,
    overdueBalanceLabel: financeCan.viewLedger ? formatCurrencyLKR(overdueBalanceAmount) : null,
    overdueBalanceAmount: financeCan.viewLedger ? overdueBalanceAmount : 0,
  });

  const leadAttention = leadsCan.viewModule ? buildLeadAttention(leads, nowMs) : { items: [] as LeadAttentionMetric[] };

  const groupDaysById = new Map(snapshot.groups.map((g) => [g.id, g.daysUntilDeparture]));
  const myDay = buildMyDay({
    tasks: myTasks,
    groupDaysById,
    nowMs,
    unassignedCount: role === "ADMIN" || role === "CEO" ? opsKpis.unassignedWork : null,
  });

  const pendingSupplierRows = snapshot.supplierRows.filter((r) => r.status === "NOT_REQUESTED" || r.status === "REQUESTED");
  const attentionRail = rankAttentionRows(
    buildAttentionCandidates({
      activeGroups: activeGroupsForStatus,
      flights: snapshot.flights,
      supplierConfirmationsPending: opsKpis.supplierConfirmationsPending,
      minSupplierDays: minDays(pendingSupplierRows),
      leadItems: leadAttention.items,
      refundsPendingCount: financeCan.viewLedger ? (refundsPending?.count ?? 0) : null,
    }),
  );

  const approvals: ApprovalsSummary | null = openProposals
    ? { totalCount: openProposals.length, top: openProposals.slice(0, 3) }
    : null;

  const businessHealth: BusinessHealthData | null = financeReport
    ? {
        revenueTrend: buildRevenueTrend(
          financeReport.bookings,
          financeReport.payments,
          resolvedPeriod.fromIso,
          resolvedPeriod.toIso,
          trendGranularityFor(period),
        ),
        fromIso: resolvedPeriod.fromIso,
        toIso: resolvedPeriod.toIso,
        collections: buildCollectionsSummary(financeReport.bookings, financeReport.payments, financeReport.groups),
        receivablesAging: buildReceivablesAging(financeReport.milestones, nowIso),
        margin: reportsCan.viewCostAndMargin ? buildPackageProfitability(financeReport.groups) : null,
      }
    : null;

  const pipeline: PipelineData | null = salesReport
    ? {
        funnel: buildLeadFunnel(salesReport.leads),
        topSources: buildLeadSourcePerformance(salesReport.leads).slice(0, 3),
      }
    : null;

  // Team Performance (§5.10) — ADMIN, CEO, MARKETING only, matching the
  // plan's role table; every other role already sees its own work in My Day.
  const teamPerformance =
    salesReport && (role === "ADMIN" || role === "CEO" || role === "MARKETING")
      ? buildSalesTeamPerformance(salesReport.leads).slice(0, 6)
      : null;

  // Seat Fill Pace (§5.6) — scoped by the same `activeGroupsForStatus` list
  // every other panel uses, so a GUIDE sees only their assigned groups here
  // too, with no extra gating needed.
  const seatPace = buildSeatPacePoints(activeGroupsForStatus);

  return {
    statusLine,
    kpis: buildKpis({
      groups: snapshot.groups,
      outstandingBalance,
      periodLabel,
      newInquiries: newInquiriesKpi,
      collections: collectionsKpi,
    }),
    myDay,
    departureGroups: buildDepartureGroups(snapshot.groups),
    attentionRail,
    approvals,
    copilotToday,
    businessHealth,
    pipeline,
    teamPerformance,
    seatPace,
    leadAttention,
    collections,
    recentActivities: activity,
  };
}
