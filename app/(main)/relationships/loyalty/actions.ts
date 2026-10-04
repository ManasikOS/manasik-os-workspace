"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import {
  addPointEntry,
  createLoyaltyTier,
  createRedemption,
  updateRedemptionStatus,
  type AddPointEntryInput,
  type CreateRedemptionInput,
  type CreateTierInput,
} from "@/lib/data/loyalty-repository";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import type { LoyaltyRedemptionStatus } from "@/lib/types/loyalty";
import { createClient } from "@/utils/supabase/server";

interface ActionResult {
  ok: boolean;
  error?: string;
}

async function db() {
  return createClient(await cookies());
}

/** Same posture as Announcements/Pilgrim Portal — no dedicated "Relationships" RBAC module exists yet. */
async function requireCanManage() {
  await requireUser();
  const { role, name } = await getCurrentStaffRole();
  const ok = role === "ADMIN" || role === "CEO" || role === "OPERATIONS";
  return { ok, name };
}

function revalidateLoyalty() {
  revalidatePath("/relationships/loyalty");
}

export async function createLoyaltyTierAction(input: Omit<CreateTierInput, "createdByName">): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot create loyalty tiers." };
  if (!input.name.trim()) return { ok: false, error: "Give the tier a name." };

  const supabase = await db();
  await createLoyaltyTier(supabase, { ...input, createdByName: name ?? "Staff" });
  revalidateLoyalty();
  return { ok: true };
}

export async function addPointEntryAction(input: Omit<AddPointEntryInput, "createdByName">): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot adjust loyalty points." };
  if (input.points === 0) return { ok: false, error: "Enter a non-zero number of points." };
  if (!input.reason.trim()) return { ok: false, error: "Give a reason for this adjustment." };

  const supabase = await db();
  await addPointEntry(supabase, { ...input, createdByName: name ?? "Staff" });
  revalidateLoyalty();
  return { ok: true };
}

export async function createRedemptionAction(
  input: Omit<CreateRedemptionInput, "createdByName">,
): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot create redemptions." };
  if (!input.rewardDescription.trim()) return { ok: false, error: "Describe the reward." };
  if (input.pointsSpent <= 0) return { ok: false, error: "Enter a points amount greater than zero." };

  const supabase = await db();
  await createRedemption(supabase, { ...input, createdByName: name ?? "Staff" });
  revalidateLoyalty();
  return { ok: true };
}

export async function updateRedemptionStatusAction(
  redemptionId: string,
  status: LoyaltyRedemptionStatus,
): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot update redemptions." };

  const supabase = await db();
  await updateRedemptionStatus(supabase, redemptionId, status, name ?? "Staff");
  revalidateLoyalty();
  return { ok: true };
}
