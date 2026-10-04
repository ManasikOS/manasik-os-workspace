"use server";

/**
 * Manasik Copilot settings — read/write for `ai_settings`. See §11 of
 * docs/modules/whatsapp-ai-agent-implementation-plan.md.
 *
 * Runs through the ordinary session client, exactly like every other
 * Settings-style module — `ai_settings`' RLS policy (ADMIN-only write) is
 * the real enforcement; the `editSettings` check here is the fast, friendly
 * rejection before a query even runs.
 */

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { capabilitiesForAiAgent } from "@/lib/access/ai-agent-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { aiBehaviourSchema, type AiBehaviour } from "@/lib/validations/ai-behaviour";
import { followupSettingsSchema, type FollowupSettingsInput } from "@/lib/validations/followups";
import { countBodyVariables } from "@/lib/whatsapp/template-params";
import { createClient } from "@/utils/supabase/server";
import { z } from "zod";
import { loadInboxAutonomyEvidence } from "@/lib/inbox/autonomy/evidence";
import { resolveEntitlements } from "@/lib/billing/entitlements";

export interface AiSettingsInput {
  enabled: boolean;
  agentName: string;
  personaInstructions: string;
  languages: string[];
  tone: "FRIENDLY_PROFESSIONAL" | "FORMAL" | "CONCISE";
  leadCaptureEnabled: boolean;
  bookingEnabled: boolean;
  handoffEnabled: boolean;
  behaviour: AiBehaviour;
  seatHoldHours: number;
  maxTurnsPerConversation: number;
  outOfHoursMessage: string;
}

export type SaveResult = { ok: true } | { ok: false; error: string };

const inboxAutonomyLevelSchema = z.object({ level: z.enum(["L0", "L1", "L2", "L3"]) }).strict();

export async function saveInboxAutonomyLevel(input: unknown): Promise<SaveResult> {
  await requireUser();
  const parsed = inboxAutonomyLevelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid Inbox autonomy level." };
  const { role, agencyId, staffId } = await getCurrentStaffRole();
  if (!capabilitiesForAiAgent(role).editSettings) return { ok: false, error: "Your role cannot edit Inbox autonomy." };
  if (!agencyId || !staffId) return { ok: false, error: "No agency staff profile resolved for your account." };
  const supabase = createClient(await cookies());
  const [evidence, entitlements, { data: current }] = await Promise.all([
    loadInboxAutonomyEvidence(supabase, agencyId),
    resolveEntitlements(supabase, agencyId),
    supabase.from("ai_surface_settings").select("autonomy").eq("agency_id", agencyId).eq("surface", "INBOX_REPLY").maybeSingle(),
  ]);
  const rank = { L0: 0, L1: 1, L2: 2, L3: 3 } as const;
  const currentLevel = (["L0", "L1", "L2", "L3"].includes(String((current?.autonomy as Record<string, unknown> | null)?.level))
    ? String((current?.autonomy as Record<string, unknown>).level)
    : "L0") as "L0" | "L1" | "L2" | "L3";
  const isPromotion = rank[parsed.data.level] > rank[currentLevel];
  if (isPromotion && (parsed.data.level === "L2" || parsed.data.level === "L3") && !evidence.decision.eligible) {
    return { ok: false, error: evidence.decision.blockers.join(" ") };
  }
  // A plan whose entitlements could not be resolved (no subscription row, or the read failed) is never a way
  // around the ceiling — fail closed to L0, the same default `authorizeAutomatedInboxSend` (runtime.ts) uses at
  // send time, so a config saved here can never claim a level the send path would not actually honour.
  const autonomyCeiling = entitlements?.autonomyCeiling ?? "L0";
  if (rank[parsed.data.level] > rank[autonomyCeiling]) {
    return {
      ok: false,
      error: entitlements
        ? `The ${entitlements.planCode} plan allows autonomy up to ${entitlements.autonomyCeiling}.`
        : "Your agency's plan entitlements could not be confirmed, so autonomy cannot be raised above L0. Try again shortly.",
    };
  }
  const wasAutonomous = currentLevel === "L2" || currentLevel === "L3";
  const becomesAutonomous = parsed.data.level === "L2" || parsed.data.level === "L3";
  const autonomy = { ...((current?.autonomy ?? {}) as Record<string, unknown>), level: parsed.data.level, promoted_at: becomesAutonomous ? (wasAutonomous ? (current?.autonomy as Record<string, unknown>)?.promoted_at ?? new Date().toISOString() : new Date().toISOString()) : null };
  const mode = parsed.data.level === "L0" ? "SHADOW" : parsed.data.level === "L1" ? "PROPOSE" : "ACTIVE";
  const { error } = await supabase.rpc("set_inbox_autonomy_level", {
    p_agency_id: agencyId,
    p_surface: "INBOX_REPLY",
    p_level: parsed.data.level,
    p_mode: mode,
    p_enabled: parsed.data.level !== "L0",
    p_autonomy: autonomy,
    p_actor_id: staffId,
    p_reason: isPromotion ? "Manual promotion after measured evidence review." : rank[parsed.data.level] < rank[currentLevel] ? "Manual demotion." : "Autonomy setting confirmed.",
    p_evidence: evidence.evidence,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/management/ai-agent");
  return { ok: true };
}

export async function saveAiSettings(input: AiSettingsInput): Promise<SaveResult> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForAiAgent(role).editSettings) return { ok: false, error: "Your role cannot edit Manasik Copilot settings." };
  if (!agencyId) return { ok: false, error: "No agency resolved for your account." };

  if (input.bookingEnabled && !input.leadCaptureEnabled) {
    return { ok: false, error: "Booking needs lead capture enabled too — every booking is tied to a lead." };
  }

  const behaviour = aiBehaviourSchema.safeParse(input.behaviour);
  if (!behaviour.success) {
    return { ok: false, error: behaviour.error.issues[0]?.message ?? "The conversation style settings are not valid." };
  }

  const supabase = createClient(await cookies());
  const { error } = await supabase
    .from("ai_settings")
    .update({
      behaviour: behaviour.data,
      enabled: input.enabled,
      agent_name: input.agentName.trim() || "Assistant",
      persona_instructions: input.personaInstructions,
      languages: input.languages.length > 0 ? input.languages : ["en"],
      tone: input.tone,
      lead_capture_enabled: input.leadCaptureEnabled,
      booking_enabled: input.bookingEnabled,
      handoff_enabled: input.handoffEnabled,
      seat_hold_hours: input.seatHoldHours,
      max_turns_per_conversation: input.maxTurnsPerConversation,
      out_of_hours_message: input.outOfHoursMessage,
    })
    .eq("agency_id", agencyId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/management/ai-agent");
  return { ok: true };
}

export interface DepartureOpsSettingsInput {
  enabled: boolean;
  mode: "OFF" | "SHADOW" | "PROPOSE" | "ACTIVE";
  maxProposalsPerRun: number;
  maxTasksPerRun: number;
  highRiskRoles: string[];
  rejectionCooldownDays: number;
}

/** Same posture as `saveAiSettings` — `editSettings` is the friendly rejection, `ai_settings`' own ADMIN-only RLS policy is the real enforcement. */
export async function saveDepartureOpsSettings(input: DepartureOpsSettingsInput): Promise<SaveResult> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForAiAgent(role).editSettings) return { ok: false, error: "Your role cannot edit Manasik Copilot settings." };
  if (!agencyId) return { ok: false, error: "No agency resolved for your account." };

  if (input.highRiskRoles.length === 0) {
    return { ok: false, error: "At least one role must be able to approve a HIGH-risk proposal." };
  }

  const supabase = createClient(await cookies());
  const { error } = await supabase
    .from("ai_settings")
    .update({
      departure_ops_enabled: input.enabled,
      departure_ops_mode: input.mode,
      departure_ops_max_proposals_per_run: input.maxProposalsPerRun,
      departure_ops_max_tasks_per_run: input.maxTasksPerRun,
      departure_ops_high_risk_roles: input.highRiskRoles,
      departure_ops_rejection_cooldown_days: input.rejectionCooldownDays,
    })
    .eq("agency_id", agencyId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/management/ai-agent");
  return { ok: true };
}

