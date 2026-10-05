import type { ConversationMessageRow, ConversationRow, WhatsAppTemplateRow } from "@/lib/types/whatsapp";
import type { InboxCapabilities } from "@/lib/access/inbox-access";
import type { VoiceTranscriptView } from "@/lib/inbox/media/voice-transcript";
import type { IdentityProposalView } from "@/lib/inbox/identity/graph";
import type { InboxView } from "@/lib/inbox/views";
import type { QueueCounts, QueueCursor } from "@/lib/data/inbox-queue-repository";
import type { ComposerPresence } from "@/lib/inbox/composer-presence";
import type { ConversationHandoffRecord } from "@/lib/data/conversation-handoff-repository";

export interface InboxConversation extends ConversationRow {
  lead_reference: string | null;
  lead_stage: string | null;
  desired_package_name: string | null;
  /** Snippet of the latest message in this conversation, for list preview. */
  last_message_content: string | null;
  last_message_role: string | null;
  /** Type of the latest message, used when media has no text content. */
  last_message_type: string | null;
  has_open_support_case: boolean;
}

/**
 * A canonical message. `sequence_number` is the conversation's own monotonic order (assigned by the database);
 * `client_idempotency_key` is the browser-generated key of a staff send. Both are optional in the type because rows written
 * before sequencing existed are backfilled but a delta must still tolerate a null.
 */
export type InboxMessage = ConversationMessageRow & {
  sequence_number?: number | null;
  client_idempotency_key?: string | null;
};

export interface InboxNote {
  id: string;
  conversation_id: string;
  body: string;
  author_id: string;
  author_name_snapshot: string;
  created_at: string;
}

export interface InboxSavedReply {
  id: string;
  title: string;
  body: string;
  language: string | null;
  providers: string[];
}

export type InboxTemplate = Pick<
  WhatsAppTemplateRow,
  "id" | "name" | "language" | "category" | "components"
> & {
  /** Latest Meta-derived unit rate for this recipient/category; null means no observation exists yet. */
  projected_charge?: number | null;
  charge_currency?: string | null;
};

export interface InboxCustomerContext {
  lead: {
    id: string;
    reference: string;
    full_name: string;
    mobile: string;
    email: string | null;
    stage: string;
    preferred_language: string;
    desired_package_name: string | null;
    preferred_period: string;
    selected_departure_group_id: string | null;
    booking_id: string | null;
    next_follow_up_at: string | null;
    follow_up_type: string | null;
    follow_up_owner_name: string | null;
    adults: number;
    children: number;
    journey_type: "UMRAH" | "HAJJ" | "EARLY_REGISTRATION";
    desired_package_id: string | null;
    room_preference: "QUAD" | "TRIPLE" | "DOUBLE" | "SINGLE" | "UNDECIDED";
  } | null;
  booking: {
    id: string;
    /** The booked departure's name, so staff see what was booked, not just a reference. */
    departure_group_name: string | null;
    /** The departure the booking belongs to, so the booking can be opened on its own page. */
    departure_group_id?: string | null;
    /** Set while the booking is only a seat hold; the seats are released when it passes. */
    seat_hold_expires_at: string | null;
    booking_reference: string;
    booking_status: string;
    traveller_count: number;
    outstanding_balance: number | null;
    currency: string | null;
  } | null;
  canViewBalance: boolean;
  /** May this person open the linked lead, booking and departure group pages? Decides which links are shown. */
  canOpenLead?: boolean;
  canOpenBooking?: boolean;
  canOpenDepartureGroup?: boolean;
  canCreateBooking: boolean;
  canUseCopilot: boolean;
  canScheduleFollowUp: boolean;
  canSelectDepartureGroup: boolean;
  canCreateLead: boolean;
  /** May this person turn the conversation into a task or case (MI4.6)? The server checks again when they do. */
  canConvertConversation?: boolean;
  /** "Possible existing lead found": open suggestions for a conversation that has no lead yet (MI3.3). */
  identityProposals?: IdentityProposalView[];
  /** May this person link the conversation to a suggested lead, or keep the contact separate? */
  canDecideIdentity?: boolean;
  /** The Operations handoff already made for this conversation, if any (MI4.5) — so the panel shows it instead of offering another. */
  handoff?: ConversationHandoffRecord | null;
}

export interface InboxMentionableStaff {
  id: string;
  name: string;
}

