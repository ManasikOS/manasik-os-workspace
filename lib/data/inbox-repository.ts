import { loadConversationHandoff } from "@/lib/data/conversation-handoff-repository";
import { cookies } from "next/headers";

import type {
  InboxAttachment,
  InboxConversation,
  InboxConversationData,
  InboxConversationListPatch,
  InboxCustomerContext,
  InboxListData,
  InboxMediaAnalysis,
  InboxMentionableStaff,
  InboxMessage,
  InboxNote,
  InboxNotesDelta,
  InboxHistoryRead,
  InboxPresenceRead,
  InboxSavedReply,
  InboxTemplate,
  InboxThreadDelta,
} from "@/app/inbox/types";
import { findLatestTemplateRates } from "@/lib/data/whatsapp-billing-repository";
import { countryForWaId } from "@/lib/agent/whatsapp/phone";
import { capabilitiesForFinance } from "@/lib/access/finance-access";
import { capabilitiesForInbox } from "@/lib/access/inbox-access";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import { canCopyReceiptToFinance } from "@/lib/finance/finance-evidence";
import { capabilitiesFor } from "@/lib/access/departure-groups-access";
import { capabilitiesForLeads } from "@/lib/access/leads-access";
import { requireUser } from "@/lib/dal";
import { loadProposalsForConversation } from "@/lib/data/identity-graph-repository";
import { assembleInboxIntelligence } from "@/lib/data/inbox-intelligence-repository";
import type { InboxIntelligenceData } from "@/lib/inbox/intelligence/rail-view";
import { INBOX_SEARCH_LIMIT, normaliseSearchQuery } from "@/lib/inbox/search-query";
import { countsByView, queueForView } from "@/lib/inbox/views";
import { listQueueConversationIds, loadInboxQueuesV2Enabled, loadQueueCounts } from "@/lib/data/inbox-queue-repository";
import type { InboxListPatchRequest, InboxNotesDeltaRequest, InboxThreadDeltaRequest, InboxWorkspaceRequest } from "@/lib/validations/inbox";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { INBOX_ATTACHMENT_BUCKET } from "@/lib/inbox/media/handlers";
import { canViewPassportMedia, withholdPassportMedia } from "@/lib/inbox/media/passport-visibility";
import { attachVoiceTranscripts, canViewVoiceTranscripts, type VoiceTranscriptRowForView } from "@/lib/inbox/media/voice-transcript";
import { isInboxEmailMailboxReady } from "@/lib/inbox/email-mailbox-readiness";

import { getCurrentStaffRole } from "./departure-groups";

/**
 * The Inbox loads in four independent pieces so the dialog can paint the
 * chat list first, then the open conversation, then the lead panel and the
 * Copilot reading side by side:
 *
 *   loadInboxListData          → chat list + per-view counts + templates
 *   loadInboxConversationData  → messages, notes, saved replies, draft
 *   loadInboxLeadContext       → lead + booking for the open conversation
 *   loadInboxIntelligence      → Copilot's stored reading (intent, urgency, signals)
 *
 * Every piece calls `requireUser()` and reads through the RLS-scoped client,
 * so each is safe to expose as its own Server Action.
 */


/** The intervention kinds that put a "support case" flag on a conversation in the list. */
const SUPPORT_CASE_KINDS = ["COMPLAINT", "DISTRESSED_CUSTOMER", "FRAUD_CONCERN", "MEDICAL_URGENCY", "REFUND_REQUEST"] as const;

/** The most messages one thread delta returns. A larger backlog is paged: the browser asks again from `highestSequence`. */
export const THREAD_DELTA_LIMIT = 200;
const NOTES_DELTA_LIMIT = 100;

const EMPTY_LEAD_CONTEXT_FLAGS = {
  canViewBalance: false,
  canCreateBooking: false,
  canUseCopilot: false,
  canScheduleFollowUp: false,
} as const;

/** A conversation row as read with its lead embedded, before the list adds the last message and support-case flag. */
type ConversationWithLead = InboxConversation & {
  leads: {
    reference: string;
    stage: string;
    desired_package_name: string | null;
  } | null;
};

/** The select that reads a conversation with the lead fields the list shows. Named FK: leads also points back at conversations. */
const CONVERSATION_WITH_LEAD_SELECT = "*, leads!conversations_lead_agency_fkey(reference, stage, desired_package_name)";

/**
 * Turns conversation rows into list rows: puts them in the given order, and adds each one's last message and whether it has
 * an open support case (two reads for the whole set, never one per chat). Shared by the list and by search, so a search
 * result looks and behaves exactly like a listed chat.
 */
