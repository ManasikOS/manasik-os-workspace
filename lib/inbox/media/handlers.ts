/** BULK-lane processors for inbound voice notes, passports, receipts and brochures. */
import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { MODEL_FOR_TIER, generateStructured } from "@/lib/ai/provider";
import { getChannelAdapterForAgency } from "@/lib/inbox/simulator/adapter-for-agency";
import { openIntervention, recordSignals } from "@/lib/data/conversation-intelligence-repository";
import type { ChannelProvider } from "@/lib/inbox/contracts";
import type { LaneJobContext, LaneJobHandler } from "@/lib/inbox/jobs/drain";
import type { ClaimedChannelJob } from "@/lib/inbox/jobs/queue";
import { reviewPassportCandidate } from "./passport";
import { receiptReview } from "./receipt";
import { loadInboxMediaContext } from "./context";
import { finalizeOggOpusStream } from "./ogg-opus";
import { resolveEntitlements } from "@/lib/billing/entitlements";
import { resolveInboxFeatureAvailability } from "@/lib/inbox/feature-availability";
import { createSupabaseVoiceTranscriptWorker, type VoiceTranscriptRunOutcome } from "./voice-transcript-worker";

export const INBOX_ATTACHMENT_BUCKET = "inbox-attachments";

const mediaPayloadSchema = z.object({ attachmentId: z.string().uuid(), messageId: z.string().uuid() });
const supportedMediaTypeSchema = z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);
const extractedMediaSchema = z.object({
  kind: z.enum(["PASSPORT", "RECEIPT", "BROCHURE", "OTHER"]),
  confidence: z.number().min(0).max(1),
  passportNumber: z.string().trim().min(1).nullable(),
  expiryDate: z.string().trim().min(1).nullable(),
  fullName: z.string().trim().min(1).nullable(),
  amount: z.number().nonnegative().nullable(),
  reference: z.string().trim().min(1).nullable(),
  paidAt: z.string().trim().min(1).nullable(),
  summary: z.string().trim().max(1000).nullable(),
});

const extractedMediaJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "confidence", "passportNumber", "expiryDate", "fullName", "amount", "reference", "paidAt", "summary"],
  properties: {
    kind: { type: "string", enum: ["PASSPORT", "RECEIPT", "BROCHURE", "OTHER"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    passportNumber: { type: ["string", "null"] },
    expiryDate: { type: ["string", "null"] },
    fullName: { type: ["string", "null"] },
    amount: { type: ["number", "null"], minimum: 0 },
    reference: { type: ["string", "null"] },
    paidAt: { type: ["string", "null"] },
    summary: { type: ["string", "null"] },
  },
} as const;

type ExtractedMedia = z.infer<typeof extractedMediaSchema>;
interface RetainedMedia {
  bytes: ArrayBuffer;
  mimeType: string;
  conversationId: string;
}

function safeFilename(filename: string | null, mimeType: string): string {
  const fallback = mimeType === "application/pdf" ? "attachment.pdf" : mimeType.startsWith("audio/") ? "voice-note" : "attachment";
  return (filename?.trim() || fallback).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
}

async function loadAndRetainOriginal(job: ClaimedChannelJob, context: LaneJobContext): Promise<RetainedMedia> {
  const payload = mediaPayloadSchema.parse(job.payload);
  const { data: attachment, error: attachmentError } = await context.db
    .from("message_attachments")
    .select("id,message_id,provider_media_id,storage_path,filename,mime_type,metadata")
    .eq("agency_id", job.agencyId)
    .eq("id", payload.attachmentId)
    .eq("message_id", payload.messageId)
    .single();
  if (attachmentError || !attachment) throw new Error(`Could not load the media attachment: ${attachmentError?.message ?? "not found"}`);

  const { data: message, error: messageError } = await context.db
    .from("conversation_messages")
    .select("conversation_id")
    .eq("agency_id", job.agencyId)
    .eq("id", payload.messageId)
    .single();
  if (messageError || !message) throw new Error(`Could not load the attachment message: ${messageError?.message ?? "not found"}`);

  if (attachment.storage_path) {
    const stored = await context.db.storage.from(INBOX_ATTACHMENT_BUCKET).download(String(attachment.storage_path));
    if (!stored.error && stored.data) {
      return { bytes: await stored.data.arrayBuffer(), mimeType: String(attachment.mime_type || stored.data.type || "application/octet-stream"), conversationId: String(message.conversation_id) };
    }
  }

  const { data: conversation, error: conversationError } = await context.db
    .from("conversations")
    .select("channel,connection_id")
    .eq("agency_id", job.agencyId)
    .eq("id", message.conversation_id)
    .single();
  if (conversationError || !conversation?.connection_id) throw new Error(`Could not resolve the attachment channel: ${conversationError?.message ?? "connection missing"}`);

  const adapter = await getChannelAdapterForAgency(context.db, job.agencyId, String(conversation.channel) as ChannelProvider);
  const connection = await adapter.resolveConnectionForChannelConnection(context.db, job.agencyId, String(conversation.connection_id));
  if (!connection) throw new Error("The attachment channel connection is unavailable.");
  const token = await adapter.readToken(context.db, connection);
  if (!token) throw new Error("The attachment channel credential is unavailable.");
  const metadata = (attachment.metadata ?? {}) as Record<string, unknown>;
  const mediaRef = typeof attachment.provider_media_id === "string" && attachment.provider_media_id
    ? attachment.provider_media_id
    : typeof metadata.source_url === "string" ? metadata.source_url : null;
  if (!mediaRef) throw new Error("The provider did not include an attachment reference.");
  const fetcher = job.kind === "TRANSCRIBE_VOICE" ? adapter.fetchAudio : adapter.fetchAttachment;
  if (!fetcher) throw new Error(`${adapter.provider} cannot download this attachment type.`);
  const downloaded = await fetcher(connection, token, mediaRef);
  if (context.signal.aborted) throw new Error("Media processing was cancelled.");

  const mimeType = downloaded.mimeType || String(attachment.mime_type || "application/octet-stream");
  const retainedBytes = mimeType.toLowerCase().startsWith("audio/ogg")
    ? finalizeOggOpusStream(downloaded.bytes)
    : downloaded.bytes;
  const path = `${job.agencyId}/${payload.attachmentId}/${safeFilename(attachment.filename as string | null, mimeType)}`;
  const upload = await context.db.storage.from(INBOX_ATTACHMENT_BUCKET).upload(path, retainedBytes, { contentType: mimeType, upsert: true });
  if (upload.error) throw new Error(`Could not retain the original attachment: ${upload.error.message}`);

  const { data: settings } = await context.db.from("agency_settings").select("inbox_attachment_retention_days,voice_audio_retention_days").eq("agency_id", job.agencyId).maybeSingle();
  const retentionDays = job.kind === "TRANSCRIBE_VOICE"
    ? Number(settings?.voice_audio_retention_days ?? 180)
    : Number(settings?.inbox_attachment_retention_days ?? 90);
  const expiresAt = new Date(Date.now() + retentionDays * 86_400_000).toISOString();
  const checksum = createHash("sha256").update(Buffer.from(retainedBytes)).digest("hex");
  const update = await context.db.from("message_attachments").update({
    storage_path: path,
    mime_type: mimeType,
    byte_size: retainedBytes.byteLength,
    checksum_sha256: checksum,
    // "CLEAN" here means the bytes were fetched from the provider, stored and type-checked. NO virus scan runs (SEC-8, docs/runbooks/inbox-attachment-checks.md).
    scan_status: "CLEAN",
    expires_at: expiresAt,
  }).eq("agency_id", job.agencyId).eq("id", payload.attachmentId);
  if (update.error) throw new Error(`Could not save the retained attachment metadata: ${update.error.message}`);
  return { bytes: retainedBytes, mimeType, conversationId: String(message.conversation_id) };
}

async function extractDocument(job: ClaimedChannelJob, context: LaneJobContext, media: RetainedMedia): Promise<ExtractedMedia> {
  const supported = supportedMediaTypeSchema.safeParse(media.mimeType.split(";")[0].toLowerCase());
  if (!supported.success) throw new Error(`Unsupported document type: ${media.mimeType}`);
  const result = await generateStructured({
    tier: "classify",
    system: "You read travel-agency attachments. Extract candidates only. Never confirm identity, passport validity, or payment. Use null when unreadable.",
    instruction: "Classify this as PASSPORT, RECEIPT, BROCHURE or OTHER and return only visible candidate fields. Dates must be YYYY-MM-DD when legible. The summary must be factual and short.",
    media: { bytes: media.bytes, mimeType: supported.data },
    jsonSchema: extractedMediaJsonSchema,
    schema: extractedMediaSchema,
    surface: "inbox_media_intelligence",
    agencyId: job.agencyId,
    subjectType: "message_attachment",
    subjectId: mediaPayloadSchema.parse(job.payload).attachmentId,
    maxTokens: 1200,
    db: context.db,
  });
  if (!result.value) throw new Error(result.note ?? "The attachment could not be read.");
  return result.value;
}

/** Staff-only transcript of a retained voice note. It writes its own table, never the message or the analysis. */
async function transcribeRetainedVoice(
  context: LaneJobContext,
  job: ClaimedChannelJob,
  media: RetainedMedia,
  isFinalAttempt: boolean,
): Promise<VoiceTranscriptRunOutcome> {
  const payload = mediaPayloadSchema.parse(job.payload);
  return createSupabaseVoiceTranscriptWorker(context.db, context.signal).run({
    agencyId: job.agencyId,
    attachmentId: payload.attachmentId,
    messageId: payload.messageId,
    mimeType: media.mimeType,
    bytes: media.bytes,
    isFinalAttempt,
  });
}

async function updateAnalysis(context: LaneJobContext, job: ClaimedChannelJob, values: Record<string, unknown>): Promise<void> {
  const payload = mediaPayloadSchema.parse(job.payload);
  const { error } = await context.db.from("message_media_analyses").update(values).eq("agency_id", job.agencyId).eq("attachment_id", payload.attachmentId).eq("message_id", payload.messageId);
  if (error) throw new Error(`Could not save media analysis: ${error.message}`);
}

async function openMediaReview(context: LaneJobContext, job: ClaimedChannelJob, conversationId: string, signalCode: "PAYMENT_CLAIM_UNVERIFIED" | "PASSPORT_EXPIRY_RISK"): Promise<string> {
  const payload = mediaPayloadSchema.parse(job.payload);
  await recordSignals(context.db, job.agencyId, conversationId, [{
    signalCode,
    messageId: payload.messageId,
    detector: "MODEL",
    confidence: 1,
    evidence: [{ messageId: payload.messageId, snippet: signalCode === "PAYMENT_CLAIM_UNVERIFIED" ? "Payment proof attachment requires Finance verification." : "Extracted passport expiry requires document review." }],
  }]);
  const spec = signalCode === "PAYMENT_CLAIM_UNVERIFIED"
    ? { kind: "PAYMENT_CLAIM" as const, severity: "BLOCK" as const, headline: "Payment proof requires verification", guidance: "Treat this attachment only as proof of a claim. Finance must verify it against the bank statement before any payment state changes.", requiredActionCode: "VERIFY_PAYMENT" as const, assignedRole: "FINANCE" }
    : { kind: "PASSPORT_EXPIRY" as const, severity: "REVIEW" as const, headline: "Passport expiry requires review", guidance: "Review the original passport and traveller record. Request a renewed document when the passport is expired or not valid long enough.", requiredActionCode: "REQUEST_DOCUMENTS" as const, assignedRole: "OPERATIONS" };
  const opened = await openIntervention(context.db, job.agencyId, { conversationId, ...spec });
  return opened.intervention.id;
}

async function openPassportReview(context: LaneJobContext, job: ClaimedChannelJob, conversationId: string): Promise<string> {
  const opened = await openIntervention(context.db, job.agencyId, {
    conversationId,
    kind: "PASSPORT_EXPIRY",
    severity: "REVIEW",
    headline: "Passport requires review",
    guidance: "Review the original passport and the selected traveller. Confirm the name, passport number, expiry date, and validity for the departure before updating any traveller record.",
    requiredActionCode: "REQUEST_DOCUMENTS",
    assignedRole: "OPERATIONS",
  });
  return opened.intervention.id;
}

class VoiceTranscriptionRetryError extends Error {
  constructor() {
    super("Voice transcription will be retried.");
    this.name = "VoiceTranscriptionRetryError";
  }
}

export interface MediaHandlerDependencies {
  loadAndRetain: typeof loadAndRetainOriginal;
  extract: typeof extractDocument;
  update: typeof updateAnalysis;
  transcribeVoice: typeof transcribeRetainedVoice;
  openReview: typeof openMediaReview;
  openPassportReview: typeof openPassportReview;
  loadContext: typeof loadInboxMediaContext;
  now: () => Date;
  isMediaIntelligenceEnabled: (db: LaneJobContext["db"], agencyId: string) => Promise<boolean>;
}

const defaultDependencies: MediaHandlerDependencies = {
  loadAndRetain: loadAndRetainOriginal, extract: extractDocument, update: updateAnalysis, transcribeVoice: transcribeRetainedVoice, openReview: openMediaReview, openPassportReview, loadContext: loadInboxMediaContext, now: () => new Date(),
  isMediaIntelligenceEnabled: async (db, agencyId) => resolveInboxFeatureAvailability({ entitlements: await resolveEntitlements(db, agencyId), inboxQueuesV2: false }).mediaIntelligence,
};

export function createMediaJobHandler(overrides: Partial<MediaHandlerDependencies> = {}): LaneJobHandler {
  const deps = { ...defaultDependencies, ...overrides };
  return async (job, context) => {
    try {
      const payload = mediaPayloadSchema.parse(job.payload);
      const media = await deps.loadAndRetain(job, context);
      if (job.kind === "TRANSCRIBE_VOICE") {
        await deps.update(context, job, {
          kind: "VOICE",
          status: "READY",
          candidate_fields: {},
          confidence: null,
          uncertainty: [],
          transcript: null,
          source_model: null,
        });
        // The original is already retained and shown as ready. A transcript is an optional extra, so a failure here
        // may be retried but must never fail the voice note itself.
        const isFinalAttempt = job.attempts >= job.maxAttempts;
        try {
          const transcription = await deps.transcribeVoice(context, job, media, isFinalAttempt);
          if (transcription.outcome === "RETRY") throw new VoiceTranscriptionRetryError();
        } catch (cause) {
          if (!isFinalAttempt) throw cause;
          console.error("Voice transcription failed on the final attempt; the voice note stays playable:", cause instanceof Error ? cause.name : "unknown");
        }
        return;
      }
      // The original is kept either way. Without AI reading, the card is simply "ready" with no extracted fields,
      // rather than showing "pending" forever.
      if (!await deps.isMediaIntelligenceEnabled(context.db, job.agencyId)) {
        await deps.update(context, job, { status: "READY", candidate_fields: {}, uncertainty: [] });
        return;
      }
      if (!supportedMediaTypeSchema.safeParse(media.mimeType.split(";")[0].trim().toLowerCase()).success) {
        // Word, Excel, text and similar files are stored and shown, but the reading model cannot open them.
        await deps.update(context, job, { status: "READY", candidate_fields: {}, uncertainty: [] });
        return;
      }
      const extracted = await deps.extract(job, context, media);
      let interventionId: string | null = null;
      let uncertainty: string[] = [];
      let status: "READY" | "REVIEW_REQUIRED" = extracted.confidence < 0.9 ? "REVIEW_REQUIRED" : "READY";
      const fields: Record<string, string | number> = {};

      if (extracted.kind === "PASSPORT") {
        if (extracted.passportNumber) fields.passportNumber = extracted.passportNumber;
        if (extracted.expiryDate) fields.expiryDate = extracted.expiryDate;
        if (extracted.fullName) fields.fullName = extracted.fullName;
        const mediaContext = await deps.loadContext(context.db, { agencyId: job.agencyId, conversationId: media.conversationId });
        const review = reviewPassportCandidate(
          { passportNumber: extracted.passportNumber ?? undefined, expiryDate: extracted.expiryDate ?? undefined, fullName: extracted.fullName ?? undefined, confidence: extracted.confidence },
          mediaContext,
          deps.now(),
        );
        uncertainty = [...review.uncertainFields, ...review.fieldMismatches, ...(review.travellerSelectionRequired ? ["travellerSelection"] : []), ...(!review.matchedTravellerId && !review.travellerSelectionRequired ? ["traveller"] : [])];
        if (review.reviewRequired) status = "REVIEW_REQUIRED";
        interventionId = review.signal
          ? await deps.openReview(context, job, media.conversationId, review.signal)
          : review.reviewRequired
            ? await deps.openPassportReview(context, job, media.conversationId)
            : null;
        await deps.update(context, job, {
          kind: extracted.kind,
          status,
          candidate_fields: fields,
          confidence: extracted.confidence,
          uncertainty,
          review_fields: {
            fieldMismatches: review.fieldMismatches,
            expired: review.expired,
            insufficientValidityAtDeparture: review.insufficientValidityAtDeparture,
            departureDate: mediaContext.departureDate,
            passportValidityMonths: mediaContext.passportValidityMonths,
            travellerSelectionRequired: review.travellerSelectionRequired,
            matchedTravellerId: review.matchedTravellerId,
          },
          candidate_traveller_ids: review.candidateTravellerIds,
          selected_traveller_id: review.matchedTravellerId,
          transcript: null,
          source_model: MODEL_FOR_TIER.classify,
          intervention_id: interventionId,
        });
        return;
      } else if (extracted.kind === "RECEIPT") {
        if (extracted.amount !== null) fields.amount = extracted.amount;
        if (extracted.reference) fields.reference = extracted.reference;
        if (extracted.paidAt) fields.paidAt = extracted.paidAt;
        receiptReview({ amount: extracted.amount, reference: extracted.reference, paidAt: extracted.paidAt, confidence: extracted.confidence }, payload.attachmentId);
        interventionId = await deps.openReview(context, job, media.conversationId, "PAYMENT_CLAIM_UNVERIFIED");
        status = "REVIEW_REQUIRED";
        uncertainty = ["paymentVerification"];
      } else if (extracted.summary) {
        fields.summary = extracted.summary;
      }

      await deps.update(context, job, {
        kind: extracted.kind,
        status,
        candidate_fields: fields,
        confidence: extracted.confidence,
        uncertainty,
        transcript: null,
        source_model: MODEL_FOR_TIER.classify,
        intervention_id: interventionId,
      });
    } catch (cause) {
      if (job.attempts >= job.maxAttempts) {
        await deps.update(context, job, { status: "FAILED", uncertainty: [cause instanceof Error ? cause.message.slice(0, 300) : "Media processing failed"] }).catch(() => undefined);
      }
      throw cause;
    }
  };
}

export const mediaLaneJobHandler = createMediaJobHandler();
