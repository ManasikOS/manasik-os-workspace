"use server";

import { cookies } from "next/headers";
import { after } from "next/server";
import { z } from "zod";

import type { InboxTemplate } from "@/app/inbox/types";
import { countryForWaId, waIdToMobile } from "@/lib/agent/whatsapp/phone";
import { findLatestTemplateRates } from "@/lib/data/whatsapp-billing-repository";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireUser } from "@/lib/dal";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { loadProtectionContext } from "@/lib/data/inbox-risk-repository";
import { quickChatSendMode, type QuickChatSendMode } from "@/lib/inbox/quick-chat/access";
import { processDueInboxOutbox } from "@/lib/inbox/outbox/drain";
import { decideReplyOnOwnedConversation, type OwnedConversationFacts } from "@/lib/inbox/ownership-guard";
import { outboundGateText } from "@/lib/inbox/risk/outbound-gate-text";
import { evaluateProtection, refusalMessage } from "@/lib/inbox/risk/protection-gate";
import { isInboxWorkerActive } from "@/lib/inbox/worker/mode";
import { isQuickChatEnabled } from "@/lib/inbox/quick-chat/flag";
import {
  decideQuickChatTarget,
  type QuickChatExistingConversation,
  type QuickChatTarget,
} from "@/lib/inbox/quick-chat/resolve-target";
import { toQuickChatThread, type QuickChatMessage, type QuickChatMessageSource } from "@/lib/inbox/quick-chat/thread";
import { checkStartChatConsent } from "@/lib/inbox/start-chat-consent";
import { createClient } from "@/utils/supabase/server";

/**
 * Read-only actions behind the Quick Chat popup. Sending goes through the Inbox's own `sendStaffMessage`; these two only let the popup
 * learn what it may show. Both are agency-scoped and answer "not permitted" to anyone who may not use the popup.
 */

export type ResolveQuickChatTargetResult =
  | { ok: true; digits: string; target: QuickChatTarget; contactName: string | null }
  | { ok: false; error: string };

export type LoadQuickChatTemplatesResult = { ok: true; templates: InboxTemplate[] } | { ok: false; error: string };

export type LoadQuickChatThreadResult = { ok: true; messages: QuickChatMessage[] } | { ok: false; error: string };

const resolveInputSchema = z.object({ channel: z.literal("WHATSAPP"), to: z.string().trim().min(1).max(40) });
const threadInputSchema = z.object({ conversationId: z.string().uuid() });

const NOT_PERMITTED = "Not permitted.";
const BAD_NUMBER = "Enter the full international WhatsApp number, including country code.";
const MESSAGE_LIMIT = 50;

async function authorised(): Promise<{ agencyId: string; staffId: string | null; mode: QuickChatSendMode } | null> {
  await requireUser();
  const { role, agencyId, staffId } = await getCurrentStaffRole();
  const mode = quickChatSendMode(role);
  if (!isQuickChatEnabled() || !agencyId || !mode) return null;
  return { agencyId, staffId: staffId ?? null, mode };
}

export async function resolveQuickChatTargetAction(input: unknown): Promise<ResolveQuickChatTargetResult> {
  const who = await authorised();
  if (!who) return { ok: false, error: NOT_PERMITTED };
  const parsed = resolveInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_NUMBER };

  const digits = parsed.data.to.replace(/\D/g, "");
  if (!/^\d{8,15}$/.test(digits)) return { ok: false, error: BAD_NUMBER };

  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("conversations")
    .select("id, state, assigned_to_id, assigned_to_name, service_window_expires_at, contact_name")
    .eq("agency_id", who.agencyId)
    .eq("channel", "WHATSAPP")
    .eq("external_conversation_id", digits)
    .maybeSingle();

  const consent = await checkStartChatConsent(supabase, { agencyId: who.agencyId, mobile: waIdToMobile(digits) });
  const row = (data as (QuickChatExistingConversation & { contact_name: string | null }) | null) ?? null;
  const target = decideQuickChatTarget({
    existing: error ? "UNREADABLE" : row,
    consent,
    currentStaffId: who.staffId,
    now: new Date(),
  });
  return { ok: true, digits, target, contactName: row?.contact_name ?? null };
}

