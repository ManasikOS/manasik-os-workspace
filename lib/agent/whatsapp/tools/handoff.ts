/**
 * Human handoff — the agent's only way to stop talking. See §10.1 of
 * docs/modules/whatsapp-ai-agent-implementation-plan.md.
 *
 * Setting `state = 'HUMAN_REQUESTED'` here is what makes the handoff real:
 * once set, the webhook (§6.1 step 8) stops enqueueing jobs for this
 * conversation entirely — the agent is never invoked again until a staff
 * member releases it back. The tool does not merely suggest a handoff; it
 * is the handoff.
 */

import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";

import type { AgentContext } from "@/lib/agent/whatsapp/context";
import { resolveHandoffOwner } from "@/lib/data/inbox-routing-repository";
import { setConversationState } from "@/lib/data/whatsapp-repository";

/**
 * The owner of a handed-off conversation. An agency that turned Inbox routing on (MI3.5) gets the four-step chain, which
 * may honestly return nobody; an agency that did not gets the configured default owner, exactly as before. If the chain
 * cannot be read, the old single-owner rule answers rather than the handoff failing.
 */
export async function assignOwner(ctx: AgentContext): Promise<{ id: string | null; name: string | null }> {
  try {
    return await resolveHandoffOwner(ctx.db, { agencyId: ctx.agencyId, conversationId: ctx.conversationId });
  } catch (cause) {
    console.error("Inbox routing failed; using the default owner:", cause instanceof Error ? cause.message : cause);
    return defaultOwner(ctx);
  }
}

async function defaultOwner(ctx: AgentContext): Promise<{ id: string | null; name: string | null }> {
  const { data: settings } = await ctx.db
    .from("ai_settings")
    .select("default_lead_owner_id")
    .eq("agency_id", ctx.agencyId)
    .maybeSingle();

  const ownerId = (settings as { default_lead_owner_id: string | null } | null)?.default_lead_owner_id;
  if (!ownerId) return { id: null, name: null };

  const { data: staff } = await ctx.db
    .from("staff_profiles")
    .select("id, full_name")
    .eq("id", ownerId)
    .eq("agency_id", ctx.agencyId)
    .maybeSingle();

  if (!staff) return { id: null, name: null };
  return { id: staff.id as string, name: (staff as { full_name: string }).full_name };
}

export function createHandoffTools(ctx: AgentContext) {
  const transferToStaff = betaTool({
    name: "transfer_to_staff",
    description:
      "Hands the conversation to a human member of staff and stops the AI from replying further. Call " +
      "this whenever the customer explicitly asks for a person, whenever the topic touches money, " +
      "refunds, complaints, visa or medical detail, or whenever you are not confident you can help " +
      "correctly. This is not optional caution — it is the correct move whenever in doubt.",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "One sentence a staff member will read before opening the conversation." },
        urgency: { type: "string", enum: ["NORMAL", "HIGH"] },
      },
      required: ["reason"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      const owner = await assignOwner(ctx);

      await setConversationState(ctx.db, ctx.conversationId, "HUMAN_REQUESTED", {
        assigned_to_id: owner.id,
        assigned_to_name: owner.name,
      });

      await ctx.db.from("conversation_messages").insert({
        agency_id: ctx.agencyId,
        conversation_id: ctx.conversationId,
        role: "system",
        actor_kind: "SYSTEM",
        content: `Handed off to staff${owner.name ? ` (${owner.name})` : ""}. Reason: ${args.reason}`,
        message_type: "SYSTEM",
        metadata: { urgency: args.urgency ?? "NORMAL" },
      });

      return JSON.stringify({ ok: true, assignedTo: owner.name });
    },
  });

  return [transferToStaff];
}
