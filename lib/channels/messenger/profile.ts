/**
 * Best-effort customer name lookup for Messenger and Instagram (plan F11/F12). It never blocks and never throws:
 * no name simply leaves the placeholder in place.
 *
 * Two routes, tried in this order:
 *  1. The Page inbox — `/me/conversations?user_id=…&fields=participants` — which names everyone in the customer's
 *     thread. Verified live in Development mode, where route 2 is refused even for a tester: it needs only the
 *     Page token and the messaging permissions the connection already has.
 *  2. The direct profile lookup — `/{customer}?fields=first_name,last_name` — which needs Advanced Access to
 *     "Business Asset User Profile Access" and fails outright for accounts created with a phone number
 *     (error 2018218). Kept as the fallback for when the app has that access.
 */

import "server-only";

import type { PageMessagingChannel } from "@/lib/channels/messenger/webhook";
import type { Db } from "@/lib/data/whatsapp-repository";
import { metaGraphFetch, metaGraphVersion } from "@/lib/meta/graph";

export const MESSENGER_NAME_PLACEHOLDER = "Messenger customer";
export const INSTAGRAM_NAME_PLACEHOLDER = "Instagram customer";

export function namePlaceholderFor(channel: PageMessagingChannel): string {
  return channel === "INSTAGRAM" ? INSTAGRAM_NAME_PLACEHOLDER : MESSENGER_NAME_PLACEHOLDER;
}

export function profileDisplayName(
  profile: { name?: string | null; first_name?: string | null; last_name?: string | null; username?: string | null } | null,
): string | null {
  if (!profile) return null;
  const joined = [profile.first_name, profile.last_name].filter((part): part is string => Boolean(part && part.trim())).join(" ").trim();
  const name = joined || profile.name?.trim() || "";
  if (name.length > 0) return name;
  // An Instagram customer with no display name still has a handle, which is better than "Instagram customer".
  const handle = profile.username?.trim();
  return handle ? `@${handle}` : null;
}

/** True when a stored name is missing or is one of our own placeholders — the only case worth asking Meta again. */
export function needsProfileName(storedName: string | null): boolean {
  return storedName === null || storedName.trim() === "" || storedName === MESSENGER_NAME_PLACEHOLDER || storedName === INSTAGRAM_NAME_PLACEHOLDER;
}

interface InboxThread {
  participants?: { data?: Array<{ id?: string; name?: string; username?: string }> };
}

/** The customer's name as the Page inbox shows it, or null. The participant is matched by id, never taken by position. */
export async function fetchNameFromPageInbox(pageToken: string, customerId: string, channel: PageMessagingChannel): Promise<string | null> {
  try {
    const platform = channel === "INSTAGRAM" ? "instagram" : "messenger";
    const result = (await metaGraphFetch(
      { host: "facebook", version: metaGraphVersion() },
      `/me/conversations?platform=${platform}&user_id=${encodeURIComponent(customerId)}&fields=participants`,
      pageToken,
      { method: "GET", retries: 0, signal: AbortSignal.timeout(4000) },
    )) as { data?: InboxThread[] };
    for (const thread of result.data ?? []) {
      for (const participant of thread.participants?.data ?? []) {
        if (participant.id !== customerId) continue;
        const name = profileDisplayName({ name: participant.name, username: participant.username });
        if (name) return name;
      }
    }
    return null;
  } catch {
    return null; // the direct lookup is tried next
  }
}

export async function fetchMessengerProfileName(pageToken: string, customerId: string, channel: PageMessagingChannel = "MESSENGER"): Promise<string | null> {
  const fromInbox = await fetchNameFromPageInbox(pageToken, customerId, channel);
  if (fromInbox) return fromInbox;

  const fields = channel === "INSTAGRAM" ? "name,username" : "first_name,last_name";
  try {
    const profile = (await metaGraphFetch(
      { host: "facebook", version: metaGraphVersion() },
      `/${encodeURIComponent(customerId)}?fields=${fields}`,
      pageToken,
      { method: "GET", retries: 0, signal: AbortSignal.timeout(4000) },
    )) as { first_name?: string; last_name?: string; name?: string; username?: string };
    return profileDisplayName(profile);
  } catch (error) {
    console.warn(`${channel === "INSTAGRAM" ? "Instagram" : "Messenger"} profile lookup failed:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Writes the fetched name where the placeholder was: the conversation, the contact identity, and the lead
 * only if it still carries the placeholder (a name a person has since edited is never overwritten).
 */
export async function applyMessengerProfileName(
  db: Db,
  input: { agencyId: string; psid: string; name: string; channel?: PageMessagingChannel },
): Promise<void> {
  const channel = input.channel ?? "MESSENGER";
  const placeholder = namePlaceholderFor(channel);

  const { data: conversation } = await db
    .from("conversations")
    .select("id, lead_id")
    .eq("agency_id", input.agencyId)
    .eq("channel", channel)
    .eq("external_conversation_id", input.psid)
    .maybeSingle();
  if (!conversation) return;
  const row = conversation as { id: string; lead_id: string | null };

  await db
    .from("conversations")
    .update({ contact_name: input.name })
    .eq("id", row.id)
    .eq("agency_id", input.agencyId)
    .in("contact_name", ["", placeholder]);
  await db
    .from("contact_identities")
    .update({ display_name: input.name })
    .eq("agency_id", input.agencyId)
    .eq("provider", channel)
    .eq("external_subject_id", input.psid);
  if (row.lead_id) {
    await db.from("leads").update({ full_name: input.name }).eq("id", row.lead_id).eq("agency_id", input.agencyId).eq("full_name", placeholder);
  }
}
