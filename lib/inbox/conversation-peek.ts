import { formatDistanceStrict, format } from "date-fns";

import { COPILOT_NAME } from "@/lib/agent/identity";
import { channelDisplayName } from "@/lib/inbox/composer-state";
import { inboxListMessagePreview } from "@/lib/inbox/message-preview";
import { ownershipStatusFor } from "@/lib/inbox/ownership-status";
import type { ConversationState } from "@/lib/types/whatsapp";

/**
 * What staff can learn about a chat from the list alone, shown when they hover a row, so they do not have to open it to
 * find out who is on it, what was said last, whether the reply window is still open, or who owns it. Every line comes from
 * data the list already holds; nothing here is fetched.
 */

/** The fields of a list row this card reads. */
export interface ConversationPeekSource {
  channel: string;
  contact_name: string;
  contact_phone: string;
  external_conversation_id: string;
  state: ConversationState;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  service_window_expires_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  unread_count: number;
  created_at: string;
  lead_reference: string | null;
  lead_stage: string | null;
  desired_package_name: string | null;
  last_message_content: string | null;
  last_message_role: string | null;
  last_message_type: string | null;
  has_open_support_case: boolean;
}

export interface ConversationPeekFact {
  label: string;
  value: string;
  /** The line needs attention (for example, the reply window has closed). Still said in words, never colour alone. */
  attention?: boolean;
}

export interface ConversationPeek {
  name: string;
  channelLabel: string;
  /** Phone number, or the email address for an email thread. */
  contactLine: string | null;
  lastMessage: { sender: string; text: string } | null;
  facts: ConversationPeekFact[];
}

const LAST_MESSAGE_MAX_CHARS = 240;
const SENDER_LABEL: Record<string, string> = {
  user: "Customer",
  assistant: COPILOT_NAME,
  staff: "Staff",
};

function sentenceCase(code: string): string {
  const words = code.split("_").join(" ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function ago(iso: string, now: Date): string {
  return formatDistanceStrict(new Date(iso), now, { addSuffix: true });
}

function replyWindowFact(source: ConversationPeekSource, now: Date): ConversationPeekFact | null {
  if (!source.service_window_expires_at || source.state === "CLOSED") return null;
  const closesAt = new Date(source.service_window_expires_at);
  if (Number.isNaN(closesAt.getTime())) return null;
  return closesAt.getTime() > now.getTime()
    ? { label: "Reply window", value: `Open, closes ${formatDistanceStrict(closesAt, now, { addSuffix: true })}` }
    : { label: "Reply window", value: "Closed. Only an approved template can start the conversation again.", attention: true };
}

export function conversationPeek(
  source: ConversationPeekSource,
  options: { now: Date; currentStaffId: string | null },
): ConversationPeek {
  const { now, currentStaffId } = options;
  const name = source.contact_name || source.contact_phone || "Unknown contact";
  const contactLine =
    source.channel === "GMAIL"
      ? source.external_conversation_id || null
      : source.contact_phone && source.contact_phone !== name
        ? source.contact_phone
        : null;

  const previewText = inboxListMessagePreview({
    content: source.last_message_content,
    messageType: source.last_message_type,
  });
  const text =
    previewText.length > LAST_MESSAGE_MAX_CHARS
      ? `${previewText.slice(0, LAST_MESSAGE_MAX_CHARS).trimEnd()}…`
      : previewText;
  const hasMessage = Boolean(source.last_message_content?.trim() || source.last_message_type);

  const ownership = ownershipStatusFor({
    state: source.state,
    assignedToName: source.assigned_to_name,
    assignedToId: source.assigned_to_id,
    currentStaffId,
  });

  const facts: ConversationPeekFact[] = [
    { label: "Status", value: ownership.statusLabel, attention: ownership.tone === "action" },
    { label: "Owner", value: ownership.ownerLabel },
  ];
  if (source.lead_reference) {
    facts.push({
      label: "Lead",
      value: source.lead_stage ? `${source.lead_reference} · ${sentenceCase(source.lead_stage)}` : source.lead_reference,
    });
  }
  if (source.desired_package_name) facts.push({ label: "Interested in", value: source.desired_package_name });
  const windowFact = replyWindowFact(source, now);
  if (windowFact) facts.push(windowFact);
  if (source.last_inbound_at) facts.push({ label: "Customer wrote", value: ago(source.last_inbound_at, now) });
  if (source.last_outbound_at) facts.push({ label: "We replied", value: ago(source.last_outbound_at, now) });
  if (source.unread_count > 0) {
    facts.push({
      label: "Unread",
      value: `${source.unread_count} ${source.unread_count === 1 ? "message" : "messages"}`,
    });
  }
  if (source.has_open_support_case) {
    facts.push({ label: "Support case", value: "One is open for this customer", attention: true });
  }
  facts.push({ label: "Started", value: format(new Date(source.created_at), "d MMM yyyy") });

  return {
    name,
    channelLabel: channelDisplayName(source.channel),
    contactLine,
    lastMessage: hasMessage ? { sender: SENDER_LABEL[source.last_message_role ?? ""] ?? "Message", text } : null,
    facts,
  };
}