export async function loadQuickChatThreadAction(input: unknown): Promise<LoadQuickChatThreadResult> {
  const who = await authorised();
  if (!who) return { ok: false, error: NOT_PERMITTED };
  const parsed = threadInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That conversation could not be found." };

  const supabase = createClient(await cookies());
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", parsed.data.conversationId)
    .eq("agency_id", who.agencyId)
    .maybeSingle();
  if (conversationError || !conversation) return { ok: false, error: "That conversation could not be found." };

  const { data, error } = await supabase
    .from("conversation_messages")
    .select("id, role, actor_kind, actor_name_snapshot, content, message_type, delivery_status, delivery_error, created_at")
    .eq("conversation_id", parsed.data.conversationId)
    .eq("agency_id", who.agencyId)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_LIMIT);
  if (error) return { ok: false, error: "The messages could not be loaded. Please try again." };
  return { ok: true, messages: toQuickChatThread((data ?? []) as QuickChatMessageSource[]) };
}

/**
 * The approved WhatsApp templates, each with the charge Meta last reported for this number's country and category (null when none has
 * been seen, which the screen says in words). Only reads; the send goes through the Inbox's own template actions.
 */
export async function loadQuickChatTemplatesAction(input: unknown): Promise<LoadQuickChatTemplatesResult> {
  const who = await authorised();
  // Templates are sent through the Inbox's own actions, so only the roles that may send from the Inbox are offered them.
  if (!who || who.mode !== "INBOX") return { ok: false, error: NOT_PERMITTED };
  const parsed = resolveInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_NUMBER };
  const digits = parsed.data.to.replace(/\D/g, "");
  if (!/^\d{8,15}$/.test(digits)) return { ok: false, error: BAD_NUMBER };

  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("whatsapp_templates")
    .select("id, name, language, category, components")
    .eq("agency_id", who.agencyId)
    .eq("status", "APPROVED")
    .order("name");
  if (error) return { ok: false, error: "The approved templates could not be loaded. Please try again." };

  const rows = (data ?? []) as InboxTemplate[];
  let rates: Awaited<ReturnType<typeof findLatestTemplateRates>> = {};
  try {
    rates = await findLatestTemplateRates(createAdminClient(), who.agencyId, countryForWaId(digits), [
      ...new Set(rows.map((template) => template.category)),
    ]);
  } catch (cause) {
    // A missing rate only means the charge is shown as unavailable; it never blocks choosing a template.
    console.error("Quick Chat could not read template rates:", cause instanceof Error ? cause.message : cause);
  }
  return {
    ok: true,
    templates: rows.map((template) => ({
      ...template,
      projected_charge: rates[template.category]?.amount ?? null,
      charge_currency: rates[template.category]?.currency ?? null,
    })),
  };
}

export type SendQuickChatRecordMessageResult = { ok: true; messageId: string | null } | { ok: false; error: string };

const recordMessageSchema = z
  .object({
    conversationId: z.string().uuid(),
    body: z.string().trim().min(1, "The message is empty.").max(4000, "WhatsApp messages sent from here can be up to 4,000 characters."),
    /** The browser's key for THIS send attempt: a repeat with the same key returns the message already stored. */
    clientIdempotencyKey: z.string().uuid(),
  })
  .strict();

const WINDOW_CLOSED_COPY = "The 24-hour reply window has closed, so a free-text message cannot be sent. Ask someone in Operations to send an approved template.";
const CLOSED_COPY = "This conversation is closed.";
const WHATSAPP_ONLY_COPY = "Only WhatsApp conversations can be messaged from here.";

