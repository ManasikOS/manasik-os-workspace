/**
 * Worker for staff-only voice transcripts (MED-02). It runs inside the existing `TRANSCRIBE_VOICE` lane job after the
 * original audio has been retained, so a transcript can never block ingestion or playback. Every decision is made
 * before provider use (entitlement, format, size, duration), the claim is idempotent per `(agency, attachment)`, and
 * nothing it logs or records contains transcript content.
 */
import "server-only";

import type { Db } from "@/lib/ai/db";
import { TRANSCRIBE_MODEL, generateAudioTranscript, type AudioTranscriptResult } from "@/lib/ai/provider";
import { resolveEntitlements } from "@/lib/billing/entitlements";
import { resolveInboxFeatureAvailability } from "@/lib/inbox/feature-availability";
import {
  VOICE_TRANSCRIPT_INSTRUCTION,
  VOICE_TRANSCRIPT_SYSTEM_PROMPT,
  checkVoiceTranscriptEligibility,
  isRetryableVoiceTranscriptFailure,
  oggOpusDurationSeconds,
  settleVoiceTranscript,
  voiceTranscriptJsonSchema,
  voiceTranscriptModelOutputSchema,
  type VoiceAudioFormat,
  type VoiceTranscriptFailureReason,
  type VoiceTranscriptModelOutput,
} from "./voice-transcript";

export const VOICE_TRANSCRIPT_SURFACE = "inbox_voice_transcript";

export type VoiceTranscriptStatus = "PENDING" | "PROCESSING" | "COMPLETE" | "LOW_CONFIDENCE" | "FAILED" | "SKIPPED";

export interface VoiceTranscriptRow {
  status: VoiceTranscriptStatus;
  attemptCount: number;
}

export interface VoiceTranscriptKey {
  agencyId: string;
  attachmentId: string;
  messageId: string;
}

export interface VoiceTranscriptSettlement {
  status: "COMPLETE" | "LOW_CONFIDENCE" | "FAILED" | "SKIPPED";
  transcriptText: string | null;
  failureReason: VoiceTranscriptFailureReason | null;
  language: string | null;
  confidence: number | null;
  provider: string | null;
  model: string | null;
  durationSeconds: number | null;
  completedAt: string;
}

export interface VoiceTranscriptStore {
  /** Creates the row as PENDING if absent and returns what is stored. Concurrent callers converge on one row. */
  ensure(key: VoiceTranscriptKey): Promise<VoiceTranscriptRow>;
  /** Claims an unfinished row and counts the attempt. False when another worker already settled it. */
  markProcessing(key: VoiceTranscriptKey): Promise<boolean>;
  /** Writes the outcome only while the row is unfinished. False when it was already settled. */
  settle(key: VoiceTranscriptKey, settlement: VoiceTranscriptSettlement): Promise<boolean>;
  releaseForRetry(key: VoiceTranscriptKey): Promise<void>;
}

export type VoiceTranscribeResult = AudioTranscriptResult<VoiceTranscriptModelOutput>;

export interface VoiceTranscriptLogFields {
  agencyId: string;
  attachmentId: string;
  status: VoiceTranscriptStatus;
  failureReason: VoiceTranscriptFailureReason | null;
  durationSeconds: number | null;
  latencyMs: number | null;
  model: string | null;
  runId: string | null;
  attempt: number;
}

export interface VoiceTranscriptWorkerDependencies {
  store: VoiceTranscriptStore;
  isEnabled(agencyId: string): Promise<boolean>;
  transcribe(input: { key: VoiceTranscriptKey; bytes: ArrayBuffer; format: VoiceAudioFormat }): Promise<VoiceTranscribeResult>;
  now(): Date;
  /** Receives metadata only: never transcript text, audio, or provider replies. */
  log(fields: VoiceTranscriptLogFields): void;
}

export interface VoiceTranscriptRunInput extends VoiceTranscriptKey {
  mimeType: string;
  bytes: ArrayBuffer;
  /** When omitted, read from an Ogg Opus stream; otherwise unknown. */
  durationSeconds?: number | null;
  isFinalAttempt: boolean;
}

export type VoiceTranscriptRunOutcome =
  | { outcome: "DONE"; status: VoiceTranscriptStatus }
  | { outcome: "RETRY"; status: "PENDING" };

const FINISHED: ReadonlySet<VoiceTranscriptStatus> = new Set(["COMPLETE", "LOW_CONFIDENCE", "FAILED", "SKIPPED"]);

