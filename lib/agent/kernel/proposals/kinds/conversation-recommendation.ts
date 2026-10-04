/**
 * Package recommendation and post-trip feedback request (MI4.6). Native v2, `subjectType: "CONVERSATION"`.
 *
 * - Package recommendation (`leads.addNote`): one note on the customer's lead saying which package was recommended, with the
 *   source columns. It does NOT change the lead's chosen package: a recommendation is the salesperson's suggestion, not the
 *   customer's decision, and nothing is sent to the customer.
 * - Feedback request (`inbox.convertConversation`, like every other task-shaped conversion): a task on the customer's group to send a chosen survey. The app keeps
 *   survey TEMPLATES and submitted RESPONSES but no "pending request" record, so the honest object to create is a task for a
 *   person to send it; nothing is sent and no response is faked.
 *
 * Each checks the choice again at execution: the package or survey must belong to this agency and still be usable.
 */

import { z } from "zod";

import { loadConversationPack, type ConversationContextPack } from "@/lib/agent/kernel/proposals/conversation-pack";
import type { ProposalExecutor } from "@/lib/agent/kernel/proposals/executor";
import {
  ConversationConversionPayloadSchema,
  conversionBackLink,
  conversionFingerprint,
  sourceColumns,
  verifyConversionTarget,
} from "@/lib/agent/kernel/proposals/kinds/conversation-shared";
import { CONVERSION_TASK_DUE_HOURS, conversionTitle } from "@/lib/inbox/conversions/catalogue";
import { notifyWorkflowCreated } from "@/lib/data/staff-notifications";

/** The status that means a package is open for sale (`packages.status`). */
export const PACKAGE_OPEN_STATUS = "Open for Sale";

/* ── CONVERSATION_PACKAGE_RECOMMENDATION ──────────────────────────────────── */

const RECOMMENDATION = "CONVERSATION_PACKAGE_RECOMMENDATION";

export const PackageRecommendationPayloadSchema = ConversationConversionPayloadSchema.extend({ packageId: z.string().uuid() });
export type PackageRecommendationPayload = z.infer<typeof PackageRecommendationPayloadSchema>;

export const conversationPackageRecommendationExecutor: ProposalExecutor<PackageRecommendationPayload, ConversationContextPack> = {
  kind: RECOMMENDATION,
  module: "leads",
  subjectType: "CONVERSATION",
  schema: PackageRecommendationPayloadSchema,
  requiredCapability: "addNote",
  risk: "LOW",
  ttlHours: 24,
  loadPack: loadConversationPack,
  fingerprint: (payload) => conversionFingerprint(RECOMMENDATION, payload, payload.packageId),
  dependencySnapshot: (_payload, pack) => ({ leadId: pack.facts.leadId }),
  describe: (payload, pack) => ({
    humanDiff: [
      { field: "note on lead", from: null, to: `Recommended: ${payload.labels.packageId ?? "selected package"}` },
      { field: "lead", from: null, to: pack.facts.leadReference ?? pack.facts.leadFullName ?? "Linked lead" },
      { field: "changes the customer's choice", from: null, to: "No" },
      ...(payload.note ? [{ field: "note", from: null, to: payload.note }] : []),
    ],
  }),
  execute: async (payload, ctx) => {
    const target = await verifyConversionTarget(RECOMMENDATION, payload, ctx);
    if (!target.ok) return target;
    const { facts } = target;

    const { data: pkg, error: lookupError } = await ctx.db
      .from("packages")
      .select("title, internal_code, journey_type, status")
      .eq("agency_id", ctx.agencyId)
      .eq("id", payload.packageId)
      .maybeSingle();
    if (lookupError) return { ok: false, error: `Could not check the package: ${lookupError.message}` };
    const row = pkg as { title: string | null; internal_code: string | null; journey_type: string | null; status: string } | null;
    if (!row) return { ok: false, error: "That package could not be found." };
    if (row.status !== PACKAGE_OPEN_STATUS) return { ok: false, error: "That package is no longer open for sale." };

    const name = [row.title ?? "Package", row.internal_code ? `(${row.internal_code})` : ""].filter(Boolean).join(" ");
    const body = [`Recommended package: ${name}.`, payload.note, conversionBackLink(payload.conversationId)].filter(Boolean).join("\n\n");
    const { error } = await ctx.db.from("lead_notes").insert({
      agency_id: ctx.agencyId,
      lead_id: facts.leadId,
      body,
      author_name: ctx.actor.name,
      ...sourceColumns(payload),
    });
    if (error) return { ok: false, error: `Could not save the recommendation: ${error.message}` };
    return { ok: true };
  },
};

