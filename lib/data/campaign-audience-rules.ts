/**
 * Small pure rules for who a campaign can actually reach. Kept apart from the database code so they are unit tested.
 *
 * A lead who first wrote on Messenger or Instagram has no phone number until they give one (their `mobile` is the
 * empty string). If they were also opted in for WhatsApp they would pass every other check and be counted as
 * reachable by a WhatsApp campaign that has no number to send to.
 */

export const NO_PHONE_EXCLUSION = "No phone number on file";

/** Campaign channels that are delivered to a phone number. */
const PHONE_DELIVERED_CHANNELS = new Set(["WHATSAPP"]);

/** The reason a subject with this contact cannot be reached by a campaign on `channel`, or null when a number is not needed or exists. */
export function missingContactExclusion(channel: string, contact: string | null | undefined): string | null {
  if (!PHONE_DELIVERED_CHANNELS.has(channel)) return null;
  return (contact ?? "").trim().length === 0 ? NO_PHONE_EXCLUSION : null;
}