/**
 * Saves the follow-up and waiting-customer alert settings. Same posture as the other saves here:
 * `editSettings` is the friendly rejection, `ai_settings`' ADMIN-only RLS policy is the enforcement, and the
 * input is re-validated with Zod at this boundary whatever the form already checked.
 */
export async function saveFollowupSettings(input: FollowupSettingsInput): Promise<SaveResult> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForAiAgent(role).editSettings) return { ok: false, error: "Your role cannot edit Manasik Copilot settings." };
  if (!agencyId) return { ok: false, error: "No agency resolved for your account." };

  const parsed = followupSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "The follow-up settings are not valid." };
  const settings = parsed.data;

  const supabase = createClient(await cookies());

  if (settings.followupWhatsappTemplateId) {
    const { data: template } = await supabase
      .from("whatsapp_templates")
      .select("id, components")
      .eq("id", settings.followupWhatsappTemplateId)
      .eq("agency_id", agencyId)
      .eq("status", "APPROVED")
      .maybeSingle();
    if (!template) return { ok: false, error: "That WhatsApp template is not approved. Choose an approved template." };
    if (countBodyVariables(template.components) > 1) {
      return { ok: false, error: "Choose a template with at most one variable — the follow-up fills it with the customer's first name." };
    }
  }

  const { error } = await supabase
    .from("ai_settings")
    .update({
      followups_enabled: settings.followupsEnabled,
      followups_dry_run: settings.followupsDryRun,
      followup_delays_hours: settings.followupDelaysHours,
      followup_message_text: settings.followupMessageText,
      followup_whatsapp_template_id: settings.followupWhatsappTemplateId,
      handoff_alert_minutes: settings.handoffAlertMinutes,
      handoff_escalation_minutes: settings.handoffEscalationMinutes,
    })
    .eq("agency_id", agencyId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/management/ai-agent");
  return { ok: true };
}
