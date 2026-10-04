"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { capabilitiesForPilgrims } from "@/lib/access/pilgrims-access";
import {
  createSurvey,
  recordSurveyResponse,
  updateSurveyActive,
  type CreateSurveyInput,
  type RecordSurveyResponseInput,
} from "@/lib/data/feedback-repository";
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

async function requireCanManage() {
  await requireUser();
  const { role, name } = await getCurrentStaffRole();
  return { ok: capabilitiesForPilgrims(role).manageSupportRequests, name };
}

function revalidateFeedback(surveyId?: string) {
  revalidatePath("/relationships/feedback-complaints");
  if (surveyId) revalidatePath(`/relationships/feedback-complaints/${surveyId}`);
}

export async function createSurveyAction(
  input: Omit<CreateSurveyInput, "createdByName">,
): Promise<ActionResult & { surveyId?: string }> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot create surveys." };
  if (!input.title.trim()) return { ok: false, error: "Give the survey a title." };

  const supabase = await db();
  const created = await createSurvey(supabase, { ...input, createdByName: name ?? "Staff" });
  revalidateFeedback();
  return { ok: true, surveyId: created.id };
}

export async function updateSurveyActiveAction(surveyId: string, isActive: boolean): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot update this survey." };

  const supabase = await db();
  await updateSurveyActive(supabase, surveyId, isActive);
  revalidateFeedback(surveyId);
  return { ok: true };
}

export async function recordSurveyResponseAction(
  input: Omit<RecordSurveyResponseInput, "recordedByName">,
): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot record survey responses." };
  if (!input.pilgrimId.trim()) return { ok: false, error: "Enter the pilgrim's ID." };

  const supabase = await db();
  try {
    await recordSurveyResponse(supabase, { ...input, recordedByName: name ?? "Staff" });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not record response." };
  }
  revalidateFeedback(input.surveyId);
  return { ok: true };
}
