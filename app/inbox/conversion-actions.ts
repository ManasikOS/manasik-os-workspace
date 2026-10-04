"use server";

import { revalidatePath } from "next/cache";

import { resolveCapability } from "@/lib/agent/kernel/proposals/capabilities";
import { requireUser } from "@/lib/dal";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import type { OfferedConversion } from "@/lib/inbox/conversions/catalogue";
import { confirmConversion, dismissConversion, listOfferedConversions, loadChoicesForConversion, previewConversion, type ConversionActor, type ConversionChoicesResult, type ConversionPreview } from "@/lib/inbox/conversions/service";
import { inboxConversationRequestSchema, inboxConversionChoicesSchema, inboxConversionDecisionSchema, inboxConversionPreviewSchema } from "@/lib/validations/inbox";
import { createAdminClient } from "@/utils/supabase/admin";

/**
 * Turning a conversation into work (MI4.6). Every action starts with `requireUser()`, validates at the boundary, and takes the
 * agency, the person and their role from the session — never from the request. The Inbox capability is checked here AND again
 * by the proposal kernel when the request is approved, so hiding the menu is never the boundary.
 *
 * The writes run on the trusted client after those checks: the task board and the support-case table are restricted to a few
 * roles, and a salesperson who may raise work from a conversation is not one of them. Every write names the agency.
 */

export type ConversionsResult = { ok: true; conversions: OfferedConversion[] } | { ok: false; error: string };
export type ConversionDecisionResult = { ok: true } | { ok: false; error: string };

async function resolveConversionActor(): Promise<{ ok: true; actor: ConversionActor } | { ok: false; error: string }> {
  await requireUser();
  const { role, roleId, agencyId, staffId, name } = await getCurrentStaffRole();
  if (!agencyId || !staffId) return { ok: false, error: "Your account is not linked to an agency." };
  const admin = createAdminClient();
  const [canReply, canConvert] = await Promise.all([
    resolveCapability(role, roleId, "inbox", "sendMessage", admin),
    resolveCapability(role, roleId, "inbox", "convertConversation", admin),
  ]);
  if (!canReply || !canConvert) return { ok: false, error: "Your role cannot turn conversations into tasks or cases." };
  return { ok: true, actor: { agencyId, role, roleId, staffId, name: name ?? "Staff" } };
}

/** Which conversions this conversation supports right now, and why any that do not. */
export async function loadConversationConversionsAction(input: unknown): Promise<ConversionsResult> {
  const parsed = inboxConversationRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That conversation could not be found." };
  const who = await resolveConversionActor();
  if (!who.ok) return who;
  try {
    const conversions = await listOfferedConversions(createAdminClient(), who.actor, parsed.data.conversationId);
    return conversions ? { ok: true, conversions } : { ok: false, error: "That conversation could not be found." };
  } catch (cause) {
    console.error("loadConversationConversionsAction failed", cause);
    return { ok: false, error: "The options could not be loaded. Please try again." };
  }
}

/** What the person can choose for one conversion (which traveller, which package, how many seats, which survey). */
export async function loadConversionChoicesAction(input: unknown): Promise<ConversionChoicesResult> {
  const parsed = inboxConversionChoicesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That option could not be found." };
  const who = await resolveConversionActor();
  if (!who.ok) return who;
  try {
    return await loadChoicesForConversion(createAdminClient(), who.actor, parsed.data);
  } catch (cause) {
    console.error("loadConversionChoicesAction failed", cause);
    return { ok: false, error: "The choices could not be loaded. Please try again." };
  }
}

/** Step 1: write the request and show what it would create. Nothing is created yet. */
export async function previewConversationConversionAction(input: unknown): Promise<ConversionPreview> {
  const parsed = inboxConversionPreviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check what you asked for." };
  const who = await resolveConversionActor();
  if (!who.ok) return who;
  try {
    return await previewConversion(createAdminClient(), who.actor, parsed.data);
  } catch (cause) {
    console.error("previewConversationConversionAction failed", cause);
    return { ok: false, error: "This could not be prepared. Please try again." };
  }
}

/** Step 2: the person approves it; the one task or case is created, pointing back at the conversation. */
export async function confirmConversationConversionAction(input: unknown): Promise<ConversionDecisionResult> {
  const parsed = inboxConversionDecisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That request could not be found." };
  const who = await resolveConversionActor();
  if (!who.ok) return who;
  try {
    const outcome = await confirmConversion(createAdminClient(), who.actor, parsed.data.proposalId);
    if (outcome.ok) {
      revalidatePath("/operations");
      revalidatePath("/departure-groups");
      revalidatePath("/pilgrims");
    }
    return outcome;
  } catch (cause) {
    console.error("confirmConversationConversionAction failed", cause);
    return { ok: false, error: "This could not be created. Please try again." };
  }
}

/** Step 2 (other way): cancel. Nothing was created, so nothing is undone. */
export async function dismissConversationConversionAction(input: unknown): Promise<ConversionDecisionResult> {
  const parsed = inboxConversionDecisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That request could not be found." };
  const who = await resolveConversionActor();
  if (!who.ok) return who;
  try {
    return await dismissConversion(createAdminClient(), who.actor, parsed.data.proposalId);
  } catch (cause) {
    console.error("dismissConversationConversionAction failed", cause);
    return { ok: false, error: "This could not be cancelled. Please try again." };
  }
}
