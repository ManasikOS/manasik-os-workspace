/**
 * Server-only reads for Reports. This is the only file that touches
 * Supabase for this module — same posture as `lib/data/finance-repository.ts`.
 *
 * Reports never writes operational data. Capabilities decide what is
 * *fetched*, not merely rendered: `stripGroupCostFields()` nulls supplier
 * cost / margin before a row reaches a Client Component for a role without
 * `viewCostAndMargin` (plan — mirrors Finance's `stripReceivable`).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ReportsCapabilities } from "@/lib/access/reports-access";
import type { ReportFilters } from "@/app/(main)/reports/types";
import { resolveComparison, resolvePeriod } from "@/lib/data/reports-period";
import type {
  ReportBookingFact,
  ReportGroupFact,
  ReportLeadFact,
  ReportMilestoneFact,
  ReportPaymentFact,
  ReportPilgrimComplianceFact,
  ReportSupplierFact,
  ReportTaskFact,
  ReportsFinanceSnapshot,
  ReportsGroupsSnapshot,
  ReportsOverviewSnapshot,
  ReportsPilgrimsSnapshot,
  ReportsSalesSnapshot,
  ReportsSuppliersSnapshot,
} from "@/lib/types/reports";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class ReportsPersistenceError extends Error {
  constructor(
    readonly view: string,
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Reports: select on ${view} failed — ${detail}`);
    this.name = "ReportsPersistenceError";
  }
}

function stripGroupCostFields(row: ReportGroupFact, can: ReportsCapabilities): ReportGroupFact {
  if (can.viewCostAndMargin) return row;
  return { ...row, supplier_cost_mixed_currency: 0 };
}

function stripSupplierAmounts(row: ReportSupplierFact, can: ReportsCapabilities): ReportSupplierFact {
  if (can.viewCostAndMargin) return row;
  return { ...row, amount: null, amount_paid: 0, outstanding_amount: 0 };
}

/* ── Overview tab ─────────────────────────────────────────────────────────── */

export async function loadReportsOverviewSnapshot(
  db: Db,
  filters: ReportFilters,
  nowIso: string,
  can: ReportsCapabilities,
): Promise<ReportsOverviewSnapshot> {
  const period = resolvePeriod(filters.period, filters.customFrom, filters.customTo, nowIso);
  const comparison = resolveComparison(period, filters.compare);

  const [bookingsCurrent, bookingsPrevious, paymentsCurrent, paymentsPrevious, groups] = await Promise.all([
    loadBookingFacts(db, filters, period.fromIso, period.toIso),
    comparison ? loadBookingFacts(db, filters, comparison.fromIso, comparison.toIso) : Promise.resolve([]),
    loadPaymentFacts(db, filters, period.fromIso, period.toIso),
    comparison ? loadPaymentFacts(db, filters, comparison.fromIso, comparison.toIso) : Promise.resolve([]),
    loadGroupFacts(db, filters),
  ]);

  return {
    bookingsCurrent,
    bookingsPrevious,
    paymentsCurrent,
    paymentsPrevious,
    groups: groups.map((g) => stripGroupCostFields(g, can)),
  };
}

/* ── Sales & Leads tab ────────────────────────────────────────────────────── */

export async function loadReportsSalesSnapshot(db: Db, filters: ReportFilters, nowIso: string): Promise<ReportsSalesSnapshot> {
  const period = resolvePeriod(filters.period, filters.customFrom, filters.customTo, nowIso);
  const leads = await loadLeadFacts(db, filters, period.fromIso, period.toIso);
  return { leads };
}

/* ── Finance tab ──────────────────────────────────────────────────────────── */

export async function loadReportsFinanceSnapshot(
  db: Db,
  filters: ReportFilters,
  nowIso: string,
  can: ReportsCapabilities,
): Promise<ReportsFinanceSnapshot> {
  const period = resolvePeriod(filters.period, filters.customFrom, filters.customTo, nowIso);

  const [bookings, payments, milestones, groups, refundsPending] = await Promise.all([
    loadBookingFacts(db, filters, period.fromIso, period.toIso),
    loadPaymentFacts(db, filters, period.fromIso, period.toIso),
    loadMilestoneFacts(db, filters),
    loadGroupFacts(db, filters),
    loadRefundsPendingSummary(db),
  ]);

  return {
    bookings,
    payments,
    milestones,
    groups: groups.map((g) => stripGroupCostFields(g, can)),
    refundsPending,
  };
}

async function loadRefundsPendingSummary(db: Db): Promise<{ count: number; amount: number }> {
  const { data, error } = await db
    .from("refund_requests")
    .select("amount")
    .in("status", ["PENDING_APPROVAL", "APPROVED"]);
  if (error) throw new ReportsPersistenceError("refund_requests", error);
  const rows = (data ?? []) as { amount: number }[];
  return { count: rows.length, amount: rows.reduce((total, r) => total + r.amount, 0) };
}

/* ── Departure Groups tab ────────────────────────────────────────────────── */

export async function loadReportsGroupsSnapshot(
  db: Db,
  filters: ReportFilters,
  can: ReportsCapabilities,
): Promise<ReportsGroupsSnapshot> {
  const groups = await loadGroupFacts(db, filters);
  return { groups: groups.map((g) => stripGroupCostFields(g, can)) };
}

/* ── Pilgrims & Compliance tab ────────────────────────────────────────────── */

export async function loadReportsPilgrimsSnapshot(db: Db, filters: ReportFilters): Promise<ReportsPilgrimsSnapshot> {
  const pilgrims = await loadPilgrimComplianceFacts(db, filters);
  return { pilgrims };
}

