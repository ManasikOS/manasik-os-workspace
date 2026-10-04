import "server-only";

import type { ChannelRuntimeAdapter } from "@/lib/channels/adapter";
import { ensureLeadForConversation } from "@/lib/agent/whatsapp/lead-capture";
import { deliverAgentReply } from "@/lib/agent/whatsapp/reply-delivery";
import { assignOwner } from "@/lib/agent/whatsapp/tools/handoff";
import type { AgentContext } from "@/lib/agent/whatsapp/context";
import { resolveEntitlements } from "@/lib/billing/entitlements";
import type { AutonomyLevel } from "@/lib/inbox/intelligence/contracts";
import type { ConversationRow } from "@/lib/types/whatsapp";
import { meterAiConversation, utcMonthStart } from "@/lib/billing/meter";
import { advanceIntakeFlow, intakeQuestion, type IntakeState } from "./intake-flow";
import { resolveEffectiveAutonomy } from "./level";

interface StoredIntakeState {
  step: IntakeState["step"];
  answers: IntakeState["answers"];
  stalled_turns: number;
  last_message_id: string | null;
  last_reply_key: string | null;
}

const initialState = (): IntakeState => ({ step: "DATES", answers: {}, stalledTurns: 0 });
const levelOf = (value: unknown): AutonomyLevel => (["L0", "L1", "L2", "L3"] as const).includes(value as AutonomyLevel) ? value as AutonomyLevel : "L0";

function roomPreference(answer: string | undefined): "QUAD" | "TRIPLE" | "DOUBLE" | "SINGLE" | "UNDECIDED" | undefined {
  if (!answer) return undefined;
  if (/quad|four|4|හතර|நான்கு/iu.test(answer)) return "QUAD";
  if (/triple|three|3|තුන්|மூன்று/iu.test(answer)) return "TRIPLE";
  if (/double|two|2|දෙ|இரண்டு/iu.test(answer)) return "DOUBLE";
  if (/single|one|1|තනි|தனி/iu.test(answer)) return "SINGLE";
  return "UNDECIDED";
}

async function intakeLevel(context: AgentContext, conversation: ConversationRow): Promise<AutonomyLevel> {
  const [{ data: surface, error }, entitlements] = await Promise.all([
    context.db.from("ai_surface_settings").select("enabled,mode,autonomy").eq("agency_id", context.agencyId).eq("surface", "INBOX_INTAKE").maybeSingle(),
    resolveEntitlements(context.db, context.agencyId),
  ]);
  if (error) throw new Error(`Could not read the Inbox intake setting: ${error.message}`);
  const autonomy = (surface?.autonomy ?? {}) as Record<string, unknown>;
  const mode = surface?.enabled && ["OFF", "SHADOW", "PROPOSE", "ACTIVE"].includes(String(surface.mode))
    ? String(surface.mode) as "OFF" | "SHADOW" | "PROPOSE" | "ACTIVE"
    : "OFF";
  // Mirrors the human-active check `authorizeAutomatedInboxSend` (runtime.ts) makes before authorizing any
  // automated send — a staff member already handling this conversation must stop bounded intake from starting
  // (and, on a handover-triggering answer, reassigning ownership away from them), not just from actually sending.
  const conversationHumanActive = conversation.state === "HUMAN_ACTIVE" || conversation.handling_mode === "HUMAN_ACTIVE";
  return resolveEffectiveAutonomy({ entitlementCeiling: entitlements?.autonomyCeiling ?? "L0", surfaceMode: mode, configuredLevel: levelOf(autonomy.level), conversationHumanActive });
}

/**
 * Atomically claims this conversation's first intake turn (FIX4: "duplicate first message sends nothing
 * twice"). No `inbox_intake_states` row exists yet on a genuine first turn, and nothing upstream deduplicates a
 * redelivered webhook before it reaches here, so two concurrent calls for the same inbound message could
 * otherwise both compose and send a reply. A plain insert either succeeds (this call owns the first turn) or
 * hits the table's `(agency_id, conversation_id)` primary key (another call already claimed it) — reading back
 * what that call wrote lets this one fall through to the same idempotent "already processed" path a later
 * duplicate takes. Returns `null` when this call won the claim.
 */
