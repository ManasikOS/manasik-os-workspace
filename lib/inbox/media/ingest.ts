import "server-only";

import type { Db } from "@/lib/ai/db";
import { enqueueChannelJob } from "@/lib/inbox/jobs/queue";
import { classifyInboundMedia, inboxAttachmentFamily, type MediaKind } from "./classify";

interface ProviderAttachment { type?: string; url?: string | null; filename?: string | null; mime_type?: string | null; media_id?: string | null }

function mimeTypeOf(attachment: ProviderAttachment): string {
  if (attachment.mime_type) return attachment.mime_type;
  if (attachment.type === "audio") return "audio/mp4";
  if (attachment.type === "image") return "image/jpeg";
  if (attachment.type === "video") return "video/mp4";
  return "application/octet-stream";
}

function jobKindFor(kind: MediaKind): "TRANSCRIBE_VOICE" | "READ_DOCUMENT" | "EXTRACT_RECEIPT" | null {
  if (kind === "VOICE") return "TRANSCRIBE_VOICE";
  if (kind === "RECEIPT") return "EXTRACT_RECEIPT";
  if (kind === "PASSPORT" || kind === "BROCHURE" || kind === "OTHER") return "READ_DOCUMENT";
  return null;
}

/** Persist and label attachments before any media model is allowed to read them. */
export async function persistInboundMediaAttachments(db: Db, input: {
  agencyId: string;
  messageId: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  const attachments = Array.isArray(input.metadata.attachments)
    ? input.metadata.attachments.filter((item): item is ProviderAttachment => Boolean(item && typeof item === "object"))
    : [];
  if (attachments.length === 0) return;

  // Classify everything first (no I/O), so the message can be marked before anything is stored or queued.
  const accepted: Array<{ attachment: ProviderAttachment; mimeType: string; kind: MediaKind }> = [];
  const allSensitiveKinds = new Set<string>();
  for (const attachment of attachments) {
    const mimeType = mimeTypeOf(attachment);
    // Images, documents and audio only. Video (and anything else) is never stored or downloaded.
    if (!inboxAttachmentFamily({ mimeType, providerType: attachment.type })) continue;
    const classified = classifyInboundMedia({ mimeType, filename: attachment.filename });
    // An unnamed image is quarantined as potentially sensitive until the
    // document classifier says otherwise. This happens before model work.
    const sensitiveKinds = classified.sensitiveKinds.length > 0
      ? classified.sensitiveKinds
      : mimeType.startsWith("image/") ? ["UNCLASSIFIED_IMAGE"] : [];
    sensitiveKinds.forEach((kind) => allSensitiveKinds.add(kind));
    accepted.push({ attachment, mimeType, kind: classified.kind });
  }

  // Marked before any attachment row or media job exists ("marked at ingest, before any model sees the message"). Writing this last left
  // a window in which a worker could claim a passport's read job before the mark landed, and lost the mark altogether if a later
  // attachment failed to store. If the mark cannot be saved, nothing is stored or queued: the caller fails and the message is retried.
  const { error: markError } = await db.from("conversation_messages").update({
    // `redaction_state` only allows NONE or MASKED and nothing has masked this message yet, so it keeps its default.
    sensitive_kinds: [...allSensitiveKinds],
  }).eq("id", input.messageId).eq("agency_id", input.agencyId);
  if (markError) throw new Error(`Could not mark attachment sensitivity: ${markError.message}`);

  for (const { attachment, mimeType, kind } of accepted) {
    const { data: stored, error } = await db.from("message_attachments").insert({
      agency_id: input.agencyId,
      message_id: input.messageId,
      provider_media_id: attachment.media_id ?? null,
      filename: attachment.filename ?? null,
      mime_type: mimeType,
      metadata: { source_url: attachment.url ?? null, provider_type: attachment.type ?? null },
    }).select("id").single();
    if (error || !stored) throw new Error(`Could not store the inbound attachment: ${error?.message ?? "no id returned"}`);
    const { error: analysisError } = await db.from("message_media_analyses").insert({
      agency_id: input.agencyId,
      attachment_id: stored.id,
      message_id: input.messageId,
      kind,
      status: "PENDING",
    });
    if (analysisError) throw new Error(`Could not initialise attachment analysis: ${analysisError.message}`);
    const jobKind = jobKindFor(kind);
    if (jobKind) {
      const queued = await enqueueChannelJob(db, {
        agencyId: input.agencyId,
        kind: jobKind,
        coalesceKey: `media:${stored.id}`,
        payload: { attachmentId: stored.id, messageId: input.messageId },
      });
      // The queue reports failure as a value so a webhook is never failed by it. Nothing re-queues a media job, so an attachment whose job
      // was lost stays PENDING for good: this log (ids and job kind only) is the only trace.
      if (!queued.ok) console.error(`Could not queue the media job ${jobKind} for attachment ${String(stored.id)}:`, queued.error);
    }
  }
}