/* ── Suppliers & Operations tab ───────────────────────────────────────────── */

export async function loadReportsSuppliersSnapshot(
  db: Db,
  filters: ReportFilters,
  can: ReportsCapabilities,
): Promise<ReportsSuppliersSnapshot> {
  const [suppliers, tasks] = await Promise.all([loadSupplierFacts(db, filters), loadTaskFacts(db, filters)]);
  return { suppliers: suppliers.map((s) => stripSupplierAmounts(s, can)), tasks };
}

/* ── Fact loaders — one per view, each applying the subset of the six global
   filters the view's columns actually support ─────────────────────────────── */

async function loadBookingFacts(
  db: Db,
  filters: ReportFilters,
  fromIso: string,
  toIso: string,
): Promise<ReportBookingFact[]> {
  let query = db.from("report_booking_facts").select("*").gte("booked_at", fromIso).lte("booked_at", toIso);
  if (filters.branch) query = query.eq("branch", filters.branch);
  if (filters.journey) query = query.eq("journey_type", filters.journey);
  if (filters.packageId) query = query.eq("package_template_id", filters.packageId);
  if (filters.departureGroupId) query = query.eq("departure_group_id", filters.departureGroupId);
  const { data, error } = await query;
  if (error) throw new ReportsPersistenceError("report_booking_facts", error);
  return (data ?? []) as ReportBookingFact[];
}

async function loadPaymentFacts(
  db: Db,
  filters: ReportFilters,
  fromIso: string,
  toIso: string,
): Promise<ReportPaymentFact[]> {
  let query = db.from("report_payment_facts").select("*").gte("paid_at", fromIso).lte("paid_at", toIso);
  if (filters.branch) query = query.eq("branch", filters.branch);
  if (filters.journey) query = query.eq("journey_type", filters.journey);
  if (filters.packageId) query = query.eq("package_template_id", filters.packageId);
  if (filters.departureGroupId) query = query.eq("departure_group_id", filters.departureGroupId);
  const { data, error } = await query;
  if (error) throw new ReportsPersistenceError("report_payment_facts", error);
  return (data ?? []) as ReportPaymentFact[];
}

async function loadGroupFacts(db: Db, filters: ReportFilters): Promise<ReportGroupFact[]> {
  let query = db.from("report_group_facts").select("*");
  if (filters.branch) query = query.eq("branch", filters.branch);
  if (filters.journey) query = query.eq("journey_type", filters.journey);
  if (filters.departureGroupId) query = query.eq("departure_group_id", filters.departureGroupId);
  const { data, error } = await query;
  if (error) throw new ReportsPersistenceError("report_group_facts", error);
  return (data ?? []) as ReportGroupFact[];
}

async function loadLeadFacts(
  db: Db,
  filters: ReportFilters,
  fromIso: string,
  toIso: string,
): Promise<ReportLeadFact[]> {
  let query = db.from("report_lead_facts").select("*").gte("created_at", fromIso).lte("created_at", toIso);
  if (filters.journey) query = query.eq("journey_type", filters.journey);
  if (filters.branch) query = query.eq("booking_branch", filters.branch);
  if (filters.departureGroupId) query = query.eq("selected_departure_group_id", filters.departureGroupId);
  const { data, error } = await query;
  if (error) throw new ReportsPersistenceError("report_lead_facts", error);
  return (data ?? []) as ReportLeadFact[];
}

async function loadMilestoneFacts(db: Db, filters: ReportFilters): Promise<ReportMilestoneFact[]> {
  let query = db.from("report_milestone_facts").select("*");
  if (filters.branch) query = query.eq("branch", filters.branch);
  if (filters.departureGroupId) query = query.eq("departure_group_id", filters.departureGroupId);
  const { data, error } = await query;
  if (error) throw new ReportsPersistenceError("report_milestone_facts", error);
  return (data ?? []) as ReportMilestoneFact[];
}

async function loadPilgrimComplianceFacts(db: Db, filters: ReportFilters): Promise<ReportPilgrimComplianceFact[]> {
  let query = db.from("report_pilgrim_compliance_facts").select("*");
  if (filters.branch) query = query.eq("branch", filters.branch);
  if (filters.journey) query = query.eq("journey_type", filters.journey);
  if (filters.departureGroupId) query = query.eq("departure_group_id", filters.departureGroupId);
  const { data, error } = await query;
  if (error) throw new ReportsPersistenceError("report_pilgrim_compliance_facts", error);
  return (data ?? []) as ReportPilgrimComplianceFact[];
}

async function loadSupplierFacts(db: Db, filters: ReportFilters): Promise<ReportSupplierFact[]> {
  let query = db.from("report_supplier_facts").select("*");
  if (filters.branch) query = query.eq("branch", filters.branch);
  if (filters.departureGroupId) query = query.eq("departure_group_id", filters.departureGroupId);
  const { data, error } = await query;
  if (error) throw new ReportsPersistenceError("report_supplier_facts", error);
  return (data ?? []) as ReportSupplierFact[];
}

async function loadTaskFacts(db: Db, filters: ReportFilters): Promise<ReportTaskFact[]> {
  let query = db.from("report_task_facts").select("*");
  if (filters.branch) query = query.eq("branch", filters.branch);
  if (filters.departureGroupId) query = query.eq("departure_group_id", filters.departureGroupId);
  const { data, error } = await query;
  if (error) throw new ReportsPersistenceError("report_task_facts", error);
  return (data ?? []) as ReportTaskFact[];
}
