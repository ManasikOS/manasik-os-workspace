/**
 * Server-only read/write access for Referrals.
 *
 * Backed by `referrers` / `referrals` / `reward_rules` / `reward_accruals`
 * added in `supabase/migrations/20261016090000_referrals.sql`. Referrer
 * metrics (referral count, conversions, total reward) are computed live
 * here from `referrals` / `reward_accruals` — never stored on the referrer
 * row, so they can't disagree with the records they count.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ReferralRow,
  ReferralStatus,
  ReferralWithReferrer,
  ReferrerRow,
  ReferrerType,
  ReferrerWithMetrics,
  RewardAccrualRow,
  RewardAccrualStatus,
  RewardAccrualWithContext,
  RewardRuleRow,
  RewardType,
} from "@/lib/types/referrals";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class ReferralPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update" | "delete",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Referrals: ${operation} on ${table} failed — ${detail}`);
    this.name = "ReferralPersistenceError";
  }
}

function randomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export async function listReferrersWithMetrics(client: Db): Promise<ReferrerWithMetrics[]> {
  const [referrersResult, referralsResult, accrualsResult] = await Promise.all([
    client.from("referrers").select("*").order("created_at", { ascending: false }),
    client.from("referrals").select("id, referrer_id, status"),
    client.from("reward_accruals").select("referral_id, amount, status"),
  ]);
  if (referrersResult.error) throw new ReferralPersistenceError("referrers", "select", referrersResult.error);
  if (referralsResult.error) throw new ReferralPersistenceError("referrals", "select", referralsResult.error);
  if (accrualsResult.error) throw new ReferralPersistenceError("reward_accruals", "select", accrualsResult.error);

  const referrals = (referralsResult.data ?? []) as Pick<ReferralRow, "id" | "referrer_id" | "status">[];
  const accruals = (accrualsResult.data ?? []) as Pick<RewardAccrualRow, "referral_id" | "amount" | "status">[];
  const referralToReferrer = new Map(referrals.map((r) => [r.id, r.referrer_id]));

  return ((referrersResult.data ?? []) as ReferrerRow[]).map((referrer) => {
    const ownReferrals = referrals.filter((r) => r.referrer_id === referrer.id);
    const convertedCount = ownReferrals.filter((r) => r.status === "CONVERTED").length;
    const totalRewardAmount = accruals
      .filter((a) => referralToReferrer.get(a.referral_id) === referrer.id && a.status !== "CANCELLED")
      .reduce((sum, a) => sum + a.amount, 0);

    return {
      ...referrer,
      metrics: { referralCount: ownReferrals.length, convertedCount, totalRewardAmount },
    };
  });
}

export async function listReferralsWithReferrer(client: Db): Promise<ReferralWithReferrer[]> {
  const [referralsResult, referrersResult] = await Promise.all([
    client.from("referrals").select("*").order("created_at", { ascending: false }),
    client.from("referrers").select("id, name, referral_code"),
  ]);
  if (referralsResult.error) throw new ReferralPersistenceError("referrals", "select", referralsResult.error);
  if (referrersResult.error) throw new ReferralPersistenceError("referrers", "select", referrersResult.error);

  const referrerById = new Map(
    ((referrersResult.data ?? []) as Pick<ReferrerRow, "id" | "name" | "referral_code">[]).map((r) => [r.id, r]),
  );

  return ((referralsResult.data ?? []) as ReferralRow[]).map((referral) => {
    const referrer = referrerById.get(referral.referrer_id);
    return {
      ...referral,
      referrerName: referrer?.name ?? "Unknown",
      referrerCode: referrer?.referral_code ?? "—",
    };
  });
}

export async function listRewardRules(client: Db): Promise<RewardRuleRow[]> {
  const { data, error } = await client.from("reward_rules").select("*").order("created_at", { ascending: false });
  if (error) throw new ReferralPersistenceError("reward_rules", "select", error);
  return (data ?? []) as RewardRuleRow[];
}

export async function listRewardAccrualsWithContext(client: Db): Promise<RewardAccrualWithContext[]> {
  const [accrualsResult, referralsResult, referrersResult, rulesResult] = await Promise.all([
    client.from("reward_accruals").select("*").order("created_at", { ascending: false }),
    client.from("referrals").select("id, referred_name, referrer_id"),
    client.from("referrers").select("id, name"),
    client.from("reward_rules").select("id, name"),
  ]);
  if (accrualsResult.error) throw new ReferralPersistenceError("reward_accruals", "select", accrualsResult.error);
  if (referralsResult.error) throw new ReferralPersistenceError("referrals", "select", referralsResult.error);
  if (referrersResult.error) throw new ReferralPersistenceError("referrers", "select", referrersResult.error);
  if (rulesResult.error) throw new ReferralPersistenceError("reward_rules", "select", rulesResult.error);

  const referralById = new Map(
    ((referralsResult.data ?? []) as Pick<ReferralRow, "id" | "referred_name" | "referrer_id">[]).map((r) => [
      r.id,
      r,
    ]),
  );
  const referrerById = new Map(
    ((referrersResult.data ?? []) as Pick<ReferrerRow, "id" | "name">[]).map((r) => [r.id, r.name]),
  );
  const ruleById = new Map(((rulesResult.data ?? []) as Pick<RewardRuleRow, "id" | "name">[]).map((r) => [r.id, r.name]));

  return ((accrualsResult.data ?? []) as RewardAccrualRow[]).map((accrual) => {
    const referral = referralById.get(accrual.referral_id);
    return {
      ...accrual,
      referredName: referral?.referred_name ?? "Unknown",
      referrerName: referral ? referrerById.get(referral.referrer_id) ?? "Unknown" : "Unknown",
      ruleName: ruleById.get(accrual.reward_rule_id) ?? "Unknown",
    };
  });
}

export interface CreateReferrerInput {
  name: string;
  referrerType: ReferrerType;
  subjectId: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  createdByName: string;
}

export async function createReferrer(client: Db, input: CreateReferrerInput): Promise<ReferrerRow> {
  let referralCode = randomCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await client
      .from("referrers")
      .insert({
        name: input.name,
        referrer_type: input.referrerType,
        subject_id: input.subjectId,
        contact_phone: input.contactPhone,
        contact_email: input.contactEmail,
        referral_code: referralCode,
        created_by_name: input.createdByName,
      })
      .select("*")
      .single();
    if (!error) return data as ReferrerRow;
    if (!error.message?.includes("referral_code")) throw new ReferralPersistenceError("referrers", "insert", error);
    referralCode = randomCode();
  }
  throw new ReferralPersistenceError("referrers", "insert", new Error("could not generate a unique referral code"));
}

export interface CreateReferralInput {
  referrerId: string;
  referredName: string;
  referredContact: string | null;
  createdByName: string;
}

export async function createReferral(client: Db, input: CreateReferralInput): Promise<ReferralRow> {
  const { data, error } = await client
    .from("referrals")
    .insert({
      referrer_id: input.referrerId,
      referred_name: input.referredName,
      referred_contact: input.referredContact,
      created_by_name: input.createdByName,
    })
    .select("*")
    .single();
  if (error) throw new ReferralPersistenceError("referrals", "insert", error);
  return data as ReferralRow;
}

export async function updateReferralStatus(client: Db, referralId: string, status: ReferralStatus): Promise<void> {
  const { error } = await client
    .from("referrals")
    .update({ status, converted_at: status === "CONVERTED" ? new Date().toISOString() : null })
    .eq("id", referralId);
  if (error) throw new ReferralPersistenceError("referrals", "update", error);
}

export interface CreateRewardRuleInput {
  name: string;
  rewardType: RewardType;
  amount: number | null;
  percentage: number | null;
  createdByName: string;
}

export async function createRewardRule(client: Db, input: CreateRewardRuleInput): Promise<RewardRuleRow> {
  const { data, error } = await client
    .from("reward_rules")
    .insert({
      name: input.name,
      reward_type: input.rewardType,
      amount: input.amount,
      percentage: input.percentage,
      created_by_name: input.createdByName,
    })
    .select("*")
    .single();
  if (error) throw new ReferralPersistenceError("reward_rules", "insert", error);
  return data as RewardRuleRow;
}

export interface GrantRewardInput {
  referralId: string;
  rewardRuleId: string;
  amount: number;
  createdByName: string;
}

export async function grantRewardAccrual(client: Db, input: GrantRewardInput): Promise<RewardAccrualRow> {
  const { data, error } = await client
    .from("reward_accruals")
    .insert({
      referral_id: input.referralId,
      reward_rule_id: input.rewardRuleId,
      amount: input.amount,
      created_by_name: input.createdByName,
    })
    .select("*")
    .single();
  if (error) throw new ReferralPersistenceError("reward_accruals", "insert", error);
  return data as RewardAccrualRow;
}

export async function updateRewardAccrualStatus(
  client: Db,
  accrualId: string,
  status: RewardAccrualStatus,
  actorName: string,
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === "APPROVED") {
    patch.approved_by_name = actorName;
    patch.approved_at = new Date().toISOString();
  }
  if (status === "PAID") patch.paid_at = new Date().toISOString();

  const { error } = await client.from("reward_accruals").update(patch).eq("id", accrualId);
  if (error) throw new ReferralPersistenceError("reward_accruals", "update", error);
}