/** First piece of the Inbox: the chat list and everything the rail and list need. */
export interface InboxListData {
  agencyId: string | null;
  staffId: string | null;
  capabilities: InboxCapabilities;
  /** The Inbox only offers new-email composition after its inbound IMAP mailbox is ready. */
  emailMailboxReady: boolean;
  /** True when this person may ask Manasik Copilot for a reply draft — known up front, before any lead loads. */
  canUseCopilot: boolean;
  /** The newest conversations of the active view (up to 100), plus the requested chat when it is outside that view. */
  conversations: InboxConversation[];
  /** How many conversations each rail view holds across the whole agency, not only the ones listed. */
  viewCounts: Record<InboxView, number>;
  /** The same counts keyed by queue code, for the grouped rail. */
  queueCounts: QueueCounts;
  /** True when this agency uses the grouped queue rail (`agency_settings.inbox_queues_v2`). */
  queuesV2: boolean;
  /** Pass as `cursor` to load the next page of this view; null when the list is complete. */
  nextCursor: QueueCursor | null;
  activeConversation: InboxConversation | null;
  activeConversationId: string | null;
  activeView: InboxView;
  templates: InboxTemplate[];
}

/** Second piece: what the open conversation shows. */
export interface InboxConversationData {
  messages: InboxMessage[];
  attachments: InboxAttachment[];
  mediaAnalyses: InboxMediaAnalysis[];
  notes: InboxNote[];
  savedReplies: InboxSavedReply[];
  mentionableStaff: InboxMentionableStaff[];
  draft: string;
  /** Best-effort lease for the active reply composer; never used as a reply lock. */
  composerPresence: ComposerPresence | null;
}

export interface InboxAttachment {
  id: string;
  message_id: string;
  filename: string | null;
  mime_type: string;
  original_href: string | null;
  expires_at: string | null;
  promoted_document_id: string | null;
  /** A passport the viewer's role may not open: no link and no file name, and the screen says so instead of waiting for it. */
  restricted?: boolean;
}

export interface InboxMediaAnalysis {
  id: string;
  message_id: string;
  attachment_id: string;
  kind: string;
  status: string;
  candidate_fields: Record<string, unknown>;
  confidence: number | null;
  uncertainty: unknown[];
  review_fields: Record<string, unknown>;
  traveller_options: Array<{ id: string; name: string }>;
  selected_traveller_id: string | null;
  mime_type?: string | null;
  original_href: string | null;
  expires_at: string | null;
  promoted_document_id: string | null;
  /** Staff-only machine transcript of a voice note; null for other kinds and for roles that may not read it. */
  voice_transcript?: VoiceTranscriptView | null;
}

export type { VoiceTranscriptView } from "@/lib/inbox/media/voice-transcript";

/** Fourth piece: Copilot's stored reading of the open conversation (MI2.5). */
export type { InboxIntelligenceData } from "@/lib/inbox/intelligence/rail-view";

/** SC3 — one list row, patched instead of reloading the whole list. */
export interface InboxConversationListPatch {
  /** The conversation as the list shows it now, or null when it is no longer visible to this person. */
  conversation: InboxConversation | null;
  /** Whether it belongs in the view the browser asked about. */
  inActiveView: boolean;
  /** Where it sorts: the exact `last_activity_at` string Postgres returned, so ties and precision are never rounded. */
  lastActivityAt: string | null;
  /** Ordering counter: the browser ignores a patch older than the version it already holds. */
  conversationVersion: number | null;
  /** The exact rail counts — present only when the caller asked for them. */
  queueCounts: QueueCounts | null;
  viewCounts: Record<InboxView, number> | null;
}

/** SC3 — the messages the browser is missing, and the artifacts of only those messages. */
export interface InboxThreadDelta {
  /** Ascending by sequence: every message after the requested sequence, then any explicitly requested existing ones. */
  messages: InboxMessage[];
  attachments: InboxAttachment[];
  mediaAnalyses: InboxMediaAnalysis[];
  /** The highest sequence among the returned messages, or null when nothing newer exists. */
  highestSequence: number | null;
  /** True when more messages remain after this page: the browser asks again from `highestSequence`. */
  hasMore: boolean;
}

/** SC3 — notes after a keyset position, plus the current state of specific notes (a missing id was deleted). */
export interface InboxNotesDelta {
  notes: InboxNote[];
  removedNoteIds: string[];
  /** More notes exist after this page: the browser reads again from the newest one it now holds. */
  hasMore: boolean;
}

/** The recorded changes on one conversation (owner changes today), newest first, for the side panel's history. */
export interface InboxHistoryRead {
  events: Array<{ id: string; kind: string; data: Record<string, unknown>; occurred_at: string }>;
}

/** SC3 — the composer lease alone, so presence never reloads messages. */
export interface InboxPresenceRead {
  composerPresence: ComposerPresence | null;
}
