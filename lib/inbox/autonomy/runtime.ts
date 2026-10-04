import "server-only";

import type { Db } from "@/lib/ai/db";
import { resolveEntitlements } from "@/lib/billing/entitlements";
import { loadProtectionContext } from "@/lib/data/inbox-risk-repository";
import { loadSlaSettings } from "@/lib/data/inbox-sla-repository";
import type { AutonomyLevel } from "@/lib/inbox/intelligence/contracts";
import { isWithinBusinessHours } from "@/lib/inbox/sla/business-hours";
import { loadInboxAutonomyEvidence } from "./evidence";
import { legacyAssistantMayAuthorise, lowerAutonomyLevel, resolveEffectiveAutonomy } from "./level";
import { autonomyDemotionTarget, narrowPromotionWindowAllows } from "./promotion";
import { automatedInboxSendGate } from "./send-gate";

export type AutomatedReplySource = "APPROVED_TEMPLATE" | "APPROVED_ANSWER" | "INTAKE_FLOW" | "GENERATED";
export type AutomatedReplyAction = "ACKNOWLEDGEMENT" | "QUALIFYING_QUESTION" | "APPROVED_FAQ" | "OTHER";

const LEVELS: readonly AutonomyLevel[] = ["L0", "L1", "L2", "L3"];
function levelOf(value: unknown): AutonomyLevel {
  return LEVELS.includes(value as AutonomyLevel) ? value as AutonomyLevel : "L0";
}

export interface AutomatedSendAuthorization {
  allowed: boolean;
  reasons: string[];
  level: AutonomyLevel;
  surface: "INBOX_REPLY" | "INBOX_INTAKE";
}

/** The single server-side autonomy decision used by every automated delivery path. */
async function legacyAssistantIsActive(db: Db, agencyId: string): Promise<boolean> {
  const { data, error } = await db.from("ai_surface_settings").select("enabled,mode").eq("agency_id", agencyId).eq("surface", "WHATSAPP").maybeSingle();
  if (error) throw new Error(`Could not read the assistant setting: ${error.message}`);
  return Boolean(data?.enabled) && data?.mode === "ACTIVE";
}

/** Has anyone ever set the Inbox reply level for this agency? Every change goes through `set_inbox_autonomy_level`, which audits it. */
async function inboxReplyEverConfigured(db: Db, agencyId: string): Promise<boolean> {
  const { count, error } = await db.from("inbox_autonomy_level_audit").select("id", { count: "exact", head: true }).eq("agency_id", agencyId).eq("surface", "INBOX_REPLY");
  if (error) throw new Error(`Could not read the autonomy history: ${error.message}`);
  return (count ?? 0) > 0;
}

