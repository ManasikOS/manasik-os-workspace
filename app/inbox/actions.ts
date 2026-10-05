"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { capabilitiesForInbox } from "@/lib/access/inbox-access";
import { logEvent } from "@/lib/observability/log";
import { reportHandledError } from "@/lib/observability/report-error";
import { capabilitiesForDocuments } from "@/lib/access/documents-access";
import { capabilitiesFor } from "@/lib/access/departure-groups-access";
import { BULK_ACTION_LIMIT, SPAM_MARKED_EVENT_KIND, SPAM_RESTORED_EVENT_KIND, bulkResultSummary, planBulkAction, type BulkConversationInput } from "@/lib/inbox/bulk-actions";
import { parseSavedViewInput, SAVED_VIEW_LIMIT, savedViewsFromRows, type SavedView } from "@/lib/inbox/saved-views";
import { parsePassportDetails } from "@/lib/inbox/passport-fields";
import { canBeVisaOfficer } from "@/lib/inbox/visa-officer";
import { insertVisaEvent, updateVisaFields } from "@/lib/data/visa-repository";
import { dialableDigits } from "@/lib/inbox/new-chat-lead-match";
import { assignmentNotification, canTakeInboxConversations, OWNER_CHANGED_EVENT_KIND, ownerChangedEventData, planConversationAssignment } from "@/lib/inbox/assignment";
import { claimRefusalMessage, claimTemplateSend, attachTemplateConversation, recordTemplateFailed, recordTemplateSent } from "@/lib/inbox/template-send-claims";
import { decideReleaseToAi, decideReplyOnOwnedConversation, decideTakeControl, type OwnedConversationFacts } from "@/lib/inbox/ownership-guard";
import { decideStartOnExistingConversation, type ExistingConversationForStart } from "@/lib/inbox/start-conversation-guard";
import { insertReviewEvent } from "@/lib/data/documents-repository";
import { INBOX_ATTACHMENT_BUCKET } from "@/lib/inbox/media/handlers";
import { claimInboxAttachmentForPromotion, markInboxAttachmentPromoted, releaseInboxAttachmentClaim } from "@/lib/inbox/retention/promote-attachment";
import { checkPassportFileForPromotion, choosePassportChecklistItem, mayRemoveUnsubmittedCopy, passportDocumentPath, resolvePassportTraveller, type PassportChecklistItem } from "@/lib/inbox/retention/promote-passport-plan";
import { capabilitiesForOperations } from "@/lib/access/operations-access";
import { capabilitiesForLeads } from "@/lib/access/leads-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { createGroupBooking, submitGroupPilgrimDocument, updateGroupPilgrimRecord } from "@/lib/data/departure-groups";
import { markLeadBookedInStore, pricePerPerson, selectDepartureGroupInStore, setFollowUpInStore } from "@/lib/data/leads";
import { loadLeadStore, persistLeadStore, snapshotLeadStore } from "@/lib/data/leads-repository";
import type { FollowUpType } from "@/lib/types/leads";
import { requireUser } from "@/lib/dal";
import { sendApprovedTemplate } from "@/lib/whatsapp/send-template-message";
import { createAdminClient } from "@/utils/supabase/admin";
import { isInboxEmailMailboxReady } from "@/lib/inbox/email-mailbox-readiness";
import { createClient } from "@/utils/supabase/server";
import { processDueInboxOutbox } from "@/lib/inbox/outbox/drain";
import { isInboxWorkerActive } from "@/lib/inbox/worker/mode";
import { createStaffAttachmentUpload, verifyStagedAttachment } from "@/lib/inbox/attachments/staged-file";
import { prepareStaffAttachmentSchema, stagedAttachmentRefSchema, type StagedAttachmentRef } from "@/lib/inbox/attachments/staff-attachment";
import { getChannelProfile } from "@/lib/channels/profile";
import { hasChannelAdapter } from "@/lib/channels/registry";
import type { ChannelProvider } from "@/lib/inbox/contracts";
import { linkConversationToLead } from "@/lib/inbox/lead-linking";
import { deleteConversationPermanently } from "@/lib/inbox/delete-conversation";
import { deriveBookingFromLead } from "@/lib/inbox/conversation-booking";
import { loadReplyContextPack } from "@/lib/inbox/reply-context";
import { loadInboxReplyPack } from "@/lib/inbox/reply-pack-loader";
import { suggestConversationReply } from "@/lib/ai/surfaces/inbox/workflows";
import { checkConsent } from "@/lib/ai/trust/consent-gate";
import { waIdToMobile } from "@/lib/agent/whatsapp/phone";
import { loadCopilotKnowledgeContext } from "@/lib/copilot/sales/knowledge-context";
import { loadIntelligence } from "@/lib/data/conversation-intelligence-repository";
import { checkStoredOffer } from "@/lib/data/inbox-offer-repository";
import { canQuoteOffer, intentCodeSchema, OFFER_CHECK_MESSAGES, type MatchedOfferSnapshot, type OfferCheckState } from "@/lib/inbox/intelligence/contracts";
import { composeFollowUp, composeOfferReply } from "@/lib/inbox/intelligence/offer";
import { confirmIdentityLink, rejectIdentityLinks, unlinkIdentityLink } from "@/lib/data/identity-graph-repository";
import { acknowledgeIntervention, listInterventions, openIntervention, resolveIntervention } from "@/lib/data/conversation-intelligence-repository";
import { loadProtectionContext } from "@/lib/data/inbox-risk-repository";
import { canCloseIntervention } from "@/lib/inbox/risk/interventions";
import { evaluateProtection, refusalMessage } from "@/lib/inbox/risk/protection-gate";
import { outboundGateText } from "@/lib/inbox/risk/outbound-gate-text";
import { claimComposerPresence, releaseComposerPresence, syncConcurrentComposerSignal } from "@/lib/data/inbox-composer-presence-repository";
import { inboxHandoffAcknowledgementSchema, inboxInterventionDecisionSchema, inboxIdentityLinkRequestSchema, inboxConversationRequestSchema, inboxOfferMessageRequestSchema, inboxOfferRequestSchema, inboxStaffMessageSchema, inboxStaffCaptionSchema, inboxTemplateMessageSchema, inboxEntityIdSchema, inboxStartChatSchema, inboxComposeEmailSchema, inboxInternalNoteSchema, inboxAssignConversationSchema, inboxBulkUpdateSchema, inboxFollowUpRequestSchema, createSavedReplyInputSchema } from "@/lib/validations/inbox";
import type { InboxSavedReply } from "@/app/inbox/types";
import { saveQuoteDraftAction } from "@/app/(main)/leads/copilot-actions";
import { acknowledgeConversationHandoff, attachHandoffNarration, buildHandoffForConversation, createConversationHandoff, handoffNeedsNarration, loadConversationHandoff, type ConversationHandoffRecord } from "@/lib/data/conversation-handoff-repository";
import { listActiveStaffIdsByRole, notifyConversationWaiting, notifyWorkflowCreated } from "@/lib/data/staff-notifications";
import { narrateHandoffExpectations } from "@/lib/ai/surfaces/inbox/handoff-narrate";
import { stampConversationSource } from "@/lib/inbox/conversions/source-link";
import { resolveEntitlements } from "@/lib/billing/entitlements";
import { resolveInboxFeatureAvailability } from "@/lib/inbox/feature-availability";
import { meterAiConversation, utcMonthStart } from "@/lib/billing/meter";
import { resolveEffectiveAutonomy } from "@/lib/inbox/autonomy/level";
import type { AutonomyLevel } from "@/lib/inbox/intelligence/contracts";
import { classifyProposalReview } from "@/lib/inbox/autonomy/review";
import { rejectApprovedInboxAnswer } from "@/lib/inbox/answers/repository";
import { z } from "zod";
import { loadInboxMediaContext } from "@/lib/inbox/media/context";
import { reviewPassportCandidate } from "@/lib/inbox/media/passport";
import { translateInboxText } from "@/lib/ai/surfaces/inbox/translation";
import { canCopyReceiptToFinance, copyReceiptToFinanceSchema } from "@/lib/finance/finance-evidence";
import { createSupabaseFinanceEvidenceRepository } from "@/lib/data/finance-evidence-repository";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import { capabilitiesForFinance } from "@/lib/access/finance-access";

const passportMediaTravellerSelectionSchema = z.object({ attachmentId: z.string().uuid(), travellerId: z.string().uuid() });

/**
 * Every action here runs on the session client and re-checks
 * `capabilitiesForInbox(role)` — the same posture as every other module's
 * `actions.ts`. See §10.2 of docs/modules/whatsapp-ai-agent-implementation-plan.md.
 */
async function db() {
  return createClient(await cookies());
}

export type ActionResult = { ok: true } | { ok: false; error: string };

export type CopyReceiptToFinanceActionResult =
  | { ok: true; evidenceId: string; message: string }
  | { ok: false; error: string };

/** A database or provider error is logged for us and replaced by plain words for the browser — its text can name tables, columns and constraints. */
function inboxFailure(context: string, cause: unknown, publicMessage: string): { ok: false; error: string } {
  logEvent("error", "inbox.action_failed", { context, error: cause instanceof Error ? cause.message : String(cause) });
  reportHandledError(`inbox.${context}`, cause);
  return { ok: false, error: publicMessage };
}

/**
 * Retains one analysed receipt in Finance's private evidence intake. This is
 * deliberately not a payment command: it never records, verifies, allocates,
 * or reconciles money. All source and CRM links are re-derived from the one
 * attachment id inside the caller's agency.
 */
export async function copyReceiptToFinanceAction(input: unknown): Promise<CopyReceiptToFinanceActionResult> {
  const user = await requireUser();
  const parsed = copyReceiptToFinanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid receipt." };

  const { role, roleId, agencyId, staffId, name } = await getCurrentStaffRole();
  if (!agencyId) return { ok: false, error: "Your agency could not be identified." };

  try {
    // This privileged client is required by D1: CEO and an explicitly capable
    // assigned staff member may promote evidence even though direct Finance
    // table/Storage writes remain limited to ADMIN and FINANCE by RLS. The
    // action authenticates, authorises, and agency-scopes before every write.
    const repository = createSupabaseFinanceEvidenceRepository(createAdminClient());
    const source = await repository.loadReceiptSource(agencyId, parsed.data.attachmentId);
    if (!source) return { ok: false, error: "That receipt is unavailable or is not ready for Finance review." };
    const sessionDb = await db();
    const [inboxCapabilities, financeCapabilities] = await Promise.all([
      loadDynamicCapabilities(sessionDb, roleId, "inbox", capabilitiesForInbox(role)),
      loadDynamicCapabilities(sessionDb, roleId, "finance", capabilitiesForFinance(role)),
    ]);
    if (!canCopyReceiptToFinance({
      role,
      staffId,
      assignedToId: source.assignedToId,
      openFinanceReview: inboxCapabilities.viewModule && financeCapabilities.viewLedger,
    })) {
      return { ok: false, error: "You cannot copy this receipt to Finance." };
    }

    const evidence = await repository.copyReceiptEvidence({
      agencyId,
      attachmentId: parsed.data.attachmentId,
      actor: { id: user.id, name: name ?? "Staff", role },
      source,
    });
    revalidatePath("/inbox");
    revalidatePath("/finance/payments");
    return {
      ok: true,
      evidenceId: evidence.id,
      message: "Receipt copied for Finance review. No payment was created or verified.",
    };
  } catch (cause) {
    return inboxFailure("copyReceiptToFinance", cause, "Could not copy the receipt to Finance. Try again.");
  }
}

const inboxTranslationRequestSchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid().optional(),
  targetLanguage: z.enum(["English", "Sinhala", "Tamil"]).default("English"),
});

export type InboxTranslationActionResult =
  | { ok: true; translation: string; detectedLanguage: string; confidence: number; source: "RULES" | "LLM"; note: string | null }
  | { ok: false; error: string };

/** Translates one verified agency-scoped message, or the current stored digest, without persisting the translation. */
export async function translateInboxTextAction(input: unknown): Promise<InboxTranslationActionResult> {
  await requireUser();
  const parsed = inboxTranslationRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid message to translate." };
  const { role, agencyId } = await getCurrentStaffRole();
  if (!agencyId || !capabilitiesForInbox(role).viewModule) return { ok: false, error: "Your role cannot translate Inbox messages." };
  const supabase = await db();
  const text = parsed.data.messageId
    ? await supabase.from("conversation_messages").select("content").eq("agency_id", agencyId).eq("conversation_id", parsed.data.conversationId).eq("id", parsed.data.messageId).maybeSingle()
      .then(({ data, error }) => error || !data ? null : String(data.content ?? "").trim())
    : await supabase.from("conversation_intelligence").select("digest").eq("agency_id", agencyId).eq("conversation_id", parsed.data.conversationId).maybeSingle()
      .then(({ data, error }) => error || !data ? null : String(data.digest ?? "").trim());
  if (text === null) return { ok: false, error: "That Inbox content is no longer available." };
  if (!text) return { ok: false, error: "There is no text to translate yet." };
  const result = await translateInboxText({ agencyId, conversationId: parsed.data.conversationId, text, targetLanguage: parsed.data.targetLanguage, db: supabase });
  if (!result.value) return { ok: false, error: result.note ?? "Translation is unavailable. The original message is still available." };
  return { ok: true, ...result.value, source: result.source, note: result.note };
}

/** Staff selects the traveller for an ambiguous passport; only review metadata changes. Needs `reviewPassportFields`, like confirming the passport's details. */
export async function selectPassportMediaTravellerAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const parsed = passportMediaTravellerSelectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid traveller." };
  const { role, agencyId } = await getCurrentStaffRole();
  // Choosing the traveller reads the passport's details and opens a review, so it needs the same right as confirming those details.
  if (!agencyId || !capabilitiesForInbox(role).reviewPassportFields) return { ok: false, error: "Your role cannot review passports." };

  const admin = createAdminClient();
  const { data: analysis, error } = await admin
    .from("message_media_analyses")
    .select("id,message_id,kind,candidate_fields,candidate_traveller_ids,confidence")
    .eq("agency_id", agencyId)
    .eq("attachment_id", parsed.data.attachmentId)
    .maybeSingle();
  if (error || !analysis || analysis.kind !== "PASSPORT") return { ok: false, error: "Passport analysis not found." };

  const { data: message, error: messageError } = await admin
    .from("conversation_messages")
    .select("conversation_id")
    .eq("agency_id", agencyId)
    .eq("id", analysis.message_id)
    .maybeSingle();
  if (messageError || !message) return { ok: false, error: "The passport conversation could not be found." };

  try {
    const mediaContext = await loadInboxMediaContext(admin, { agencyId, conversationId: message.conversation_id });
    const allowedIds = new Set(Array.isArray(analysis.candidate_traveller_ids) ? analysis.candidate_traveller_ids : []);
    if (!allowedIds.has(parsed.data.travellerId) || !mediaContext.travellers.some((traveller) => traveller.id === parsed.data.travellerId)) {
      return { ok: false, error: "That traveller is not linked to this booking." };
    }
    const candidate = (analysis.candidate_fields ?? {}) as Record<string, unknown>;
    const review = reviewPassportCandidate({
      passportNumber: typeof candidate.passportNumber === "string" ? candidate.passportNumber : undefined,
      expiryDate: typeof candidate.expiryDate === "string" ? candidate.expiryDate : undefined,
      fullName: typeof candidate.fullName === "string" ? candidate.fullName : undefined,
      confidence: typeof analysis.confidence === "number" ? analysis.confidence : Number(analysis.confidence ?? 0),
    }, { ...mediaContext, selectedTravellerId: parsed.data.travellerId }, new Date());
    const intervention = review.reviewRequired
      ? await openIntervention(admin, agencyId, {
          conversationId: message.conversation_id,
          kind: "PASSPORT_EXPIRY",
          severity: "REVIEW",
          headline: "Passport requires review",
          guidance: "Review the original passport and the selected traveller. Confirm the name, passport number, expiry date, and validity for the departure before updating any traveller record.",
          requiredActionCode: "REQUEST_DOCUMENTS",
          assignedRole: "OPERATIONS",
        })
      : null;
    const { error: updateError } = await admin.from("message_media_analyses").update({
      selected_traveller_id: parsed.data.travellerId,
      review_fields: {
        fieldMismatches: review.fieldMismatches,
        expired: review.expired,
        insufficientValidityAtDeparture: review.insufficientValidityAtDeparture,
        departureDate: mediaContext.departureDate,
        passportValidityMonths: mediaContext.passportValidityMonths,
        travellerSelectionRequired: false,
        matchedTravellerId: review.matchedTravellerId,
      },
      uncertainty: [...review.uncertainFields, ...review.fieldMismatches],
      status: review.reviewRequired ? "REVIEW_REQUIRED" : "READY",
      intervention_id: intervention?.intervention.id ?? null,
    }).eq("agency_id", agencyId).eq("id", analysis.id);
    if (updateError) throw new Error(updateError.message);
  } catch (cause) {
    console.error("Could not select passport traveller:", cause);
    return { ok: false, error: "Could not update the passport review. Try again." };
  }
  revalidatePath("/inbox");
  return { ok: true };
}

