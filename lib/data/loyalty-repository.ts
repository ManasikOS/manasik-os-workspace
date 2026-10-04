/**
 * Server-only read/write access for Loyalty & Repeat Umrah.
 *
 * Backed by `loyalty_tiers` / `loyalty_point_entries` / `loyalty_redemptions`
 * added in `supabase/migrations/20261020090000_loyalty.sql`. A pilgrim's
 * "repeat" status, points balance and tier are all computed live here —
 * repeat status from `departure_group_pilgrims`, balance from the
 * point-entry ledger, tier from matching that balance against
 * `loyalty_tiers` — never stored, so none of them can drift from what
 * actually happened.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  LoyaltyPilgrimSummary,
  LoyaltyPointEntryRow,
  LoyaltyRedemptionRow,
  LoyaltyRedemptionStatus,
  LoyaltyRedemptionWithPilgrim,
  LoyaltyTierRow,
} from "@/lib/types/loyalty";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class LoyaltyPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update" | "delete",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Loyalty: ${operation} on ${table} failed — ${detail}`);
    this.name = "LoyaltyPersistenceError";
  }
}

export async function listLoyaltyTiers(client: Db): Promise<LoyaltyTierRow[]> {
  const { data, error } = await client.from("loyalty_tiers").select("*").order("min_points", { ascending: true });
  if (error) throw new LoyaltyPersistenceError("loyalty_tiers", "select", error);
  return (data ?? []) as LoyaltyTierRow[];
}

function tierForBalance(tiers: LoyaltyTierRow[], balance: number): LoyaltyTierRow | null {
  const eligible = tiers.filter((t) => t.min_points <= balance).sort((a, b) => b.min_points - a.min_points);
  return eligible[0] ?? null;
}

/**
 * Every pilgrim with at least one departure-group booking, their repeat
 * status (2+ distinct groups), live points balance and current tier. Only
 * pilgrims with bookings are listed — loyalty only means something once
 * someone has actually travelled or is booked to.
 */
export async function listLoyaltyPilgrimSummaries(client: Db): Promise<LoyaltyPilgrimSummary[]> {
  const [membershipResult, entriesResult, tiers] = await Promise.all([
    client.from("departure_group_pilgrims").select("pilgrim_id, departure_group_id"),
    client.from("loyalty_point_entries").select("pilgrim_id, points"),
    listLoyaltyTiers(client),
  ]);
  if (membershipResult.error) throw new LoyaltyPersistenceError("departure_group_pilgrims", "select", membershipResult.error);
  if (entriesResult.error) throw new LoyaltyPersistenceError("loyalty_point_entries", "select", entriesResult.error);

  const groupsByPilgrim = new Map<string, Set<string>>();
  for (const row of (membershipResult.data ?? []) as { pilgrim_id: string | null; departure_group_id: string }[]) {
    if (!row.pilgrim_id) continue;
    const set = groupsByPilgrim.get(row.pilgrim_id) ?? new Set<string>();
    set.add(row.departure_group_id);
    groupsByPilgrim.set(row.pilgrim_id, set);
  }
  if (groupsByPilgrim.size === 0) return [];

  const balanceByPilgrim = new Map<string, number>();
  for (const row of (entriesResult.data ?? []) as { pilgrim_id: string; points: number }[]) {
    balanceByPilgrim.set(row.pilgrim_id, (balanceByPilgrim.get(row.pilgrim_id) ?? 0) + row.points);
  }

  const pilgrimIds = [...groupsByPilgrim.keys()];
  const { data: pilgrims, error: pilgrimError } = await client
    .from("pilgrims")
    .select("id, full_name, reference")
    .in("id", pilgrimIds);
  if (pilgrimError) throw new LoyaltyPersistenceError("pilgrims", "select", pilgrimError);

  return ((pilgrims ?? []) as { id: string; full_name: string; reference: string }[])
    .map((p) => {
      const groupCount = groupsByPilgrim.get(p.id)?.size ?? 0;
      const pointsBalance = balanceByPilgrim.get(p.id) ?? 0;
      return {
        pilgrimId: p.id,
        fullName: p.full_name,
        reference: p.reference,
        groupCount,
        isRepeat: groupCount > 1,
        pointsBalance,
        tierName: tierForBalance(tiers, pointsBalance)?.name ?? null,
      };
    })
    .sort((a, b) => b.pointsBalance - a.pointsBalance);
}

