/**
 * Complaint case conversion (MI4.6). Native v2, `module: "inbox"`, `subjectType: "CONVERSATION"`.
 *
 * Opens one row in `pilgrim_support_requests` (the Support module's case table) for the traveller the customer's booking
 * lists, carrying the source conversation and message. It never closes or resolves a complaint (Architecture §10.3: a
 * complaint is closed by a person) and never replies to the customer. If the customer has no traveller record yet, the
 * conversion is refused with the reason, rather than attaching the case to the wrong person.
 */

import type { ProposalExecutor } from "@/lib/agent/kernel/proposals/executor";
import { listActiveStaffIdsByRole, notifyWorkflowCreated } from "@/lib/data/staff-notifications";
import { loadConversationPack, type ConversationContextPack } from "@/lib/agent/kernel/proposals/conversation-pack";
import {
  ConversationConversionPayloadSchema,
  conversionBackLink,
  conversionFingerprint,
  verifyConversionTarget,
  type ConversationConversionPayload,
} from "@/lib/agent/kernel/proposals/kinds/conversation-shared";
import { conversionTitle } from "@/lib/inbox/conversions/catalogue";

const KIND = "CONVERSATION_COMPLAINT_CASE";

export const conversationComplaintCaseExecutor: ProposalExecutor<ConversationConversionPayload, ConversationContextPack> = {
  kind: KIND,
  module: "inbox",
  subjectType: "CONVERSATION",
  schema: ConversationConversionPayloadSchema,
  requiredCapability: "convertConversation",
  // A complaint case is customer-visible work with a service clock; a person must see what it will say before it opens.
  risk: "MEDIUM",
  ttlHours: 24,
  loadPack: loadConversationPack,
  fingerprint: (payload) => conversionFingerprint(KIND, payload),
  // The traveller the case attaches to. A different traveller by approval time means a different person: supersede.
  dependencySnapshot: (_payload, pack) => ({ pilgrimId: pack.facts.pilgrimId, departureGroupId: pack.facts.departureGroupId }),
  describe: (payload, pack) => ({
    humanDiff: [
      { field: "support case", from: null, to: conversionTitle(KIND, pack.facts.customerName, pack.facts.leadReference) },
      { field: "category", from: null, to: "Complaint" },
      { field: "priority", from: null, to: "High" },
      ...(payload.note ? [{ field: "note", from: null, to: payload.note }] : []),
    ],
  }),
  execute: async (payload, ctx) => {
    const target = await verifyConversionTarget(KIND, payload, ctx);
    if (!target.ok) return target;
    const { facts } = target;

    const detail = [payload.note, conversionBackLink(payload.conversationId)].filter(Boolean).join("\n\n");
    const { data, error } = await ctx.db
      .from("pilgrim_support_requests")
      .insert({
        agency_id: ctx.agencyId,
        pilgrim_id: facts.pilgrimId,
        departure_group_id: facts.departureGroupId,
        title: conversionTitle(KIND, facts.customerName, facts.leadReference),
        detail,
        category: "COMPLAINT",
        priority: "HIGH",
        status: "OPEN",
        assigned_role: "OPERATIONS",
        raised_by_portal: false,
        sla_due_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
        source_conversation_id: payload.conversationId,
        source_message_id: payload.sourceMessageId,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: `Could not open the support case: ${error?.message ?? "no row returned"}` };

    // The case's timeline says where it came from. Best effort: the case itself already carries the source link.
    const timeline = await ctx.db.from("support_case_events").insert({
      agency_id: ctx.agencyId,
      support_request_id: (data as { id: string }).id,
      pilgrim_id: facts.pilgrimId,
      event_type: "COMMENT",
      message: "Opened from an Inbox conversation.",
      actor_name: ctx.actor.name,
    });
    if (timeline.error) console.error("Could not write the support case's opening note:", timeline.error.message);
    const recipients = await listActiveStaffIdsByRole(ctx.db, ctx.agencyId, ["OPERATIONS"]).catch((cause) => {
      console.error("Could not find staff to notify about the support case:", cause);
      return [];
    });
    await notifyWorkflowCreated({ agencyId: ctx.agencyId, conversationId: payload.conversationId, kind: "WORKFLOW_CREATED", recipientIds: recipients, title: conversionTitle(KIND, facts.customerName, facts.leadReference) }, ctx.db);
    return { ok: true };
  },
};