export function createVoiceTranscriptWorker(dependencies: VoiceTranscriptWorkerDependencies) {
  const { store } = dependencies;

  async function finish(
    key: VoiceTranscriptKey,
    settlement: Omit<VoiceTranscriptSettlement, "completedAt" | "provider">,
    context: { attempt: number; latencyMs: number | null; runId: string | null },
  ): Promise<VoiceTranscriptRunOutcome> {
    const applied = await store.settle(key, {
      ...settlement,
      provider: settlement.model ? "openrouter" : null,
      completedAt: dependencies.now().toISOString(),
    });
    // Losing the race means another worker already recorded the outcome; there is nothing more to do.
    if (!applied) return { outcome: "DONE", status: "PROCESSING" };
    dependencies.log({
      agencyId: key.agencyId,
      attachmentId: key.attachmentId,
      status: settlement.status,
      failureReason: settlement.failureReason,
      durationSeconds: settlement.durationSeconds,
      latencyMs: context.latencyMs,
      model: settlement.model,
      runId: context.runId,
      attempt: context.attempt,
    });
    return { outcome: "DONE", status: settlement.status };
  }

  return {
    async run(input: VoiceTranscriptRunInput): Promise<VoiceTranscriptRunOutcome> {
      const key: VoiceTranscriptKey = { agencyId: input.agencyId, attachmentId: input.attachmentId, messageId: input.messageId };
      const existing = await store.ensure(key);
      if (FINISHED.has(existing.status)) return { outcome: "DONE", status: existing.status };

      const durationSeconds = input.durationSeconds ?? oggOpusDurationSeconds(input.bytes);
      const eligibility = checkVoiceTranscriptEligibility({
        enabled: await dependencies.isEnabled(input.agencyId),
        mimeType: input.mimeType,
        byteSize: input.bytes.byteLength,
        durationSeconds,
      });
      const skipped = (reason: VoiceTranscriptFailureReason, attempt: number) =>
        finish(
          key,
          { status: "SKIPPED", transcriptText: null, failureReason: reason, language: null, confidence: null, model: null, durationSeconds },
          { attempt, latencyMs: null, runId: null },
        );
      if (!eligibility.eligible) return skipped(eligibility.reason, existing.attemptCount);

      if (!(await store.markProcessing(key))) return { outcome: "DONE", status: "PROCESSING" };
      const attempt = existing.attemptCount + 1;

      const result = await dependencies.transcribe({ key, bytes: input.bytes, format: eligibility.format });
      if (!result.ok) {
        if (result.reason === "DISABLED" || result.reason === "QUOTA_EXCEEDED") return skipped(result.reason, attempt);
        if (isRetryableVoiceTranscriptFailure(result.reason) && !input.isFinalAttempt) {
          await store.releaseForRetry(key);
          dependencies.log({
            agencyId: key.agencyId,
            attachmentId: key.attachmentId,
            status: "PENDING",
            failureReason: result.reason,
            durationSeconds,
            latencyMs: null,
            model: null,
            runId: null,
            attempt,
          });
          return { outcome: "RETRY", status: "PENDING" };
        }
        return finish(
          key,
          { status: "FAILED", transcriptText: null, failureReason: result.reason, language: null, confidence: null, model: null, durationSeconds },
          { attempt, latencyMs: null, runId: null },
        );
      }

      const settled = settleVoiceTranscript(result.value);
      const context = { attempt, latencyMs: result.latencyMs, runId: result.runId };
      if (settled.status === "FAILED") {
        return finish(
          key,
          { status: "FAILED", transcriptText: null, failureReason: settled.failureReason, language: null, confidence: null, model: result.model, durationSeconds },
          context,
        );
      }
      return finish(
        key,
        {
          status: settled.status,
          transcriptText: settled.transcriptText,
          failureReason: null,
          language: settled.language,
          confidence: settled.confidence,
          model: result.model,
          durationSeconds,
        },
        context,
      );
    },
  };
}