export async function listPointEntries(client: Db, pilgrimId: string): Promise<LoyaltyPointEntryRow[]> {
  const { data, error } = await client
    .from("loyalty_point_entries")
    .select("*")
    .eq("pilgrim_id", pilgrimId)
    .order("created_at", { ascending: false });
  if (error) throw new LoyaltyPersistenceError("loyalty_point_entries", "select", error);
  return (data ?? []) as LoyaltyPointEntryRow[];
}

export async function listRedemptionsWithPilgrim(client: Db): Promise<LoyaltyRedemptionWithPilgrim[]> {
  const { data, error } = await client
    .from("loyalty_redemptions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new LoyaltyPersistenceError("loyalty_redemptions", "select", error);
  const redemptions = (data ?? []) as LoyaltyRedemptionRow[];
  if (redemptions.length === 0) return [];

  const pilgrimIds = [...new Set(redemptions.map((r) => r.pilgrim_id))];
  const { data: pilgrims, error: pilgrimError } = await client
    .from("pilgrims")
    .select("id, full_name")
    .in("id", pilgrimIds);
  if (pilgrimError) throw new LoyaltyPersistenceError("pilgrims", "select", pilgrimError);
  const nameById = new Map(((pilgrims ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));

  return redemptions.map((r) => ({ ...r, pilgrimName: nameById.get(r.pilgrim_id) ?? "Unknown" }));
}

export interface CreateTierInput {
  name: string;
  minPoints: number;
  benefits: string | null;
  sortOrder: number;
  createdByName: string;
}

export async function createLoyaltyTier(client: Db, input: CreateTierInput): Promise<LoyaltyTierRow> {
  const { data, error } = await client
    .from("loyalty_tiers")
    .insert({
      name: input.name,
      min_points: input.minPoints,
      benefits: input.benefits,
      sort_order: input.sortOrder,
      created_by_name: input.createdByName,
    })
    .select("*")
    .single();
  if (error) throw new LoyaltyPersistenceError("loyalty_tiers", "insert", error);
  return data as LoyaltyTierRow;
}

export interface AddPointEntryInput {
  pilgrimId: string;
  points: number;
  entryType: LoyaltyPointEntryRow["entry_type"];
  reason: string;
  referenceBookingId: string | null;
  createdByName: string;
}

export async function addPointEntry(client: Db, input: AddPointEntryInput): Promise<LoyaltyPointEntryRow> {
  const { data, error } = await client
    .from("loyalty_point_entries")
    .insert({
      pilgrim_id: input.pilgrimId,
      points: input.points,
      entry_type: input.entryType,
      reason: input.reason,
      reference_booking_id: input.referenceBookingId,
      created_by_name: input.createdByName,
    })
    .select("*")
    .single();
  if (error) throw new LoyaltyPersistenceError("loyalty_point_entries", "insert", error);
  return data as LoyaltyPointEntryRow;
}

export interface CreateRedemptionInput {
  pilgrimId: string;
  rewardDescription: string;
  pointsSpent: number;
  createdByName: string;
}

export async function createRedemption(client: Db, input: CreateRedemptionInput): Promise<LoyaltyRedemptionRow> {
  const { data, error } = await client
    .from("loyalty_redemptions")
    .insert({
      pilgrim_id: input.pilgrimId,
      reward_description: input.rewardDescription,
      points_spent: input.pointsSpent,
      created_by_name: input.createdByName,
    })
    .select("*")
    .single();
  if (error) throw new LoyaltyPersistenceError("loyalty_redemptions", "insert", error);
  return data as LoyaltyRedemptionRow;
}

/**
 * Fulfilling a redemption also writes the offsetting REDEEMED ledger entry —
 * the two-step design the migration describes, done together here so a
 * caller can't fulfill one without the ledger reflecting it.
 */
export async function updateRedemptionStatus(
  client: Db,
  redemptionId: string,
  status: LoyaltyRedemptionStatus,
  actorName: string,
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === "FULFILLED") patch.fulfilled_at = new Date().toISOString();

  const { data, error } = await client
    .from("loyalty_redemptions")
    .update(patch)
    .eq("id", redemptionId)
    .select("*")
    .single();
  if (error) throw new LoyaltyPersistenceError("loyalty_redemptions", "update", error);

  if (status === "FULFILLED") {
    const redemption = data as LoyaltyRedemptionRow;
    await addPointEntry(client, {
      pilgrimId: redemption.pilgrim_id,
      points: -redemption.points_spent,
      entryType: "REDEEMED",
      reason: `Redeemed: ${redemption.reward_description}`,
      referenceBookingId: null,
      createdByName: actorName,
    });
  }
}
