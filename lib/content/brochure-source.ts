/**
 * Loads exactly the rows a departure-group brochure needs — the group, its
 * frozen package snapshot, and its live pricing — without going through
 * `getDepartureGroupDetail()`, which hydrates flights, hotels, rooming,
 * bookings, readiness and the activity trail for a full detail-page render.
 * A brochure needs none of that.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DepartureGroupPackageSnapshotRow, DepartureGroupPricingRow, DepartureGroupRow } from "@/lib/types/departure-groups";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface BrochureSourceRows {
  group: DepartureGroupRow;
  snapshot: DepartureGroupPackageSnapshotRow;
  pricing: DepartureGroupPricingRow;
}

export type BrochureSourceResult =
  | { ok: true; source: BrochureSourceRows }
  | { ok: false; error: string };

/** Agency ownership is checked against `departure_groups` itself — the source of truth — not merely trusted from the caller. */
export async function loadBrochureSource(client: Db, agencyId: string, departureGroupId: string): Promise<BrochureSourceResult> {
  const { data: group, error: groupError } = await client
    .from("departure_groups")
    .select("*")
    .eq("id", departureGroupId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (groupError) return { ok: false, error: "The departure group could not be read." };
  if (!group) return { ok: false, error: "That departure group could not be found." };

  const [{ data: snapshot, error: snapshotError }, { data: pricing, error: pricingError }] = await Promise.all([
    client.from("departure_group_package_snapshots").select("*").eq("departure_group_id", departureGroupId).maybeSingle(),
    client.from("departure_group_pricing").select("*").eq("departure_group_id", departureGroupId).maybeSingle(),
  ]);
  if (snapshotError || !snapshot) return { ok: false, error: "This group has no package snapshot to build a brochure from." };
  if (pricingError || !pricing) return { ok: false, error: "This group has no pricing to build a brochure from." };

  return {
    ok: true,
    source: {
      group: group as DepartureGroupRow,
      snapshot: snapshot as DepartureGroupPackageSnapshotRow,
      pricing: pricing as DepartureGroupPricingRow,
    },
  };
}
