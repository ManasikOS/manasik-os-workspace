/**
 * Cross-group read access for `/finance/departure-profitability`.
 *
 * The margin math already exists as the `departure_group_costing` database
 * view (list price, confirmed pax, estimated variable cost/pax, fixed
 * cost/departure, actual supplier cost booked so far, break-even headcount,
 * estimated gross margin) — built for the group's own Overview tab. This
 * file only reads it across every group instead of one at a time, and joins
 * it with each group's real booked/collected/outstanding revenue so margin
 * and cash position sit side by side. No new table.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DepartureGroupCostingRow } from "@/lib/types/departure-groups";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class ProfitabilityPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Profitability: ${operation} on ${table} failed — ${detail}`);
  }
}

export interface GroupProfitabilityRow {
  departureGroupId: string;
  groupName: string;
  groupCode: string;
  groupStatus: string;
  departureDate: string;
  currency: string;
  listPrice: number;
  confirmedPax: number;
  estimatedVariableCostPerPax: number;
  fixedCostPerDeparture: number;
  actualSupplierCost: number;
  /** Supplier commitments from the authoritative payables view. */
  committedSupplierCost: number;
  supplierPayableOutstanding: number;
  /** True only when the immutable package pricing source is present and usable. */
  hasPackagePricingSnapshot: boolean;
  /** True only when every cost-sheet input needed for the margin source is present. */
  hasCompleteCosting: boolean;
  breakEvenHeadcount: number | null;
  estimatedGrossMargin: number;
  bookedRevenue: number;
  collectedRevenue: number;
  outstandingRevenue: number;
}

/**
 * Every departure group's margin snapshot, soonest departure first.
 * Estimated costs and margin come from `departure_group_costing`; booked,
 * collected and outstanding revenue are summed live from that group's
 * bookings, so a payment recorded five minutes ago is already reflected.
 */
