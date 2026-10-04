/**
 * The repair path for the SC1 guarantee (docs/inbox/scaling.md §9): a customer message must never sit without an Inbox
 * reading because its ENRICH job was lost. `repair_missing_enrich_jobs` finds conversations by that effect — a recent
 * inbound message, no reading (or a PENDING/STALE one), no live ENRICH job — and gives each one a coalesced job. It is
 * bounded, agency-scoped, idempotent, and runs from the scheduled sweep; it is not the normal scheduler.
 */

import "server-only";

import type { Db } from "@/lib/ai/db";
import { enqueueChannelJob } from "@/lib/inbox/jobs/queue";

const MEDIA_JOB_KIND = { VOICE: "TRANSCRIBE_VOICE", RECEIPT: "EXTRACT_RECEIPT", PASSPORT: "READ_DOCUMENT", BROCHURE: "READ_DOCUMENT", OTHER: "READ_DOCUMENT" } as const;

/**
 * An attachment whose original was never downloaded (its job was lost, or ran out of attempts) would show "not
 * available" forever. This re-queues the download for recent attachments that still have no stored original. The
 * job is coalesced on the attachment, so a live job is never doubled. Returns how many were queued; never throws.
 */
export async function repairMissingMediaJobs(db: Db, agencyId: string, options: { olderThanSeconds?: number; withinDays?: number; limit?: number } = {}): Promise<number> {
  try {
    const olderThan = new Date(Date.now() - (options.olderThanSeconds ?? 120) * 1000).toISOString();
    const since = new Date(Date.now() - (options.withinDays ?? 7) * 86_400_000).toISOString();
    const { data: attachments, error } = await db
      .from("message_attachments")
      .select("id,message_id")
      .eq("agency_id", agencyId)
      .is("storage_path", null)
      .lt("created_at", olderThan)
      .gt("created_at", since)
      .limit(options.limit ?? 50);
    if (error || !attachments?.length) return 0;

    const { data: analyses } = await db
      .from("message_media_analyses")
      .select("attachment_id,kind,status")
      .eq("agency_id", agencyId)
      .in("attachment_id", attachments.map((row) => String(row.id)));
    const analysisByAttachment = new Map((analyses ?? []).map((row) => [String(row.attachment_id), row]));

    let queued = 0;
    for (const attachment of attachments) {
      const analysis = analysisByAttachment.get(String(attachment.id));
      if (!analysis || analysis.status === "READY") continue;
      const kind = MEDIA_JOB_KIND[String(analysis.kind) as keyof typeof MEDIA_JOB_KIND];
      if (!kind) continue;
      const result = await enqueueChannelJob(db, {
        agencyId,
        kind,
        coalesceKey: `media:${attachment.id}`,
        payload: { attachmentId: attachment.id, messageId: attachment.message_id },
      });
      if (result.ok) queued += 1;
    }
    return queued;
  } catch (cause) {
    console.error("repairMissingMediaJobs failed:", cause instanceof Error ? cause.message : cause);
    return 0;
  }
}

/** Returns how many conversations were given a job. Never throws: a repair that fails is retried by the next tick. */
export async function repairMissingEnrichJobs(db: Db, agencyId: string, options: { olderThanSeconds?: number; limit?: number } = {}): Promise<number> {
  try {
    const { data, error } = await db.rpc("repair_missing_enrich_jobs", {
      p_agency_id: agencyId,
      p_older_than_seconds: options.olderThanSeconds ?? 120,
      p_limit: options.limit ?? 100,
    });
    if (error) {
      console.error("repairMissingEnrichJobs failed:", error.message);
      return 0;
    }
    return typeof data === "number" ? data : 0;
  } catch (cause) {
    console.error("repairMissingEnrichJobs failed:", cause instanceof Error ? cause.message : cause);
    return 0;
  }
}
