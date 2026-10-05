/**
 * Inbound email: IMAP polling of the agency's own mailbox (Phase 2 of
 * docs/inbox/email-channel-implementation-plan.md, D3). Reuses the channel-neutral ingestion pipeline
 * (`ingestInboundMessage`) every other channel's webhook calls, so identity resolution, lead-linking and
 * downstream job enqueue all happen through the one existing, tested path.
 *
 * Deviation from the written plan: attachments are classified and inserted here directly, with
 * `storage_path` already set (mirroring `lib/inbox/media/handlers.ts`'s "already retained" fast path),
 * rather than through the shared `persistInboundMediaAttachments` helper — that helper's contract is
 * "record a provider reference, fetch the bytes later," which fits a webhook that has no bytes yet; the
 * IMAP poll already has the full message downloaded, so there is nothing to fetch later. The
 * classification, sensitivity-marking and BULK-job-enqueue logic is deliberately kept in the same order
 * that helper uses (classify everything first, mark sensitivity, only then write rows and queue jobs) so
 * passport/receipt review behaves identically regardless of channel.
 *
 * Cursor advance is per-message, not per-batch: a message's UID only advances the stored cursor once that
 * message is durably ingested, so a crash mid-batch resumes from the last one that actually committed
 * rather than either replaying the whole batch or losing track of where it was.
 */

import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject, type Attachment, type ParsedMail } from "mailparser";

import type { Db } from "@/lib/data/whatsapp-repository";
import { ingestInboundMessage } from "@/lib/inbox/ingest";
import { normalizeEmail } from "@/lib/inbox/identity";
import { classifyInboundMedia, inboxAttachmentFamily, type MediaKind } from "@/lib/inbox/media/classify";
import { enqueueChannelJob } from "@/lib/inbox/jobs/queue";

const INBOX_ATTACHMENT_BUCKET = "inbox-attachments";
/** One poll tick fetches at most this many new messages; the rest wait for the next tick. */
const MAX_MESSAGES_PER_TICK = 50;
/** Matches the WhatsApp adapter's own inbound-attachment cap (lib/channels/whatsapp-adapter.ts). */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const DEFAULT_ATTACHMENT_RETENTION_DAYS = 90;

interface EmailPollConnection {
  channelConnectionId: string;
  agencyId: string;
  credentialRef: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: "STARTTLS" | "TLS";
  username: string;
}

interface EmailPollCursor {
  uidValidity: string;
  lastUid: number;
}

export interface EmailPollResult {
  agencyId: string;
  status: "no_connection" | "bootstrapped" | "polled" | "auth_failed" | "error";
  processed: number;
  skipped: number;
  error?: string;
}

function jobKindFor(kind: MediaKind): "TRANSCRIBE_VOICE" | "READ_DOCUMENT" | "EXTRACT_RECEIPT" | null {
  if (kind === "VOICE") return "TRANSCRIBE_VOICE";
  if (kind === "RECEIPT") return "EXTRACT_RECEIPT";
  if (kind === "PASSPORT" || kind === "BROCHURE" || kind === "OTHER") return "READ_DOCUMENT";
  return null;
}

/** Mirrors the extension-preserving sanitizer in lib/inbox/media/handlers.ts; kept local since both are tiny and channel-specific. */
function safeFilename(filename: string | null | undefined, mimeType: string): string {
  const fallback = mimeType === "application/pdf" ? "attachment.pdf" : "attachment";
  return (filename?.trim() || fallback).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
}

function parseCursor(raw: string | null): EmailPollCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<EmailPollCursor>;
    if (typeof parsed.uidValidity === "string" && typeof parsed.lastUid === "number") return { uidValidity: parsed.uidValidity, lastUid: parsed.lastUid };
  } catch {
    // Falls through to null — an unreadable cursor is treated as "never polled", not a crash.
  }
  return null;
}

