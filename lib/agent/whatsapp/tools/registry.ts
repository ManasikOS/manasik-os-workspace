/**
 * Assembles the tool set for one agent turn from `ai_settings`' capability
 * flags — see §7.2 of docs/modules/whatsapp-ai-agent-implementation-plan.md.
 *
 * The telemetry/redaction wrapper itself lives in `lib/agent/kernel/telemetry.ts`
 * now, shared with every agent — see that module's header for why.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- every tool here has a genuinely different input type; BetaRunnableTool<any> is the SDK's own shape for a heterogeneous tool array */
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";

import type { AgentContext } from "@/lib/agent/whatsapp/context";
import { isKnowledgeBaseAvailable } from "@/lib/agent/whatsapp/knowledge/availability";
import { createBookingTools } from "@/lib/agent/whatsapp/tools/booking";
import { createDepartureTools } from "@/lib/agent/whatsapp/tools/departures";
import { createHandoffTools } from "@/lib/agent/whatsapp/tools/handoff";
import { createKnowledgeTools } from "@/lib/agent/whatsapp/tools/knowledge";
import { createLeadTools } from "@/lib/agent/whatsapp/tools/leads";
import { wrapWithTelemetryAndRedaction, type ToolTelemetry } from "@/lib/agent/kernel/telemetry";

export type { ToolCallRecord, ToolTelemetry } from "@/lib/agent/kernel/telemetry";

interface AiSettingsFlags {
  lead_capture_enabled: boolean;
  booking_enabled: boolean;
  handoff_enabled: boolean;
  max_turns_per_conversation: number;
  /** Switched on for the agency AND at least one active, ready document exists. */
  knowledge_base_available: boolean;
}

/** Loads which capabilities are on for this agency, defaulting everything off if the row is somehow missing. */
export async function loadAiCapabilities(ctx: AgentContext): Promise<AiSettingsFlags> {
  const { data } = await ctx.db
    .from("ai_settings")
    .select("lead_capture_enabled, booking_enabled, handoff_enabled, max_turns_per_conversation")
    .eq("agency_id", ctx.agencyId)
    .maybeSingle();

  const knowledgeBaseAvailable = await isKnowledgeBaseAvailable(ctx.db, ctx.agencyId);

  return {
    ...((data as Omit<AiSettingsFlags, "knowledge_base_available"> | null) ?? {
      lead_capture_enabled: false,
      booking_enabled: false,
      handoff_enabled: false,
      max_turns_per_conversation: 40,
    }),
    knowledge_base_available: knowledgeBaseAvailable,
  };
}

export function buildToolSet(
  ctx: AgentContext,
  capabilities: AiSettingsFlags,
  telemetry: ToolTelemetry,
): BetaRunnableTool<any>[] {
  // Every tool has a genuinely different input schema/type, so this array is
  // deliberately widened to BetaRunnableTool<any> — the runner itself
  // accepts exactly this kind of heterogeneous tool array.
  const tools: BetaRunnableTool<any>[] = [...createDepartureTools(ctx)];

  if (capabilities.lead_capture_enabled) tools.push(...createLeadTools(ctx));
  if (capabilities.handoff_enabled) tools.push(...createHandoffTools(ctx));
  if (capabilities.booking_enabled) tools.push(...createBookingTools(ctx));
  if (capabilities.knowledge_base_available) tools.push(...createKnowledgeTools(ctx));

  return tools.map((tool) => wrapWithTelemetryAndRedaction(tool, telemetry));
}

/** MI6.2: the L3 intake flow can read options, create/update a provisional lead, search approved knowledge and hand over. It can never hold inventory, confirm a booking or write money. */
export function buildInboxIntakeToolSet(ctx: AgentContext, capabilities: AiSettingsFlags, telemetry: ToolTelemetry): BetaRunnableTool<any>[] {
  const allowed = new Set(["get_upcoming_departures", "search_departures", "get_departure_details", "find_or_create_lead", "update_lead", "add_lead_note", "capture_contact_number", "search_knowledge_base", "transfer_to_staff"]);
  return buildToolSet(ctx, { ...capabilities, booking_enabled: false }, telemetry).filter((tool) => allowed.has(tool.name));
}
