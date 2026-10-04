import { cookies } from "next/headers";
import { cache } from "react";

import { requireUser } from "@/lib/dal";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import {
  computeListStepGaps,
  listCompletenessPercent,
} from "@/lib/validations/packages";
import type { PackageListRow, PackageRow } from "@/lib/types/database";
import type { PackageActivityLog, PackageListItem } from "@/lib/types/packages";
import { createClient } from "@/utils/supabase/server";

/**
 * Server-side read access for the Packages catalogue.
 *
 * Requires `supabase/migrations/20260812090000_packages_module_v2.sql` to
 * have been applied — it depends on the generated `*_count`/`itinerary_days`
 * columns and the `package_usage` view that migration adds. Every query here
 * selects a narrow, explicit column list; nothing in this file ever selects
 * `itinerary`, `payment_milestones`, or any other JSONB body for a list of
 * packages (that is the whole point of the rewrite — see
 * docs/modules/packages-module-implementation-plan.md, finding F1).
 *
 * `listPackages` fetches the whole (role-scoped) catalogue in one query,
 * archived rows included — the same shape as `listDepartureGroups` in
 * `lib/data/departure-groups.ts`. Filtering, search, sort and pagination all
 * happen client-side in `packages-list.tsx` against that one array, so
 * changing a filter is a local re-render instead of a server round trip.
 * Only *what a role may see at all* (the Marketing visibility rule below)
 * stays a SQL predicate — that is an access-control boundary, not a UI
 * concern, so it cannot be enforced client-side.
 */

interface PackageListWithUsageRow extends PackageListRow {
  group_count: number;
  live_group_count: number;
  seats_booked: number;
  seats_capacity: number;
}

function toPackageListItem(row: PackageListWithUsageRow): PackageListItem {
  const missing = computeListStepGaps(row);

  return {
    id: row.id,
    code: row.internal_code || row.id.slice(0, 8).toUpperCase(),
    title: row.title || "Untitled package",
    journeyType: row.journey_type,
    category: row.category,
    packageCategory: row.package_category,
    branch: row.branch,
    status: row.status,
    visibility: row.visibility,
    featured: row.featured,
    durationDays: row.days,
    durationNights: row.nights,
    durationLabel: row.duration,
    itineraryDays: row.itinerary_days ?? 0,
    completeness: listCompletenessPercent(missing),
    missingSteps: missing,
    groupCount: row.group_count ?? 0,
    liveGroupCount: row.live_group_count ?? 0,
    seatsBooked: row.seats_booked ?? 0,
    seatsCapacity: row.seats_capacity ?? 0,
    archived: !!row.archived_at,
    updatedAt: row.updated_at,
    ownerId: row.owner_id,
  };
}

/**
 * Fetches the whole role-scoped catalogue — archived packages included,
 * usage counts joined in — as one RPC call.
 * `supabase/migrations/20261010090000_packages_list_with_usage_rpc.sql`
 * replaced the old list-query-plus-`.in(ids)`-usage-query pattern: that
 * second query put every package id from the first query into the request
 * URL, which silently failed (and was silently swallowed) once a catalogue
 * had a few hundred rows — see docs/modules/packages-production-readiness-plan.md,
 * finding F1. `packages-list.tsx` splits the result into the active and
 * archived lists and does every filter/search/sort/pagination operation
 * over this array in the browser.
 */
export const listPackages = cache(
  async (role: StaffRole, currentUserId: string | null): Promise<PackageListItem[]> => {
    await requireUser();
    const supabase = createClient(await cookies());

    const { data, error } = await supabase.rpc("list_packages_with_usage", {
      p_role: role,
      p_current_user_id: currentUserId,
    });
    if (error) throw new Error(`Could not load packages: ${error.message}`);

    const rows = (data ?? []) as unknown as PackageListWithUsageRow[];
    return rows.map(toPackageListItem);
  },
);