/** What the database function says when it refuses, in words for the person. Anything else is a failure to log, not to show. */
const RECORD_SEND_REFUSALS: Array<[RegExp, string]> = [
  [/outside the reply window/, WINDOW_CLOSED_COPY],
  [/owned by a colleague/, "This conversation is owned by a colleague. Ask them to reply, or to hand it over first."],
  [/conversation is closed/, CLOSED_COPY],
  [/WhatsApp only/, WHATSAPP_ONLY_COPY],
  [/not permitted/, NOT_PERMITTED],
];

/**
 * Sends one WhatsApp text from a record page for Finance and Visa, who may not send from the Inbox. Everyone else uses the Inbox's own
 * `sendStaffMessage`; this refuses them. The database function repeats the role, channel, ownership and reply-window rules; the payment
 * protection gate (which needs the conversation's open reviews) runs here, before it is called.
 */
export async function sendQuickChatRecordMessageAction(input: unknown): Promise<SendQuickChatRecordMessageResult> {
  const who = await authorised();
  if (!who || who.mode !== "RECORD") return { ok: false, error: NOT_PERMITTED };
  const parsed = recordMessageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the message." };
  const { conversationId, body, clientIdempotencyKey } = parsed.data;

  const supabase = createClient(await cookies());
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id, channel, state, assigned_to_id, assigned_to_name, service_window_expires_at")
    .eq("id", conversationId)
    .eq("agency_id", who.agencyId)
    .maybeSingle();
  if (conversationError || !conversation) return { ok: false, error: "Conversation not found." };
  if (conversation.channel !== "WHATSAPP") return { ok: false, error: WHATSAPP_ONLY_COPY };
  if (conversation.state === "CLOSED") return { ok: false, error: CLOSED_COPY };
  const owner = decideReplyOnOwnedConversation({ conversation: conversation as OwnedConversationFacts, currentStaffId: who.staffId });
  if (!owner.ok) return owner;
  const windowEnds = conversation.service_window_expires_at as string | null;
  if (!windowEnds || new Date(windowEnds).getTime() <= Date.now()) return { ok: false, error: WINDOW_CLOSED_COPY };

  // The payment-protection gate, enforced here on the server. If the open reviews cannot be read, nothing is sent: unknown is not "clear".
  try {
    const protection = await loadProtectionContext(supabase, who.agencyId, conversationId);
    const decision = evaluateProtection({
      text: outboundGateText({ subject: null, body, filename: undefined }),
      audience: "STAFF_SEND",
      openReviews: protection.openReviews,
      approvedAccountDigits: protection.approvedAccountDigits,
    });
    if (!decision.allowed) return { ok: false, error: refusalMessage(decision) };
  } catch (cause) {
    console.error("Quick Chat protection gate could not read the open reviews:", cause instanceof Error ? cause.message : cause);
    return { ok: false, error: "Could not check whether a review is open on this conversation. Try again in a moment." };
  }

  const { data, error } = await supabase.rpc("enqueue_record_text_message", {
    p_conversation_id: conversationId,
    p_body: body,
    p_client_idempotency_key: clientIdempotencyKey,
  });
  if (error) {
    const refusal = RECORD_SEND_REFUSALS.find(([pattern]) => pattern.test(error.message));
    if (refusal) return { ok: false, error: refusal[1] };
    console.error("Quick Chat record send failed:", error.message);
    return { ok: false, error: "The message could not be sent. Please try again." };
  }

  // The always-on worker drains the outbox itself; the scheduled drain remains the guarantee.
  if (!isInboxWorkerActive()) {
    after(() => processDueInboxOutbox({ budgetMs: 20_000 }).catch((cause) => console.error("Inbox outbox drain failed", cause)));
  }
  const created = (Array.isArray(data) ? data[0] : data) as { message_id?: string } | null;
  return { ok: true, messageId: created?.message_id ?? null };
}
