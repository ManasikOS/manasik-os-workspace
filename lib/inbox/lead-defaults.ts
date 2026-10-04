/**
 * What a lead created from a chat starts with, so that it behaves like a lead added on the Leads page instead of a
 * bare reference: the Leads page requires an owner and a next follow-up on every new lead, and its follow-up views
 * (Follow-up Today, Overdue) are driven by `next_follow_up_at`. A lead with no follow-up never surfaces there.
 *
 * Shared by the Inbox's canonical lead binding (lib/inbox/lead-linking.ts) and the assistant's lead capture
 * (lib/agent/whatsapp/lead-capture.ts) so both create the same thing.
 */

/** A new chat lead is due for a first human follow-up this long after it arrives. */
export const NEW_CHAT_LEAD_FOLLOW_UP_MINUTES = 60;

export interface ChatLeadOwner {
  id: string;
  name: string;
}

export function newChatLeadFollowUpFields(owner: ChatLeadOwner, now: Date = new Date()) {
  return {
    next_follow_up_at: new Date(now.getTime() + NEW_CHAT_LEAD_FOLLOW_UP_MINUTES * 60_000).toISOString(),
    follow_up_type: "WHATSAPP_MESSAGE" as const,
    follow_up_owner_id: owner.id,
    follow_up_owner_name: owner.name,
    preferred_language: "English",
    temperature: "WARM" as const,
  };
}

/** The activity rows the Leads page writes for a new lead: created, and follow-up scheduled. */
export function newChatLeadActivity(agencyId: string, leadId: string, createdMessage: string, actorName: string) {
  return [
    { agency_id: agencyId, lead_id: leadId, type: "CREATED", message: createdMessage, actor_name: actorName },
    { agency_id: agencyId, lead_id: leadId, type: "FOLLOW_UP_SCHEDULED", message: "Next follow-up scheduled.", actor_name: actorName },
  ];
}
