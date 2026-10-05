import type { Db } from "@/lib/ai/db";

/**
 * Starting a WhatsApp chat sends a billable template to any number staff type in. Copilot's draft path already refuses a lead who opted out or
 * asked not to be contacted; this is the same refusal for a chat staff start by hand (SEC-6 in docs/progress/2026-10-05-inbox-security-and-bug-audit.md).
 *
 * It refuses ONLY a number that belongs to a lead who opted out or is marked do-not-contact. A number nobody has any record of is allowed: staff
 * legitimately start chats with people who phoned or walked in, and consent for them is simply not recorded yet. The new-chat dialog already shows
 * which lead a number belongs to, so staff see what they are about to message.
 */

export type StartChatConsentVerdict = { allowed: true } | { allowed: false; reason: "OPTED_OUT" | "UNREADABLE"; error: string };

export interface LeadConsentRow {
  consent_status: string | null;
  do_not_contact: boolean | null;
}

export function decideStartChatConsent(leads: readonly LeadConsentRow[]): StartChatConsentVerdict {
  const optedOut = leads.some((lead) => lead.do_not_contact === true || lead.consent_status === "OPTED_OUT");
  if (!optedOut) return { allowed: true };
  return {
    allowed: false,
    reason: "OPTED_OUT",
    error: "This number belongs to a lead who has opted out of contact or asked not to be contacted, so a chat cannot be started. Check the lead in Leads.",
  };
}

/** Reads the leads that use this number in this agency and decides. If they cannot be read nothing is sent: unknown is not "clear". */
export async function checkStartChatConsent(db: Db, input: { agencyId: string; mobile: string }): Promise<StartChatConsentVerdict> {
  const { data, error } = await db
    .from("leads")
    .select("consent_status, do_not_contact")
    .eq("agency_id", input.agencyId)
    .eq("mobile", input.mobile)
    .limit(20);
  if (error) {
    return { allowed: false, reason: "UNREADABLE", error: "Could not check whether this number has opted out of contact. Try again in a moment." };
  }
  return decideStartChatConsent((data ?? []) as LeadConsentRow[]);
}