async function loadConnection(db: Db, agencyId: string): Promise<EmailPollConnection | null> {
  const { data } = await db
    .from("channel_connections")
    .select("id, credential_ref, provider_metadata")
    .eq("agency_id", agencyId)
    .eq("provider", "GMAIL")
    .eq("status", "CONNECTED")
    .maybeSingle();
  if (!data?.credential_ref) return null;
  const metadata = (data.provider_metadata ?? {}) as Record<string, unknown>;
  const imapHost = typeof metadata.imapHost === "string" ? metadata.imapHost : null;
  const imapPort = typeof metadata.imapPort === "number" ? metadata.imapPort : null;
  const imapSecurity = metadata.imapSecurity === "TLS" || metadata.imapSecurity === "STARTTLS" ? metadata.imapSecurity : null;
  const username = typeof metadata.username === "string" ? metadata.username : null;
  if (!imapHost || !imapPort || !imapSecurity || !username) return null;
  return { channelConnectionId: String(data.id), agencyId, credentialRef: String(data.credential_ref), imapHost, imapPort, imapSecurity, username };
}

async function readPassword(db: Db, credentialRef: string): Promise<string | null> {
  // Same service-role-only Vault reader the SMTP adapter and its settings-page test use.
  const { data, error } = await db.rpc("whatsapp_read_secret", { p_credential_ref: credentialRef });
  if (error || typeof data !== "string" || !data) return null;
  return data;
}

async function writeCursor(db: Db, channelConnectionId: string, cursor: EmailPollCursor): Promise<void> {
  await db.from("channel_connections").update({ sync_cursor: JSON.stringify(cursor), last_inbound_at: new Date().toISOString() }).eq("id", channelConnectionId);
}

async function markAuthFailure(db: Db, channelConnectionId: string): Promise<void> {
  await db
    .from("channel_connections")
    .update({ status: "ERROR", last_error: "The mail server rejected the stored IMAP password — save the email settings again." })
    .eq("id", channelConnectionId);
}

function addressOf(field: AddressObject | AddressObject[] | undefined): { address: string; name: string } | null {
  const list = Array.isArray(field) ? field : field ? [field] : [];
  const first = list[0]?.value?.[0];
  const address = first?.address ? normalizeEmail(first.address) : null;
  if (!address) return null;
  return { address, name: first?.name?.trim() || address };
}

function addressListOf(field: AddressObject | AddressObject[] | undefined): string[] {
  const list = Array.isArray(field) ? field : field ? [field] : [];
  return list.flatMap((entry) => entry.value ?? []).map((entry) => entry.address ?? "").filter((address) => normalizeEmail(address) !== null);
}

/**
 * Uploads and records every accepted attachment, in the same order and with the same sensitivity marking
 * as `persistInboundMediaAttachments`, but with the bytes already in hand — see the module note above.
 */