/** The Supabase-backed store. Writes use the lane's service-role client; clients have no write grant. */
export function createSupabaseVoiceTranscriptStore(db: Db): VoiceTranscriptStore {
  const scope = (key: VoiceTranscriptKey) => ({ agency_id: key.agencyId, attachment_id: key.attachmentId });
  const unfinished = ["PENDING", "PROCESSING"];

  return {
    async ensure(key) {
      const { error: upsertError } = await db
        .from("inbox_voice_transcripts")
        .upsert({ ...scope(key), message_id: key.messageId }, { onConflict: "agency_id,attachment_id", ignoreDuplicates: true });
      if (upsertError) throw new Error(`Could not create the voice transcript row: ${upsertError.message}`);
      const { data, error } = await db
        .from("inbox_voice_transcripts")
        .select("status,attempt_count")
        .eq("agency_id", key.agencyId)
        .eq("attachment_id", key.attachmentId)
        .single();
      if (error || !data) throw new Error(`Could not read the voice transcript row: ${error?.message ?? "not found"}`);
      return { status: data.status as VoiceTranscriptStatus, attemptCount: Number(data.attempt_count) };
    },
    async markProcessing(key) {
      const { data: current, error: readError } = await db
        .from("inbox_voice_transcripts")
        .select("attempt_count")
        .eq("agency_id", key.agencyId)
        .eq("attachment_id", key.attachmentId)
        .in("status", unfinished)
        .maybeSingle();
      if (readError) throw new Error(`Could not read the voice transcript row: ${readError.message}`);
      if (!current) return false;
      // Optimistic on the attempt counter, so two workers cannot both claim the same attempt.
      const { data, error } = await db
        .from("inbox_voice_transcripts")
        .update({ status: "PROCESSING", started_at: new Date().toISOString(), attempt_count: Number(current.attempt_count) + 1 })
        .eq("agency_id", key.agencyId)
        .eq("attachment_id", key.attachmentId)
        .eq("attempt_count", current.attempt_count)
        .in("status", unfinished)
        .select("id");
      if (error) throw new Error(`Could not claim the voice transcript: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async settle(key, settlement) {
      const { data, error } = await db
        .from("inbox_voice_transcripts")
        .update({
          status: settlement.status,
          transcript_text: settlement.transcriptText,
          failure_reason: settlement.failureReason,
          language: settlement.language,
          confidence: settlement.confidence,
          provider: settlement.provider,
          model: settlement.model,
          duration_seconds: settlement.durationSeconds,
          completed_at: settlement.completedAt,
        })
        .eq("agency_id", key.agencyId)
        .eq("attachment_id", key.attachmentId)
        .in("status", unfinished)
        .select("id");
      if (error) throw new Error(`Could not save the voice transcript: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async releaseForRetry(key) {
      const { error } = await db
        .from("inbox_voice_transcripts")
        .update({ status: "PENDING" })
        .eq("agency_id", key.agencyId)
        .eq("attachment_id", key.attachmentId)
        .eq("status", "PROCESSING");
      if (error) throw new Error(`Could not release the voice transcript for retry: ${error.message}`);
    },
  };
}

/**
 * Off until switched on: transcription needs the plan's media-intelligence feature AND an explicit, enabled
 * `ai_surface_settings` row for this surface. The shared budget gate treats a missing row as permissive, which would
 * enable a costly audio call for every agency, so the opt-in is enforced here (checkpoint P4a).
 */
export async function isVoiceTranscriptionEnabled(db: Db, agencyId: string): Promise<boolean> {
  const [entitlements, settings] = await Promise.all([
    resolveEntitlements(db, agencyId),
    db.from("ai_surface_settings").select("enabled,mode").eq("agency_id", agencyId).eq("surface", VOICE_TRANSCRIPT_SURFACE).maybeSingle(),
  ]);
  if (settings.error || !settings.data) return false;
  if (!resolveInboxFeatureAvailability({ entitlements, inboxQueuesV2: false }).mediaIntelligence) return false;
  return settings.data.enabled === true && settings.data.mode !== "OFF";
}

export function createSupabaseVoiceTranscriptWorker(db: Db, signal?: AbortSignal) {
  return createVoiceTranscriptWorker({
    store: createSupabaseVoiceTranscriptStore(db),
    isEnabled: (agencyId) => isVoiceTranscriptionEnabled(db, agencyId),
    transcribe: ({ key, bytes, format }) =>
      generateAudioTranscript({
        system: VOICE_TRANSCRIPT_SYSTEM_PROMPT,
        instruction: VOICE_TRANSCRIPT_INSTRUCTION,
        audio: { bytes, format },
        jsonSchema: voiceTranscriptJsonSchema,
        schema: voiceTranscriptModelOutputSchema,
        surface: VOICE_TRANSCRIPT_SURFACE,
        agencyId: key.agencyId,
        subjectType: "message_attachment",
        subjectId: key.attachmentId,
        maxTokens: 6000,
        db,
        signal,
      }),
    now: () => new Date(),
    log: (fields) => console.info("voice transcript", JSON.stringify(fields)),
  });
}

export { TRANSCRIBE_MODEL };
