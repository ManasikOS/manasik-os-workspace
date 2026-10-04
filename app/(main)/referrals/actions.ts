"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { capabilitiesForLeads } from "@/lib/access/leads-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import {
  createReferral,
  createReferrer,
  createRewardRule,
  grantRewardAccrual,
  updateReferralStatus,
  updateRewardAccrualStatus,
  type CreateReferralInput,
  type CreateReferrerInput,
  type CreateRewardRuleInput,
  type GrantRewardInput,
} from "@/lib/data/referrals-repository";
import type { ReferralStatus, RewardAccrualStatus } from "@/lib/types/referrals";
import { createClient } from "@/utils/supabase/server";

interface ActionResult {
  ok: boolean;
  error?: string;
}

async function db() {
  return createClient(await cookies());
}

/** Same posture as Campaigns/Audiences/Content — reuses Leads' manageSourcesAndAutomation. */
async function requireCanManage() {
  await requireUser();
  const { role, name } = await getCurrentStaffRole();
  return { ok: capabilitiesForLeads(role).manageSourcesAndAutomation, name };
}

/** Reward rules and payouts are money-adjacent — restricted further to ADMIN/CEO, matching the RLS policy on reward_rules/reward_accruals. */
async function requireCanManageRewards() {
  await requireUser();
  const { role, name } = await getCurrentStaffRole();
  return { ok: role === "ADMIN" || role === "CEO", name };
}

function revalidateReferrals() {
  revalidatePath("/referrals");
}

export async function createReferrerAction(
  input: Omit<CreateReferrerInput, "createdByName">,
): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot add referrers." };
  if (!input.name.trim()) return { ok: false, error: "Give the referrer a name." };

  const supabase = await db();
  await createReferrer(supabase, { ...input, createdByName: name ?? "Staff" });
  revalidateReferrals();
  return { ok: true };
}

export async function createReferralAction(
  input: Omit<CreateReferralInput, "createdByName">,
): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot log referrals." };
  if (!input.referredName.trim()) return { ok: false, error: "Enter who was referred." };

  const supabase = await db();
  await createReferral(supabase, { ...input, createdByName: name ?? "Staff" });
  revalidateReferrals();
  return { ok: true };
}

export async function updateReferralStatusAction(referralId: string, status: ReferralStatus): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot update referral status." };

  const supabase = await db();
  await updateReferralStatus(supabase, referralId, status);
  revalidateReferrals();
  return { ok: true };
}

export async function createRewardRuleAction(
  input: Omit<CreateRewardRuleInput, "createdByName">,
): Promise<ActionResult> {
  const { ok, name } = await requireCanManageRewards();
  if (!ok) return { ok: false, error: "Your role cannot create reward rules." };
  if (!input.name.trim()) return { ok: false, error: "Give the reward rule a name." };

  const supabase = await db();
  await createRewardRule(supabase, { ...input, createdByName: name ?? "Staff" });
  revalidateReferrals();
  return { ok: true };
}

export async function grantRewardAction(input: Omit<GrantRewardInput, "createdByName">): Promise<ActionResult> {
  const { ok, name } = await requireCanManageRewards();
  if (!ok) return { ok: false, error: "Your role cannot grant rewards." };
  if (input.amount <= 0) return { ok: false, error: "Enter a reward amount greater than zero." };

  const supabase = await db();
  await grantRewardAccrual(supabase, { ...input, createdByName: name ?? "Staff" });
  revalidateReferrals();
  return { ok: true };
}

export async function updateRewardAccrualStatusAction(
  accrualId: string,
  status: RewardAccrualStatus,
): Promise<ActionResult> {
  const { ok, name } = await requireCanManageRewards();
  if (!ok) return { ok: false, error: "Your role cannot update reward status." };

  const supabase = await db();
  await updateRewardAccrualStatus(supabase, accrualId, status, name ?? "Staff");
  revalidateReferrals();
  return { ok: true };
}