export async function listGroupProfitability(client: Db): Promise<GroupProfitabilityRow[]> {
  const [costingResult, groupResult, bookingResult, payableResult, costEstimateResult] = await Promise.all([
    client.from("departure_group_costing").select("*"),
    client
      .from("departure_groups")
      .select(
        "id, group_name, group_code, group_status, departure_date, departure_group_package_snapshots ( pricing_snapshot )",
      ),
    client
      .from("departure_group_bookings")
      .select("departure_group_id, total_booking_value, amount_paid, outstanding_balance, booking_status"),
    client
      .from("finance_supplier_payable_rows")
      .select("departure_group_id, amount, outstanding_amount, currency"),
    client
      .from("departure_group_cost_estimates")
      .select(
        "departure_group_id, flight_cost_per_pilgrim, accommodation_cost_per_pilgrim, transport_cost_per_pilgrim, visa_insurance_cost_per_pilgrim, catering_cost_per_pilgrim, guide_operations_cost_per_pilgrim, contingency_cost_per_pilgrim, fixed_cost_per_departure",
      ),
  ]);

  if (costingResult.error)
    throw new ProfitabilityPersistenceError("departure_group_costing", "select", costingResult.error);
  if (groupResult.error)
    throw new ProfitabilityPersistenceError("departure_groups", "select", groupResult.error);
  if (bookingResult.error)
    throw new ProfitabilityPersistenceError("departure_group_bookings", "select", bookingResult.error);
  if (payableResult.error)
    throw new ProfitabilityPersistenceError("finance_supplier_payable_rows", "select", payableResult.error);
  if (costEstimateResult.error)
    throw new ProfitabilityPersistenceError("departure_group_cost_estimates", "select", costEstimateResult.error);

  interface GroupRow {
    id: string;
    group_name: string;
    group_code: string;
    group_status: string;
    departure_date: string;
    departure_group_package_snapshots: { pricing_snapshot: Record<string, unknown> } | null;
  }
  interface BookingRow {
    departure_group_id: string;
    total_booking_value: number;
    amount_paid: number;
    outstanding_balance: number;
    booking_status: string;
  }
  interface CostEstimateRow {
    departure_group_id: string;
    flight_cost_per_pilgrim: number | null;
    accommodation_cost_per_pilgrim: number | null;
    transport_cost_per_pilgrim: number | null;
    visa_insurance_cost_per_pilgrim: number | null;
    catering_cost_per_pilgrim: number | null;
    guide_operations_cost_per_pilgrim: number | null;
    contingency_cost_per_pilgrim: number | null;
    fixed_cost_per_departure: number | null;
  }

  const costingByGroup = new Map(
    ((costingResult.data ?? []) as DepartureGroupCostingRow[]).map((row) => [row.departure_group_id, row]),
  );
  const completeCostingByGroup = new Map(
    ((costEstimateResult.data ?? []) as CostEstimateRow[]).map((row) => [
      row.departure_group_id,
      [
        row.flight_cost_per_pilgrim,
        row.accommodation_cost_per_pilgrim,
        row.transport_cost_per_pilgrim,
        row.visa_insurance_cost_per_pilgrim,
        row.catering_cost_per_pilgrim,
        row.guide_operations_cost_per_pilgrim,
        row.contingency_cost_per_pilgrim,
        row.fixed_cost_per_departure,
      ].every((value) => value !== null && Number.isFinite(Number(value))),
    ]),
  );

  const revenueByGroup = new Map<
    string,
    { booked: number; collected: number; outstanding: number }
  >();
  const supplierByGroup = new Map<string, { committed: number; outstanding: number; currency: string }>();
  for (const row of (payableResult.data ?? []) as { departure_group_id: string; amount: number | null; outstanding_amount: number; currency: string }[]) {
    const acc = supplierByGroup.get(row.departure_group_id) ?? { committed: 0, outstanding: 0, currency: row.currency };
    // A group contract is single-currency; keep a separate bucket if legacy
    // data violates that invariant rather than silently converting it.
    if (acc.currency === row.currency) {
      acc.committed += Number(row.amount ?? 0);
      acc.outstanding += Number(row.outstanding_amount ?? 0);
    }
    supplierByGroup.set(row.departure_group_id, acc);
  }
  for (const b of (bookingResult.data ?? []) as BookingRow[]) {
    if (b.booking_status === "CANCELLED") continue;
    const acc = revenueByGroup.get(b.departure_group_id) ?? { booked: 0, collected: 0, outstanding: 0 };
    acc.booked += Number(b.total_booking_value);
    acc.collected += Number(b.amount_paid);
    acc.outstanding += Number(b.outstanding_balance);
    revenueByGroup.set(b.departure_group_id, acc);
  }

  return ((groupResult.data ?? []) as unknown as GroupRow[])
    .map((g) => {
      const costing = costingByGroup.get(g.id);
      const revenue = revenueByGroup.get(g.id) ?? { booked: 0, collected: 0, outstanding: 0 };
      const supplier = supplierByGroup.get(g.id) ?? { committed: 0, outstanding: 0, currency: "" };
      const packagePricing = g.departure_group_package_snapshots?.pricing_snapshot;
      const packageCurrency = packagePricing?.currency;
      const hasPackagePricingSnapshot =
        typeof packageCurrency === "string" &&
        packageCurrency.trim().length > 0 &&
        Number.isFinite(Number(packagePricing?.quad_price));
      const currency = typeof packageCurrency === "string" && packageCurrency.trim().length > 0 ? packageCurrency : "LKR";

      return {
        departureGroupId: g.id,
        groupName: g.group_name,
        groupCode: g.group_code,
        groupStatus: g.group_status,
        departureDate: g.departure_date,
        currency,
        listPrice: costing?.list_price ?? 0,
        confirmedPax: costing?.confirmed_pax ?? 0,
        estimatedVariableCostPerPax: costing?.estimated_variable_cost_per_pax ?? 0,
        fixedCostPerDeparture: costing?.fixed_cost_per_departure ?? 0,
        actualSupplierCost: costing?.actual_supplier_cost ?? 0,
        committedSupplierCost: supplier.committed,
        supplierPayableOutstanding: supplier.outstanding,
        hasPackagePricingSnapshot,
        hasCompleteCosting: completeCostingByGroup.get(g.id) ?? false,
        breakEvenHeadcount: costing?.break_even_headcount ?? null,
        estimatedGrossMargin: costing?.estimated_gross_margin ?? 0,
        bookedRevenue: revenue.booked,
        collectedRevenue: revenue.collected,
        outstandingRevenue: revenue.outstanding,
      } satisfies GroupProfitabilityRow;
    })
    .sort((a, b) => a.departureDate.localeCompare(b.departureDate));
}
