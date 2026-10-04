"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { capabilitiesForLeads } from "@/lib/access/leads-access";
import {
  addStaticMember,
  createAudience,
  deleteAudience,
  removeStaticMember,
  updateAudienceFilters,
  type CreateAudienceInput,
} from "@/lib/data/audiences-repository";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import type { AudienceFilters, AudienceSubjectType } from "@/lib/types/audiences";
import { createClient } from "@/utils/supabase/server";

interface ActionResult {
  ok: boolean;
  error?: string;
}

async function db() {
  return createClient(await cookies());
}

/**
 * Same reasoning as Campaigns' `requireCanManage` — Audiences reuses Leads'
 * `manageSourcesAndAutomation` capability rather than a new RBAC module,
 * since building/saving a segment is the same class of admin action.
 */
async function requireCanManage() {
  await requireUser();
  const { role, name } = await getCurrentStaffRole();
  return { ok: capabilitiesForLeads(role).manageSourcesAndAutomation, name };
}

function revalidateAudiences(audienceId?: string) {
  revalidatePath("/audiences");
  if (audienceId) revalidatePath(`/audiences/${audienceId}`);
}

export async function createAudienceAction(
  input: Omit<CreateAudienceInput, "createdByName">,
): Promise<ActionResult & { audienceId?: string }> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot create audiences." };
  if (!input.name.trim()) return { ok: false, error: "Give the audience a name." };

  const supabase = await db();
  const created = await createAudience(supabase, { ...input, createdByName: name ?? "Staff" });
  revalidateAudiences();
  return { ok: true, audienceId: created.id };
}

export async function updateAudienceFiltersAction(
  audienceId: string,
  filters: AudienceFilters,
): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot edit audience filters." };

  const supabase = await db();
  await updateAudienceFilters(supabase, audienceId, filters);
  revalidateAudiences(audienceId);
  return { ok: true };
}

export async function deleteAudienceAction(audienceId: string): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot delete audiences." };

  const supabase = await db();
  await deleteAudience(supabase, audienceId);
  revalidateAudiences();
  return { ok: true };
}

export async function addStaticMemberAction(input: {
  audienceId: string;
  subjectType: AudienceSubjectType;
  subjectId: string;
}): Promise<ActionResult> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot edit this audience." };

  const supabase = await db();
  await addStaticMember(supabase, { ...input, addedByName: name ?? "Staff" });
  revalidateAudiences(input.audienceId);
  return { ok: true };
}

export async function removeStaticMemberAction(audienceId: string, subjectId: string): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot edit this audience." };

  const supabase = await db();
  await removeStaticMember(supabase, audienceId, subjectId);
  revalidateAudiences(audienceId);
  return { ok: true };
}