/**
 * Finds the traveller a passport attachment belongs to, from the attachment id alone: the analysis must be a passport, the
 * traveller is the one staff chose (or the only candidate), and must be on the conversation's booking. Everything is read
 * on the server and scoped to the agency; the browser supplies nothing but the attachment id.
 */
async function resolvePassportPilgrim(
  admin: ReturnType<typeof createAdminClient>,
  agencyId: string,
  attachment: { id: string; message_id: string },
): Promise<{ ok: true; pilgrim: { id: string; departure_group_id: string } } | { ok: false; error: string }> {
  const { data: analysis, error: analysisError } = await admin
    .from("message_media_analyses")
    .select("kind,selected_traveller_id,candidate_traveller_ids")
    .eq("agency_id", agencyId)
    .eq("attachment_id", attachment.id)
    .maybeSingle();
  if (analysisError || !analysis || analysis.kind !== "PASSPORT") return { ok: false, error: "That file is not a passport." };

  const { data: message, error: messageError } = await admin
    .from("conversation_messages")
    .select("conversation_id")
    .eq("agency_id", agencyId)
    .eq("id", attachment.message_id)
    .maybeSingle();
  if (messageError || !message) return { ok: false, error: "The conversation for this passport could not be found." };

  const mediaContext = await loadInboxMediaContext(admin, { agencyId, conversationId: message.conversation_id });
  const traveller = resolvePassportTraveller({
    selectedTravellerId: (analysis.selected_traveller_id as string | null) ?? null,
    candidateTravellerIds: Array.isArray(analysis.candidate_traveller_ids) ? (analysis.candidate_traveller_ids as string[]) : [],
    bookingTravellerIds: mediaContext.travellers.map((item) => item.id),
  });
  if (!traveller.ok) return traveller;

  const { data: pilgrim, error: pilgrimError } = await admin
    .from("departure_group_pilgrims")
    .select("id,departure_group_id")
    .eq("agency_id", agencyId)
    .eq("id", traveller.travellerId)
    .maybeSingle();
  if (pilgrimError || !pilgrim) return { ok: false, error: "That traveller could not be found." };
  return { ok: true, pilgrim: { id: pilgrim.id as string, departure_group_id: pilgrim.departure_group_id as string } };
}

const savePassportToDocumentsSchema = z.object({ attachmentId: z.string().uuid() });

/**
 * Copies a passport a customer sent in chat into the traveller's document checklist, so it is kept with the booking
 * instead of expiring with the Inbox copy. The file lands as "submitted" and still needs the normal Documents
 * verification: saving is never verifying. Everything is re-derived on the server from the attachment id alone.
 */
export async function savePassportToDocumentsAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = savePassportToDocumentsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid passport." };
  const { role, agencyId, name } = await getCurrentStaffRole();
  const inboxCan = capabilitiesForInbox(role);
  if (!agencyId || !inboxCan.saveAttachmentToDocuments) return { ok: false, error: "Your role cannot save passports to Documents." };

  const admin = createAdminClient();
  const { data: attachment, error: attachmentError } = await admin
    .from("message_attachments")
    .select("id,message_id,storage_path,mime_type,promoted_document_id")
    .eq("agency_id", agencyId)
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();
  if (attachmentError || !attachment) return { ok: false, error: "That attachment could not be found." };
  // Repeat clicks and retries are safe: once saved, it stays saved.
  if (attachment.promoted_document_id) return { ok: true };
  if (!attachment.storage_path) return { ok: false, error: "The Inbox copy of this file is no longer available." };

  try {
    const subject = await resolvePassportPilgrim(admin, agencyId, { id: attachment.id as string, message_id: attachment.message_id as string });
    if (!subject.ok) return subject;
    const pilgrim = subject.pilgrim;

    // Same rule as Documents' own upload: the role must be allowed to upload for travellers and to see their sensitive data.
    if (!capabilitiesFor(role).viewSensitiveTravellerData || !capabilitiesForDocuments(role).uploadOnBehalf) {
      return { ok: false, error: "Your role cannot save traveller documents." };
    }

    const { data: checklist, error: checklistError } = await admin
      .from("departure_group_pilgrim_documents")
      .select("id,status,document_type")
      .eq("pilgrim_id", pilgrim.id);
    if (checklistError) throw new Error(checklistError.message);
    const target = choosePassportChecklistItem(
      ((checklist ?? []) as Array<{ id: string; status: PassportChecklistItem["status"]; document_type: string }>).map((row) => ({ id: row.id, status: row.status, documentType: row.document_type })),
    );
    if (!target.ok) return target;

    // One save at a time per attachment: a double click or a second tab loses here instead of racing the copy below.
    const claim = { agencyId, attachmentId: attachment.id as string, documentId: target.item.id };
    if (!(await claimInboxAttachmentForPromotion(admin, claim))) {
      return { ok: false, error: "This passport is already being saved. Check Documents in a moment." };
    }
    let submittedToDocuments = false;
    try {
      const download = await admin.storage.from(INBOX_ATTACHMENT_BUCKET).download(attachment.storage_path as string);
      if (download.error || !download.data) return { ok: false, error: "The Inbox copy of this file could not be read." };
      const bytes = new Uint8Array(await download.data.arrayBuffer());
      const file = checkPassportFileForPromotion({ mimeType: String(attachment.mime_type), sizeBytes: bytes.byteLength });
      if (!file.ok) return file;

      const destination = passportDocumentPath({
        agencyId,
        departureGroupId: pilgrim.departure_group_id as string,
        pilgrimId: pilgrim.id as string,
        documentId: target.item.id,
        extension: file.extension,
      });
      const upload = await admin.storage.from("pilgrim-documents").upload(destination.path, bytes, { contentType: String(attachment.mime_type), upsert: true });
      if (upload.error) throw new Error(upload.error.message);

      const submitted = await submitGroupPilgrimDocument({
        documentId: target.item.id,
        departureGroupId: pilgrim.departure_group_id as string,
        filePath: destination.path,
        fileName: destination.fileName,
        fileSizeBytes: bytes.byteLength,
        notes: "Saved from an Inbox conversation.",
      });
      if (!submitted.ok) {
        // Remove the copy only if nothing points at it: the path is the checklist item's, so another save to the same item may own this very file.
        const { data: itemNow, error: itemReadError } = await admin.from("departure_group_pilgrim_documents").select("file_path").eq("id", target.item.id).maybeSingle();
        if (mayRemoveUnsubmittedCopy({ readFailed: Boolean(itemReadError), itemFilePath: (itemNow?.file_path as string | null | undefined) ?? null, destinationPath: destination.path })) {
          await admin.storage.from("pilgrim-documents").remove([destination.path]);
        }
        return { ok: false, error: submitted.error };
      }
      submittedToDocuments = true;

      await insertReviewEvent(await db(), {
        document_id: target.item.id,
        actor_id: user.id,
        actor_name: name ?? "Staff",
        actor_role: role,
        action: "UPLOADED",
        from_status: target.item.status,
        to_status: "SUBMITTED",
        reason_code: null,
        note: "Saved from an Inbox conversation.",
        overrode_ai_analysis_id: null,
        override_reason: null,
      });

      try {
        await markInboxAttachmentPromoted(admin, { agencyId, attachmentId: attachment.id as string, documentId: target.item.id });
      } catch (cause) {
        // The passport IS in Documents; only the Inbox's "saved" marker is missing. A retry finishes it without a second copy.
        console.error("Passport saved to Documents but the Inbox marker failed:", cause);
      }
    } finally {
      // A save that did not reach Documents gives the attachment back, so it can be saved again and the retention sweep sees it as unsaved.
      if (!submittedToDocuments) await releaseInboxAttachmentClaim(admin, claim);
    }
  } catch (cause) {
    return inboxFailure("savePassportToDocuments", cause, "Could not save the passport to Documents. Try again.");
  }

  revalidatePath("/inbox");
  revalidatePath("/documents");
  return { ok: true };
}

const applyPassportDetailsSchema = z.object({ attachmentId: z.string().uuid(), passportNumber: z.string().max(40), expiryDate: z.string().max(20) }).strict();

/**
 * Writes the passport number and expiry a person has just confirmed to the traveller's record, so the six-month validity check
 * runs on real values. The traveller is found from the passport on the server; the values are re-checked here; and the record's
 * own updater applies its rules (an expiry before departure is refused) and keeps its own history. Nothing the model read is
 * saved without this confirmation.
 */
export async function applyPassportDetailsAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const parsed = applyPassportDetailsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the passport details." };
  const { role, agencyId } = await getCurrentStaffRole();
  if (!agencyId || !capabilitiesForInbox(role).reviewPassportFields) return { ok: false, error: "Your role cannot edit traveller records." };

  const details = parsePassportDetails({ passportNumber: parsed.data.passportNumber, expiryDate: parsed.data.expiryDate });
  if (!details.ok) return details;

  const admin = createAdminClient();
  const { data: attachment, error: attachmentError } = await admin
    .from("message_attachments")
    .select("id,message_id")
    .eq("agency_id", agencyId)
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();
  if (attachmentError || !attachment) return { ok: false, error: "That attachment could not be found." };

  try {
    const subject = await resolvePassportPilgrim(admin, agencyId, { id: attachment.id as string, message_id: attachment.message_id as string });
    if (!subject.ok) return subject;
    const outcome = await updateGroupPilgrimRecord({
      id: subject.pilgrim.id,
      departureGroupId: subject.pilgrim.departure_group_id,
      passportNumber: details.passportNumber,
      passportExpiry: details.passportExpiry,
    });
    if (!outcome.ok) return { ok: false, error: outcome.error };
  } catch (cause) {
    return inboxFailure("applyPassportDetails", cause, "Could not update the traveller's passport details. Try again.");
  }

  revalidatePath("/departure-groups");
  return { ok: true };
}

export type LoadVisaOfficersResult =
  | { ok: true; officers: Array<{ id: string; name: string }> }
  | { ok: false; error: string };

/** The colleagues a passport can be given to: active staff of this agency whose role does visa work. Read when the picker opens. */
export async function loadVisaOfficersAction(): Promise<LoadVisaOfficersResult> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!agencyId || !capabilitiesForInbox(role).assignVisaOfficer) return { ok: false, error: "Your role cannot assign visa officers." };

  const supabase = await db();
  const { data, error } = await supabase
    .from("staff_profiles")
    .select("id, full_name, role, status")
    .eq("agency_id", agencyId)
    .eq("status", "ACTIVE")
    .order("full_name")
    .limit(100);
  if (error) return inboxFailure("loadVisaOfficers", error, "Could not load the visa officers.");
  return {
    ok: true,
    officers: ((data ?? []) as Array<{ id: string; full_name: string | null; role: string | null; status: string | null }>)
      .filter((profile) => canBeVisaOfficer(profile))
      .map((profile) => ({ id: profile.id, name: profile.full_name || "Staff" })),
  };
}

const assignVisaOfficerSchema = z.object({ attachmentId: z.string().uuid(), officerId: z.string().uuid().nullable() }).strict();

/**
 * Gives the traveller's visa file, found from the passport they sent, to a visa officer (or takes the officer off it).
 * Uses the visa module's own fields and history, so the assignment shows in Visa exactly as one made there. The traveller
 * and the officer are both re-derived and checked on the server; the browser only names the passport and the person.
 */
export async function assignVisaOfficerForPassportAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = assignVisaOfficerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid passport and officer." };
  const { role, agencyId, name: actorName } = await getCurrentStaffRole();
  if (!agencyId || !capabilitiesForInbox(role).assignVisaOfficer) return { ok: false, error: "Your role cannot assign visa officers." };

  const admin = createAdminClient();
  const { data: attachment, error: attachmentError } = await admin
    .from("message_attachments")
    .select("id,message_id")
    .eq("agency_id", agencyId)
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();
  if (attachmentError || !attachment) return { ok: false, error: "That attachment could not be found." };

  try {
    const subject = await resolvePassportPilgrim(admin, agencyId, { id: attachment.id as string, message_id: attachment.message_id as string });
    if (!subject.ok) return subject;

    let officer: { id: string; name: string } | null = null;
    if (parsed.data.officerId) {
      const { data: profile, error: profileError } = await admin
        .from("staff_profiles")
        .select("id, full_name, role, status")
        .eq("agency_id", agencyId)
        .eq("id", parsed.data.officerId)
        .maybeSingle();
      if (profileError || !profile || !canBeVisaOfficer(profile)) return { ok: false, error: "That person cannot take visa files." };
      officer = { id: profile.id as string, name: (profile.full_name as string) || "Staff" };
    }

    const supabase = await db();
    await updateVisaFields(supabase, subject.pilgrim.id, {
      visa_assigned_to: officer?.id ?? null,
      visa_assigned_to_name: officer?.name ?? null,
      visa_assigned_at: officer ? new Date().toISOString() : null,
    });
    await insertVisaEvent(supabase, {
      journey_id: subject.pilgrim.id,
      departure_group_id: subject.pilgrim.departure_group_id,
      batch_id: null,
      actor_id: user.id,
      actor_name: actorName ?? "Staff",
      actor_role: role,
      action: "ASSIGNED",
      from_status: null,
      to_status: null,
      issue_type: null,
      note: officer ? `${officer.name} (from an Inbox conversation)` : "Unassigned (from an Inbox conversation)",
      evidence_path: null,
    });
  } catch (cause) {
    return inboxFailure("assignVisaOfficerForPassport", cause, "Could not assign the visa officer. Try again.");
  }

  revalidatePath("/visa");
  return { ok: true };
}