async function hydrateInboxConversations(
  supabase: InboxSessionDb,
  rows: ConversationWithLead[],
  order: readonly string[],
): Promise<InboxConversation[]> {
  const orderedConversations = [...rows].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const conversationIds = orderedConversations.map((row) => row.id);

  // Fetch the last message for each conversation in a single query: newest first, then keep the first hit per chat.
  const [{ data: lastMessageRows }, { data: supportCaseRows }] = await Promise.all([
    conversationIds.length > 0
      ? await supabase
          .from("conversation_messages")
          .select("conversation_id, content, role, message_type")
          .in("conversation_id", conversationIds)
          .order("created_at", { ascending: false })
          .limit(conversationIds.length * 5) // at most 5 messages per conversation fetched
      : Promise.resolve({ data: [] }),
    conversationIds.length > 0
      ? supabase.from("conversation_interventions").select("conversation_id").in("conversation_id", conversationIds).in("status", ["OPEN", "ACKNOWLEDGED"]).in("kind", [...SUPPORT_CASE_KINDS])
      : Promise.resolve({ data: [] }),
  ]);

  const lastMessageByConvId = new Map<string, { content: string; role: string; messageType: string }>();
  const supportCaseConversationIds = new Set(((supportCaseRows ?? []) as Array<{ conversation_id: string }>).map((row) => row.conversation_id));
  for (const row of lastMessageRows ?? []) {
    const r = row as { conversation_id: string; content: string; role: string; message_type: string };
    if (!lastMessageByConvId.has(r.conversation_id)) {
      lastMessageByConvId.set(r.conversation_id, {
        content: r.content,
        role: r.role,
        messageType: r.message_type,
      });
    }
  }

  return orderedConversations.map((row) => ({
    ...row,
    lead_reference: row.leads?.reference ?? null,
    lead_stage: row.leads?.stage ?? null,
    desired_package_name: row.leads?.desired_package_name ?? null,
    last_message_content: lastMessageByConvId.get(row.id)?.content ?? null,
    last_message_role: lastMessageByConvId.get(row.id)?.role ?? null,
    last_message_type: lastMessageByConvId.get(row.id)?.messageType ?? null,
    has_open_support_case: supportCaseConversationIds.has(row.id),
  }));
}

export async function loadInboxListData(
  request: InboxWorkspaceRequest,
): Promise<InboxListData | null> {
  await requireUser();
  const { role, roleId, staffId, agencyId } = await getCurrentStaffRole();
  const capabilities = capabilitiesForInbox(role);
  if (!capabilities.viewModule) return null;

  const supabase = createClient(await cookies());
  const leadCapabilities = capabilitiesForLeads(role);

  // Which chats belong to a view, and the rail counts, are read from the queue membership table (one indexed count,
  // one keyset-paginated list) — never from a scan of the agency's chats, so cost no longer grows with agency size.
  const [
    queueCounts,
    page,
    queuesV2,
    emailMailbox,
    effectiveInboxCapabilities,
    effectiveFinanceCapabilities,
  ] = await Promise.all([
    loadQueueCounts(supabase, staffId),
    listQueueConversationIds(supabase, {
      agencyId: agencyId ?? "",
      staffId,
      queue: queueForView(request.view),
      cursor: request.cursor ?? null,
    }),
    loadInboxQueuesV2Enabled(supabase, agencyId ?? ""),
    capabilities.sendMessage && agencyId
      ? supabase
          .from("channel_connections")
          .select("status, provider_metadata")
          .eq("agency_id", agencyId)
          .eq("provider", "GMAIL")
          .maybeSingle()
      : Promise.resolve({ data: null }),
    loadDynamicCapabilities(supabase, roleId, "inbox", capabilities),
    loadDynamicCapabilities(
      supabase,
      roleId,
      "finance",
      capabilitiesForFinance(role),
    ),
  ]);
  const viewCounts = countsByView(queueCounts);
  const idsInView = page.ids;
  // A chat opened from elsewhere (a notification, a just-started chat) may sit outside the current view.
  const idsToLoad =
    request.conversationId && !idsInView.includes(request.conversationId)
      ? [request.conversationId, ...idsInView]
      : idsInView;

  const [{ data: conversations, error: conversationsError }, { data: templates }] = await Promise.all([
    idsToLoad.length > 0
      ? supabase
          .from("conversations")
          // Named FK (the agency-scoped key every database has, see 20270107090000): leads also points back at conversations (source_conversation_id), so a bare `leads(...)` is ambiguous.
          .select(CONVERSATION_WITH_LEAD_SELECT)
          .in("id", idsToLoad)
      : Promise.resolve({ data: [], error: null }),
    capabilities.sendMessage
      ? supabase
          .from("whatsapp_templates")
          .select("id, name, language, category, components")
          .eq("status", "APPROVED")
          .order("name")
      : Promise.resolve({ data: [] }),
  ]);

  if (conversationsError) throw new Error(`Could not load the conversations: ${conversationsError.message}`);

  // `in (...)` returns rows in no particular order; the list is newest first, with the requested chat on top.
  const list = await hydrateInboxConversations(supabase, (conversations ?? []) as ConversationWithLead[], idsToLoad);
  // A requested chat that no longer exists (cleared, or not visible to this person) falls back to the first
  // chat in the view instead of leaving the workspace pointing at nothing.
  const activeConversation =
    list.find((conversation) => conversation.id === request.conversationId) ??
    list[0] ??
    null;
  const activeConversationId = activeConversation?.id ?? null;

  const canCopyActiveReceipt = canCopyReceiptToFinance({
    role,
    staffId,
    assignedToId: activeConversation?.assigned_to_id ?? null,
    openFinanceReview:
      effectiveInboxCapabilities.viewModule
      && effectiveFinanceCapabilities.viewLedger,
  });
  const activeCapabilities = {
    ...capabilities,
    openFinanceReview: canCopyActiveReceipt,
  };

  const templateRows = (templates ?? []) as InboxTemplate[];
  let projectedTemplates = templateRows;
  if (activeConversation?.channel === "WHATSAPP" && agencyId && activeConversation.contact_phone) {
    const rates = await findLatestTemplateRates(
      createAdminClient(),
      agencyId,
      countryForWaId(String(activeConversation.contact_phone).replace(/\D/g, "")),
      [...new Set(templateRows.map((template) => template.category))],
    );
    projectedTemplates = templateRows.map((template) => ({
      ...template,
      projected_charge: rates[template.category]?.amount ?? null,
      charge_currency: rates[template.category]?.currency ?? null,
    }));
  }

  return {
    agencyId,
    staffId,
    capabilities: activeCapabilities,
    emailMailboxReady: isInboxEmailMailboxReady(emailMailbox.data),
    canUseCopilot: capabilities.sendMessage && leadCapabilities.useCopilot,
    conversations: list,
    viewCounts,
    queueCounts,
    queuesV2,
    nextCursor: page.nextCursor,
    activeConversation,
    activeConversationId,
    activeView: request.view,
    templates: projectedTemplates,
  };
}

