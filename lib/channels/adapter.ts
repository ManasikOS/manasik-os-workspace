/**
 * The agent-side channel adapter: everything the reply drain and the outbox drain need from a channel,
 * behind one interface, so neither imports a provider SDK. It sits beside the neutral
 * `ChannelAdapter` in lib/inbox/contracts.ts (which describes canonical webhook events and the outbox
 * command) rather than changing it: that contract is about *ingest and outbox commands*, this one is
 * about *what a reply turn needs at the moment of sending*. A provider implements both eventually.
 *
 * Two callers share each adapter — the AI reply drain and the staff outbox drain — so send, retry and
 * error-reflection logic exists once per provider.
 */

import type { QuickReply } from "@/lib/agent/whatsapp/quick-replies";
import type { Db } from "@/lib/data/whatsapp-repository";
import type { ChannelProfile } from "@/lib/channels/profile";
import type { ChannelProvider } from "@/lib/inbox/contracts";

/** Provider-neutral failure classes, so the drains have one error path instead of one per provider. */
export type ChannelErrorClass =
  | "TOKEN_DEAD"
  | "OUTSIDE_SERVICE_WINDOW"
  | "NOT_REGISTERED"
  | "RATE_LIMITED"
  | "UNFUNDED"
  | "UNKNOWN";

/** The connection a reply is sent through, resolved for one agency. Opaque to callers beyond these fields. */
export interface ResolvedChannelConnection {
  provider: ChannelProvider;
  /** Provider's own row id (e.g. whatsapp_integrations.id) — what status writes target. */
  id: string;
  status: string;
  /** Vault reference for the access token; null when the connection has no credential. */
  credentialRef: string | null;
  /** Public address shown to customers (WhatsApp display number), when there is one. */
  displayAddress: string | null;
  fundingStatus: string | null;
  /** Provider-specific ids the adapter needs to send (e.g. WhatsApp phone_number_id). */
  accountId: string | null;
  /** Instagram only: `"INSTAGRAM_LOGIN"` for a connection made with Instagram Login (its own token, `graph.instagram.com`); absent or null for the Facebook-Page connection. */
  connectMethod?: "INSTAGRAM_LOGIN" | null;
  /** Email only: the SMTP parameters `sendReply`/`sendMedia` need, read once here since they take no `db` of their own. */
  smtpConfig?: {
    host: string;
    port: number;
    security: "STARTTLS" | "TLS";
    username: string;
    fromName: string;
    fromEmail: string;
    replyTo: string;
  } | null;
}

export interface OutboundReply {
  /** The customer's id on this channel (`conversations.external_conversation_id`). */
  to: string;
  text: string;
  buttons?: QuickReply[];
  /** Set only by the final server-side policy gate for a genuine human support reply. */
  metaTag?: "HUMAN_AGENT";
  /** Email only. Absent on every other channel. */
  subject?: string;
  cc?: string[];
  bcc?: string[];
  /** The RFC 5322 Message-ID this reply answers, and the accumulated reference chain — so the customer's own mail client threads it correctly (docs/inbox/email-channel-implementation-plan.md, D2). */
  inReplyTo?: string;
  references?: string[];
}

/** A file a staff member sends (F1). The URL is short-lived and signed; it goes to the provider and nowhere else. */
export interface OutboundMedia {
  to: string;
  kind: "image" | "document";
  url: string;
  filename: string;
  /** Sent with the file where the channel supports it, otherwise as a text straight after. */
  caption?: string;
  metaTag?: "HUMAN_AGENT";
  /** Email only. Absent on every other channel. */
  subject?: string;
  cc?: string[];
  bcc?: string[];
  inReplyTo?: string;
  references?: string[];
}

export interface SendReplyResult {
  /** The provider's id for the reply — for a reply sent in several parts, the LAST part (what delivery receipts reference). */
  externalMessageId: string;
  /**
   * Every part's provider id, in order, when the reply had to be split. Each part fires its own echo on
   * Messenger/Instagram, so all of them must be recognisable as ours or an echo of part 1 would look like a
   * person typing and silence the assistant (plan F6). Absent for a single-part reply.
   */
  partMessageIds?: string[];
  /** True when the file went out but its separate caption text did not. The customer has the file; the sender should be told. */
  captionFailed?: boolean;
}

export interface ChannelRuntimeAdapter {
  readonly provider: ChannelProvider;
  /** True only on the in-memory simulator that stands in for the provider for a disposable test agency (lib/inbox/simulator). Never set on a real adapter. */
  readonly simulated?: true;
  readonly profile: ChannelProfile;

  /** The agency's connection for this channel, or null when none exists. Never throws for "not connected". */
  resolveConnection(db: Db, agencyId: string): Promise<ResolvedChannelConnection | null>;
  /** The connection behind a generic `channel_connections` row (used by the staff outbox). */
  resolveConnectionForChannelConnection(db: Db, agencyId: string, channelConnectionId: string): Promise<ResolvedChannelConnection | null>;
  readToken(db: Db, connection: ResolvedChannelConnection): Promise<string | null>;

  /** Reply text after any channel-specific decoration (WhatsApp's "Call us" line). Pure. */
  decorateReplyText(text: string, buttons: readonly QuickReply[], connection: ResolvedChannelConnection): string;
  sendReply(connection: ResolvedChannelConnection, token: string, reply: OutboundReply): Promise<SendReplyResult>;
  /** Sends a file. Absent when the channel cannot carry files; a kind the channel does not carry throws "can't send". */
  sendMedia?(connection: ResolvedChannelConnection, token: string, media: OutboundMedia): Promise<SendReplyResult>;

  /**
   * Best-effort "typing…" indicator; absent when the platform has none. Callers must not fail on it. WhatsApp
   * addresses the customer's latest message; Messenger addresses the recipient — so both are given.
   */
  sendTyping?(connection: ResolvedChannelConnection, token: string, target: { to: string; customerMessageId: string }): Promise<void>;
  /** Downloads a voice note the customer sent. Absent when the channel can't deliver audio. */
  fetchAudio?(connection: ResolvedChannelConnection, token: string, mediaId: string): Promise<{ bytes: ArrayBuffer; mimeType: string }>;
  /** Downloads any inbound attachment for the media-intelligence BULK worker. */
  fetchAttachment?(connection: ResolvedChannelConnection, token: string, mediaRef: string): Promise<{ bytes: ArrayBuffer; mimeType: string }>;

  classifyError(error: unknown): ChannelErrorClass;

  /**
   * Makes a send failure visible on the connection (the Integrations card and Inbox read this): a dead
   * token or unfunded account is not something immediate retries fix, so the caller stops retrying and
   * a human sees the state instead.
   */
  reflectSendFailure(db: Db, connection: ResolvedChannelConnection, agencyId: string, errorClass: ChannelErrorClass, error: unknown): Promise<void>;
  /** A successful send is the clearest sign an earlier problem (e.g. unfunded) has cleared. */
  reflectSendSuccess(db: Db, connection: ResolvedChannelConnection): Promise<void>;
}