export type BulkUpdateResult =
  | { ok: true; changed: number; skipped: number; summary: string }
  | { ok: false; error: string };

/**
 * Closes, changes the owner of, or marks as spam (and restores from spam) several conversations in one step. Each conversation is read and checked on the server
 * (this agency's, and eligible: closed chats are never assigned), the new owner is validated once, and only the conversations
 * the plan marks as changed are written. The result says how many changed and how many were left alone.
 */
export async function bulkUpdateConversationsAction(input: unknown): Promise<BulkUpdateResult> {
  const user = await requireUser();
  const parsed = inboxBulkUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Choose between 1 and ${BULK_ACTION_LIMIT} conversations.` };
  const { role, agencyId, name: actorName } = await getCurrentStaffRole();
  const can = capabilitiesForInbox(role);
  const { action } = parsed.data;
  // Marking and restoring spam need the same permission as closing: both take a chat out of the working lists.
  if (!agencyId || (action.kind === "ASSIGN" ? !can.assignConversation : !can.closeConversation)) return { ok: false, error: "Not permitted." };
  const isSpamChange = action.kind === "MARK_SPAM" || action.kind === "UNMARK_SPAM";

  const ids = [...new Set(parsed.data.conversationIds)];
  const supabase = await db();
  const { data: rows, error: readError } = await supabase
    .from("conversations")
    .select("id, state, assigned_to_id, assigned_to_name, contact_name, lifecycle_status, lead_id")
    .eq("agency_id", agencyId)
    .in("id", ids);
  if (readError) return inboxFailure("bulkUpdateConversations", readError, "Could not read the conversations.");
  const found = (rows ?? []) as Array<{ id: string; state: BulkConversationInput["state"]; assigned_to_id: string | null; assigned_to_name: string | null; contact_name: string | null; lifecycle_status: BulkConversationInput["lifecycleStatus"]; lead_id: string | null }>;
  if (found.length === 0) return { ok: false, error: "Those conversations could not be found." };
  // A spam change fails closed: if any selected conversation is not this agency's, nothing at all is changed.
  if (isSpamChange && found.length !== ids.length) {
    return { ok: false, error: "Some of those conversations could not be found, so nothing was changed." };
  }

  // The facts a spam change must check first: a booking on the lead, an open review, and the lead's own spam stage.
  const spamFacts = new Map<string, { leadIsSpam: boolean; hasBooking: boolean; hasOpenReview: boolean }>();
  if (isSpamChange) {
    const leadIds = [...new Set(found.map((row) => row.lead_id).filter((id): id is string => id !== null))];
    const [leadRead, reviewRead] = await Promise.all([
      leadIds.length > 0
        ? supabase.from("leads").select("id, stage, booking_id").eq("agency_id", agencyId).in("id", leadIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("conversation_interventions").select("conversation_id").eq("agency_id", agencyId).in("conversation_id", ids).in("status", ["OPEN", "ACKNOWLEDGED"]),
    ]);
    if (leadRead.error || reviewRead.error) {
      return inboxFailure("bulkUpdateConversations", leadRead.error ?? reviewRead.error, "Could not check the conversations, so nothing was changed.");
    }
    const leadById = new Map(((leadRead.data ?? []) as Array<{ id: string; stage: string; booking_id: string | null }>).map((lead) => [lead.id, lead]));
    const withReview = new Set(((reviewRead.data ?? []) as Array<{ conversation_id: string }>).map((review) => review.conversation_id));
    for (const row of found) {
      const lead = row.lead_id ? leadById.get(row.lead_id) : undefined;
      spamFacts.set(row.id, { leadIsSpam: lead?.stage === "SPAM", hasBooking: Boolean(lead?.booking_id), hasOpenReview: withReview.has(row.id) });
    }
  }

  let target: { id: string; name: string } | null = null;
  if (action.kind === "ASSIGN" && action.assigneeId) {
    const { data: profile, error: profileError } = await supabase
      .from("staff_profiles")
      .select("id, full_name, role, status")
      .eq("agency_id", agencyId)
      .eq("id", action.assigneeId)
      .maybeSingle();
    if (profileError || !profile || !canTakeInboxConversations(profile)) return { ok: false, error: "That person cannot take Inbox conversations." };
    target = { id: profile.id as string, name: (profile.full_name as string) || "Staff" };
  }

  const plan = planBulkAction(
    action.kind === "ASSIGN" ? { kind: "ASSIGN", target } : { kind: action.kind },
    found.map((row) => ({
      id: row.id,
      state: row.state,
      assignedToId: row.assigned_to_id,
      ...(isSpamChange ? { lifecycleStatus: row.lifecycle_status ?? (row.state === "CLOSED" ? "CLOSED" : "OPEN"), ...spamFacts.get(row.id) } : {}),
    })),
  );
  // Ids the read did not return (not this agency's, or gone) are left alone too, so the counts add up to what was asked.
  const missing = ids.length - found.length;

  // Compare-and-swap on the state/owner the read above found for each row: a concurrent change (another staff
  // member's assign, a different bulk action, the customer replying) between that read and this write must not
  // be silently overwritten by a decision made against stale data.
  const previousById = new Map(found.map((row) => [row.id, row]));
  let failed = 0;
  let conflicted = 0;
  const written: string[] = [];
  for (const item of plan.changed) {
    const previousRow = previousById.get(item.id);
    let guardedUpdate = supabase
      .from("conversations")
      .update(item.patch)
      .eq("agency_id", agencyId)
      .eq("id", item.id)
      .eq("state", previousRow?.state ?? item.patch.state ?? "");
    if (action.kind === "ASSIGN") {
      const previousAssigneeId = previousRow?.assigned_to_id ?? null;
      guardedUpdate = previousAssigneeId === null ? guardedUpdate.is("assigned_to_id", null) : guardedUpdate.eq("assigned_to_id", previousAssigneeId);
    }
    if (isSpamChange) {
      // Guard on the lifecycle the plan was made against, so a concurrent change is never silently overwritten.
      const previousLifecycle = previousRow?.lifecycle_status ?? null;
      guardedUpdate = previousLifecycle === null ? guardedUpdate.is("lifecycle_status", null) : guardedUpdate.eq("lifecycle_status", previousLifecycle);
    }
    const { data: updatedRows, error } = await guardedUpdate.select("id");
    if (error) {
      failed += 1;
      console.error("Bulk update failed for one conversation:", error.message);
    } else if (!updatedRows || updatedRows.length === 0) {
      conflicted += 1;
    } else {
      written.push(item.id);
    }
  }

  // Best effort, like a single assignment: an audit row per changed chat, and one notice to the new owner.
  if (action.kind === "ASSIGN" && written.length > 0) {
    try {
      const admin = createAdminClient();
      await admin.from("conversation_events").insert(
        written.map((id) => ({
          agency_id: agencyId,
          conversation_id: id,
          kind: OWNER_CHANGED_EVENT_KIND,
          actor_kind: "STAFF",
          actor_id: user.id,
          data: ownerChangedEventData({
            from: { id: previousById.get(id)?.assigned_to_id ?? null, name: previousById.get(id)?.assigned_to_name ?? null },
            to: { id: target?.id ?? null, name: target?.name ?? null },
            actorName: actorName ?? null,
          }),
        })),
      );
      if (target && target.id !== user.id) {
        await notifyWorkflowCreated(
          { agencyId, conversationId: written[0], kind: "WORKFLOW_CREATED", recipientIds: [target.id], title: `${actorName?.trim() || "A colleague"} gave you ${written.length} conversation${written.length === 1 ? "" : "s"}` },
          admin,
        );
      }
    } catch (cause) {
      console.error("Bulk owner change follow-up failed:", cause instanceof Error ? cause.message : cause);
    }
  }

  // Best effort, like an owner change: one audit event per conversation whose spam state changed.
  if (isSpamChange && written.length > 0) {
    try {
      const kind = action.kind === "MARK_SPAM" ? SPAM_MARKED_EVENT_KIND : SPAM_RESTORED_EVENT_KIND;
      await createAdminClient().from("conversation_events").insert(
        written.map((id) => ({
          agency_id: agencyId,
          conversation_id: id,
          kind,
          actor_kind: "STAFF",
          actor_id: user.id,
          data: { actorName: actorName ?? null, to: plan.changed.find((item) => item.id === id)?.patch.lifecycle_status ?? null },
        })),
      );
    } catch (cause) {
      console.error("Bulk spam change audit failed:", cause instanceof Error ? cause.message : cause);
    }
  }

  revalidatePath("/inbox");
  const skipped = plan.skipped.length + missing + failed + conflicted;
  return { ok: true, changed: written.length, skipped, summary: bulkResultSummary({ action: action.kind, changed: written.length, skipped }) };
}

export type SavedViewsResult = { ok: true; views: SavedView[] } | { ok: false; error: string };

/** The person's own saved views, oldest first. Row security already limits the table to their rows; the filters say it again. */
export async function listSavedViewsAction(): Promise<SavedViewsResult> {
  await requireUser();
  const { role, agencyId, staffId } = await getCurrentStaffRole();
  if (!agencyId || !staffId || !capabilitiesForInbox(role).viewModule) return { ok: false, error: "Not permitted." };
  const supabase = await db();
  const { data, error } = await supabase
    .from("inbox_saved_views")
    .select("id, name, view, search")
    .eq("agency_id", agencyId)
    .eq("staff_id", staffId)
    .order("created_at", { ascending: true })
    .limit(SAVED_VIEW_LIMIT);
  if (error) return inboxFailure("listSavedViews", error, "Saved views are not available right now.");
  return { ok: true, views: savedViewsFromRows((data ?? []) as Array<{ id: string; name: string; view: string; search: string | null }>) };
}

const saveViewSchema = z.object({ name: z.string().max(200), view: z.string().max(60), search: z.string().max(200).nullable().optional() }).strict();

/** Saves the queue and search the person is looking at under a name of their choosing. At most SAVED_VIEW_LIMIT each. */
export async function saveViewAction(input: unknown): Promise<SavedViewsResult> {
  await requireUser();
  const shape = saveViewSchema.safeParse(input);
  if (!shape.success) return { ok: false, error: "Check the name and try again." };
  const parsed = parseSavedViewInput(shape.data);
  if (!parsed.ok) return parsed;
  const { role, agencyId, staffId } = await getCurrentStaffRole();
  if (!agencyId || !staffId || !capabilitiesForInbox(role).viewModule) return { ok: false, error: "Not permitted." };

  const supabase = await db();
  const { count, error: countError } = await supabase
    .from("inbox_saved_views")
    .select("id", { count: "exact", head: true })
    .eq("agency_id", agencyId)
    .eq("staff_id", staffId);
  if (countError) return inboxFailure("saveView", countError, "Saved views are not available right now.");
  if ((count ?? 0) >= SAVED_VIEW_LIMIT) return { ok: false, error: `You can keep ${SAVED_VIEW_LIMIT} saved views. Remove one first.` };

  const { error } = await supabase.from("inbox_saved_views").insert({ agency_id: agencyId, staff_id: staffId, name: parsed.name, view: parsed.view, search: parsed.search });
  if (error) {
    // The unique (person, name) constraint: saving the same name twice is a plain mistake, not a failure worth logging.
    if (error.code === "23505") return { ok: false, error: "You already have a saved view with that name." };
    return inboxFailure("saveView", error, "Could not save this view.");
  }
  return listSavedViewsAction();
}

/** Removes one of the person's own saved views. The id must be theirs; anything else changes nothing. */
export async function deleteSavedViewAction(input: unknown): Promise<SavedViewsResult> {
  await requireUser();
  const parsed = z.object({ id: z.string().uuid() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a saved view to remove." };
  const { role, agencyId, staffId } = await getCurrentStaffRole();
  if (!agencyId || !staffId || !capabilitiesForInbox(role).viewModule) return { ok: false, error: "Not permitted." };
  const supabase = await db();
  const { error } = await supabase.from("inbox_saved_views").delete().eq("agency_id", agencyId).eq("staff_id", staffId).eq("id", parsed.data.id);
  if (error) return inboxFailure("deleteSavedView", error, "Could not remove this view.");
  return listSavedViewsAction();
}

export type CreateConversationHandoffResult =
  | { ok: true; handoff: ConversationHandoffRecord; created: boolean }
  | { ok: false; error: string };

/**
 * Creates the Operations handoff from a confirmed booking's live facts — once per booking. A repeat click returns the
 * stored handoff without another model call; if its narration was unavailable the first time (surface off, model down),
 * the repeat click tries again and fills in the prose while nobody has acknowledged it.
 */
export async function createConversationHandoffAction(input: unknown): Promise<CreateConversationHandoffResult> {
  const user = await requireUser();
  const parsed = inboxConversationRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That conversation could not be found." };
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).sendMessage || !agencyId) return { ok: false, error: "Not permitted to hand this booking to Operations." };
  try {
    const supabase = await db();
    const built = await buildHandoffForConversation(supabase, agencyId, parsed.data.conversationId);
    if (!built) return { ok: false, error: "A confirmed booking linked to this conversation is required before handoff." };

    const stored = await loadConversationHandoff(supabase, agencyId, parsed.data.conversationId);
    const sameBooking = stored && stored.bookingId === built.bookingId ? stored : null;
    if (sameBooking && !handoffNeedsNarration(sameBooking)) return { ok: true, handoff: sameBooking, created: false };

    const narration = await narrateHandoffExpectations({
      agencyId,
      conversationId: parsed.data.conversationId,
      customerMessages: built.customerMessages,
      facts: built.handoff,
      db: supabase,
    });
    const customerExpectations = narration.value
      ? { items: narration.value.expectations, source: narration.source, confidence: narration.value.confidence, note: narration.note }
      : { items: [], source: narration.source, note: narration.note };
    const sentiment = narration.value?.sentiment ?? null;

    if (sameBooking) {
      // Already handed over, but without its prose: add it now if the narration worked this time.
      if (!narration.value) return { ok: true, handoff: sameBooking, created: false };
      const filled = await attachHandoffNarration(createAdminClient(), { agencyId, handoffId: sameBooking.id, customerExpectations, sentiment });
      revalidatePath("/operations");
      return { ok: true, handoff: filled ?? sameBooking, created: false };
    }

    const { record, created } = await createConversationHandoff(supabase, {
      agencyId,
      conversationId: parsed.data.conversationId,
      bookingId: built.bookingId,
      createdBy: user.id,
      handoff: built.handoff,
      customerExpectations,
      sentiment,
    });
    if (created) await notifyOperationsOfHandoff(agencyId, parsed.data.conversationId, record, user.id);
    revalidatePath("/operations");
    return { ok: true, handoff: record, created };
  } catch (cause) {
    console.error("Could not create Operations handoff:", cause);
    return { ok: false, error: "Could not create the Operations handoff. Try again." };
  }
}

/** Tells Operations (and admins) a booking is waiting for them. Best effort: a failed notification never undoes the handoff. */
async function notifyOperationsOfHandoff(agencyId: string, conversationId: string, handoff: ConversationHandoffRecord, actorId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const recipients = (await listActiveStaffIdsByRole(admin, agencyId, ["OPERATIONS", "ADMIN"])).filter((id) => id !== actorId);
    const customer = (handoff.summary.customer as { name?: string } | undefined)?.name ?? "A customer";
    const reference = (handoff.summary.booking as { reference?: string } | undefined)?.reference ?? "a booking";
    await notifyConversationWaiting({ agencyId, conversationId, kind: "HANDOFF_ESCALATED", recipientIds: recipients, title: `Sales handoff: ${customer} · ${reference} is ready for Operations` }, admin);
  } catch (cause) {
    console.error("Could not notify Operations of the handoff:", cause instanceof Error ? cause.message : cause);
  }
}

/** Operations acknowledges the stored handoff with the authenticated actor. */
export async function acknowledgeConversationHandoffAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const parsed = inboxHandoffAcknowledgementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That handoff could not be found." };
  const { role, agencyId, staffId } = await getCurrentStaffRole();
  if (!agencyId || !staffId || !capabilitiesForOperations(role).acknowledgeInboxHandoff) return { ok: false, error: "Only Operations or an administrator can acknowledge this handoff." };
  try {
    await acknowledgeConversationHandoff(await db(), agencyId, parsed.data.handoffId, staffId);
    revalidatePath("/operations");
    return { ok: true };
  } catch (cause) {
    console.error("Could not acknowledge Operations handoff:", cause);
    return { ok: false, error: "Could not acknowledge this handoff. Try again." };
  }
}
export type StartChatResult = { ok: true; conversationId: string } | { ok: false; error: string };

/** Repairs a legacy/unmatched Inbox conversation through the same canonical
 * resolver used by channel webhooks. It is intentionally explicit for staff
 * and records a minimal lead only when the caller has lead-create access. */
export async function captureConversationLead(rawConversationId: string): Promise<ActionResult> {
  await requireUser();
  const idCheck = inboxEntityIdSchema.safeParse(rawConversationId);
  if (!idCheck.success) return { ok: false, error: "Conversation not found." };
  const conversationId = idCheck.data;
  const { role, agencyId, staffId, name } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).sendMessage || !capabilitiesForLeads(role).createLead || !agencyId || !staffId) {
    return { ok: false, error: "Not permitted to link or create leads." };
  }

  const supabase = await db();
  const { data: conversation, error } = await supabase
    .from("conversations")
    .select("id, channel, external_conversation_id, contact_name, contact_phone")
    .eq("id", conversationId)
    .maybeSingle();
  if (error || !conversation) return { ok: false, error: "Conversation not found." };

  const provider = conversation.channel as "WHATSAPP" | "INSTAGRAM" | "MESSENGER" | "GMAIL" | "WEB_CHAT" | "SMS" | "OTHER";
  const externalSubjectId = (conversation.external_conversation_id as string | null) ?? (conversation.contact_phone as string | null);
  if (!externalSubjectId) return { ok: false, error: "This conversation has no contact identity to link." };

  try {
    const result = await linkConversationToLead(createAdminClient(), {
      agencyId,
      conversationId,
      provider,
      externalSubjectId,
      displayName: conversation.contact_name as string | null,
      normalizedPhone: provider === "WHATSAPP" ? waIdToMobile(externalSubjectId) : null,
      createIfMissing: true,
      owner: { id: staffId, name: name ?? "Staff" },
    });
    if (result.source === "PROPOSED") return { ok: false, error: "This contact may already be a lead. Open the conversation and choose Link conversation or Create separate lead." };
    if (!result.lead) return { ok: false, error: "Multiple leads use this contact number. Link the correct lead from Leads." };
    // A lead this button just created points back at the conversation it came from (MI4.6). An existing lead keeps its own origin.
    if (result.source === "CREATED") {
      await stampConversationSource(createAdminClient(), { agencyId, table: "leads", by: { column: "id", value: result.lead.id }, conversationId });
    }
  } catch (cause) {
    return inboxFailure("captureConversationLead", cause, "Could not link the lead. Please try again.");
  }

  revalidatePath("/leads");
  return { ok: true };
}

export type LookUpLeadForNumberResult =
  | { ok: true; matches: Array<{ name: string; reference: string }> }
  | { ok: false; error: string };

/**
 * Read-only preview for the new-chat dialog: which existing lead uses this number, so staff see what the chat will attach
 * to before sending. It matches exactly the way `startWhatsAppChat` does, returns at most two rows (one is a link, two is
 * "ambiguous") and only names and references, never contact details.
 */
export async function lookUpLeadForNumberAction(rawNumber: unknown): Promise<LookUpLeadForNumberResult> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!agencyId || !capabilitiesForInbox(role).sendMessage) return { ok: false, error: "Not permitted." };
  const digits = typeof rawNumber === "string" ? dialableDigits(rawNumber) : null;
  if (!digits) return { ok: true, matches: [] };

  const supabase = await db();
  const { data, error } = await supabase
    .from("leads")
    .select("full_name, reference")
    .eq("agency_id", agencyId)
    .eq("mobile", waIdToMobile(digits))
    .limit(2);
  if (error) return inboxFailure("lookUpLeadForNumber", error, "Could not check this number against existing leads.");
  return { ok: true, matches: ((data ?? []) as Array<{ full_name: string; reference: string }>).map((row) => ({ name: row.full_name, reference: row.reference })) };
}

/** The conversation this contact already has on this channel, null when there is none, or "UNREADABLE" when the lookup failed (never guessed as "none"). */
async function findExistingConversationForStart(
  supabase: Awaited<ReturnType<typeof db>>,
  agencyId: string,
  channel: "WHATSAPP" | "GMAIL",
  externalId: string,
): Promise<(ExistingConversationForStart & { contact_name: string | null }) | null | "UNREADABLE"> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, state, assigned_to_id, assigned_to_name, contact_name")
    .eq("agency_id", agencyId)
    .eq("channel", channel)
    .eq("external_conversation_id", externalId)
    .maybeSingle();
  if (error) return "UNREADABLE";
  return (data as (ExistingConversationForStart & { contact_name: string | null }) | null) ?? null;
}

/**
 * The protection gate for an approved template, run on the filled-in text before it is sent. If the open reviews cannot be read nothing is
 * sent: unknown is not "clear".
 */
function protectionCheckForOutgoingText(supabase: Awaited<ReturnType<typeof db>>, agencyId: string, conversationId: string): (renderedText: string) => Promise<string | null> {
  return async (renderedText) => {
    try {
      const protection = await loadProtectionContext(supabase, agencyId, conversationId);
      const decision = evaluateProtection({ text: renderedText, audience: "STAFF_SEND", openReviews: protection.openReviews, approvedAccountDigits: protection.approvedAccountDigits });
      return decision.allowed ? null : refusalMessage(decision);
    } catch (cause) {
      console.error("Protection gate could not read the open reviews:", cause instanceof Error ? cause.message : cause);
      return "Could not check whether a review is open on this conversation. Try again in a moment.";
    }
  };
}

export async function startWhatsAppChat(rawInput: {
  phoneNumber: string;
  contactName?: string;
  templateId: string;
  bodyParameters: string[];
  clientIdempotencyKey: string;
}): Promise<StartChatResult> {
  const user = await requireUser();
  const { role, agencyId, staffId, name } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).sendMessage) return { ok: false, error: "Not permitted." };
  if (!agencyId) return { ok: false, error: "No agency resolved for your account." };
  const parsedInput = inboxStartChatSchema.safeParse(rawInput);
  if (!parsedInput.success) return { ok: false, error: parsedInput.error.issues[0]?.message ?? "Check the number, template and message details." };
  const input = parsedInput.data;

  const to = input.phoneNumber.replace(/[^\d]/g, "");
  if (!/^\d{8,15}$/.test(to)) {
    return { ok: false, error: "Enter the full international WhatsApp number, including country code." };
  }

  const supabase = await db();
  const admin = createAdminClient();
  // The number may already have a conversation. Check before anything is sent, so a colleague's chat is never taken over.
  const existingChat = await findExistingConversationForStart(supabase, agencyId, "WHATSAPP", to);
  if (existingChat === "UNREADABLE") return { ok: false, error: "Could not check whether this number already has a conversation. Try again." };
  const startDecision = decideStartOnExistingConversation({ existing: existingChat, currentStaffId: staffId, contactNoun: "number" });
  if (!startDecision.ok) return startDecision;

  // The attempt is recorded BEFORE Meta is called, so a repeat of this send (double click, retry, second tab) cannot send and bill twice.
  const claim = await claimTemplateSend(admin, { agencyId, key: input.clientIdempotencyKey, staffId: user.id });
  if (claim.kind === "ALREADY_SENT") {
    return claim.conversationId
      ? { ok: true, conversationId: claim.conversationId }
      : { ok: false, error: "This message was already sent, but the chat could not be opened. Refresh the Inbox to find it." };
  }
  const claimRefusal = claimRefusalMessage(claim);
  if (claimRefusal) return { ok: false, error: claimRefusal };

  const sent = await sendApprovedTemplate({
    db: admin,
    agencyId,
    to,
    templateId: input.templateId,
    values: input.bodyParameters,
    // A brand-new contact has no open review; an existing conversation does, and the template must pass the same gate as a typed reply.
    ...(existingChat ? { checkRenderedText: protectionCheckForOutgoingText(supabase, agencyId, existingChat.id) } : {}),
  });
  if (!sent.ok) {
    await recordTemplateFailed(admin, { agencyId, key: input.clientIdempotencyKey, error: sent.error });
    return { ok: false, error: sent.error };
  }
  // On record straight away, so the send is known even if opening the conversation below fails.
  await recordTemplateSent(admin, { agencyId, key: input.clientIdempotencyKey, externalMessageId: sent.externalMessageId });
  const { template, bodyParameters, externalMessageId } = sent;

  const now = new Date().toISOString();
  // A name typed now wins; otherwise keep the name the existing conversation already has instead of replacing it with the number.
  const contactName = input.contactName?.trim() || existingChat?.contact_name?.trim() || `+${to}`;
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .upsert(
      {
        agency_id: agencyId,
        channel: "WHATSAPP",
        external_conversation_id: to,
        contact_name: contactName,
        contact_phone: to,
        state: "HUMAN_ACTIVE",
        assigned_to_id: staffId,
        assigned_to_name: name,
        last_outbound_at: now,
      },
      { onConflict: "agency_id,channel,external_conversation_id" },
    )
    .select("id")
    .single();
  if (conversationError || !conversation) {
    return { ok: false, error: "The message was sent, but the CRM could not open the conversation. Refresh before retrying." };
  }

  await attachTemplateConversation(admin, { agencyId, key: input.clientIdempotencyKey, conversationId: conversation.id as string });

  // A staff-started chat must enter the same CRM path as an inbound message.
  // Here we only match an existing lead; creating a new record is an explicit
  // Inbox action so staff never accidentally create leads while composing.
  await linkConversationToLead(admin, {
    agencyId,
    conversationId: conversation.id as string,
    provider: "WHATSAPP",
    externalSubjectId: to,
    displayName: contactName,
    normalizedPhone: waIdToMobile(to),
  });

  const content = sent.renderedText;
  // The author is set by the database from the signed-in user; staff cannot insert message rows directly.
  const { error: messageError } = await supabase.rpc("record_staff_template_message", {
    p_conversation_id: conversation.id,
    p_external_message_id: externalMessageId,
    p_content: content,
    p_metadata: {
      template_id: template.id,
      template_name: template.name,
      template_language: template.language,
      template_category: template.category,
      body_parameters: bodyParameters,
    },
  });
  if (messageError) {
    return { ok: false, error: "The message was sent, but the CRM could not save it. Refresh before retrying." };
  }

  return { ok: true, conversationId: conversation.id as string };
}

/**
 * Starts a brand-new email conversation (docs/inbox/email-channel-implementation-plan.md, Phase 3): unlike
 * Messenger/Instagram, the business CAN start an email. The conversation and its contact identity are created
 * up front (mirroring `startWhatsAppChat`'s shape), then the first message is queued through the same
 * `enqueue_inbox_text_message` RPC — and the same outbox drain — an ordinary reply uses.
 */
async function loadInboxEmailMailboxConnection(agencyId: string) {
  const { data: connection } = await createAdminClient()
    .from("channel_connections")
    .select("id, status, provider_metadata")
    .eq("agency_id", agencyId)
    .eq("provider", "GMAIL")
    .maybeSingle();
  return connection && isInboxEmailMailboxReady(connection) ? connection : null;
}

/** Reads the latest mailbox state when the compose dialog opens after Settings has changed it. */
export async function loadEmailComposeMailboxReadinessAction(): Promise<boolean> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!agencyId || !capabilitiesForInbox(role).sendMessage) return false;
  return Boolean(await loadInboxEmailMailboxConnection(agencyId));
}

export async function startEmailConversation(rawInput: {
  recipientEmail: string;
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
}): Promise<StartChatResult> {
  await requireUser();
  const { role, agencyId, staffId, name } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).sendMessage) return { ok: false, error: "Not permitted." };
  if (!agencyId) return { ok: false, error: "No agency resolved for your account." };
  const parsedInput = inboxComposeEmailSchema.safeParse(rawInput);
  if (!parsedInput.success) return { ok: false, error: parsedInput.error.issues[0]?.message ?? "Check the recipient, subject and message." };
  const input = parsedInput.data;
  const recipient = input.recipientEmail.trim().toLowerCase();

  const admin = createAdminClient();
  const connection = await loadInboxEmailMailboxConnection(agencyId);
  if (!connection) {
    return { ok: false, error: "Connect a mailbox with IMAP enabled in Settings → Email before composing." };
  }

  const supabase = await db();
  const existingChat = await findExistingConversationForStart(supabase, agencyId, "GMAIL", recipient);
  if (existingChat === "UNREADABLE") return { ok: false, error: "Could not check whether this address already has a conversation. Try again." };
  const startDecision = decideStartOnExistingConversation({ existing: existingChat, currentStaffId: staffId, contactNoun: "email address" });
  if (!startDecision.ok) return startDecision;
  // An address that already has a conversation may have an open review on it; a new email passes the same gate as a reply.
  if (existingChat) {
    const refusal = await protectionCheckForOutgoingText(supabase, agencyId, existingChat.id)(outboundGateText({ subject: input.subject, body: input.body }));
    if (refusal) return { ok: false, error: refusal };
  }
  const now = new Date().toISOString();
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .upsert(
      {
        agency_id: agencyId,
        channel: "GMAIL",
        external_conversation_id: recipient,
        contact_name: existingChat?.contact_name?.trim() || recipient,
        connection_id: connection.id,
        state: "HUMAN_ACTIVE",
        assigned_to_id: staffId,
        assigned_to_name: name,
        last_outbound_at: now,
      },
      { onConflict: "agency_id,channel,external_conversation_id" },
    )
    .select("id")
    .single();
  if (conversationError || !conversation) {
    return { ok: false, error: "Could not open the conversation. Refresh before retrying." };
  }

  // Mirrors startWhatsAppChat: only matches an existing lead. Creating one is a separate, explicit Inbox action.
  await linkConversationToLead(admin, {
    agencyId,
    conversationId: conversation.id as string,
    provider: "GMAIL",
    externalSubjectId: recipient,
    displayName: recipient,
    normalizedPhone: null,
    email: recipient,
  });

  const idempotencyKey = crypto.randomUUID();
  const { error } = await supabase.rpc("enqueue_inbox_text_message", {
    p_conversation_id: conversation.id,
    p_body: input.body,
    p_client_idempotency_key: idempotencyKey,
    p_subject: input.subject,
    p_cc: input.cc?.length ? input.cc : null,
    p_bcc: input.bcc?.length ? input.bcc : null,
  });
  if (error) {
    return { ok: false, error: "The conversation was created, but the message could not be queued. Open it and try sending again." };
  }

  return { ok: true, conversationId: conversation.id as string };
}

/** Sends an approved WhatsApp template into an existing conversation when free text is unavailable. */
export async function sendConversationTemplateAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = inboxTemplateMessageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the template message." };

  const { role, agencyId, staffId, name } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).sendMessage || !agencyId) return { ok: false, error: "Not permitted." };
  const supabase = await db();
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id, agency_id, channel, state, contact_phone, external_conversation_id, assigned_to_id, assigned_to_name")
    .eq("id", parsed.data.conversationId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (conversationError || !conversation) return { ok: false, error: "Conversation not found." };
  if (conversation.channel !== "WHATSAPP") return { ok: false, error: "Approved templates can only be sent on WhatsApp." };
  if (conversation.state === "CLOSED") return { ok: false, error: "This conversation is closed." };
  // Sending makes the sender the owner, so a chat a colleague owns is refused before anything is sent.
  const ownerDecision = decideReplyOnOwnedConversation({ conversation: conversation as OwnedConversationFacts, currentStaffId: staffId });
  if (!ownerDecision.ok) return ownerDecision;
  const to = String(conversation.external_conversation_id || conversation.contact_phone || "").replace(/\D/g, "");
  if (!/^\d{8,15}$/.test(to)) return { ok: false, error: "This conversation has no valid WhatsApp number." };

  const admin = createAdminClient();
  // The attempt is recorded BEFORE Meta is called, so a repeat of this send (double click, retry, second tab) cannot send and bill twice.
  const claim = await claimTemplateSend(admin, { agencyId, key: parsed.data.clientIdempotencyKey, staffId: user.id });
  if (claim.kind === "ALREADY_SENT") return { ok: true };
  const claimRefusal = claimRefusalMessage(claim);
  if (claimRefusal) return { ok: false, error: claimRefusal };

  const sent = await sendApprovedTemplate({
    db: admin,
    agencyId,
    to,
    templateId: parsed.data.templateId,
    values: parsed.data.bodyParameters,
    checkRenderedText: protectionCheckForOutgoingText(supabase, agencyId, conversation.id as string),
  });
  if (!sent.ok) {
    await recordTemplateFailed(admin, { agencyId, key: parsed.data.clientIdempotencyKey, error: sent.error });
    return { ok: false, error: sent.error };
  }
  await recordTemplateSent(admin, { agencyId, key: parsed.data.clientIdempotencyKey, externalMessageId: sent.externalMessageId });
  await attachTemplateConversation(admin, { agencyId, key: parsed.data.clientIdempotencyKey, conversationId: conversation.id as string });

  const now = new Date().toISOString();
  const { error: messageError } = await supabase.rpc("record_staff_template_message", {
    p_conversation_id: conversation.id,
    p_external_message_id: sent.externalMessageId,
    p_content: sent.renderedText,
    p_metadata: {
      template_id: sent.template.id,
      template_name: sent.template.name,
      template_language: sent.template.language,
      template_category: sent.template.category,
      body_parameters: sent.bodyParameters,
    },
  });
  if (messageError) return { ok: false, error: "The message was sent, but the CRM could not save it. Refresh before retrying." };

  const previousOwnerId = (conversation.assigned_to_id as string | null) ?? null;
  let guardedUpdate = supabase
    .from("conversations")
    .update({ state: "HUMAN_ACTIVE", assigned_to_id: staffId, assigned_to_name: name, last_outbound_at: now })
    .eq("id", conversation.id)
    .eq("agency_id", agencyId);
  guardedUpdate = previousOwnerId === null ? guardedUpdate.is("assigned_to_id", null) : guardedUpdate.eq("assigned_to_id", previousOwnerId);
  const { data: updatedRows, error: conversationUpdateError } = await guardedUpdate.select("id");
  if (conversationUpdateError || !updatedRows || updatedRows.length === 0) return { ok: false, error: "The message was sent, but the conversation status could not be updated. Refresh before retrying." };
  await recordOwnerChange({
    agencyId,
    conversationId: conversation.id as string,
    actorId: user.id,
    actorName: name ?? null,
    from: { id: previousOwnerId, name: (conversation.assigned_to_name as string | null) ?? null },
    to: { id: staffId, name: name ?? null },
  });
  revalidatePath("/inbox");
  return { ok: true };
}

/**
 * Clears a chat's unread count once a staff member has it open. Only a chat that actually has unread messages is written,
 * so opening a read chat changes nothing (and advances no version). Row security confines the update to the agency.
 */
export async function markConversationRead(rawConversationId: string): Promise<ActionResult> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).viewModule || !agencyId) return { ok: false, error: "Not permitted." };
  const idCheck = inboxEntityIdSchema.safeParse(rawConversationId);
  if (!idCheck.success) return { ok: false, error: "Conversation not found." };

  const supabase = await db();
  const { error } = await supabase
    .from("conversations")
    .update({ unread_count: 0 })
    .eq("agency_id", agencyId)
    .eq("id", idCheck.data)
    .gt("unread_count", 0);
  if (error) return inboxFailure("markConversationRead", error, "Could not mark this conversation as read.");

  return { ok: true };
}

/** Best effort, like every other owner change: the history row never undoes the change it describes. */
async function recordOwnerChange(input: {
  agencyId: string;
  conversationId: string;
  actorId: string;
  actorName: string | null;
  from: { id: string | null; name: string | null };
  to: { id: string | null; name: string | null };
}): Promise<void> {
  if (input.from.id === input.to.id) return;
  try {
    const { error } = await createAdminClient().from("conversation_events").insert({
      agency_id: input.agencyId,
      conversation_id: input.conversationId,
      kind: OWNER_CHANGED_EVENT_KIND,
      actor_kind: "STAFF",
      actor_id: input.actorId,
      data: ownerChangedEventData({ from: input.from, to: input.to, actorName: input.actorName }),
    });
    if (error) console.error("Could not record the owner change:", error.message);
  } catch (cause) {
    console.error("Could not record the owner change:", cause instanceof Error ? cause.message : cause);
  }
}

const CONVERSATION_CHANGED_MESSAGE = "Someone else changed this conversation just now. Refresh and try again.";

/**
 * Makes the caller the conversation's owner and pauses the assistant. Refused when a colleague owns the chat or the chat is closed
 * (giving a chat to someone is the Assign action), and the write is a compare-and-swap on the state and owner that were checked.
 */
export async function takeControl(rawConversationId: string): Promise<ActionResult> {
  const user = await requireUser();
  const { role, staffId, name, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).takeControl || !agencyId) return { ok: false, error: "Not permitted." };
  const idCheck = inboxEntityIdSchema.safeParse(rawConversationId);
  if (!idCheck.success) return { ok: false, error: "Conversation not found." };

  const supabase = await db();
  const { data: current, error: readError } = await supabase
    .from("conversations")
    .select("state, assigned_to_id, assigned_to_name")
    .eq("agency_id", agencyId)
    .eq("id", idCheck.data)
    .maybeSingle();
  if (readError) return inboxFailure("takeControl", readError, "Could not take control of this conversation.");
  if (!current) return { ok: false, error: "Conversation not found." };
  const facts = current as OwnedConversationFacts;
  const decision = decideTakeControl({ conversation: facts, currentStaffId: staffId });
  if (!decision.ok) return decision;

  let guardedUpdate = supabase
    .from("conversations")
    .update({ state: "HUMAN_ACTIVE", assigned_to_id: staffId, assigned_to_name: name })
    .eq("agency_id", agencyId)
    .eq("id", idCheck.data)
    .eq("state", facts.state);
  guardedUpdate = facts.assigned_to_id === null ? guardedUpdate.is("assigned_to_id", null) : guardedUpdate.eq("assigned_to_id", facts.assigned_to_id);
  const { data: updatedRows, error } = await guardedUpdate.select("id");
  if (error) return inboxFailure("takeControl", error, "Could not take control of this conversation.");
  if (!updatedRows || updatedRows.length === 0) return { ok: false, error: CONVERSATION_CHANGED_MESSAGE };

  await recordOwnerChange({
    agencyId,
    conversationId: idCheck.data,
    actorId: user.id,
    actorName: name ?? null,
    from: { id: facts.assigned_to_id, name: facts.assigned_to_name },
    to: { id: staffId, name: name ?? null },
  });
  return { ok: true };
}

/**
 * Gives a conversation to a colleague, or removes its owner. The colleague is re-read on the server: they must be an
 * active member of this agency whose role can reply in the Inbox, so a chat is never handed to someone who cannot see it.
 */
export async function assignConversationAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = inboxAssignConversationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid conversation and person." };
  const { role, agencyId, name: actorName } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).assignConversation || !agencyId) return { ok: false, error: "Not permitted." };

  const supabase = await db();
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id, state, assigned_to_id, assigned_to_name, contact_name")
    .eq("agency_id", agencyId)
    .eq("id", parsed.data.conversationId)
    .maybeSingle();
  if (conversationError || !conversation) return { ok: false, error: "Conversation not found." };

  let target: { id: string; name: string } | null = null;
  if (parsed.data.assigneeId) {
    const { data: profile, error: profileError } = await supabase
      .from("staff_profiles")
      .select("id, full_name, role, status")
      .eq("agency_id", agencyId)
      .eq("id", parsed.data.assigneeId)
      .maybeSingle();
    if (profileError || !profile || !canTakeInboxConversations(profile)) {
      return { ok: false, error: "That person cannot take Inbox conversations." };
    }
    target = { id: profile.id as string, name: (profile.full_name as string) || "Staff" };
  }

  const currentAssigneeId = (conversation.assigned_to_id as string | null) ?? null;
  const plan = planConversationAssignment({ state: conversation.state, currentAssigneeId, target });
  if (!plan.ok) return plan;
  if (!plan.changed) return { ok: true };

  // Compare-and-swap on the state/owner just read: a concurrent change (another assign, a bulk action, the
  // customer replying) between that read and this write must not be silently overwritten by a decision made
  // against stale data.
  let guardedUpdate = supabase
    .from("conversations")
    .update(plan.patch)
    .eq("agency_id", agencyId)
    .eq("id", parsed.data.conversationId)
    .eq("state", conversation.state);
  guardedUpdate = currentAssigneeId === null ? guardedUpdate.is("assigned_to_id", null) : guardedUpdate.eq("assigned_to_id", currentAssigneeId);
  const { data: updatedRows, error } = await guardedUpdate.select("id");
  if (error) return inboxFailure("assignConversation", error, "Could not change the owner of this conversation.");
  if (!updatedRows || updatedRows.length === 0) return { ok: false, error: "Someone else changed this conversation just now. Refresh and try again." };

  // The change is made. Recording it and telling the new owner are best effort: neither may undo it or turn it into a failure.
  try {
    const admin = createAdminClient();
    const { error: eventError } = await admin.from("conversation_events").insert({
      agency_id: agencyId,
      conversation_id: parsed.data.conversationId,
      kind: OWNER_CHANGED_EVENT_KIND,
      actor_kind: "STAFF",
      actor_id: user.id,
      data: ownerChangedEventData({
        from: { id: (conversation.assigned_to_id as string | null) ?? null, name: (conversation.assigned_to_name as string | null) ?? null },
        to: { id: target?.id ?? null, name: target?.name ?? null },
        actorName: actorName ?? null,
      }),
    });
    if (eventError) console.error("Could not record the owner change:", eventError.message);

    const notice = assignmentNotification({ actorId: user.id, actorName: actorName ?? null, target, customerName: (conversation.contact_name as string | null) ?? null });
    if (notice) {
      await notifyWorkflowCreated({ agencyId, conversationId: parsed.data.conversationId, kind: "WORKFLOW_CREATED", recipientIds: [notice.recipientId], title: notice.title }, admin);
    }
  } catch (cause) {
    console.error("Owner change follow-up failed:", cause instanceof Error ? cause.message : cause);
  }

  revalidatePath("/inbox");
  return { ok: true };
}

/**
 * Hands a chat back to the assistant. Only its owner (or an administrator) may, never while a review is open on it, and the owner is
 * cleared so a stale name does not keep colleagues from taking the chat later.
 */
export async function releaseToAi(rawConversationId: string): Promise<ActionResult> {
  const user = await requireUser();
  const { role, agencyId, staffId, name } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).releaseToAi || !agencyId) return { ok: false, error: "Not permitted." };
  const idCheck = inboxEntityIdSchema.safeParse(rawConversationId);
  if (!idCheck.success) return { ok: false, error: "Conversation not found." };

  const supabase = await db();
  const [{ data: current, error: readError }, { data: openReviews, error: reviewError }] = await Promise.all([
    supabase.from("conversations").select("state, assigned_to_id, assigned_to_name").eq("agency_id", agencyId).eq("id", idCheck.data).maybeSingle(),
    supabase.from("conversation_interventions").select("id").eq("agency_id", agencyId).eq("conversation_id", idCheck.data).in("status", ["OPEN", "ACKNOWLEDGED"]).limit(1),
  ]);
  if (readError) return inboxFailure("releaseToAi", readError, "Could not hand this conversation back to the assistant.");
  // Unknown is not "clear": if the open reviews cannot be read, the chat stays with the person.
  if (reviewError) return inboxFailure("releaseToAi.reviews", reviewError, "Could not check whether a review is open on this conversation. Try again in a moment.");
  if (!current) return { ok: false, error: "Conversation not found." };
  const facts = current as OwnedConversationFacts;
  const decision = decideReleaseToAi({ conversation: facts, currentStaffId: staffId, isAdministrator: role === "ADMIN", openReviewCount: openReviews?.length ?? 0 });
  if (!decision.ok) return decision;

  let guardedUpdate = supabase
    .from("conversations")
    .update({ state: "AI_RESUMED", assigned_to_id: null, assigned_to_name: null })
    .eq("agency_id", agencyId)
    .eq("id", idCheck.data)
    .eq("state", facts.state);
  guardedUpdate = facts.assigned_to_id === null ? guardedUpdate.is("assigned_to_id", null) : guardedUpdate.eq("assigned_to_id", facts.assigned_to_id);
  const { data: updatedRows, error } = await guardedUpdate.select("id");
  if (error) return inboxFailure("releaseToAi", error, "Could not hand this conversation back to the assistant.");
  if (!updatedRows || updatedRows.length === 0) return { ok: false, error: CONVERSATION_CHANGED_MESSAGE };

  await recordOwnerChange({
    agencyId,
    conversationId: idCheck.data,
    actorId: user.id,
    actorName: name ?? null,
    from: { id: facts.assigned_to_id, name: facts.assigned_to_name },
    to: { id: null, name: null },
  });
  return { ok: true };
}

export async function closeConversation(rawConversationId: string): Promise<ActionResult> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).closeConversation || !agencyId) return { ok: false, error: "Not permitted." };
  const idCheck = inboxEntityIdSchema.safeParse(rawConversationId);
  if (!idCheck.success) return { ok: false, error: "Conversation not found." };

  const supabase = await db();
  const { error } = await supabase.from("conversations").update({ state: "CLOSED" }).eq("agency_id", agencyId).eq("id", idCheck.data);
  if (error) return inboxFailure("closeConversation", error, "Could not close this conversation.");

  return { ok: true };
}

/**
 * Permanently deletes one conversation (messages, notes, attachments and their stored files). Administrators only, and it cannot be
 * undone. The conversation is first looked up through the person's own session, so row security confirms it is one they can see; the
 * removal itself then runs with the service key, which is what may delete stored files and send-queue rows. Only ids and counts are logged,
 * never message text or contact details.
 */
export async function deleteConversationAction(rawConversationId: string): Promise<ActionResult> {
  const user = await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).deleteConversation || !agencyId) return { ok: false, error: "Not permitted." };
  const idCheck = inboxEntityIdSchema.safeParse(rawConversationId);
  if (!idCheck.success) return { ok: false, error: "Conversation not found." };

  const supabase = await db();
  const { data: visible, error: readError } = await supabase.from("conversations").select("id").eq("agency_id", agencyId).eq("id", idCheck.data).maybeSingle();
  if (readError) return inboxFailure("deleteConversation", readError, "Could not delete this conversation.");
  if (!visible) return { ok: false, error: "Conversation not found." };

  try {
    const result = await deleteConversationPermanently(createAdminClient(), { agencyId, conversationId: idCheck.data });
    if (!result.ok) return { ok: false, error: "Conversation not found." };
    logEvent("info", "inbox.conversation_deleted", {
      agencyId,
      conversationId: idCheck.data,
      actorId: user.id,
      channel: result.channel,
      messagesDeleted: result.messagesDeleted,
      objectsDeleted: result.objectsDeleted,
    });
  } catch (cause) {
    return inboxFailure("deleteConversation", cause, "Could not finish deleting this conversation. Try again.");
  }

  revalidatePath("/inbox");
  return { ok: true };
}

/**
 * Internal notes are collaboration records, never customer-facing messages.
 * The database also requires the author to be the authenticated user and
 * scopes the note to the active agency.
 */
export async function addInternalNote(
  rawConversationId: string,
  body: string,
  mentionedUserIds: string[] = [],
): Promise<ActionResult> {
  const user = await requireUser();
  const { role, name, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).sendMessage) return { ok: false, error: "Not permitted." };

  const parsedNote = inboxInternalNoteSchema.safeParse({ conversationId: rawConversationId, body, mentionedUserIds });
  if (!parsedNote.success) return { ok: false, error: parsedNote.error.issues[0]?.message ?? "Check the note." };
  const { conversationId, body: trimmedBody } = parsedNote.data;

  const supabase = await db();
  const uniqueMentionedUserIds = [...new Set(mentionedUserIds)].filter((id) => id !== user.id);
  if (uniqueMentionedUserIds.length > 20) return { ok: false, error: "A note can mention up to 20 staff members." };
  if (uniqueMentionedUserIds.length > 0) {
    if (!agencyId) return { ok: false, error: "No agency resolved for your account." };
    const { data: staff, error: staffError } = await supabase
      .from("staff_profiles")
      .select("id")
      .eq("agency_id", agencyId)
      .eq("status", "ACTIVE")
      .in("id", uniqueMentionedUserIds);
    if (staffError || (staff ?? []).length !== uniqueMentionedUserIds.length) {
      return { ok: false, error: "One or more mentioned staff members are no longer available." };
    }
  }

  const { data: note, error } = await supabase
    .from("conversation_notes")
    .insert({
      conversation_id: conversationId,
      body: trimmedBody,
      author_id: user.id,
      author_name_snapshot: name ?? "Staff",
    })
    .select("id")
    .single();
  if (error || !note) return inboxFailure("addInternalNote", error, "Could not add the note.");

  if (uniqueMentionedUserIds.length > 0) {
    const { error: mentionsError } = await supabase.from("note_mentions").insert(
      uniqueMentionedUserIds.map((mentioned_user_id) => ({ note_id: note.id, mentioned_user_id })),
    );
    if (mentionsError) {
      await supabase.from("conversation_notes").delete().eq("id", note.id);
      return inboxFailure("addInternalNote.mentions", mentionsError, "Could not add the note.");
    }
  }

  return { ok: true };
}

export type CreateSavedReplyResult = { ok: true; reply: InboxSavedReply } | { ok: false; error: string };

/**
 * Adds a saved reply from the composer's own "Saved replies" dropdown —
 * the only place in the app that writes to `saved_replies`; there is no
 * separate settings page for it. `manageSavedReplies` matches that
 * table's RLS write policy exactly (ADMIN, MARKETING, OPERATIONS).
 */
export async function createSavedReplyAction(input: unknown): Promise<CreateSavedReplyResult> {
  const user = await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).manageSavedReplies) return { ok: false, error: "Your role cannot create saved replies." };

  const parsed = createSavedReplyInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the reply." };

  const supabase = await db();
  const { data, error } = await supabase
    .from("saved_replies")
    .insert({
      title: parsed.data.title,
      body: parsed.data.body,
      is_private: parsed.data.isPrivate,
      owner_id: parsed.data.isPrivate ? user.id : null,
    })
    .select("id, title, body, language, providers")
    .single();
  if (error || !data) return inboxFailure("createSavedReplyAction", error, "Could not save the reply.");

  return { ok: true, reply: data as InboxSavedReply };
}

/** Per-user drafts deliberately do not revalidate the Inbox on every keystroke. */
export async function saveConversationDraft(rawConversationId: string, body: string): Promise<ActionResult> {
  const user = await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).sendMessage) return { ok: false, error: "Not permitted." };
  const idCheck = inboxEntityIdSchema.safeParse(rawConversationId);
  if (!idCheck.success) return { ok: false, error: "Conversation not found." };
  const conversationId = idCheck.data;
  if (typeof body !== "string" || body.length > 10_000) return { ok: false, error: "Drafts must be 10,000 characters or fewer." };

  const supabase = await db();
  if (!body) {
    const { error } = await supabase
      .from("conversation_drafts")
      .delete()
      .eq("conversation_id", conversationId)
      .eq("author_id", user.id);
    return error ? inboxFailure("saveConversationDraft.delete", error, "Could not save your draft.") : { ok: true };
  }

  const { error } = await supabase.from("conversation_drafts").upsert(
    { conversation_id: conversationId, author_id: user.id, body },
    { onConflict: "conversation_id,author_id" },
  );
  return error ? inboxFailure("saveConversationDraft", error, "Could not save your draft.") : { ok: true };
}

export type ComposerPresenceActionResult =
  | { ok: true; status: "CLAIMED" | "HELD_BY_OTHER"; presence: { staffId: string; at: string } | null }
  | { ok: false; error: string };

/**
 * A best-effort editing signal, not a reply lock. The repository uses a
 * conditional update so we never overwrite a colleague's fresh heartbeat.
 */
export async function claimConversationComposerAction(input: unknown): Promise<ComposerPresenceActionResult> {
  await requireUser();
  const parsed = inboxConversationRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That conversation could not be found." };

  const { role, agencyId, staffId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).sendMessage || !agencyId || !staffId) {
    return { ok: false, error: "Not permitted to reply here." };
  }

  try {
    const result = await claimComposerPresence(await db(), {
      agencyId,
      conversationId: parsed.data.conversationId,
      staffId,
      now: new Date(),
    });
    // Signal writes use the service worker client because projection signals have no staff-write RLS policy.
    // A failed warning must never turn a soft presence marker into a blocked reply.
    after(() => syncConcurrentComposerSignal(createAdminClient(), {
      agencyId,
      conversationId: parsed.data.conversationId,
      now: new Date(),
    }).catch((cause) => console.error("Could not synchronise concurrent-composer signal:", cause)));
    return { ok: true, status: result.status, presence: result.presence };
  } catch (cause) {
    console.error("Could not claim composer presence:", cause);
    return { ok: false, error: "Could not tell colleagues that you are writing. You can still reply." };
  }
}

/** Releases only this staff member's soft composer lease on blur or send. */
export async function releaseConversationComposerAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const parsed = inboxConversationRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That conversation could not be found." };

  const { role, agencyId, staffId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).sendMessage || !agencyId || !staffId) {
    return { ok: false, error: "Not permitted to reply here." };
  }

  try {
    await releaseComposerPresence(await db(), {
      agencyId,
      conversationId: parsed.data.conversationId,
      staffId,
    });
    after(() => syncConcurrentComposerSignal(createAdminClient(), {
      agencyId,
      conversationId: parsed.data.conversationId,
      now: new Date(),
    }).catch((cause) => console.error("Could not synchronise concurrent-composer signal:", cause)));
    return { ok: true };
  } catch (cause) {
    console.error("Could not release composer presence:", cause);
    return { ok: false, error: "Could not clear the writing indicator." };
  }
}

/**
 * Converts the lead already linked to this conversation using the same
 * capacity-safe booking primitive as the Leads workspace. The action derives
 * commercial inputs from the selected package/group instead of accepting
 * them from the browser.
 */
export async function createBookingFromConversation(rawConversationId: string): Promise<ActionResult> {
  await requireUser();
  const idCheck = inboxEntityIdSchema.safeParse(rawConversationId);
  if (!idCheck.success) return { ok: false, error: "Conversation not found." };
  const conversationId = idCheck.data;
  const { role, name, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).sendMessage || !capabilitiesForLeads(role).convertToBooking || !agencyId) {
    return { ok: false, error: "Not permitted to create bookings." };
  }

  const supabase = await db();
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("lead_id")
    .eq("id", conversationId)
    .single();
  if (conversationError || !conversation?.lead_id) return { ok: false, error: "Link a lead before creating a booking." };

  const store = await loadLeadStore(supabase);
  const leadOrNull = store.leads.find((item) => item.id === conversation.lead_id) ?? null;
  const derived = deriveBookingFromLead(leadOrNull);
  if (!derived.ok) return { ok: false, error: derived.error };
  const lead = leadOrNull!; // non-null: deriveBookingFromLead only returns ok:true for a real lead.
  // A lead from Messenger/Instagram has no number until the customer gives one; a booking with nobody to call is not useful.
  if (!lead.mobile.trim()) return { ok: false, error: "Add the customer's phone number to the lead before creating a booking." };
  const { travellerCount, roomOccupancyPreference } = derived.result;
  const bookingOutcome = await createGroupBooking(
    {
      departureGroupId: lead.selected_departure_group_id!,
      leadId: lead.id,
      bookingReference: `LD-${lead.reference.replace(/^LD-/, "")}`,
      bookingStatus: "DEPOSIT_PENDING",
      primaryContactName: lead.full_name,
      primaryContactPhone: lead.mobile,
      travellerCount,
      roomOccupancyPreference,
      packagePricePerPerson: pricePerPerson(store, lead.desired_package_id, lead.journey_type, lead.room_preference),
      amountPaid: 0,
    },
    { client: supabase },
  );
  if (!bookingOutcome.ok) return bookingOutcome;

  // The booking points back at the conversation it was created from (MI4.6).
  await stampConversationSource(createAdminClient(), { agencyId, table: "departure_group_bookings", by: { column: "id", value: bookingOutcome.result.bookingId }, conversationId });

  const before = snapshotLeadStore(store);
  const linked = markLeadBookedInStore(store, {
    leadId: lead.id,
    bookingId: bookingOutcome.result.bookingId,
    bookingReference: bookingOutcome.result.bookingReference,
    actorName: name ?? "Staff",
  }, new Date().toISOString());
  if (!linked.ok) return { ok: false, error: linked.error ?? "Could not link the booking to the lead." };
  await persistLeadStore(supabase, before, store);

  revalidatePath("/leads");
  revalidatePath("/bookings");
  return { ok: true };
}

/** Selects a capacity-compatible departure group without leaving Inbox. This
 * records lead intent only; capacity is held when the booking is created. */
export async function selectConversationDepartureGroup(rawInput: {
  conversationId: string;
  departureGroupId: string;
}): Promise<ActionResult> {
  await requireUser();
  const parsedSelection = z.object({ conversationId: inboxEntityIdSchema, departureGroupId: inboxEntityIdSchema }).strict().safeParse(rawInput);
  if (!parsedSelection.success) return { ok: false, error: "That departure group could not be found." };
  const input = parsedSelection.data;
  const { role, name } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).sendMessage || !capabilitiesForLeads(role).findGroups) {
    return { ok: false, error: "Not permitted to select a departure group." };
  }

  const supabase = await db();
  const { data: conversation } = await supabase.from("conversations").select("lead_id").eq("id", input.conversationId).maybeSingle();
  if (!conversation?.lead_id) return { ok: false, error: "Link a lead before selecting a departure group." };
  const store = await loadLeadStore(supabase);
  const lead = store.leads.find((item) => item.id === conversation.lead_id);
  if (!lead) return { ok: false, error: "The linked lead is no longer available." };

  let groupQuery = supabase.from("departure_groups").select("id, group_name, group_code")
    .eq("id", input.departureGroupId).eq("journey_type", lead.journey_type)
    .in("sales_status", ["SELLING", "LIMITED_AVAILABILITY"])
    .not("group_status", "in", "(CANCELLED,COMPLETED,CLOSED)")
    .eq("archived", false).gte("available_seats", lead.adults + lead.children);
  if (lead.desired_package_id) groupQuery = groupQuery.eq("package_template_id", lead.desired_package_id);
  const { data: group, error: groupError } = await groupQuery.maybeSingle();
  if (groupError || !group) return { ok: false, error: "That departure group is no longer available for this lead." };

  const before = snapshotLeadStore(store);
  const outcome = selectDepartureGroupInStore(store, {
    leadId: lead.id,
    departureGroupId: group.id as string,
    groupLabel: `${group.group_name as string} (${group.group_code as string})`,
    actorName: name ?? "Staff",
  }, new Date().toISOString());
  if (!outcome.ok) return { ok: false, error: outcome.error ?? "Could not select the departure group." };
  await persistLeadStore(supabase, before, store);
  revalidatePath("/leads");
  return { ok: true };
}

export type SuggestReplyResult = { ok: true; reply: string; proposalId: string } | { ok: false; error: string };

const triageReviewSchema = z.object({
  conversationId: z.string().uuid(),
  predictedIntent: intentCodeSchema,
  reviewedIntent: intentCodeSchema,
  predictionComputedAt: z.string().datetime(),
}).strict();

/** Records the agency-specific reviewed S1 sample used by the R5 promotion gate. */
export async function reviewConversationTriageAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const parsed = triageReviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose the intent that best matches this conversation." };
  const { role, agencyId, staffId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).sendMessage || !agencyId || !staffId) return { ok: false, error: "Not permitted to review Inbox triage." };
  const admin = createAdminClient();
  const { data: reading } = await admin.from("conversation_intelligence").select("intent_code,computed_at").eq("agency_id", agencyId).eq("conversation_id", parsed.data.conversationId).maybeSingle();
  if (!reading || reading.intent_code !== parsed.data.predictedIntent || reading.computed_at !== parsed.data.predictionComputedAt) return { ok: false, error: "Copilot's reading changed. Refresh before reviewing it." };
  const { error } = await admin.from("inbox_triage_reviews").upsert({
    agency_id: agencyId,
    conversation_id: parsed.data.conversationId,
    predicted_intent: parsed.data.predictedIntent,
    reviewed_intent: parsed.data.reviewedIntent,
    prediction_computed_at: parsed.data.predictionComputedAt,
    reviewed_by: staffId,
    reviewed_at: new Date().toISOString(),
  }, { onConflict: "agency_id,conversation_id,prediction_computed_at" });
  return error ? inboxFailure("reviewConversationTriage", error, "Could not save this triage review.") : { ok: true };
}

/**
 * Drafts a reply for staff to review, edit, or discard in the composer —
 * it never sends anything itself. Refuses outright for a lead that has
 * opted out or asked not to be contacted, rather than leaving that check to
 * the model's own judgment (Phase 8: "Require staff for ... identity
 * ambiguity"; an opted-out lead is exactly that kind of case, just decided
 * deterministically instead of by the model).
 */
export async function suggestConversationReplyAction(conversationId: string): Promise<SuggestReplyResult> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).sendMessage || !capabilitiesForLeads(role).useCopilot) {
    return { ok: false, error: "Your role cannot use Manasik Copilot." };
  }
  if (!agencyId) return { ok: false, error: "Your account is not linked to an agency." };

  const supabase = await db();
  const [{ data: autonomySurface }, entitlements] = await Promise.all([
    supabase.from("ai_surface_settings").select("enabled,mode,autonomy").eq("agency_id", agencyId).eq("surface", "INBOX_REPLY").maybeSingle(),
    resolveEntitlements(supabase, agencyId),
  ]);
  const autonomy = (autonomySurface?.autonomy ?? {}) as Record<string, unknown>;
  const configuredLevel = (["L0", "L1", "L2", "L3"].includes(String(autonomy.level)) ? String(autonomy.level) : "L0") as AutonomyLevel;
  const surfaceMode = autonomySurface?.enabled && ["OFF", "SHADOW", "PROPOSE", "ACTIVE"].includes(String(autonomySurface.mode))
    ? String(autonomySurface.mode) as "OFF" | "SHADOW" | "PROPOSE" | "ACTIVE"
    : "OFF";
  // Human ownership stops autonomous delivery, but it must not disable L1's human-reviewed drafting.
  const effectiveLevel = resolveEffectiveAutonomy({ entitlementCeiling: entitlements?.autonomyCeiling ?? "L0", surfaceMode, configuredLevel, conversationHumanActive: false });
  if (effectiveLevel === "L0") return { ok: false, error: "Inbox autonomy is at L0 Observe. Move to L1 Assist before asking Copilot to draft replies." };
  const pack = await loadReplyContextPack(supabase, conversationId, agencyId);
  if (!pack) return { ok: false, error: "Conversation was not found for this agency." };

  if (pack.consent) {
    // Only WhatsApp has a modelled consent channel today (see
    // reply-context.ts); for any other provider, still refuse on the
    // channel-agnostic signals (do-not-contact, opted out) rather than
    // skip consent entirely.
    const consentFacts = {
      consentStatus: pack.consent.consentStatus,
      doNotContact: pack.consent.doNotContact,
      contactableChannels: pack.consent.contactableChannels,
    };
    const consentCheck = pack.consent.channel
      ? checkConsent(consentFacts, pack.consent.channel, true)
      : consentFacts.doNotContact || consentFacts.consentStatus === "OPTED_OUT"
        ? { allowed: false as const, reason: "DO_NOT_CONTACT" as const }
        : { allowed: true as const };
    if (!consentCheck.allowed) {
      return { ok: false, error: "This lead has opted out of contact — a suggestion would not be appropriate here." };
    }
  }

  let protection: Awaited<ReturnType<typeof loadProtectionContext>>;
  try {
    protection = await loadProtectionContext(supabase, agencyId, conversationId);
  } catch (cause) {
    console.error("Protection gate could not read the open reviews:", cause instanceof Error ? cause.message : cause);
    reportHandledError("inbox.sendStaffMessage.protectionGate", cause, { agencyId, conversationId });
    return { ok: false, error: "Could not check whether a review is open on this conversation. Try again in a moment." };
  }
  const intelligencePack = await loadInboxReplyPack(supabase, {
    agencyId,
    conversationId,
    fallback: pack,
    openInterventions: protection.openReviews,
  }).catch((cause) => {
    console.error("The widened Inbox reply pack could not be loaded; using the narrow fallback:", cause instanceof Error ? cause.message : cause);
    return null;
  });
  const availability = resolveInboxFeatureAvailability({
    entitlements,
    inboxQueuesV2: false,
    surfaces: { INBOX_REPLY: { enabled: Boolean(autonomySurface?.enabled), mode: surfaceMode, autonomy } },
  });
  const result = await suggestConversationReply(intelligencePack ?? pack, agencyId, conversationId, supabase, "INBOX_REPLY", protection, { answerCacheEnabled: availability.answerCache });
  if (!result.value) {
    if (result.source === "RULES" && result.note) return { ok: false, error: result.note };
    return {
      ok: false,
      error: "Copilot could not prepare a draft. Review the customer's message and the verified CRM facts; it cannot confirm anything unverified. Send a staff reply or try again.",
    };
  }
  const admin = createAdminClient();
  const { data: proposal, error: proposalError } = await admin.from("inbox_autonomy_decisions").insert({
    agency_id: agencyId,
    conversation_id: conversationId,
    surface: "INBOX_REPLY",
    effective_level: effectiveLevel,
    decision: "PROPOSED",
    source: result.note === "Approved agency answer cache" ? "APPROVED_ANSWER" : "GENERATED",
    candidate_text: result.value.reply,
    reasons: result.value.cacheEntryId ? [`answer_cache_id:${result.value.cacheEntryId}`] : [],
  }).select("id").single();
  if (proposalError || !proposal) return { ok: false, error: "The suggestion was drafted, but its review evidence could not be recorded. Please try again." };
  // FIX3 (docs/inbox/fixing-plan.md): a shown reply — generated fresh or served from the
  // approved answer cache — meters once per (agency, conversation, billing period), never
  // per call; `meter_ai_conversation` is the atomic idempotent authority, so a retried or
  // repeated draft in the same period is a no-op here.
  await meterAiConversation(admin, { agencyId, conversationId, periodStart: utcMonthStart(new Date()) }).catch((cause) => {
    console.error("Could not meter the AI-assisted conversation:", cause instanceof Error ? cause.message : cause);
  });
  return { ok: true, reply: result.value.reply, proposalId: String(proposal.id) };
}

/* ── Review cards (MI4.2) ─────────────────────────────────────────────────── */

/**
 * Acknowledge, resolve or dismiss a "human review required" card. Resolving or dismissing needs a note and an actor. The money
 * reviews (a payment claim, a bank detail, a refund) can only be closed by Finance or Admin; the rest by anyone who works the
 * inbox. Runs on the service role AFTER the checks, every query scoped to the agency.
 */
export async function updateInterventionAction(input: unknown): Promise<ActionResult> {
  const parsed = inboxInterventionDecisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the review." };

  const user = await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!agencyId) return { ok: false, error: "Your account is not linked to an agency." };
  const admin = createAdminClient();

  const reviews = await listInterventions(admin, agencyId, parsed.data.conversationId, { openOnly: true });
  const review = reviews.find((entry) => entry.id === parsed.data.interventionId);
  if (!review) return { ok: false, error: "That review is already closed, or is not on this conversation." };
  if (!canCloseIntervention(role, review.kind)) {
    return { ok: false, error: review.kind === "PAYMENT_CLAIM" || review.kind === "BANK_DETAIL_MISMATCH" || review.kind === "REFUND_REQUEST" || review.kind === "FRAUD_CONCERN" ? "Only Finance or an Admin can close this review." : "Your role cannot close this review." };
  }

  if (parsed.data.decision === "ACKNOWLEDGE") {
    await acknowledgeIntervention(admin, agencyId, review.id);
    return { ok: true };
  }
  const closed = await resolveIntervention(admin, agencyId, { interventionId: review.id, status: parsed.data.decision === "RESOLVE" ? "RESOLVED" : "DISMISSED", note: parsed.data.note, actorStaffId: user.id });
  if (!closed) return { ok: false, error: "That review was already closed." };
  return { ok: true };
}

/* ── Identity matches (MI3.3) ─────────────────────────────────────────────── */

/**
 * "Possible existing lead found": a person decides. Nothing links or merges without one of these. They run on the service
 * role AFTER the role check, exactly like `captureConversationLead`, and every query in the repository names the agency.
 */
async function identityDecider(): Promise<{ agencyId: string; actorId: string; canCreateLead: boolean; staffId: string | null; name: string } | { error: string }> {
  const user = await requireUser();
  const { role, agencyId, staffId, name } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).sendMessage) return { error: "Your role cannot link conversations to leads." };
  if (!agencyId) return { error: "Your account is not linked to an agency." };
  return { agencyId, actorId: user.id, canCreateLead: capabilitiesForLeads(role).createLead, staffId, name: name ?? "Staff" };
}

/** "Link conversation": point this conversation at the suggested lead. The lead itself is not changed. */
export async function confirmIdentityLinkAction(input: unknown): Promise<ActionResult> {
  const parsed = inboxIdentityLinkRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That match could not be found." };
  const who = await identityDecider();
  if ("error" in who) return { ok: false, error: who.error };
  const result = await confirmIdentityLink(createAdminClient(), { agencyId: who.agencyId, linkId: parsed.data.linkId, conversationId: parsed.data.conversationId, actorId: who.actorId });
  if (result.ok) revalidatePath("/leads");
  return result;
}

/** "Create separate lead": close every suggestion for this contact (never proposed again) and capture them as their own lead. */
export async function keepIdentitySeparateAction(input: unknown): Promise<ActionResult> {
  const parsed = inboxConversationRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That conversation could not be found." };
  const who = await identityDecider();
  if ("error" in who) return { ok: false, error: who.error };
  if (!who.canCreateLead || !who.staffId) return { ok: false, error: "Your role cannot create leads." };

  const admin = createAdminClient();
  const rejected = await rejectIdentityLinks(admin, { agencyId: who.agencyId, conversationId: parsed.data.conversationId, actorId: who.actorId });
  if (!rejected.ok) return rejected;
  return captureConversationLead(parsed.data.conversationId);
}

/** Undo a confirmed link: the conversation goes back to the lead it had before, and the pair is not suggested again. */
export async function unlinkIdentityLinkAction(input: unknown): Promise<ActionResult> {
  const parsed = inboxIdentityLinkRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That match could not be found." };
  const who = await identityDecider();
  if ("error" in who) return { ok: false, error: who.error };
  const result = await unlinkIdentityLink(createAdminClient(), { agencyId: who.agencyId, linkId: parsed.data.linkId, conversationId: parsed.data.conversationId, actorId: who.actorId });
  if (result.ok) revalidatePath("/leads");
  return result;
}

/* ── The offer card (S3, MI3.2) ───────────────────────────────────────────── */

/**
 * The four actions on the Inbox offer card. The browser only names the conversation: the stored offer, its live check,
 * the customer's lead and every figure are re-read here on the server, so nothing a page holds can be trusted into a
 * quote, a reply or a link.
 */
type StoredOffer = { agencyId: string; supabase: Awaited<ReturnType<typeof db>>; offer: MatchedOfferSnapshot; check: OfferCheckState };

async function loadStoredOffer(conversationId: string, capability: "view" | "send"): Promise<StoredOffer | { error: string }> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesForInbox(role);
  if (capability === "send" ? !can.sendMessage : !can.viewModule) return { error: "Your role cannot do that here." };
  if (!agencyId) return { error: "Your account is not linked to an agency." };

  const supabase = await db();
  const intelligence = await loadIntelligence(supabase, agencyId, conversationId);
  if (!intelligence?.matchedOffer) return { error: "Copilot has not found a departure for this conversation yet." };
  const check = await checkStoredOffer(supabase, agencyId, intelligence.matchedOffer, new Date().toISOString()).catch(() => null);
  if (check === null) return { error: "Could not check that the price and seats are still current. Try again in a moment." };
  return { agencyId, supabase, offer: intelligence.matchedOffer, check };
}

export type OfferMessageResult = { ok: true; text: string } | { ok: false; error: string };

/** Text for the composer: a reply built from the offer, or the questions still worth asking. Staff edit it; nothing is sent. */
export async function prepareOfferMessageAction(input: unknown): Promise<OfferMessageResult> {
  const parsed = inboxOfferMessageRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That conversation could not be found." };
  const stored = await loadStoredOffer(parsed.data.conversationId, "send");
  if ("error" in stored) return { ok: false, error: stored.error };

  // Same rule as "Suggest reply": a customer who opted out of contact is not offered a draft.
  const pack = await loadReplyContextPack(stored.supabase, parsed.data.conversationId, stored.agencyId);
  if (!pack) return { ok: false, error: "Conversation was not found for this agency." };
  if (pack.consent && (pack.consent.doNotContact || pack.consent.consentStatus === "OPTED_OUT")) {
    return { ok: false, error: "This lead has opted out of contact — a draft would not be appropriate here." };
  }

  if (parsed.data.kind === "REPLY") {
    const text = composeOfferReply(stored.offer, stored.check);
    return text ? { ok: true, text } : { ok: false, error: OFFER_CHECK_MESSAGES[stored.check] ?? "This offer cannot be quoted right now." };
  }
  const text = composeFollowUp(stored.offer);
  return text ? { ok: true, text } : { ok: false, error: "There is nothing left that the customer could answer." };
}

export type OpenGroupResult = { ok: true; href: string } | { ok: false; error: string };

/** Where "Open group" goes. Only a departure Copilot listed for THIS conversation (and this agency) can be opened. */
export async function openDepartureGroupFromConversation(input: unknown): Promise<OpenGroupResult> {
  const parsed = inboxOfferRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That conversation could not be found." };
  const stored = await loadStoredOffer(parsed.data.conversationId, "view");
  if ("error" in stored) return { ok: false, error: stored.error };

  const listed = [stored.offer.departureGroupId, ...stored.offer.alternatives.map((option) => option.departureGroupId)];
  const wanted = parsed.data.departureGroupId ?? stored.offer.departureGroupId;
  if (!listed.includes(wanted)) return { ok: false, error: "That departure is not one of the options for this conversation." };
  return { ok: true, href: `/departure-groups/${wanted}` };
}

export type ConversationQuoteResult = { ok: true; reference: string; leadId: string } | { ok: false; error: string };

/**
 * A draft quote for the conversation's lead from the stored offer, through the same path as the Leads quote builder:
 * price, seats and inclusions are re-read from the live group there, and a discount is never applied from here.
 */
export async function createQuoteFromConversation(input: unknown): Promise<ConversationQuoteResult> {
  const parsed = inboxOfferRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That conversation could not be found." };
  const stored = await loadStoredOffer(parsed.data.conversationId, "send");
  if ("error" in stored) return { ok: false, error: stored.error };
  if (!capabilitiesForLeads((await getCurrentStaffRole()).role).createQuoteDraft) return { ok: false, error: "Your role cannot create quotes." };
  if (!canQuoteOffer(stored.check)) return { ok: false, error: OFFER_CHECK_MESSAGES[stored.check] ?? "This offer cannot be quoted right now." };

  const { offer } = stored;
  if (!offer.roomType || !offer.party || offer.party.adults < 1) return { ok: false, error: "Confirm the room type and who is travelling before you quote." };

  const { data: conversation } = await stored.supabase.from("conversations").select("lead_id").eq("agency_id", stored.agencyId).eq("id", parsed.data.conversationId).maybeSingle();
  const leadId = (conversation as { lead_id: string | null } | null)?.lead_id ?? null;
  if (!leadId) return { ok: false, error: "Link this conversation to a lead first, then create the quote." };

  const context = await loadCopilotKnowledgeContext(stored.supabase, leadId);
  const facts = context?.candidates.find((candidate) => candidate.facts.groupId === offer.departureGroupId)?.facts;
  if (!facts) return { ok: false, error: "That departure is no longer open for sale." };

  const saved = await saveQuoteDraftAction({
    leadId,
    departureGroupId: offer.departureGroupId,
    occupancyType: offer.roomType,
    adults: offer.party.adults,
    children: offer.party.children,
    infants: offer.party.infants,
    discountAmount: 0,
    discountReason: "",
    expiresInDays: 7,
    inclusions: facts.inclusions,
    exclusions: facts.exclusions,
  });
  if (!saved.ok) return { ok: false, error: saved.error };
  // The quote points back at the conversation it was drafted in (MI4.6).
  await stampConversationSource(createAdminClient(), { agencyId: stored.agencyId, table: "lead_quotes", by: { column: "reference", value: saved.reference }, conversationId: parsed.data.conversationId });
  revalidatePath("/leads");
  return { ok: true, reference: saved.reference, leadId };
}

export async function scheduleConversationFollowUp(input: {
  conversationId: string;
  dueAt: string;
  type: FollowUpType;
}): Promise<ActionResult> {
  await requireUser();
  const { role, staffId, name } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).sendMessage || !capabilitiesForLeads(role).logContact || !staffId) {
    return { ok: false, error: "Not permitted to schedule follow-ups." };
  }
  const parsedFollowUp = inboxFollowUpRequestSchema.safeParse(input);
  if (!parsedFollowUp.success) return { ok: false, error: "Choose a valid conversation, follow-up type and time." };
  const request = parsedFollowUp.data;
  const dueAt = new Date(request.dueAt);
  if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() <= Date.now()) return { ok: false, error: "Choose a future follow-up time." };

  const { agencyId } = await getCurrentStaffRole();
  if (!agencyId) return { ok: false, error: "Your account is not linked to an agency." };
  const supabase = await db();
  const { data: conversation } = await supabase.from("conversations").select("lead_id").eq("agency_id", agencyId).eq("id", request.conversationId).maybeSingle();
  if (!conversation?.lead_id) return { ok: false, error: "Link a lead before scheduling a follow-up." };
  const store = await loadLeadStore(supabase);
  const before = snapshotLeadStore(store);
  const outcome = setFollowUpInStore(store, {
    leadId: conversation.lead_id,
    actorName: name ?? "Staff",
    nextFollowUpAt: dueAt.toISOString(),
    followUpType: request.type,
    followUpOwnerId: staffId,
    followUpOwnerName: name ?? "Staff",
  }, new Date().toISOString());
  if (!outcome.ok) return { ok: false, error: outcome.error ?? "Could not schedule follow-up." };
  await persistLeadStore(supabase, before, store);
  revalidatePath("/leads");
  return { ok: true };
}

/**
 * A staff member's free-text reply. Only ever available once the
 * conversation is HUMAN_ACTIVE — enforced both by the UI (message-composer
 * disables itself otherwise) and here, since the UI check alone is not a
 * security boundary.
 */
/** What the browser needs to upload one file straight to storage: a path the server chose and a one-file token. */
export type PrepareStaffAttachmentResult = { ok: true; path: string; token: string; filename: string } | { ok: false; error: string };

/**
 * Step one of sending a file. Checks who may send here, validates the type and size the browser claims, and issues an upload for a path
 * the server names. Nothing is sent by this: `sendStaffMessage` reads the stored file back and judges it before queueing.
 */
export async function prepareStaffAttachmentUpload(input: { conversationId: string; filename: string; mimeType: string; byteSize: number }): Promise<PrepareStaffAttachmentResult> {
  await requireUser();
  const parsed = prepareStaffAttachmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the file." };
  const supabase = await db();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).sendMessage) return { ok: false, error: "Not permitted." };
  if (!agencyId) return { ok: false, error: "Your account is not linked to an agency." };
  // Row security already confines the session to its agency; naming it here keeps the guarantee if a policy ever loosens.
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id, channel, state")
    .eq("agency_id", agencyId)
    .eq("id", parsed.data.conversationId)
    .single();
  if (conversationError || !conversation) return { ok: false, error: "Conversation not found." };
  if (conversation.state === "CLOSED") return { ok: false, error: "This conversation is closed." };
  return createStaffAttachmentUpload(createAdminClient(), {
    agencyId,
    conversationId: parsed.data.conversationId,
    channel: conversation.channel as string,
    filename: parsed.data.filename,
    mimeType: parsed.data.mimeType,
  });
}

/** A send that succeeded says which canonical message it created (or, on a retry, already had), so the browser settles by exact id. */
export type SendStaffMessageResult = { ok: true; messageId?: string } | { ok: false; error: string };

/** Email only (docs/inbox/email-channel-implementation-plan.md, Phase 3): absent on every other channel. */
export interface EmailReplyFields {
  subject?: string;
  cc?: string[];
  bcc?: string[];
}

export async function sendStaffMessage(
  conversationId: string,
  body: string,
  proposalId?: string | null,
  clientIdempotencyKey?: string,
  attachment?: StagedAttachmentRef | null,
  emailFields?: EmailReplyFields | null,
): Promise<SendStaffMessageResult> {
  await requireUser();
  const parsedAttachment = attachment ? stagedAttachmentRefSchema.safeParse(attachment) : null;
  if (parsedAttachment && !parsedAttachment.success) return { ok: false, error: "Attach the file again." };
  // With a file, the text is an optional caption; without one, a message must have text.
  const parsedMessage = (parsedAttachment ? inboxStaffCaptionSchema : inboxStaffMessageSchema).safeParse({
    conversationId, body, clientIdempotencyKey,
    subject: emailFields?.subject, cc: emailFields?.cc, bcc: emailFields?.bcc,
  });
  if (!parsedMessage.success) return { ok: false, error: parsedMessage.error.issues[0]?.message ?? "Check the message." };
  const trimmedBody = parsedMessage.data.body;
  const emailSendFields = {
    subject: parsedMessage.data.subject ?? null,
    cc: parsedMessage.data.cc?.length ? parsedMessage.data.cc : null,
    bcc: parsedMessage.data.bcc?.length ? parsedMessage.data.bcc : null,
  };

  // The session check, the role lookup and the conversation read do not depend on each other, so they run
  // together (each is a round trip to the database). The role decides whether the read's result is used at all.
  const supabase = await db();
  const [{ role, agencyId, staffId }, { data: conversation, error: conversationError }] = await Promise.all([
    getCurrentStaffRole(),
    supabase.from("conversations").select("id, channel, state, handling_mode, assigned_to_id, assigned_to_name, service_window_expires_at, human_agent_window_expires_at").eq("id", conversationId).single(),
  ]);
  if (!capabilitiesForInbox(role).sendMessage) return { ok: false, error: "Not permitted." };
  if (conversationError || !conversation) return { ok: false, error: "Conversation not found." };
  if (!agencyId) return { ok: false, error: "Your account is not linked to an agency." };
  if (proposalId && !z.string().uuid().safeParse(proposalId).success) return { ok: false, error: "The Copilot proposal reference is not valid." };
  // The file is read back from storage and judged from its own bytes before anything is queued. The browser's word is never proof.
  let stagedFile: Extract<Awaited<ReturnType<typeof verifyStagedAttachment>>, { ok: true }> | null = null;
  if (parsedAttachment?.success) {
    const verified = await verifyStagedAttachment(createAdminClient(), { agencyId, conversationId, channel: conversation.channel as string, ref: parsedAttachment.data });
    if (!verified.ok) return { ok: false, error: verified.error };
    stagedFile = verified;
  }

  // The protection gate (MI4.2), enforced HERE, on the server: hiding a button is never the boundary. While a blocking review is
  // open, a message that says what the review guards (a payment confirmation while the payment claim is open) is refused until
  // the review is resolved with a note. If the open reviews cannot be read, nothing is sent: unknown is not "clear".
  try {
    const protection = await loadProtectionContext(supabase, agencyId, conversationId);
    // The gate reads everything the customer will see, not only the body: an email subject or a file name can carry the same promise.
    const decision = evaluateProtection({ text: outboundGateText({ subject: emailSendFields.subject, body: trimmedBody, filename: stagedFile?.filename }), audience: "STAFF_SEND", openReviews: protection.openReviews, approvedAccountDigits: protection.approvedAccountDigits });
    if (!decision.allowed) return { ok: false, error: refusalMessage(decision) };
  } catch (cause) {
    console.error("Protection gate could not read the open reviews:", cause instanceof Error ? cause.message : cause);
    return { ok: false, error: "Could not check whether a review is open on this conversation. Try again in a moment." };
  }
  if (conversation.state === "CLOSED") return { ok: false, error: "This conversation is closed." };
  // A channel that can receive but has no sender installed yet (Messenger until its send path ships) must
  // say so up front, not fail later in the outbox where the customer would never be answered.
  if (!hasChannelAdapter(conversation.channel as ChannelProvider)) {
    return { ok: false, error: "Replying on this channel isn't available yet. You can read the conversation here." };
  }
  // Email has no provider reply window (resolveChannelPolicyState allows a free-form reply at any time), so a stored
  // service_window_expires_at must never block it; the 24h rule below is Meta's alone.
  if (
    conversation.channel !== "GMAIL" &&
    conversation.service_window_expires_at &&
    new Date(conversation.service_window_expires_at as string).getTime() < Date.now()
  ) {
    if (conversation.channel === "MESSENGER" || conversation.channel === "INSTAGRAM") {
      const { data: supportCases } = await supabase.from("conversation_interventions").select("id")
        .eq("conversation_id", conversationId).in("status", ["OPEN", "ACKNOWLEDGED"])
        .in("kind", ["COMPLAINT", "DISTRESSED_CUSTOMER", "FRAUD_CONCERN", "MEDICAL_URGENCY", "REFUND_REQUEST"]).limit(1);
      const humanAgentAllowed = (conversation.state === "HUMAN_ACTIVE" || conversation.handling_mode === "HUMAN_ACTIVE")
        && (supportCases?.length ?? 0) > 0
        && conversation.human_agent_window_expires_at
        && new Date(conversation.human_agent_window_expires_at as string).getTime() >= Date.now();
      if (humanAgentAllowed) {
        // The outbox drain independently re-checks this state and is the only place that applies HUMAN_AGENT.
      } else {
        return { ok: false, error: `Outside the allowed ${getChannelProfile(conversation.channel as ChannelProvider).displayName} support window. Re-engage on another consented channel or wait for the customer.` };
      }
    } else {
    // Every Meta channel has a 24h reply window; only WhatsApp can reopen one with a template.
    return {
      ok: false,
      error:
        conversation.channel === "WHATSAPP"
          ? "Outside the 24h WhatsApp service window — only an approved template can be sent now."
          : `Outside the 24h ${getChannelProfile(conversation.channel as ChannelProvider).displayName} reply window — Meta only lets you reply within 24 hours of the customer's last message. Wait for them to write again.`,
    };
    }
  }

  // Replying from the CRM while the assistant (or nobody) has the chat means a person is now answering, exactly
  // as when the agency types in the WhatsApp Business app: take control first so the assistant stops replying.
  // The queue function refuses a chat that is not with a person, so control is taken first. If queueing then fails, the chat
  // goes back as it was: otherwise the assistant would stay silenced on a chat where nothing was sent.
  const tookControl = conversation.state !== "HUMAN_ACTIVE";
  if (tookControl) {
    const takeover = await takeControl(conversationId);
    if (!takeover.ok) return takeover;
  }

  // The key comes from the browser's send attempt: a retry after a lost response returns the message already stored.
  // A caller that supplies none (an older client) still gets a fresh key, exactly as before.
  const idempotencyKey = parsedMessage.data.clientIdempotencyKey ?? crypto.randomUUID();
  const { data: enqueued, error } = stagedFile
    ? await supabase.rpc("enqueue_inbox_media_message", {
        p_conversation_id: conversationId,
        p_caption: trimmedBody,
        p_client_idempotency_key: idempotencyKey,
        p_storage_path: stagedFile.path,
        p_filename: stagedFile.filename,
        p_mime_type: stagedFile.mimeType,
        p_byte_size: stagedFile.byteSize,
        p_checksum_sha256: stagedFile.checksumSha256,
        p_subject: emailSendFields.subject,
        p_cc: emailSendFields.cc,
        p_bcc: emailSendFields.bcc,
      })
    : await supabase.rpc("enqueue_inbox_text_message", {
        p_conversation_id: conversationId,
        p_body: trimmedBody,
        p_subject: emailSendFields.subject,
        p_cc: emailSendFields.cc,
        p_bcc: emailSendFields.bcc,
        p_client_idempotency_key: idempotencyKey,
      });
  if (error) {
    if (tookControl) {
      const { error: restoreError } = await supabase
        .from("conversations")
        .update({ state: conversation.state, assigned_to_id: (conversation.assigned_to_id as string | null) ?? null, assigned_to_name: (conversation.assigned_to_name as string | null) ?? null })
        .eq("agency_id", agencyId)
        .eq("id", conversationId)
        // Only undo our own takeover: if anything changed the chat since, leave it as it now is.
        .eq("state", "HUMAN_ACTIVE")
        .eq("assigned_to_id", staffId ?? "");
      if (restoreError) console.error("Inbox action failed (sendStaffMessage.restore):", restoreError.message);
    }
    return inboxFailure("sendStaffMessage.enqueue", error, "The message could not be sent. Please try again.");
  }
  const createdMessageId = (Array.isArray(enqueued) ? enqueued[0] : enqueued)?.message_id as string | undefined;

  if (proposalId && staffId) {
    const admin = createAdminClient();
    const { data: proposal } = await admin.from("inbox_autonomy_decisions").select("candidate_text, source, reasons").eq("id", proposalId).eq("agency_id", agencyId).eq("conversation_id", conversationId).eq("decision", "PROPOSED").maybeSingle();
    if (proposal?.candidate_text) {
      const review = classifyProposalReview(String(proposal.candidate_text), trimmedBody);
      await admin.from("inbox_autonomy_decisions").update({ decision: review.decision, correct: review.correct, reviewed_by: staffId, reviewed_at: new Date().toISOString(), reasons: [`Staff edit similarity: ${Math.round(review.similarity * 100)}%`] }).eq("id", proposalId).eq("agency_id", agencyId).eq("decision", "PROPOSED");
      if (proposal.source === "APPROVED_ANSWER" && review.decision === "REJECTED") {
        const cacheReason = ((proposal.reasons ?? []) as string[]).find((reason) => reason.startsWith("answer_cache_id:"));
        const answerId = cacheReason?.slice("answer_cache_id:".length);
        if (answerId && z.string().uuid().safeParse(answerId).success) {
          await rejectApprovedInboxAnswer(admin, { agencyId, answerId, reason: "Retired after two substantial staff corrections." });
        }
      }
    }
  }

  // The always-on worker (INBOX_WORKER_ACTIVE) drains the outbox itself; the scheduled drain remains the guarantee.
  if (!isInboxWorkerActive()) {
    after(() => processDueInboxOutbox({ budgetMs: 20_000 }).catch((error) => console.error("Inbox outbox drain failed", error)));
  }
  return createdMessageId ? { ok: true, messageId: createdMessageId } : { ok: true };
}