type InboxSessionDb = ReturnType<typeof createClient>;

/**
 * Attachments (with short-lived signed links) and media analyses for exactly the given messages. Shared by the full
 * conversation load and the SC3 thread delta, so a delta signs links only for the messages it returns — never for the
 * whole thread on every event.
 */
async function loadMessageArtifacts(
  supabase: InboxSessionDb,
  agencyId: string | null,
  messageIds: string[],
  canViewTranscripts: boolean,
  canViewPassports: boolean,
): Promise<{ attachments: InboxAttachment[]; mediaAnalyses: InboxMediaAnalysis[] }> {
  // A role without passport access never gets the photo link or the model's read-out. Which attachments are passports is read with the service
  // key because the database hides those analyses from that role too; if it cannot be read, nothing is shown (unknown is not "allowed").
  const passportAttachmentIds = canViewPassports || messageIds.length === 0 ? new Set<string>() : await loadPassportAttachmentIds(agencyId, messageIds);
  const { data: mediaRows } = messageIds.length > 0
    ? await supabase.from("message_media_analyses")
        .select("id,message_id,attachment_id,kind,status,candidate_fields,confidence,uncertainty,review_fields,candidate_traveller_ids,selected_traveller_id")
        .eq("agency_id", agencyId ?? "")
        .in("message_id", messageIds)
        .order("created_at")
    : { data: [] };
  const { data: attachmentRows } = messageIds.length > 0
    ? await supabase.from("message_attachments").select("id,message_id,filename,mime_type,storage_path,metadata,expires_at,promoted_document_id,checksum_sha256").eq("agency_id", agencyId ?? "").in("message_id", messageIds)
    : { data: [] };
  // Staff-only, non-authoritative transcripts of voice notes. Skipped entirely for a role that may not read them, so
  // no transcript text is even fetched. The columns are explicit: nothing else on the row is needed.
  const voiceAttachmentIds = ((mediaRows ?? []) as Array<{ kind?: unknown; attachment_id?: unknown }>)
    .filter((row) => row.kind === "VOICE" && typeof row.attachment_id === "string")
    .map((row) => String(row.attachment_id));
  const { data: transcriptRows } = canViewTranscripts && voiceAttachmentIds.length > 0
    ? await supabase.from("inbox_voice_transcripts")
        .select("attachment_id,status,transcript_text,language,confidence,failure_reason")
        .eq("agency_id", agencyId ?? "")
        .in("attachment_id", voiceAttachmentIds)
    : { data: [] };
  const attachmentsWithUrls = await Promise.all(((attachmentRows ?? []) as Array<{ id: string; message_id: string; filename: string | null; mime_type: string; storage_path: string | null; metadata: Record<string, unknown>; expires_at: string | null; promoted_document_id: string | null; checksum_sha256: string | null }>).map(async (row) => {
    if (!row.storage_path || passportAttachmentIds.has(row.id)) return { ...row, original_href: null as string | null };
    const signed = await supabase.storage.from(INBOX_ATTACHMENT_BUCKET).createSignedUrl(row.storage_path, 300);
    const version = typeof row.checksum_sha256 === "string" ? `&v=${encodeURIComponent(row.checksum_sha256.slice(0, 12))}` : "";
    return { ...row, original_href: signed.error ? null : `${signed.data.signedUrl}${version}` };
  }));
  const attachmentById = new Map(attachmentsWithUrls.map((row) => [row.id, row]));
  const candidateTravellerIds = [...new Set(((mediaRows ?? []) as Array<{ candidate_traveller_ids?: unknown }>).flatMap((row) => Array.isArray(row.candidate_traveller_ids) ? row.candidate_traveller_ids.filter((id): id is string => typeof id === "string") : []))];
  const { data: travellerRows } = candidateTravellerIds.length > 0
    ? await supabase.from("departure_group_pilgrims").select("id,full_name_snapshot").eq("agency_id", agencyId ?? "").in("id", candidateTravellerIds)
    : { data: [] };
  const travellerNames = new Map(((travellerRows ?? []) as Array<{ id: string; full_name_snapshot: string }>).map((traveller) => [traveller.id, traveller.full_name_snapshot]));
  const attachments: InboxAttachment[] = attachmentsWithUrls.map((row) => ({
    id: row.id,
    message_id: row.message_id,
    filename: row.filename,
    mime_type: row.mime_type,
    original_href: row.original_href,
    expires_at: row.expires_at,
    promoted_document_id: row.promoted_document_id,
  }));
  const mediaAnalysesWithoutTranscripts = ((mediaRows ?? []) as Array<Record<string, unknown>>).map((row) => {
    const attachment = attachmentById.get(String(row.attachment_id));
    return {
      id: String(row.id),
      message_id: String(row.message_id),
      attachment_id: String(row.attachment_id),
      kind: String(row.kind),
      status: String(row.status),
      candidate_fields: (row.candidate_fields ?? {}) as Record<string, unknown>,
      confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
      uncertainty: Array.isArray(row.uncertainty) ? row.uncertainty : [],
      review_fields: (row.review_fields ?? {}) as Record<string, unknown>,
      traveller_options: (Array.isArray(row.candidate_traveller_ids) ? row.candidate_traveller_ids : [])
        .filter((id): id is string => typeof id === "string" && travellerNames.has(id))
        .map((id) => ({ id, name: travellerNames.get(id) ?? "Traveller" })),
      selected_traveller_id: typeof row.selected_traveller_id === "string" ? row.selected_traveller_id : null,
      mime_type: attachment?.mime_type ?? null,
      original_href: attachment?.original_href ?? null,
      expires_at: attachment?.expires_at ?? null,
      promoted_document_id: attachment?.promoted_document_id ?? null,
    };
  });
  const mediaAnalyses = attachVoiceTranscripts(
    mediaAnalysesWithoutTranscripts,
    (transcriptRows ?? []) as Array<VoiceTranscriptRowForView & { attachment_id: string }>,
    canViewTranscripts,
  );
  return withholdPassportMedia({ attachments, mediaAnalyses, passportAttachmentIds });
}

