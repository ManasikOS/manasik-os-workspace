/**
 * Row types for Referrals.
 *
 * Keep in sync with `supabase/migrations/20261016090000_referrals.sql`.
 */

export type ReferrerType = "PILGRIM" | "LEAD" | "STAFF" | "EXTERNAL";
export type ReferralStatus = "INVITED" | "CONTACTED" | "CONVERTED" | "EXPIRED" | "REJECTED";
export type RewardType = "FIXED_CASH" | "PERCENTAGE_OF_BOOKING" | "DISCOUNT_VOUCHER";
export type RewardAccrualStatus = "PENDING" | "APPROVED" | "PAID" | "CANCELLED";

export interface ReferrerRow {
  id: string;
  name: string;
  referrer_type: ReferrerType;
  subject_id: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  referral_code: string;
  created_by_name: string;
  created_at: string;
}

export interface ReferralRow {
  id: string;
  referrer_id: string;
  referred_name: string;
  referred_contact: string | null;
  referred_lead_id: string | null;
  status: ReferralStatus;
  created_by_name: string;
  created_at: string;
  converted_at: string | null;
}

export interface RewardRuleRow {
  id: string;
  name: string;
  reward_type: RewardType;
  amount: number | null;
  percentage: number | null;
  is_active: boolean;
  created_by_name: string;
  created_at: string;
}

export interface RewardAccrualRow {
  id: string;
  referral_id: string;
  reward_rule_id: string;
  amount: number;
  status: RewardAccrualStatus;
  approved_by_name: string | null;
  approved_at: string | null;
  paid_at: string | null;
  created_by_name: string;
  created_at: string;
}

/** Live-computed per referrer, never stored. */
export interface ReferrerMetrics {
  referralCount: number;
  convertedCount: number;
  totalRewardAmount: number;
}

export interface ReferrerWithMetrics extends ReferrerRow {
  metrics: ReferrerMetrics;
}

export interface ReferralWithReferrer extends ReferralRow {
  referrerName: string;
  referrerCode: string;
}

export interface RewardAccrualWithContext extends RewardAccrualRow {
  referredName: string;
  referrerName: string;
  ruleName: string;
}
