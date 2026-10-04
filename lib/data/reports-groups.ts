/**
 * Client-safe derivations for the Departure Groups report tab. Pure
 * functions over `ReportGroupFact[]` — no Supabase import.
 */

import { differenceInCalendarDays } from "date-fns";

import type { ReportGroupFact } from "@/lib/types/reports";

const CLOSED_STATUSES = new Set(["CANCELLED", "CLOSED"]);

/* ── Departure readiness ──────────────────────────────────────────────────── */

export interface ReadinessRow {
  departureGroupId: string;
  groupName: string;
  groupCode: string;
  readinessPercent: number;
  blockerCount: number;
  daysToDeparture: number;
  financeOwnerName: string | null;
  operationsOwnerName: string | null;
  readinessStatus: ReportGroupFact["readiness_status"];
}

/**
 * Overall readiness and blocker count only — a category-level breakdown
 * (Docs / Visa / Pay / Flight / Hotel / Transport / Guide, as the spec's
 * table shows) needs `departure_group_readiness_items` joined per category,
 * which `report_group_facts` does not carry yet. Flagged, not faked.
 */
export function buildReadinessRows(groups: ReportGroupFact[], nowIso: string): ReadinessRow[] {
  const now = new Date(nowIso);
  return groups
    .filter((g) => !CLOSED_STATUSES.has(g.group_status))
    .map((g) => ({
      departureGroupId: g.departure_group_id,
      groupName: g.group_name,
      groupCode: g.group_code,
      readinessPercent: g.readiness_score,
      blockerCount: g.blocker_count,
      daysToDeparture: differenceInCalendarDays(new Date(g.departure_date), now),
      financeOwnerName: g.finance_owner_name,
      operationsOwnerName: g.operations_owner_name,
      readinessStatus: g.readiness_status,
    }))
    .sort((a, b) => a.daysToDeparture - b.daysToDeparture);
}

/* ── Capacity & occupancy ─────────────────────────────────────────────────── */

export interface CapacityRow {
  departureGroupId: string;
  groupName: string;
  groupCode: string;
  capacity: number;
  bookedSeats: number;
  heldSeats: number;
  waitlistedCount: number;
  availableSeats: number;
  occupancyPercent: number;
}

export function buildCapacityRows(groups: ReportGroupFact[]): CapacityRow[] {
  return groups
    .filter((g) => !CLOSED_STATUSES.has(g.group_status))
    .map((g) => ({
      departureGroupId: g.departure_group_id,
      groupName: g.group_name,
      groupCode: g.group_code,
      capacity: g.capacity,
      bookedSeats: g.booked_seats,
      heldSeats: g.held_seats,
      waitlistedCount: g.waitlisted_count,
      availableSeats: g.available_seats,
      occupancyPercent: g.occupancy_percent,
    }))
    .sort((a, b) => b.occupancyPercent - a.occupancyPercent);
}

/* ── Group profitability ──────────────────────────────────────────────────── */

export interface GroupProfitabilityRow {
  departureGroupId: string;
  groupName: string;
  groupCode: string;
  expectedRevenue: number;
  collectedAmount: number;
  supplierCost: number;
  marginPercent: number | null;
}

export function buildGroupProfitabilityRows(groups: ReportGroupFact[]): GroupProfitabilityRow[] {
  return groups
    .filter((g) => !CLOSED_STATUSES.has(g.group_status))
    .map((g) => ({
      departureGroupId: g.departure_group_id,
      groupName: g.group_name,
      groupCode: g.group_code,
      expectedRevenue: g.expected_revenue,
      collectedAmount: g.collected_amount,
      supplierCost: g.supplier_cost_mixed_currency,
      marginPercent: g.expected_revenue > 0 ? ((g.expected_revenue - g.supplier_cost_mixed_currency) / g.expected_revenue) * 100 : null,
    }))
    .sort((a, b) => b.expectedRevenue - a.expectedRevenue);
}