/** The attachments among these messages that the model classed as passports, whatever the caller's own row access. */
async function loadPassportAttachmentIds(agencyId: string | null, messageIds: string[]): Promise<Set<string>> {
  if (!agencyId) throw new Error("Could not tell which attachments are passports: no agency.");
  const { data, error } = await createAdminClient()
    .from("message_media_analyses")
    .select("attachment_id")
    .eq("agency_id", agencyId)
    .eq("kind", "PASSPORT")
    .in("message_id", messageIds);
  if (error) throw new Error(`Could not tell which attachments are passports: ${error.message}`);
  return new Set(((data ?? []) as Array<{ attachment_id: string }>).map((row) => row.attachment_id));
}

export async function loadInboxConversationData(
  conversationId: string,
): Promise<InboxConversationData | null> {
  await requireUser();
  const { role, staffId, agencyId } = await getCurrentStaffRole();
  const capabilities = capabilitiesForInbox(role);
  if (!capabilities.viewModule) return null;

  const supabase = createClient(await cookies());
  const [
    { data: messageRows },
    { data: noteRows },
    { data: savedReplyRows },
    { data: draftRow },
    { data: staffRows },
    { data: conversationRow },
  ] = await Promise.all([
    supabase
      .from("conversation_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      // Read the newest page, then reverse it below for chronological display.
      // Ascending + limit returned the oldest 200 rows and hid new realtime messages in long threads.
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("conversation_notes")
      .select(
        "id, conversation_id, body, author_id, author_name_snapshot, created_at",
      )
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(100),
    capabilities.sendMessage
      ? supabase
          .from("saved_replies")
          .select("id, title, body, language, providers")
          .order("title")
          .limit(100)
      : Promise.resolve({ data: [] }),
    capabilities.sendMessage
      && staffId
      ? supabase
          .from("conversation_drafts")
          .select("body")
          .eq("conversation_id", conversationId)
          .eq("author_id", staffId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    capabilities.sendMessage
      ? supabase
          .from("staff_profiles")
          .select("id, full_name")
          .eq("status", "ACTIVE")
          .order("full_name")
          .limit(100)
      : Promise.resolve({ data: [] }),
    capabilities.sendMessage
      ? supabase
          .from("conversations")
          .select("composing_by, composing_at")
          .eq("id", conversationId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const messages = ([...(messageRows ?? [])] as InboxMessage[]).reverse();
  const notes = ([...(noteRows ?? [])] as InboxNote[]).reverse();
  const mentionableStaff: InboxMentionableStaff[] = (
    (staffRows ?? []) as { id: string; full_name: string }[]
  ).map((staff) => ({ id: staff.id, name: staff.full_name }));

  const { attachments, mediaAnalyses } = await loadMessageArtifacts(supabase, agencyId, messages.map((message) => message.id), canViewVoiceTranscripts(role), canViewPassportMedia(role));

  return {
    messages,
    attachments,
    mediaAnalyses,
    notes,
    savedReplies: (savedReplyRows ?? []) as InboxSavedReply[],
    mentionableStaff,
    draft: (draftRow?.body as string | undefined) ?? "",
    composerPresence:
      conversationRow?.composing_by && conversationRow.composing_at
        ? {
            staffId: conversationRow.composing_by as string,
            at: conversationRow.composing_at as string,
          }
        : null,
  };
}

export async function loadInboxLeadContext(
  conversationId: string,
): Promise<InboxCustomerContext | null> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).viewModule || !agencyId) return null;

  const leadCapabilities = capabilitiesForLeads(role);
  const inboxCapabilities = capabilitiesForInbox(role);
  const emptyContext: InboxCustomerContext = {
    lead: null,
    booking: null,
    ...EMPTY_LEAD_CONTEXT_FLAGS,
    canSelectDepartureGroup: leadCapabilities.findGroups,
    canCreateLead: leadCapabilities.createLead,
  };

  const supabase = createClient(await cookies());
  // The lead id comes from the conversation row (RLS-scoped), never from the
  // client, so a caller can only reach the lead of a conversation they can see.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("lead_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation?.lead_id) {
    // No lead yet: the graph may have found one this contact could already be. A failed read shows the plain "no lead" panel.
    const proposals = await loadProposalsForConversation(supabase, agencyId, conversationId).catch((cause) => {
      console.error("Could not load identity suggestions:", cause instanceof Error ? cause.message : cause);
      return [];
    });
    return { ...emptyContext, identityProposals: proposals, canDecideIdentity: capabilitiesForInbox(role).sendMessage };
  }

  const { data: lead } = await supabase
    .from("leads")
    .select(
      "id, reference, full_name, mobile, email, stage, preferred_language, desired_package_name, preferred_period, selected_departure_group_id, booking_id, next_follow_up_at, follow_up_type, follow_up_owner_name, adults, children, journey_type, desired_package_id, room_preference",
    )
    .eq("id", conversation.lead_id)
    .maybeSingle();
  if (!lead) return emptyContext;

  const canViewBalance = capabilitiesForFinance(role).viewModule;
  let booking: InboxCustomerContext["booking"] = null;

  if (lead.booking_id) {
    const { data: bookingRow } = await supabase
      .from("departure_group_bookings")
      .select(
        "id, departure_group_id, booking_reference, booking_status, traveller_count, outstanding_balance, seat_hold_expires_at",
      )
      .eq("id", lead.booking_id)
      .maybeSingle();

    if (bookingRow) {
      const { data: groupRow } = bookingRow.departure_group_id
        ? await supabase.from("departure_groups").select("group_name").eq("id", bookingRow.departure_group_id).maybeSingle()
        : { data: null };
      booking = {
        id: bookingRow.id as string,
        departure_group_name: (groupRow?.group_name as string | null | undefined) ?? null,
        departure_group_id: (bookingRow.departure_group_id as string | null | undefined) ?? null,
        seat_hold_expires_at: (bookingRow.seat_hold_expires_at as string | null | undefined) ?? null,
        booking_reference: bookingRow.booking_reference as string,
        booking_status: bookingRow.booking_status as string,
        traveller_count: bookingRow.traveller_count as number,
        outstanding_balance: canViewBalance
          ? Number(bookingRow.outstanding_balance)
          : null,
        currency: canViewBalance ? "LKR" : null,
      };
    }
  }

  // The handoff already made for this conversation (MI4.5). A failed read shows the panel without it, never an error.
  const handoff = booking?.booking_status === "CONFIRMED"
    ? await loadConversationHandoff(supabase, agencyId, conversationId).catch((cause) => {
        console.error("Could not load the conversation's handoff:", cause instanceof Error ? cause.message : cause);
        return null;
      })
    : null;

  return {
    lead: lead as InboxCustomerContext["lead"],
    booking,
    handoff,
    canViewBalance,
    // Mirror the pages these links open: Leads for the lead, Departure Groups for its bookings and groups.
    canOpenLead: leadCapabilities.viewModule,
    canOpenBooking: capabilitiesFor(role).viewModule,
    canOpenDepartureGroup: capabilitiesFor(role).viewModule,
    canCreateBooking: leadCapabilities.convertToBooking,
    canUseCopilot: leadCapabilities.useCopilot,
    canScheduleFollowUp: leadCapabilities.logContact,
    canSelectDepartureGroup: leadCapabilities.findGroups,
    canCreateLead: leadCapabilities.createLead,
    canConvertConversation: inboxCapabilities.sendMessage && inboxCapabilities.convertConversation,
  };
}


/** The fourth independent loader: a slow projection read can never delay the transcript or the lead panel. */
export async function loadInboxIntelligence(
  conversationId: string,
): Promise<InboxIntelligenceData | null> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).viewModule || !agencyId) return null;

  const supabase = createClient(await cookies());
  return assembleInboxIntelligence(supabase, agencyId, conversationId);
}


