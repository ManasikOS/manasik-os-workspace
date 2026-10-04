/**
 * System prompt assembly — stable content first, volatile last, because the
 * order is the prompt-cache key. See §8.2 of
 * docs/modules/whatsapp-ai-agent-implementation-plan.md.
 *
 * Nothing in the frozen preamble or the settings-derived sections changes
 * within a conversation, or between conversations for the same agency —
 * only the conversation history that follows the cache breakpoint does.
 */

import { getAgencySettings } from "@/lib/data/settings-repository";
import type { AgentContext } from "@/lib/agent/whatsapp/context";
import { renderBehaviourInstructions } from "@/lib/agent/whatsapp/behaviour-prompt";
import { renderFrozenPreamble } from "@/lib/agent/whatsapp/preamble";
import { isKnowledgeBaseAvailable } from "@/lib/agent/whatsapp/knowledge/availability";
import { parseAiBehaviour } from "@/lib/validations/ai-behaviour";

interface AiSettingsRow {
  agent_name: string;
  persona_instructions: string;
  languages: string[];
  tone: "FRIENDLY_PROFESSIONAL" | "FORMAL" | "CONCISE";
  booking_enabled: boolean;
  lead_capture_enabled: boolean;
  handoff_enabled: boolean;
  working_hours: Record<string, unknown>;
  out_of_hours_message: string;
  behaviour: unknown;
}

function toneInstruction(tone: AiSettingsRow["tone"]): string {
  switch (tone) {
    case "FORMAL":
      return "Write formally — no emoji, no slang, complete sentences.";
    case "CONCISE":
      return "Be as brief as possible — short sentences, no pleasantries beyond a greeting.";
    default:
      return "Write warmly and professionally — friendly but not overfamiliar.";
  }
}

export async function buildSystemPrompt(ctx: AgentContext): Promise<string> {
  const [agencySettings, aiSettingsResult, knowledgeBaseAvailable] = await Promise.all([
    getAgencySettings(ctx.db),
    ctx.db
      .from("ai_settings")
      .select(
        "agent_name, persona_instructions, languages, tone, booking_enabled, lead_capture_enabled, handoff_enabled, working_hours, out_of_hours_message, behaviour",
      )
      .eq("agency_id", ctx.agencyId)
      .maybeSingle(),
    isKnowledgeBaseAvailable(ctx.db, ctx.agencyId),
  ]);

  const aiSettings = (aiSettingsResult.data as AiSettingsRow | null) ?? {
    agent_name: "Assistant",
    persona_instructions: "",
    languages: ["en"],
    tone: "FRIENDLY_PROFESSIONAL" as const,
    booking_enabled: false,
    lead_capture_enabled: false,
    handoff_enabled: true,
    working_hours: {},
    out_of_hours_message: "",
    behaviour: {},
  };

  const capabilities = [
    aiSettings.lead_capture_enabled && "capturing new leads",
    aiSettings.booking_enabled && "starting a seat-hold booking",
    aiSettings.handoff_enabled && "transferring to a staff member",
    knowledgeBaseAvailable &&
      "answering policy and guidance questions from the agency's own documents (say briefly which document you used, and never quote a price from one)",
  ].filter(Boolean);

  const sections = [
    renderFrozenPreamble(ctx.profile),
    `Your name is "${aiSettings.agent_name}", representing ${agencySettings.agency_name || "the agency"}.`,
    toneInstruction(aiSettings.tone),
    renderBehaviourInstructions(parseAiBehaviour(aiSettings.behaviour)),
    aiSettings.persona_instructions.trim() ? aiSettings.persona_instructions.trim() : null,
    `Reply in whichever of these languages the customer is writing in: ${aiSettings.languages.join(", ") || "English"}. Default to English if unclear.`,
    `Agency details: timezone ${agencySettings.timezone}, currency ${agencySettings.default_currency}.`,
    capabilities.length > 0
      ? `You are currently able to help with: ${capabilities.join("; ")}.`
      : "You can currently only answer questions — lead capture, booking and handoff are all off for this agency.",
  ].filter((section): section is string => Boolean(section));

  return sections.join("\n\n");
}