async function claimFirstIntakeTurn(context: AgentContext, messageId: string): Promise<StoredIntakeState | null> {
  const claim = await context.db.from("inbox_intake_states").insert({
    agency_id: context.agencyId,
    conversation_id: context.conversationId,
    step: "DATES",
    answers: {},
    stalled_turns: 0,
    last_message_id: messageId,
    last_reply_key: null,
  });
  if (!claim.error) return null;
  const { data, error } = await context.db.from("inbox_intake_states").select("step,answers,stalled_turns,last_message_id,last_reply_key").eq("agency_id", context.agencyId).eq("conversation_id", context.conversationId).maybeSingle();
  if (error || !data) throw new Error(`Could not claim the bounded intake state: ${claim.error.message}`);
  return data as StoredIntakeState;
}

async function saveState(context: AgentContext, state: IntakeState, messageId: string, replyKey: string | null): Promise<void> {
  const { error } = await context.db.from("inbox_intake_states").upsert({
    agency_id: context.agencyId,
    conversation_id: context.conversationId,
    step: state.step,
    answers: state.answers,
    stalled_turns: state.stalledTurns,
    last_message_id: messageId,
    last_reply_key: replyKey,
    updated_at: new Date().toISOString(),
  }, { onConflict: "agency_id,conversation_id" });
  if (error) throw new Error(`Could not save the bounded intake state: ${error.message}`);
}

async function updateProvisionalLead(context: AgentContext, conversation: ConversationRow, state: IntakeState): Promise<string> {
  const created = await ensureLeadForConversation(context, {
    fullName: conversation.contact_name?.trim() || `${context.profile.displayName} customer`,
    interestedIn: "Pilgrimage package enquiry collected by bounded intake",
    city: state.answers.DEPARTURE_CITY,
  });
  context.leadId = created.lead.id;
  const patch: Record<string, unknown> = { interested_in: "Pilgrimage package enquiry — human review required" };
  if (state.answers.DATES) patch.preferred_period = state.answers.DATES;
  if (state.answers.DEPARTURE_CITY) patch.departure_city = state.answers.DEPARTURE_CITY;
  const room = roomPreference(state.answers.ROOM_ARRANGEMENT);
  if (room) patch.room_preference = room;
  const { error } = await context.db.from("leads").update(patch).eq("agency_id", context.agencyId).eq("id", created.lead.id);
  if (error) throw new Error(`Could not update the provisional intake lead: ${error.message}`);
  return created.lead.id;
}

async function handoverIntake(context: AgentContext, conversation: ConversationRow, state: IntakeState, summary: string): Promise<void> {
  const leadId = await updateProvisionalLead(context, conversation, state);
  const details = Object.entries(state.answers).map(([key, value]) => `${key.toLowerCase().replaceAll("_", " ")}: ${value}`).join("; ");
  const note = `${summary}${details ? ` Collected: ${details}.` : ""}`;
  await context.db.from("lead_notes").insert({ agency_id: context.agencyId, lead_id: leadId, body: note, author_name: "Manasik Copilot" });
  const owner = await assignOwner(context);
  const { error } = await context.db.from("conversations").update({ state: "HUMAN_REQUESTED", handling_mode: "HUMAN_REQUESTED", assigned_to_id: owner.id, assigned_to_name: owner.name }).eq("agency_id", context.agencyId).eq("id", context.conversationId);
  if (error) throw new Error(`Could not hand the intake to staff: ${error.message}`);
  await context.db.from("conversation_messages").insert({
    agency_id: context.agencyId,
    conversation_id: context.conversationId,
    role: "system",
    actor_kind: "SYSTEM",
    content: `Bounded intake handed to staff. ${note}`,
    message_type: "SYSTEM",
    metadata: { source: "inbox_intake", lead_id: leadId },
  });
}