/* ── SC3: scoped reads (docs/inbox/scaling.md §7) ─────────────────────────────
 *
 * Realtime only says "this conversation changed". These read exactly that much back — one list row, the messages after a
 * sequence, the notes after a keyset position, the composer lease — instead of the 100-row list or the 200-message page.
 * Every one calls `requireUser()`, names the agency next to the conversation, and reads through the session client, so
 * row security is still the boundary and two agencies can never see each other's rows.
 */

/** One conversation as the list shows it, whether it belongs in the given view, and (on request) the exact rail counts. */
export async function loadInboxConversationListPatch(
  request: InboxListPatchRequest,
): Promise<InboxConversationListPatch | null> {
  await requireUser();
  const { role, staffId, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).viewModule || !agencyId) return null;

  const supabase = createClient(await cookies());
  const queue = queueForView(request.view);

  const [conversationResult, lastMessageResult, supportCaseResult, membershipResult, queueCounts] = await Promise.all([
    supabase
      .from("conversations")
      .select("*, leads!conversations_lead_agency_fkey(reference, stage, desired_package_name)")
      .eq("agency_id", agencyId)
      .eq("id", request.conversationId)
      .maybeSingle(),
    supabase
      .from("conversation_messages")
      .select("content, role, message_type")
      .eq("agency_id", agencyId)
      .eq("conversation_id", request.conversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("conversation_interventions")
      .select("conversation_id")
      .eq("agency_id", agencyId)
      .eq("conversation_id", request.conversationId)
      .in("status", ["OPEN", "ACKNOWLEDGED"])
      .in("kind", [...SUPPORT_CASE_KINDS])
      .limit(1),
    // MINE is per person and not a stored queue: it is answered from the conversation row itself, below.
    queue === "MINE"
      ? Promise.resolve({ data: null, error: null })
      : supabase
          .from("conversation_queue_membership")
          .select("last_activity_at")
          .eq("agency_id", agencyId)
          .eq("queue_code", queue)
          .eq("conversation_id", request.conversationId)
          .maybeSingle(),
    request.includeCounts ? loadQueueCounts(supabase, staffId) : Promise.resolve(null),
  ]);

  if (conversationResult.error) throw new Error(`Could not load the conversation: ${conversationResult.error.message}`);
  if (membershipResult.error) throw new Error(`Could not check the view: ${membershipResult.error.message}`);

  const counts = queueCounts ? { queueCounts, viewCounts: countsByView(queueCounts) } : { queueCounts: null, viewCounts: null };
  const row = conversationResult.data as
    | (InboxConversation & {
        last_activity_at: string | null;
        version: number | null;
        leads: { reference: string; stage: string; desired_package_name: string | null } | null;
      })
    | null;
  if (!row) {
    return { conversation: null, inActiveView: false, lastActivityAt: null, conversationVersion: null, ...counts };
  }

  const lastMessage = lastMessageResult.data as { content: string; role: string; message_type: string } | null;
  const conversation: InboxConversation = {
    ...row,
    lead_reference: row.leads?.reference ?? null,
    lead_stage: row.leads?.stage ?? null,
    desired_package_name: row.leads?.desired_package_name ?? null,
    last_message_content: lastMessage?.content ?? null,
    last_message_role: lastMessage?.role ?? null,
    last_message_type: lastMessage?.message_type ?? null,
    has_open_support_case: (supportCaseResult.data ?? []).length > 0,
  };
  const inActiveView =
    queue === "MINE"
      ? staffId !== null && row.assigned_to_id === staffId && row.state !== "CLOSED"
      : membershipResult.data !== null;

  return {
    conversation,
    inActiveView,
    lastActivityAt: row.last_activity_at ?? null,
    conversationVersion: typeof row.version === "number" ? row.version : null,
    ...counts,
  };
}

