/**
 * Row types for Loyalty & Repeat Umrah.
 *
 * Keep in sync with `supabase/migrations/20261020090000_loyalty.sql`.
 */

export type LoyaltyEntryType = "EARNED_BOOKING" | "MANUAL_ADJUSTMENT" | "REDEEMED";
export type LoyaltyRedemptionStatus = "PENDING" | "APPROVED" | "FULFILLED" | "CANCELLED";

export interface LoyaltyTierRow {
  id: string;
  name: string;
  min_points: number;
  benefits: string | null;
  sort_order: number;
  created_by_name: string;
  created_at: string;
}

export interface LoyaltyPointEntryRow {
  id: string;
  pilgrim_id: string;
  points: number;
  entry_type: LoyaltyEntryType;
  reason: string;
  reference_booking_id: string | null;
  created_by_name: string;
  created_at: string;
}

export interface LoyaltyRedemptionRow {
  id: string;
  pilgrim_id: string;
  reward_description: string;
  points_spent: number;
  status: LoyaltyRedemptionStatus;
  created_by_name: string;
  created_at: string;
  fulfilled_at: string | null;
}

/** Live-computed per pilgrim, never stored. */
export interface LoyaltyPilgrimSummary {
  pilgrimId: string;
  fullName: string;
  reference: string;
  groupCount: number;
  isRepeat: boolean;
  pointsBalance: number;
  tierName: string | null;
}

export interface LoyaltyRedemptionWithPilgrim extends LoyaltyRedemptionRow {
  pilgrimName: string;
}