/** Runs one deterministic L3 intake turn. Returns false when the normal agent should handle it. */
export async function runBoundedInboxIntake(input: {
  context: AgentContext;
  conversation: ConversationRow;
  adapter: ChannelRuntimeAdapter;
  messageId: string;
}): Promise<boolean> {
  if (await intakeLevel(input.context, input.conversation) !== "L3") return false;
  const [{ data: message, error: messageError }, { data: stored, error: stateError }] = await Promise.all([
    input.context.db.from("conversation_messages").select("content").eq("agency_id", input.context.agencyId).eq("conversation_id", input.context.conversationId).eq("id", input.messageId).eq("role", "user").maybeSingle(),
    input.context.db.from("inbox_intake_states").select("step,answers,stalled_turns,last_message_id,last_reply_key").eq("agency_id", input.context.agencyId).eq("conversation_id", input.context.conversationId).maybeSingle(),
  ]);
  if (messageError || !message) throw new Error(`Could not load the intake message: ${messageError?.message ?? "not found"}`);
  if (stateError) throw new Error(`Could not load the bounded intake state: ${stateError.message}`);
  const customerText = String(message.content ?? "");
  let existing = stored as StoredIntakeState | null;
  // FIX4 (docs/inbox/fixing-plan.md): the first turn is never special-cased around the transition — it still
  // passes through the same deny-topic check and state machine as every later message, just told it is first so
  // a plain greeting is not filed as an answer to "what dates suit you" (see `advanceIntakeFlow`).
  let isFirstTurn = false;
  if (!existing) {
    const claimLostTo = await claimFirstIntakeTurn(input.context, input.messageId);
    if (claimLostTo === null) isFirstTurn = true;
    else existing = claimLostTo;
  }

  // FIX4 (docs/inbox/fixing-plan.md): "duplicate first message sends nothing twice" — this exact delivery
  // already produced the row now stored (the reply was sent, or the handover already ran); redoing either one
  // is not idempotency, it is a second send. This covers the first turn racing its own claim (see
  // `claimFirstIntakeTurn`) and any later turn redelivered before its ack is processed.
  if (!isFirstTurn && existing && existing.last_message_id === input.messageId) return true;

  let state = existing ? { step: existing.step, answers: existing.answers ?? {}, stalledTurns: existing.stalled_turns } : initialState();
  const transition = advanceIntakeFlow(state, customerText, { isFirstTurn });
  state = transition.state;
  const replyKey = transition.replyKey;
  const handover = transition.handover;
  const summary = transition.summary;
  await updateProvisionalLead(input.context, input.conversation, state);
  if (isFirstTurn) {
    // FIX3 (docs/inbox/fixing-plan.md): the first L3 intake turn is one of the four
    // qualifying boundaries. FIX4's atomic first-turn claim makes `isFirstTurn` true
    // for exactly one caller, so retries and concurrent deliveries do not re-meter.
    await meterAiConversation(input.context.db, { agencyId: input.context.agencyId, conversationId: input.context.conversationId, periodStart: utcMonthStart(new Date()) }).catch((cause) => {
      console.error("Could not meter the AI-assisted conversation:", cause instanceof Error ? cause.message : cause);
    });
  }

  if (handover || !replyKey) {
    await saveState(input.context, state, input.messageId, null);
    await handoverIntake(input.context, input.conversation, state, summary || "The bounded intake is complete and requires human review.");
    return true;
  }

  const reply = intakeQuestion(replyKey, customerText) ?? "A colleague will continue this enquiry.";
  const delivered = await deliverAgentReply({
    db: input.context.db,
    adapter: input.adapter,
    agencyId: input.context.agencyId,
    conversation: input.conversation,
    reply,
    buttons: [],
    metadata: { autonomy_source: "INTAKE_FLOW", autonomy_action: "QUALIFYING_QUESTION", intake_reply_key: replyKey },
  });
  if (delivered.status !== "SENT") {
    await handoverIntake(input.context, input.conversation, state, `Automated intake could not safely send ${replyKey}; a person must continue.`);
    return true;
  }
  await saveState(input.context, state, input.messageId, replyKey);
  return true;
}