/** The messages after `afterSequence` (ascending, one bounded page) plus any specifically requested ones, with only their artifacts. */
export async function loadInboxThreadDelta(request: InboxThreadDeltaRequest): Promise<InboxThreadDelta | null> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).viewModule || !agencyId) return null;

  const supabase = createClient(await cookies());
  const [newer, requested] = await Promise.all([
    supabase
      .from("conversation_messages")
      .select("*")
      .eq("agency_id", agencyId)
      .eq("conversation_id", request.conversationId)
      .gt("sequence_number", request.afterSequence)
      .order("sequence_number", { ascending: true })
      // One extra row tells us whether another page exists without a second count query.
      .limit(THREAD_DELTA_LIMIT + 1),
    request.messageIds.length > 0
      ? supabase
          .from("conversation_messages")
          .select("*")
          .eq("agency_id", agencyId)
          .eq("conversation_id", request.conversationId)
          .in("id", request.messageIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (newer.error) throw new Error(`Could not load new messages: ${newer.error.message}`);
  if (requested.error) throw new Error(`Could not reload messages: ${requested.error.message}`);

  const newerRows = (newer.data ?? []) as InboxMessage[];
  const hasMore = newerRows.length > THREAD_DELTA_LIMIT;
  const page = hasMore ? newerRows.slice(0, THREAD_DELTA_LIMIT) : newerRows;

  const byId = new Map<string, InboxMessage>();
  for (const message of [...page, ...((requested.data ?? []) as InboxMessage[])]) byId.set(message.id, message);
  const messages = [...byId.values()].sort(
    (left, right) => sequenceOf(left) - sequenceOf(right) || left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id),
  );

  const { attachments, mediaAnalyses } = await loadMessageArtifacts(supabase, agencyId, messages.map((message) => message.id), canViewVoiceTranscripts(role), canViewPassportMedia(role));
  const sequences = page.map(sequenceOf).filter((value) => value > 0);
  return {
    messages,
    attachments,
    mediaAnalyses,
    highestSequence: sequences.length > 0 ? Math.max(...sequences) : null,
    hasMore,
  };
}

function sequenceOf(message: InboxMessage): number {
  const value = message.sequence_number;
  return value === null || value === undefined ? 0 : Number(value);
}

/** Notes after a `(created_at, id)` position, plus the current state of specific notes — an id that comes back missing was deleted. */
export async function loadInboxNotesDelta(request: InboxNotesDeltaRequest): Promise<InboxNotesDelta | null> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).viewModule || !agencyId) return null;

  const supabase = createClient(await cookies());
  const columns = "id, conversation_id, body, author_id, author_name_snapshot, created_at";

  let newer = supabase.from("conversation_notes").select(columns).eq("agency_id", agencyId).eq("conversation_id", request.conversationId);
  if (request.after) {
    // Both values were validated by the request schema (a UUID and a timestamp), so they are safe inside the filter.
    newer = newer.or(`created_at.gt.${request.after.createdAt},and(created_at.eq.${request.after.createdAt},id.gt.${request.after.id})`);
  }
  // One extra row says whether another page exists, exactly as the thread delta does.
  const [newerResult, requestedResult] = await Promise.all([
    newer.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(NOTES_DELTA_LIMIT + 1),
    request.noteIds.length > 0
      ? supabase.from("conversation_notes").select(columns).eq("agency_id", agencyId).eq("conversation_id", request.conversationId).in("id", request.noteIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (newerResult.error) throw new Error(`Could not load new notes: ${newerResult.error.message}`);
  if (requestedResult.error) throw new Error(`Could not reload notes: ${requestedResult.error.message}`);

  const newerRows = (newerResult.data ?? []) as InboxNote[];
  const hasMore = newerRows.length > NOTES_DELTA_LIMIT;
  const byId = new Map<string, InboxNote>();
  for (const note of [...(hasMore ? newerRows.slice(0, NOTES_DELTA_LIMIT) : newerRows), ...((requestedResult.data ?? []) as InboxNote[])]) byId.set(note.id, note);
  const found = new Set(((requestedResult.data ?? []) as InboxNote[]).map((note) => note.id));
  return {
    notes: [...byId.values()].sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)),
    removedNoteIds: request.noteIds.filter((id) => !found.has(id)),
    hasMore,
  };
}

