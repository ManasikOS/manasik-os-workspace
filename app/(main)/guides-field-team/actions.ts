"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import {
  acknowledgeBriefing,
  acknowledgeHandover,
  createBriefing,
  createCheckin,
  createHandover,
  upsertGuideProfile,
  type CreateBriefingInput,
  type CreateCheckinInput,
  type CreateHandoverInput,
  type UpsertGuideProfileInput,
} from "@/lib/data/guide-field-team-repository";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { createClient } from "@/utils/supabase/server";

interface ActionResult {
  ok: boolean;
  error?: string;
}

async function db() {
  return createClient(await cookies());
}

function revalidateGuide(staffId: string) {
  revalidatePath(`/guides-field-team/${staffId}`);
}

/** Managing another guide's profile/briefings/handovers is Operations-managed. */
async function requireCanManage() {
  await requireUser();
  const { role, name } = await getCurrentStaffRole();
  const ok = role === "ADMIN" || role === "CEO" || role === "OPERATIONS";
  return { ok, name };
}

export async function upsertGuideProfileAction(input: UpsertGuideProfileInput): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot edit guide profiles." };

  const supabase = await db();
  await upsertGuideProfile(supabase, input);
  revalidateGuide(input.staffId);
  return { ok: true };
}

export async function createBriefingAction(input: Omit<CreateBriefingInput, "createdByName">): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot create briefings." };
  if (!input.title.trim() || !input.content.trim()) return { ok: false, error: "Give the briefing a title and content." };

  const supabase = await db();
  await createBriefing(supabase, { ...input, createdByName: name ?? "Staff" });
  revalidateGuide(input.staffId);
  return { ok: true };
}

/** A guide acknowledging their own briefing — gated by RLS ("own rows only"), not by role here. */
export async function acknowledgeBriefingAction(briefingId: string, ownerStaffId: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await db();
  try {
    await acknowledgeBriefing(supabase, briefingId);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not acknowledge briefing." };
  }
  revalidateGuide(ownerStaffId);
  return { ok: true };
}

export async function createHandoverAction(input: Omit<CreateHandoverInput, "createdByName">): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot create handovers." };
  if (!input.handoverNotes.trim()) return { ok: false, error: "Describe the handover." };

  const supabase = await db();
  await createHandover(supabase, { ...input, createdByName: name ?? "Staff" });
  revalidateGuide(input.toStaffId);
  if (input.fromStaffId) revalidateGuide(input.fromStaffId);
  return { ok: true };
}

/** A guide accepting a handover addressed to them — gated by RLS. */
export async function acknowledgeHandoverAction(handoverId: string, ownerStaffId: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await db();
  try {
    await acknowledgeHandover(supabase, handoverId);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not accept handover." };
  }
  revalidateGuide(ownerStaffId);
  return { ok: true };
}

/** A guide checking themselves in — gated by RLS (staff_id must be the caller). */
export async function createCheckinAction(input: CreateCheckinInput): Promise<ActionResult> {
  await requireUser();
  const supabase = await db();
  try {
    await createCheckin(supabase, input);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not record check-in." };
  }
  revalidateGuide(input.staffId);
  return { ok: true };
}