export interface PackageUsageSummary {
  groupCount: number;
  liveGroupCount: number;
  seatsBooked: number;
  seatsCapacity: number;
  /**
   * The cheapest quad-occupancy price across this package's LIVE departure
   * groups (`departure_group_pricing`), or null when none are priced yet.
   * Replaces reading `packages.quad_price`/`packages.currency` directly —
   * those columns have been deprecated and null for every package created
   * since pricing moved to the departure-group level (see
   * docs/architecture/package-departure-architecture-master-plan.md), so the detail
   * page's "Price from" tile was showing "—" for every real package
   * (finding B8/D1 in docs/modules/packages-production-readiness-plan.md). Mirrors
   * the same "cheapest live departure wins" rule `loadLeadPackages()` in
   * lib/data/leads-repository.ts already applies.
   */
  fromPrice: { amount: number; currency: string } | null;
}

export const getPackageUsage = cache(
  async (packageId: string): Promise<PackageUsageSummary> => {
    const supabase = createClient(await cookies());
    const [{ data }, { data: groupRows }] = await Promise.all([
      supabase
        .from("package_usage")
        .select("group_count, live_group_count, seats_booked, seats_capacity")
        .eq("package_id", packageId)
        .maybeSingle(),
      supabase
        .from("departure_groups")
        .select("departure_group_pricing(quad_price, currency)")
        .eq("package_template_id", packageId)
        .eq("archived", false)
        .not("group_status", "in", "(CANCELLED,COMPLETED,CLOSED)"),
    ]);

    let fromPrice: { amount: number; currency: string } | null = null;
    for (const row of (groupRows ?? []) as Record<string, unknown>[]) {
      const pricing = (
        Array.isArray(row.departure_group_pricing)
          ? row.departure_group_pricing[0]
          : row.departure_group_pricing
      ) as { quad_price: number | null; currency: string } | null | undefined;
      if (!pricing || pricing.quad_price === null) continue;
      if (fromPrice === null || pricing.quad_price < fromPrice.amount) {
        fromPrice = { amount: Number(pricing.quad_price), currency: pricing.currency };
      }
    }

    if (!data) return { groupCount: 0, liveGroupCount: 0, seatsBooked: 0, seatsCapacity: 0, fromPrice };
    return {
      groupCount: data.group_count,
      liveGroupCount: data.live_group_count,
      seatsBooked: data.seats_booked,
      seatsCapacity: data.seats_capacity,
      fromPrice,
    };
  },
);

export interface DepartureGroupUsingPackage {
  id: string;
  groupName: string;
  groupCode: string;
  departureDate: string;
  groupStatus: string;
  salesStatus: string;
  bookedSeats: number;
  capacity: number;
  archived: boolean;
  /** From `departure_group_payment_summaries.expected_revenue` — sum of `total_booking_value` across this group's bookings. Same definition Reports uses for package profitability. */
  expectedRevenue: number;
}

export const listDepartureGroupsForPackage = cache(
  async (packageId: string): Promise<DepartureGroupUsingPackage[]> => {
    const supabase = createClient(await cookies());
    const { data, error } = await supabase
      .from("departure_groups")
      .select(
        "id, group_name, group_code, departure_date, group_status, sales_status, booked_seats, capacity, archived",
      )
      .eq("package_template_id", packageId)
      .order("departure_date", { ascending: false });

    if (error || !data) return [];

    const rows = data as {
      id: string;
      group_name: string;
      group_code: string;
      departure_date: string;
      group_status: string;
      sales_status: string;
      booked_seats: number;
      capacity: number;
      archived: boolean;
    }[];

    // Revenue per group — same view Reports' package-profitability figure
    // reads (`buildPackageProfitability()` in lib/data/reports-finance.ts),
    // not a per-group price × seats estimate, so the two screens can never
    // disagree about what "revenue" means for the same group.
    const revenueByGroup = new Map<string, number>();
    if (rows.length > 0) {
      const { data: summaryRows } = await supabase
        .from("departure_group_payment_summaries")
        .select("departure_group_id, expected_revenue")
        .in("departure_group_id", rows.map((r) => r.id));
      for (const s of (summaryRows ?? []) as {
        departure_group_id: string;
        expected_revenue: number;
      }[]) {
        revenueByGroup.set(s.departure_group_id, s.expected_revenue);
      }
    }

    return rows.map((row) => ({
      id: row.id,
      groupName: row.group_name,
      groupCode: row.group_code,
      departureDate: row.departure_date,
      groupStatus: row.group_status,
      salesStatus: row.sales_status,
      bookedSeats: row.booked_seats,
      capacity: row.capacity,
      archived: row.archived,
      expectedRevenue: revenueByGroup.get(row.id) ?? 0,
    }));
  },
);