/** The composer lease alone: two columns of one conversation, never the messages. */
export async function loadInboxPresence(conversationId: string): Promise<InboxPresenceRead | null> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).viewModule || !agencyId) return null;

  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("conversations")
    .select("composing_by, composing_at")
    .eq("agency_id", agencyId)
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read who is replying: ${error.message}`);
  const row = data as { composing_by: string | null; composing_at: string | null } | null;
  return { composerPresence: row?.composing_by && row.composing_at ? { staffId: row.composing_by, at: row.composing_at } : null };
}

/** The last recorded events of one conversation. Agency-scoped and limited; null when the person may not open the Inbox. */
export async function loadInboxHistory(conversationId: string): Promise<InboxHistoryRead | null> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).viewModule || !agencyId) return null;

  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("conversation_events")
    .select("id, kind, data, occurred_at")
    .eq("agency_id", agencyId)
    .eq("conversation_id", conversationId)
    .order("occurred_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`Could not read the conversation history: ${error.message}`);
  return { events: (data ?? []) as InboxHistoryRead["events"] };
}

/**
 * Searches every conversation of the agency, not just the page on screen: by the customer's name or number, and by their lead's
 * reference, name or package. The text is normalised first (see search-query.ts) because it is placed in a filter. Results are
 * read through the person's own session, so row security still decides what they may see, and come back as ordinary list rows.
 */
export async function searchInboxConversations(rawQuery: string): Promise<InboxConversation[] | null> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForInbox(role).viewModule || !agencyId) return null;
  const query = normaliseSearchQuery(rawQuery);
  if (!query) return [];

  const supabase = createClient(await cookies());
  const pattern = `%${query}%`;

  const { data: leadRows, error: leadError } = await supabase
    .from("leads")
    .select("id")
    .eq("agency_id", agencyId)
    .or(`reference.ilike.${pattern},full_name.ilike.${pattern},desired_package_name.ilike.${pattern}`)
    .limit(INBOX_SEARCH_LIMIT);
  if (leadError) throw new Error(`Could not search leads: ${leadError.message}`);
  const leadIds = ((leadRows ?? []) as Array<{ id: string }>).map((row) => row.id);

  const [byContact, byLead] = await Promise.all([
    supabase
      .from("conversations")
      .select(CONVERSATION_WITH_LEAD_SELECT)
      .eq("agency_id", agencyId)
      .or(`contact_name.ilike.${pattern},contact_phone.ilike.${pattern}`)
      .order("last_activity_at", { ascending: false })
      .limit(INBOX_SEARCH_LIMIT),
    leadIds.length > 0
      ? supabase
          .from("conversations")
          .select(CONVERSATION_WITH_LEAD_SELECT)
          .eq("agency_id", agencyId)
          .in("lead_id", leadIds)
          .order("last_activity_at", { ascending: false })
          .limit(INBOX_SEARCH_LIMIT)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (byContact.error) throw new Error(`Could not search conversations: ${byContact.error.message}`);
  if (byLead.error) throw new Error(`Could not search conversations: ${byLead.error.message}`);

  const merged = new Map<string, ConversationWithLead & { last_activity_at?: string }>();
  for (const row of [...((byContact.data ?? []) as ConversationWithLead[]), ...((byLead.data ?? []) as ConversationWithLead[])]) merged.set(row.id, row);
  const newestFirst = [...merged.values()]
    .sort((a, b) => Date.parse(String(b.last_activity_at ?? "")) - Date.parse(String(a.last_activity_at ?? "")))
    .slice(0, INBOX_SEARCH_LIMIT);
  return hydrateInboxConversations(supabase, newestFirst, newestFirst.map((row) => row.id));
}
