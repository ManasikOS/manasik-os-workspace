/**
 * What a lead created from a given channel starts with: where it came from, how it prefers to be reached, and
 * its phone number. One place, used by the Inbox's canonical lead binding (lead-linking.ts) and by the
 * assistant's own lead capture (agent/whatsapp/lead-capture.ts), so both label the same enquiry the same way
 * (plan findings F2, F3, F4). Pure.
 */

import type { ChannelProvider } from "@/lib/inbox/contracts";
import type { LeadContactChannel, LeadSource } from "@/lib/types/leads";

export interface LeadChannelDefaults {
  source: LeadSource;
  preferredChannel: LeadContactChannel;
}

/**
 * - Messenger is "FACEBOOK" as a lead source — the lead sources list has always called it that.
 * - A person who only ever wrote on Instagram or Messenger prefers that channel, not WhatsApp: follow-ups
 *   that pick the "preferred" channel would otherwise message a number we do not have.
 * - Everything else keeps the values it had before (Gmail prefers email; the source stays WHATSAPP).
 */
export function leadChannelDefaults(provider: ChannelProvider): LeadChannelDefaults {
  switch (provider) {
    case "INSTAGRAM":
      return { source: "INSTAGRAM", preferredChannel: "INSTAGRAM" };
    case "MESSENGER":
      return { source: "FACEBOOK", preferredChannel: "MESSENGER" };
    case "GMAIL":
      return { source: "WHATSAPP", preferredChannel: "EMAIL" };
    default:
      return { source: "WHATSAPP", preferredChannel: "WHATSAPP" };
  }
}

/**
 * The value stored in `leads.mobile` for a new lead. A channel with no phone number stores the empty string —
 * NEVER the channel's own id: an Instagram-scoped id stored as a "mobile" would appear in Leads as a phone
 * number and could later collide with a real dedupe key (plan finding F2).
 */
export function mobileForNewLead(knownMobile: string | null | undefined): string {
  return knownMobile && knownMobile.trim().length > 0 ? knownMobile : "";
}
