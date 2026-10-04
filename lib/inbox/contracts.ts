/**
 * Provider-neutral Inbox contracts.
 *
 * These types deliberately contain no Supabase or UI concerns. Adapters turn
 * provider payloads into these contracts; conversation, CRM, outbox, and UI
 * code then operate without branching on a provider name.
 */

export const CHANNEL_PROVIDERS = [
  "WHATSAPP",
  "INSTAGRAM",
  "MESSENGER",
  "GMAIL",
  "WEB_CHAT",
  "SMS",
  "OTHER",
] as const;

export type ChannelProvider = (typeof CHANNEL_PROVIDERS)[number];

export const CONVERSATION_LIFECYCLE_STATUSES = ["OPEN", "CLOSED", "SPAM"] as const;
export type ConversationLifecycleStatus = (typeof CONVERSATION_LIFECYCLE_STATUSES)[number];

export const CONVERSATION_HANDLING_MODES = [
  "AI_ACTIVE",
  "AI_PAUSED",
  "HUMAN_REQUESTED",
  "HUMAN_ACTIVE",
] as const;
export type ConversationHandlingMode = (typeof CONVERSATION_HANDLING_MODES)[number];

export const CONVERSATION_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type ConversationPriority = (typeof CONVERSATION_PRIORITIES)[number];

export const MESSAGE_DIRECTIONS = ["INBOUND", "OUTBOUND", "INTERNAL", "SYSTEM"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export type DeliveryStatus = "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";

export interface ChannelCapabilities {
  canSendText: boolean;
  canSendAttachments: boolean;
  canUseTemplates: boolean;
  canReplyToMessage: boolean;
  canReplyAll: boolean;
  canSetSubject: boolean;
  canUseCcBcc: boolean;
  canMarkRead: boolean;
  canSendTyping: boolean;
  maxAttachmentBytes: number | null;
  allowedMimeTypes: string[];
  serviceWindowExpiresAt: string | null;
}

export interface ProviderIdentity {
  provider: ChannelProvider;
  externalSubjectId: string;
  displayName?: string;
  phone?: string;
  email?: string;
  profileData?: Record<string, unknown>;
}

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface AttachmentContentPart {
  type: "attachment";
  attachmentId?: string;
  providerMediaId?: string;
  filename?: string;
  mimeType: string;
  caption?: string;
}

export interface InteractiveContentPart {
  type: "interactive";
  label: string;
  value: string;
}

export type MessageContentPart = TextContentPart | AttachmentContentPart | InteractiveContentPart;

export interface CanonicalInboundMessage {
  kind: "message.received";
  providerEventId: string;
  providerMessageId: string;
  providerThreadId: string;
  occurredAt: string;
  sender: ProviderIdentity;
  content: MessageContentPart[];
  replyToProviderMessageId?: string;
  metadata?: Record<string, unknown>;
}

export interface CanonicalDeliveryEvent {
  kind: "message.status";
  providerEventId: string;
  providerMessageId: string;
  occurredAt: string;
  status: DeliveryStatus;
  providerCode?: string;
  detail?: Record<string, unknown>;
}

export interface CanonicalIdentityUpdate {
  kind: "identity.updated";
  providerEventId: string;
  occurredAt: string;
  identity: ProviderIdentity;
}

export type CanonicalChannelEvent =
  | CanonicalInboundMessage
  | CanonicalDeliveryEvent
  | CanonicalIdentityUpdate;

export interface OutboxCommand {
  id: string;
  agencyId: string;
  connectionId: string;
  conversationId: string;
  messageId: string;
  idempotencyKey: string;
  recipient: ProviderIdentity;
  providerThreadId: string;
  content: MessageContentPart[];
  replyToProviderMessageId?: string;
  subject?: string;
  cc?: string[];
  bcc?: string[];
  metadata?: Record<string, unknown>;
}

export interface ProviderSendResult {
  providerMessageId: string;
  acceptedAt: string;
  metadata?: Record<string, unknown>;
}

/** Server-only adapter boundary; the Inbox core never imports a provider SDK. */
export interface ChannelAdapter {
  readonly provider: ChannelProvider;
  capabilities(connection: { id: string; capabilitySnapshot: Record<string, unknown> }): ChannelCapabilities;
  normalizeWebhook(input: {
    connectionId: string;
    rawEventId: string;
    payload: unknown;
  }): Promise<CanonicalChannelEvent[]>;
  send(command: OutboxCommand): Promise<ProviderSendResult>;
}

export interface JourneySource {
  leadStage: string | null;
  desiredPackageId: string | null;
  selectedDepartureGroupId: string | null;
  bookingStatus: string | null;
}

export type PilgrimJourneyStage =
  | "NEW_ENQUIRY"
  | "QUALIFIED"
  | "PACKAGE_SELECTED"
  | "BOOKING_STARTED"
  | "CONFIRMED";

/**
 * Projects existing Lead and Booking facts into the five Inbox stages. It
 * intentionally does not mutate a lead stage: Leads and Bookings remain the
 * authoritative modules.
 */
export function derivePilgrimJourneyStage(source: JourneySource): PilgrimJourneyStage {
  if (source.bookingStatus === "CONFIRMED" || source.leadStage === "BOOKED") {
    return "CONFIRMED";
  }

  if (
    source.bookingStatus === "HELD" ||
    source.bookingStatus === "DRAFT" ||
    source.leadStage === "DEPOSIT_PENDING"
  ) {
    return "BOOKING_STARTED";
  }

  if (source.desiredPackageId || source.selectedDepartureGroupId) {
    return "PACKAGE_SELECTED";
  }

  if (
    source.leadStage === "QUALIFIED" ||
    source.leadStage === "PROPOSAL_SENT" ||
    source.leadStage === "NEGOTIATION"
  ) {
    return "QUALIFIED";
  }

  return "NEW_ENQUIRY";
}

