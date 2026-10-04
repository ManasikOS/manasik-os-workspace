/**
 * Whether staff can reply in a conversation right now, and — when they cannot — the sentence that says why.
 * Pure, so the rules are unit tested and the Inbox panel only renders the answer.
 *
 * The visible half of a guard whose real half is `sendStaffMessage` (app/inbox/actions.ts), which
 * re-checks every rule server-side: hiding a button is never the security boundary, and a window can close
 * while a conversation is open.
 *
 * Messenger and Instagram differ from WhatsApp in two ways (Meta's rules, in each channel's ChannelProfile):
 *  - the business can never start the conversation, so with no customer message yet there is nothing to reply to;
 *  - after the reply window (24 h) closes there is no template to reopen it — a reply simply cannot be sent
 *    until the customer writes again. WhatsApp keeps its own template path, so its composer is left as it was.
 */

import { getChannelProfile } from "@/lib/channels/profile";
import type { ChannelProvider } from "@/lib/inbox/contracts";
import { resolveChannelPolicyState, type ChannelPolicyState } from "@/lib/channels/policy-state";

export type ComposerBlockReason = "CLOSED" | "NO_PERMISSION" | "CUSTOMER_MUST_MESSAGE_FIRST" | "WINDOW_CLOSED";

export type ComposerState =
  | { canReply: true; policy?: ChannelPolicyState }
  | {
      canReply: false;
      reason: ComposerBlockReason;
      /** Said to the person in words they can act on. */
      notice: string;
      policy?: ChannelPolicyState;
    };

export interface ComposerStateInput {
  conversationState: string;
  canSendMessage: boolean;
  channel: string;
  /** When the customer's last message stops allowing a free-text reply; null when they have never written. */
  serviceWindowExpiresAt: string | null;
  humanAgentWindowExpiresAt?: string | null;
  hasOpenSupportCase?: boolean;
  now: Date;
}

const CHANNEL_NAME: Record<string, string> = { WHATSAPP: "WhatsApp", MESSENGER: "Messenger", INSTAGRAM: "Instagram", GMAIL: "Email" };

/** The name people read for a channel. An unknown channel is shown as it is stored rather than hidden. */
export function channelDisplayName(channel: string): string {
  return CHANNEL_NAME[channel] ?? channel;
}

/** Only email carries a subject line and Cc/Bcc — a plain string check, not `getChannelProfile`, so an unrecognised channel never throws here. */
export function channelSupportsSubjectAndCcBcc(channel: string): boolean {
  return channel === "GMAIL";
}

/** A channel where Meta stops the business from writing first and gives no way to reopen a closed window. */
function isCustomerFirstChannel(channel: string): boolean {
  if (channel !== "MESSENGER" && channel !== "INSTAGRAM") return false;
  return !getChannelProfile(channel as ChannelProvider).businessCanStartConversation;
}

export function composerStateFor(input: ComposerStateInput): ComposerState {
  if (input.conversationState === "CLOSED") {
    return { canReply: false, reason: "CLOSED", notice: "This conversation is closed." };
  }
  if (!input.canSendMessage) {
    return { canReply: false, reason: "NO_PERMISSION", notice: "You don't have permission to reply here." };
  }

  if (isCustomerFirstChannel(input.channel)) {
    const name = channelDisplayName(input.channel);
    const hours = getChannelProfile(input.channel as ChannelProvider).replyWindowHours;

    if (input.serviceWindowExpiresAt === null) {
      return {
        canReply: false,
        reason: "CUSTOMER_MUST_MESSAGE_FIRST",
        notice: `${name} only lets you reply after the customer has messaged you. You can reply as soon as they do — you can add an internal note meanwhile.`,
      };
    }
    // Same comparison the server makes: a window is closed once its expiry is in the past.
    if (new Date(input.serviceWindowExpiresAt).getTime() < input.now.getTime()) {
      const policy = resolveChannelPolicyState({ channel: input.channel, now: input.now, serviceWindowExpiresAt: input.serviceWindowExpiresAt, humanAgentWindowExpiresAt: input.humanAgentWindowExpiresAt ?? null, handlingMode: input.conversationState, hasOpenSupportCase: input.hasOpenSupportCase ?? false, author: "HUMAN", projectedTemplateCharge: null, chargeCurrency: null });
      if (policy.action === "HUMAN_AGENT") return { canReply: true, policy };
      return {
        canReply: false,
        reason: "WINDOW_CLOSED",
        notice: `Reply window closed. ${name} only allows a reply within ${hours} hours of the customer's last message, and there is no way to reopen it. You can add an internal note, and reply again as soon as they message you.`,
      };
    }
  }

  const policy = resolveChannelPolicyState({ channel: input.channel, now: input.now, serviceWindowExpiresAt: input.serviceWindowExpiresAt, humanAgentWindowExpiresAt: input.humanAgentWindowExpiresAt ?? null, handlingMode: input.conversationState, hasOpenSupportCase: input.hasOpenSupportCase ?? false, author: "HUMAN", projectedTemplateCharge: null, chargeCurrency: null });
  if (policy.action === "APPROVED_TEMPLATE") {
    return { canReply: false, reason: "WINDOW_CLOSED", notice: policy.notice, policy };
  }
  return { canReply: true, policy };
}