async function persistParsedAttachments(db: Db, input: { agencyId: string; messageId: string; retentionDays: number }, attachments: Attachment[]): Promise<void> {
  if (attachments.length === 0) return;

  const accepted: Array<{ attachment: Attachment; mimeType: string; kind: MediaKind }> = [];
  const allSensitiveKinds = new Set<string>();
  for (const attachment of attachments) {
    const mimeType = (attachment.contentType || "application/octet-stream").split(";")[0].trim().toLowerCase();
    if (!inboxAttachmentFamily({ mimeType })) continue; // Video and anything unrecognised is never stored.
    if (attachment.size > MAX_ATTACHMENT_BYTES) continue; // Silently dropped, same cap as the WhatsApp adapter's fetch.
    const classified = classifyInboundMedia({ mimeType, filename: attachment.filename ?? null });
    const sensitiveKinds = classified.sensitiveKinds.length > 0 ? classified.sensitiveKinds : mimeType.startsWith("image/") ? ["UNCLASSIFIED_IMAGE"] : [];
    sensitiveKinds.forEach((kind) => allSensitiveKinds.add(kind));
    accepted.push({ attachment, mimeType, kind: classified.kind });
  }
  if (accepted.length === 0) return;

  // Marked before any attachment row or media job exists — the same ordering rationale as
  // persistInboundMediaAttachments: a worker must never be able to claim a passport/receipt job before this lands.
  const { error: markError } = await db.from("conversation_messages").update({ sensitive_kinds: [...allSensitiveKinds] }).eq("id", input.messageId).eq("agency_id", input.agencyId);
  if (markError) throw new Error(`Could not mark attachment sensitivity: ${markError.message}`);

  const expiresAt = new Date(Date.now() + input.retentionDays * 86_400_000).toISOString();
  for (const { attachment, mimeType, kind } of accepted) {
    const attachmentId = randomUUID();
    const filename = safeFilename(attachment.filename, mimeType);
    const path = `${input.agencyId}/${attachmentId}/${filename}`;
    const checksum = createHash("sha256").update(attachment.content).digest("hex");
    const upload = await db.storage.from(INBOX_ATTACHMENT_BUCKET).upload(path, attachment.content, { contentType: mimeType, upsert: true });
    if (upload.error) throw new Error(`Could not store the inbound attachment: ${upload.error.message}`);

    const { error: attachmentError } = await db.from("message_attachments").insert({
      id: attachmentId,
      agency_id: input.agencyId,
      message_id: input.messageId,
      provider_media_id: null,
      storage_path: path,
      filename: attachment.filename ?? null,
      mime_type: mimeType,
      byte_size: attachment.content.byteLength,
      checksum_sha256: checksum,
      // "CLEAN" here means the file arrived by email and was stored. NO virus scan runs (SEC-8, docs/runbooks/inbox-attachment-checks.md).
      scan_status: "CLEAN",
      expires_at: expiresAt,
    });
    if (attachmentError) throw new Error(`Could not record the inbound attachment: ${attachmentError.message}`);

    const { error: analysisError } = await db.from("message_media_analyses").insert({ agency_id: input.agencyId, attachment_id: attachmentId, message_id: input.messageId, kind, status: "PENDING" });
    if (analysisError) throw new Error(`Could not initialise attachment analysis: ${analysisError.message}`);

    const jobKind = jobKindFor(kind);
    if (jobKind) {
      const queued = await enqueueChannelJob(db, { agencyId: input.agencyId, kind: jobKind, coalesceKey: `media:${attachmentId}`, payload: { attachmentId, messageId: input.messageId } });
      if (!queued.ok) console.error(`Could not queue the media job ${jobKind} for attachment ${attachmentId}:`, queued.error);
    }
  }
}

function referencesOf(parsed: ParsedMail): string[] {
  if (!parsed.references) return [];
  return Array.isArray(parsed.references) ? parsed.references : [parsed.references];
}

async function ingestParsedMessage(db: Db, connection: EmailPollConnection, uid: number, parsed: ParsedMail, retentionDays: number): Promise<void> {
  const sender = addressOf(parsed.from);
  if (!sender) throw new PermanentPollFailure(`Message UID ${uid} has no usable From address.`);

  const subject = parsed.subject?.trim() || "";
  const text = parsed.text?.trim() || subject || "(no message body)";
  const messageId = parsed.messageId?.trim() || `<no-message-id-${connection.channelConnectionId}-${uid}@local>`;

  const result = await ingestInboundMessage(db, {
    agencyId: connection.agencyId,
    provider: "GMAIL",
    externalConversationId: sender.address,
    contactName: sender.name,
    connectionId: connection.channelConnectionId,
    agentAllowed: false, // Never autonomous on email (docs/inbox/email-channel-implementation-plan.md, D4).
    normalizedPhone: null,
    email: sender.address,
    externalMessageId: messageId,
    content: text,
    messageType: "TEXT",
    metadata: {
      subject,
      cc: addressListOf(parsed.cc),
      bcc: addressListOf(parsed.bcc),
      in_reply_to: parsed.inReplyTo ?? null,
      references: referencesOf(parsed),
      html: typeof parsed.html === "string" ? parsed.html : null,
    },
    agentJobKind: "PROCESS_INBOUND",
  });

  if (result.status === "stored" && parsed.attachments.length > 0) {
    await persistParsedAttachments(db, { agencyId: connection.agencyId, messageId: result.message.id, retentionDays }, parsed.attachments);
  }
}

/** A message this mailbox will never parse correctly — skipped and its UID still advances, unlike a transient/DB failure. */
class PermanentPollFailure extends Error {}