export async function authorizeAutomatedInboxSend(db: Db, input: {
  agencyId: string;
  conversationId: string;
  text: string;
  source: AutomatedReplySource;
  action?: AutomatedReplyAction;
  now?: Date;
}): Promise<AutomatedSendAuthorization> {
  const now = input.now ?? new Date();
  const surfaceName = input.source === "INTAKE_FLOW" ? "INBOX_INTAKE" : "INBOX_REPLY";
  const [{ data: surface, error: surfaceError }, entitlements, protection, { data: conversation, error: conversationError }] = await Promise.all([
    db.from("ai_surface_settings").select("enabled,mode,autonomy").eq("agency_id", input.agencyId).eq("surface", surfaceName).maybeSingle(),
    resolveEntitlements(db, input.agencyId),
    loadProtectionContext(db, input.agencyId, input.conversationId),
    db.from("conversations").select("state,handling_mode").eq("agency_id", input.agencyId).eq("id", input.conversationId).single(),
  ]);
  if (surfaceError) throw new Error(`Could not load autonomy settings: ${surfaceError.message}`);
  if (conversationError || !conversation) throw new Error(`Could not load autonomy conversation state: ${conversationError?.message ?? "not found"}`);

  const autonomy = (surface?.autonomy ?? {}) as Record<string, unknown>;
  let configuredLevel = levelOf(autonomy.level);
  let evidenceDecision: Awaited<ReturnType<typeof loadInboxAutonomyEvidence>> | null = null;
  if (configuredLevel === "L2" || configuredLevel === "L3") {
    evidenceDecision = await loadInboxAutonomyEvidence(db, input.agencyId, now);
    const demotion = autonomyDemotionTarget(configuredLevel, evidenceDecision.evidence);
    if (demotion) {
      configuredLevel = demotion.level;
      const nextMode = configuredLevel === "L0" ? "SHADOW" : configuredLevel === "L1" ? "PROPOSE" : "ACTIVE";
      const nextAutonomy = { ...autonomy, level: configuredLevel, promoted_at: configuredLevel === "L1" ? null : autonomy.promoted_at };
      const changed = await db.rpc("set_inbox_autonomy_level", {
        p_agency_id: input.agencyId,
        p_surface: surfaceName,
        p_level: configuredLevel,
        p_mode: nextMode,
        p_enabled: configuredLevel !== "L0",
        p_autonomy: nextAutonomy,
        p_actor_id: null,
        p_reason: `Automatic demotion: ${demotion.reasons.join(" ")}`,
        p_evidence: evidenceDecision.evidence,
      });
      if (changed.error) throw new Error(`Could not apply autonomy demotion: ${changed.error.message}`);
    }
  }

  const rawMode = surface?.enabled ? String(surface.mode) : "OFF";
  const mode = (["OFF", "SHADOW", "PROPOSE", "ACTIVE"] as const).includes(rawMode as never)
    ? rawMode as "OFF" | "SHADOW" | "PROPOSE" | "ACTIVE"
    : "OFF";
  let level = resolveEffectiveAutonomy({
    entitlementCeiling: entitlements?.autonomyCeiling ?? "L0",
    surfaceMode: configuredLevel === "L1" ? "PROPOSE" : mode,
    configuredLevel,
    conversationHumanActive: conversation.state === "HUMAN_ACTIVE" || conversation.handling_mode === "HUMAN_ACTIVE",
  });

  const reasons: string[] = [];
  if ((level === "L2" || level === "L3") && autonomy.promoted_at) {
    const promotedAt = new Date(String(autonomy.promoted_at));
    if (Number.isFinite(promotedAt.getTime())) {
      const schedule = await loadSlaSettings(db, input.agencyId);
      const outsideOfficeHours = !isWithinBusinessHours(now, schedule.calendar, schedule.timezone);
      if (!narrowPromotionWindowAllows({ promotedAt, now, outsideOfficeHours, action: input.action ?? "OTHER" })) {
        reasons.push("The first 14 days after promotion allow only out-of-hours acknowledgements, approved qualifying questions, and approved FAQ answers.");
      }
    }
  }
  // A plan downgrade can only lower what settings request, never raise it.
  level = lowerAutonomyLevel(level, entitlements?.autonomyCeiling ?? "L0");
  // The assistant an agency switched on in the WhatsApp AI settings has always replied on its own. Until the agency
  // opts into the newer Inbox reply surface, that switch stays the authority for the assistant's ordinary replies —
  // otherwise the default L0 row silently refuses every one of them. The protection checks below still apply.
  // Only while nobody has ever chosen a level for the Inbox reply surface. An explicit choice, including L0, is the policy.
  if (!surface?.enabled && input.source === "GENERATED" && await legacyAssistantIsActive(db, input.agencyId)) {
    if (legacyAssistantMayAuthorise({ inboxReplySurfaceEnabled: false, source: input.source, legacyAssistantActive: true, inboxReplyEverConfigured: await inboxReplyEverConfigured(db, input.agencyId) })) {
      // The legacy switch is only a stand-in for the Inbox reply surface, not a way around the plan's ceiling.
      level = lowerAutonomyLevel("L3", entitlements?.autonomyCeiling ?? "L0");
    }
  }
  const gate = automatedInboxSendGate({ level, text: input.text, source: input.source, openReviews: protection.openReviews, approvedAccountDigits: protection.approvedAccountDigits, entitlementCeiling: entitlements?.autonomyCeiling ?? "L0" });
  reasons.push(...gate.reasons);
  return { allowed: reasons.length === 0, reasons, level, surface: surfaceName };
}

export async function recordAutomatedSendDecision(db: Db, input: {
  agencyId: string;
  conversationId: string;
  messageId?: string | null;
  authorization: AutomatedSendAuthorization;
  source: AutomatedReplySource;
  decision: "SENT" | "REFUSED";
}): Promise<void> {
  const { error } = await db.from("inbox_autonomy_decisions").insert({
    agency_id: input.agencyId,
    conversation_id: input.conversationId,
    message_id: input.messageId ?? null,
    surface: input.authorization.surface,
    effective_level: input.authorization.level,
    decision: input.decision,
    source: input.source,
    reasons: input.authorization.reasons,
    deny_list_violation: input.authorization.reasons.some((reason) => /never|promise|payment|visa|discount|refund|bank|medical|religious|complaint/i.test(reason)),
  });
  if (error) throw new Error(`Could not record the autonomy decision: ${error.message}`);
}
