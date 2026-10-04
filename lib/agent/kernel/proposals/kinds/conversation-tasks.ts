/**
 * Task-shaped conversation conversions (MI4.6): document request, visa task, payment follow-up, rooming request, transport
 * requirement and guide escalation. Native v2, `module: "inbox"`, `subjectType: "CONVERSATION"`.
 *
 * Each creates exactly one row in `departure_group_tasks`, carrying `source_conversation_id` and `source_message_id`. It is a
 * single insert on purpose: the store mutator behind the task board cannot carry the source columns, and a task created and
 * then stamped in two steps could be left without its source. One statement means the object and its link exist together or
 * not at all. The task is unowned (`owner_name` empty, the board's own default) for the team to pick up.
 *
 * Nothing here contacts the customer, confirms anything or touches money.
 */

import type { Db } from "@/lib/agent/kernel/proposals/context-pack";
import type { ProposalExecutor } from "@/lib/agent/kernel/proposals/executor";
import { notifyWorkflowCreated } from "@/lib/data/staff-notifications";
import { loadConversationPack, type ConversationContextPack } from "@/lib/agent/kernel/proposals/conversation-pack";
import {
  ConversationConversionPayloadSchema,
  conversionBackLink,
  conversionFingerprint,
  verifyConversionTarget,
  type ConversationConversionPayload,
} from "@/lib/agent/kernel/proposals/kinds/conversation-shared";
import {
  CONVERSION_CATALOGUE,
  CONVERSION_TASK_DUE_HOURS,
  conversionTitle,
  type ConversionKind,
} from "@/lib/inbox/conversions/catalogue";

async function taskAssignee(db: Db, agencyId: string, departureGroupId: string, category: string, actor: { id: string | null; name: string }) {
  const { data, error } = await db.from("departure_groups")
    .select("operations_owner_id,operations_owner_name,visa_owner_id,visa_owner_name,finance_owner_id,finance_owner_name,primary_guide_id,primary_guide_name")
    .eq("agency_id", agencyId).eq("id", departureGroupId).maybeSingle();
  if (error) throw new Error(`Could not load the task owner: ${error.message}`);
  const row = (data ?? {}) as Record<string, string | null>;
  const prefix = category === "GUIDE" ? "primary_guide" : `${category.toLowerCase()}_owner`;
  return { id: row[`${prefix}_id`] ?? actor.id, name: row[`${prefix}_name`] ?? actor.name };
}

type TaskConversionKind = Extract<
  ConversionKind,
  | "CONVERSATION_DOCUMENT_REQUEST"
  | "CONVERSATION_VISA_TASK"
  | "CONVERSATION_PAYMENT_FOLLOW_UP"
  | "CONVERSATION_ROOMING_REQUEST"
  | "CONVERSATION_TRANSPORT_REQUIREMENT"
  | "CONVERSATION_GUIDE_ESCALATION"
>;

function taskConversionExecutor(kind: TaskConversionKind, risk: "LOW" | "MEDIUM"): ProposalExecutor<ConversationConversionPayload, ConversationContextPack> {
  const spec = CONVERSION_CATALOGUE[kind];
  return {
    kind,
    module: "inbox",
    subjectType: "CONVERSATION",
    schema: ConversationConversionPayloadSchema,
    requiredCapability: "convertConversation",
    risk,
    ttlHours: 24,
    loadPack: loadConversationPack,
    fingerprint: (payload) => conversionFingerprint(kind, payload),
    // The group the task lands on. If it changes between the preview and the approval, the proposal is superseded, not run.
    dependencySnapshot: (_payload, pack) => ({ departureGroupId: pack.facts.departureGroupId }),
    describe: (payload, pack) => ({
      humanDiff: [
        { field: "task", from: null, to: conversionTitle(kind, pack.facts.customerName, pack.facts.leadReference) },
        { field: "team", from: null, to: spec.taskCategory ?? "OPERATIONS" },
        { field: "departure group", from: null, to: pack.facts.departureGroupName ?? "Selected group" },
        ...(payload.note ? [{ field: "note", from: null, to: payload.note }] : []),
      ],
    }),
    execute: async (payload, ctx) => {
      const target = await verifyConversionTarget(kind, payload, ctx);
      if (!target.ok) return target;
      const { facts } = target;
      const assignee = await taskAssignee(ctx.db as Db, ctx.agencyId, facts.departureGroupId!, spec.taskCategory ?? "OPERATIONS", ctx.actor);

      const description = [payload.note, conversionBackLink(payload.conversationId)].filter(Boolean).join("\n\n");
      const { error } = await (ctx.db as Db).from("departure_group_tasks").insert({
        agency_id: ctx.agencyId,
        departure_group_id: facts.departureGroupId,
        title: conversionTitle(kind, facts.customerName, facts.leadReference),
        description,
        owner_id: assignee.id,
        owner_name: assignee.name,
        due_at: new Date(Date.now() + CONVERSION_TASK_DUE_HOURS * 3_600_000).toISOString(),
        status: "OPEN",
        category: spec.taskCategory ?? "OPERATIONS",
        source_conversation_id: payload.conversationId,
        source_message_id: payload.sourceMessageId,
      });
      if (error) return { ok: false, error: `Could not create the task: ${error.message}` };
      if (assignee.id) await notifyWorkflowCreated({ agencyId: ctx.agencyId, conversationId: payload.conversationId, kind: "WORKFLOW_CREATED", recipientIds: [assignee.id], title: conversionTitle(kind, facts.customerName, facts.leadReference) }, ctx.db as Db);
      return { ok: true };
    },
  };
}

export const conversationDocumentRequestExecutor = taskConversionExecutor("CONVERSATION_DOCUMENT_REQUEST", "LOW");
export const conversationVisaTaskExecutor = taskConversionExecutor("CONVERSATION_VISA_TASK", "LOW");
export const conversationPaymentFollowUpExecutor = taskConversionExecutor("CONVERSATION_PAYMENT_FOLLOW_UP", "MEDIUM");
export const conversationRoomingRequestExecutor = taskConversionExecutor("CONVERSATION_ROOMING_REQUEST", "LOW");
export const conversationTransportRequirementExecutor = taskConversionExecutor("CONVERSATION_TRANSPORT_REQUIREMENT", "LOW");
export const conversationGuideEscalationExecutor = taskConversionExecutor("CONVERSATION_GUIDE_ESCALATION", "MEDIUM");
