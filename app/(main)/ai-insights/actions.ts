"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { recordInsightOutcome, runInsightGenerators } from "@/lib/data/insights-repository";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import type { InsightOutcomeType } from "@/lib/types/insights";
import { createClient } from "@/utils/supabase/server";

interface ActionResult {
  ok: boolean;
  error?: string;
}

async function db() {
  return createClient(await cookies());
}

async function requireCanManage() {
  await requireUser();
  const { role, name } = await getCurrentStaffRole();
  const ok = role === "ADMIN" || role === "CEO" || role === "OPERATIONS" || role === "MARKETING";
  return { ok, name };
}

export async function runInsightGeneratorsAction(): Promise<ActionResult & { generated?: number; skipped?: number }> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot generate insights." };

  const supabase = await db();
  const result = await runInsightGenerators(supabase);
  revalidatePath("/ai-insights");
  return { ok: true, ...result };
}

export async function recordInsightOutcomeAction(input: {
  insightId: string;
  outcomeType: InsightOutcomeType;
  note?: string;
}): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot act on insights." };

  const supabase = await db();
  await recordInsightOutcome(supabase, {
    insightId: input.insightId,
    outcomeType: input.outcomeType,
    note: input.note?.trim() || null,
    actorName: name ?? "Staff",
  });
  revalidatePath("/ai-insights");
  return { ok: true };
}