async function retentionDaysFor(db: Db, agencyId: string): Promise<number> {
  const { data } = await db.from("agency_settings").select("inbox_attachment_retention_days").eq("agency_id", agencyId).maybeSingle();
  const configured = (data as { inbox_attachment_retention_days?: number } | null)?.inbox_attachment_retention_days;
  return Number.isFinite(configured) && Number(configured) > 0 ? Number(configured) : DEFAULT_ATTACHMENT_RETENTION_DAYS;
}

/** Polls one agency's mailbox once. Never throws: every failure is reported in the returned result. */
export async function pollAgencyMailbox(db: Db, agencyId: string): Promise<EmailPollResult> {
  const connection = await loadConnection(db, agencyId);
  if (!connection) return { agencyId, status: "no_connection", processed: 0, skipped: 0 };

  const password = await readPassword(db, connection.credentialRef);
  if (!password) return { agencyId, status: "error", processed: 0, skipped: 0, error: "Could not read the saved IMAP password." };

  const client = new ImapFlow({
    host: connection.imapHost,
    port: connection.imapPort,
    secure: connection.imapSecurity === "TLS",
    auth: { user: connection.username, pass: password },
    logger: false,
  });

  try {
    await client.connect();
  } catch (error) {
    if ((error as { authenticationFailed?: boolean } | null)?.authenticationFailed) {
      await markAuthFailure(db, connection.channelConnectionId);
      return { agencyId, status: "auth_failed", processed: 0, skipped: 0, error: "IMAP authentication failed." };
    }
    return { agencyId, status: "error", processed: 0, skipped: 0, error: error instanceof Error ? error.message : String(error) };
  }

  let processed = 0;
  let skipped = 0;
  let outcome: EmailPollResult["status"] = "polled";
  let outcomeError: string | undefined;

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      if (!mailbox) throw new Error("INBOX could not be opened.");
      const currentUidValidity = mailbox.uidValidity.toString();
      const storedCursor = parseCursor((await db.from("channel_connections").select("sync_cursor").eq("id", connection.channelConnectionId).maybeSingle()).data?.sync_cursor ?? null);

      if (!storedCursor || storedCursor.uidValidity !== currentUidValidity) {
        // First connect (or the mailbox was recreated): start from now, never backfill years of existing mail
        // into brand-new Inbox conversations. Lock release and logout are handled by the outer finally blocks.
        await writeCursor(db, connection.channelConnectionId, { uidValidity: currentUidValidity, lastUid: Math.max(mailbox.uidNext - 1, 0) });
        return { agencyId, status: "bootstrapped", processed: 0, skipped: 0 };
      }

      const retentionDays = await retentionDaysFor(db, agencyId);
      let lastUid = storedCursor.lastUid;

      for await (const message of client.fetch(`${lastUid + 1}:*`, { source: true }, { uid: true })) {
        if (message.uid <= lastUid) continue; // "*" can repeat the highest existing UID when there is nothing newer.
        if (processed + skipped >= MAX_MESSAGES_PER_TICK) break; // The rest wait for the next tick.
        if (!message.source) {
          skipped++;
          lastUid = message.uid;
          await writeCursor(db, connection.channelConnectionId, { uidValidity: currentUidValidity, lastUid });
          continue;
        }

        try {
          const parsed = await simpleParser(message.source);
          await ingestParsedMessage(db, connection, message.uid, parsed, retentionDays);
          processed++;
        } catch (error) {
          if (error instanceof PermanentPollFailure) {
            console.error(`Inbox email poll: skipping UID ${message.uid} for agency ${agencyId}:`, error.message);
            skipped++;
          } else {
            // A transient/DB failure: stop here without advancing past this UID, so the next tick retries it.
            outcome = "error";
            outcomeError = error instanceof Error ? error.message : String(error);
            break;
          }
        }

        // Reached only for a success or a permanent (skipped) failure — the transient-error branch above
        // already broke out of the loop before advancing past this UID.
        lastUid = message.uid;
        await writeCursor(db, connection.channelConnectionId, { uidValidity: currentUidValidity, lastUid });
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    outcome = "error";
    outcomeError = error instanceof Error ? error.message : String(error);
  } finally {
    await client.logout().catch(() => undefined);
  }

  return { agencyId, status: outcome, processed, skipped, error: outcomeError };
}