/* ── CONVERSATION_FEEDBACK_REQUEST ────────────────────────────────────────── */

const FEEDBACK = "CONVERSATION_FEEDBACK_REQUEST";

export const FeedbackRequestPayloadSchema = ConversationConversionPayloadSchema.extend({ surveyId: z.string().uuid() });
export type FeedbackRequestPayload = z.infer<typeof FeedbackRequestPayloadSchema>;

export const conversationFeedbackRequestExecutor: ProposalExecutor<FeedbackRequestPayload, ConversationContextPack> = {
  kind: FEEDBACK,
  module: "inbox",
  subjectType: "CONVERSATION",
  schema: FeedbackRequestPayloadSchema,
  // It only adds a task for a person to send the survey; the `relationships` module's own capability set is still a placeholder.
  requiredCapability: "convertConversation",
  risk: "LOW",
  ttlHours: 24,
  loadPack: loadConversationPack,
  fingerprint: (payload) => conversionFingerprint(FEEDBACK, payload, payload.surveyId),
  dependencySnapshot: (_payload, pack) => ({ departureGroupId: pack.facts.departureGroupId }),
  describe: (payload, pack) => ({
    humanDiff: [
      { field: "task", from: null, to: conversionTitle(FEEDBACK, pack.facts.customerName, pack.facts.leadReference) },
      { field: "survey", from: null, to: payload.labels.surveyId ?? "Selected survey" },
      { field: "team", from: null, to: "MARKETING" },
      { field: "departure group", from: null, to: pack.facts.departureGroupName ?? "Selected group" },
      ...(payload.note ? [{ field: "note", from: null, to: payload.note }] : []),
    ],
  }),
  execute: async (payload, ctx) => {
    const target = await verifyConversionTarget(FEEDBACK, payload, ctx);
    if (!target.ok) return target;
    const { facts } = target;

    const { data: survey, error: lookupError } = await ctx.db
      .from("surveys")
      .select("title, is_active")
      .eq("agency_id", ctx.agencyId)
      .eq("id", payload.surveyId)
      .maybeSingle();
    if (lookupError) return { ok: false, error: `Could not check the survey: ${lookupError.message}` };
    const row = survey as { title: string; is_active: boolean } | null;
    if (!row) return { ok: false, error: "That survey could not be found." };
    if (!row.is_active) return { ok: false, error: "That survey is switched off." };

    const description = [`Send the survey "${row.title}" to this customer after their trip.`, payload.note, conversionBackLink(payload.conversationId)].filter(Boolean).join("\n\n");
    const assignee = ctx.actor;
    const { error } = await ctx.db.from("departure_group_tasks").insert({
      agency_id: ctx.agencyId,
      departure_group_id: facts.departureGroupId,
      title: conversionTitle(FEEDBACK, facts.customerName, facts.leadReference),
      description,
      owner_id: assignee.id,
      owner_name: assignee.name,
      due_at: new Date(Date.now() + CONVERSION_TASK_DUE_HOURS * 3_600_000).toISOString(),
      status: "OPEN",
      category: "MARKETING",
      ...sourceColumns(payload),
    });
    if (error) return { ok: false, error: `Could not create the task: ${error.message}` };
    if (assignee.id) await notifyWorkflowCreated({ agencyId: ctx.agencyId, conversationId: payload.conversationId, kind: "WORKFLOW_CREATED", recipientIds: [assignee.id], title: conversionTitle(FEEDBACK, facts.customerName, facts.leadReference) }, ctx.db);
    return { ok: true };
  },
};
