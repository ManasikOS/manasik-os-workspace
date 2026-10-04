import "server-only";

import type { ChannelRuntimeAdapter } from "@/lib/channels/adapter";
import { gmailChannelAdapter } from "@/lib/channels/email/adapter";
import { instagramChannelAdapter } from "@/lib/channels/instagram/adapter";
import { messengerChannelAdapter } from "@/lib/channels/messenger/adapter";
import { whatsappChannelAdapter } from "@/lib/channels/whatsapp-adapter";
import type { ChannelProvider } from "@/lib/inbox/contracts";

/**
 * Provider selection happens here and nowhere else: webhooks, the reply drain, the staff outbox and CRM
 * workflows ask for an adapter by provider and never import a provider client. A provider with no
 * adapter is refused with a clear error — never silently treated as WhatsApp, and never pretending to
 * send.
 */
const ADAPTERS: Partial<Record<ChannelProvider, ChannelRuntimeAdapter>> = {
  WHATSAPP: whatsappChannelAdapter,
  MESSENGER: messengerChannelAdapter,
  INSTAGRAM: instagramChannelAdapter,
  GMAIL: gmailChannelAdapter,
};

export function hasChannelAdapter(provider: ChannelProvider): boolean {
  return provider in ADAPTERS;
}

export function getChannelAdapter(provider: ChannelProvider): ChannelRuntimeAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`No adapter is installed for ${provider}.`);
  return adapter;
}