/**
 * Full row for the detail screen and the wizard. Previously nulled internal
 * finance figures for callers without the `viewInternalFinance` capability
 * — see the parameter's own comment for why that masking was removed.
 */
export const getPackageDetail = cache(
  async (
    packageId: string,
    /**
     * Unused for now — kept in the signature rather than removed. This
     * used to gate masking `finance_estimate`, which
     * `supabase/migrations/20261008090000_packages_drop_deprecated_columns.sql`
     * dropped entirely once confirmed nothing read it (finding B8), so
     * there is nothing left to mask. Whether a template-level internal
     * cost model comes back in some other form is open question Q3 in
     * docs/modules/packages-production-readiness-plan.md — if it does,
     * `viewInternalFinance` (the capability this flag carries) is almost
     * certainly the right gate for it, so the parameter — and the
     * capability itself — are left in place rather than deleted ahead of
     * that decision.
     */
    viewInternalFinance: boolean,
  ): Promise<PackageRow | null> => {
    void viewInternalFinance;
    await requireUser();

    const supabase = createClient(await cookies());
    const { data, error } = await supabase
      .from("packages")
      .select("*")
      .eq("id", packageId)
      .maybeSingle();

    if (error) {
      throw new Error(`Could not load package: ${error.message}`);
    }
    if (!data) return null;

    return data as PackageRow;
  },
);

/** Unchanged full-row read used by the wizard when opened directly by id. */
export const getPackage = cache(async (packageId: string): Promise<PackageRow | null> => {
  await requireUser();

  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("packages")
    .select("*")
    .eq("id", packageId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load package: ${error.message}`);
  }

  return (data as PackageRow | null) ?? null;
});

/**
 * Lifecycle transition history from `package_activity_logs` (written only by
 * the five lifecycle RPCs — see
 * supabase/migrations/20261006090000_packages_lifecycle_phase1.sql). Shown
 * as the detail page's Activity tab. Capped at 100 rows — a package changes
 * lifecycle state at most a handful of times a month, so unlike Departure
 * Groups' activity log (which logs every field edit and can run to
 * thousands of rows) this never needs "load more" pagination in practice.
 */
export const getPackageActivity = cache(
  async (packageId: string): Promise<PackageActivityLog[]> => {
    const supabase = createClient(await cookies());
    const { data, error } = await supabase
      .from("package_activity_logs")
      .select("id, actor_name_snapshot, action_type, before_status, after_status, reason, message, created_at")
      .eq("package_id", packageId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error || !data) return [];

    return (
      data as {
        id: string;
        actor_name_snapshot: string;
        action_type: PackageActivityLog["actionType"];
        before_status: PackageActivityLog["beforeStatus"];
        after_status: PackageActivityLog["afterStatus"];
        reason: string | null;
        message: string;
        created_at: string;
      }[]
    ).map((row) => ({
      id: row.id,
      actorName: row.actor_name_snapshot,
      actionType: row.action_type,
      beforeStatus: row.before_status,
      afterStatus: row.after_status,
      reason: row.reason,
      message: row.message,
      createdAt: row.created_at,
    }));
  },
);
