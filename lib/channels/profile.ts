/**
 * A channel's own technical limits and house rules — a pure value from code, never an agency setting.
 * The agent's persona, tone, behaviour, tools and knowledge are the SAME on every channel
 * (`ai_settings` has no channel column, by decision D1 of
 * docs/modules/messenger-instagram-ai-agent-implementation-plan.md); the only thing that varies by
 * channel is this profile: what the platform allows and what its policy requires.
 */

import type { ChannelProvider } from "@/lib/inbox/contracts";

export interface ChannelProfile {
  provider: ChannelProvider;
  /** Name customers and the prompt use for the channel, e.g. "WhatsApp". */
  displayName: string;
  /** Unit of the platform's hard text limit — Instagram counts bytes, which matters for Sinhala/Tamil/Arabic. */
  maxTextUnit: "chars" | "bytes";
  /** The platform's hard limit for one outbound text, in `maxTextUnit`. */
  maxTextSize: number;
  /** The most characters the guardrail lets one AI reply reach before it is blocked. Conversational, well under the hard limit. */
  preferredReplyChars: number;
  /** Hours after the customer's last message during which free-text replies are allowed. */
  replyWindowHours: number;
  /** Meta policy: say the reply is automated at the start of a thread and after a long lapse. */
  requiresAutomationDisclosure: boolean;
  supportsQuickReplies: boolean;
  supportsInboundAudio: boolean;
  /** WhatsApp can open a chat with an approved template; Messenger and Instagram cannot — the customer must write first. */
  businessCanStartConversation: boolean;
  /**
   * True when the customer's address on this channel IS a phone number (WhatsApp). False for Messenger and
   * Instagram, whose ids are not phone numbers: a lead from them has no phone until the customer gives one.
   */
  identifiesByPhone: boolean;
  /** Whether the provider accepts Meta's HUMAN_AGENT support tag inside its seven-day window. */
  supportsHumanAgentTag: boolean;
}

const WHATSAPP_PROFILE: ChannelProfile = {
  provider: "WHATSAPP",
  displayName: "WhatsApp",
  maxTextUnit: "chars",
  maxTextSize: 4096,
  preferredReplyChars: 1200, // unchanged from the guardrail's previous constant
  replyWindowHours: 24,
  requiresAutomationDisclosure: false,
  supportsQuickReplies: true,
  supportsInboundAudio: true,
  businessCanStartConversation: true,
  identifiesByPhone: true,
  supportsHumanAgentTag: false,
};

const MESSENGER_PROFILE: ChannelProfile = {
  provider: "MESSENGER",
  displayName: "Messenger",
  maxTextUnit: "chars",
  maxTextSize: 2000, // believed, not confirmed in Meta's docs — verify before Phase 3 (plan §1.1)
  preferredReplyChars: 1200,
  replyWindowHours: 24,
  requiresAutomationDisclosure: true,
  supportsQuickReplies: true,
  supportsInboundAudio: true,
  businessCanStartConversation: false,
  identifiesByPhone: false,
  supportsHumanAgentTag: true,
};

const INSTAGRAM_PROFILE: ChannelProfile = {
  provider: "INSTAGRAM",
  displayName: "Instagram",
  maxTextUnit: "bytes",
  maxTextSize: 1000, // UTF-8 bytes, per Meta's Instagram messaging docs
  preferredReplyChars: 1200,
  replyWindowHours: 24,
  requiresAutomationDisclosure: true,
  supportsQuickReplies: true,
  supportsInboundAudio: true,
  businessCanStartConversation: false,
  identifiesByPhone: false,
  supportsHumanAgentTag: true,
};

const EMAIL_PROFILE: ChannelProfile = {
  provider: "GMAIL",
  displayName: "Email",
  maxTextUnit: "chars",
  maxTextSize: 100_000, // No real provider limit; a generous ceiling against a runaway compose, not an enforced norm.
  preferredReplyChars: 100_000,
  replyWindowHours: Number.POSITIVE_INFINITY, // Email has no reply-window policy — see resolveChannelPolicyState.
  requiresAutomationDisclosure: false,
  supportsQuickReplies: false,
  supportsInboundAudio: false,
  businessCanStartConversation: true, // Unlike Messenger/Instagram, staff can compose a brand-new email.
  identifiesByPhone: false,
  supportsHumanAgentTag: false,
};

const PROFILES: Partial<Record<ChannelProvider, ChannelProfile>> = {
  WHATSAPP: WHATSAPP_PROFILE,
  MESSENGER: MESSENGER_PROFILE,
  INSTAGRAM: INSTAGRAM_PROFILE,
  GMAIL: EMAIL_PROFILE,
};

/**
 * Providers the agent can answer on. Email deliberately has a `ChannelProfile` (above, for the composer and outbox
 * to read text limits from) but is NOT in this list: Manasik Copilot never gets autonomous `AI_ACTIVE` handling on
 * a GMAIL conversation (docs/inbox/email-channel-implementation-plan.md, D4). Others (web chat…) have no profile
 * at all yet and are refused, not guessed.
 */
export function isAgentChannel(provider: string): provider is "WHATSAPP" | "MESSENGER" | "INSTAGRAM" {
  return provider === "WHATSAPP" || provider === "MESSENGER" || provider === "INSTAGRAM";
}

export function getChannelProfile(provider: ChannelProvider): ChannelProfile {
  const profile = PROFILES[provider];
  if (!profile) throw new Error(`No channel profile is defined for ${provider}.`);
  return profile;
}
