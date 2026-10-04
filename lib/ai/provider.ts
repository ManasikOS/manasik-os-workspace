/**
 * The one AI provider seam every surface calls through — Phase 0 (P0.1) of
 * docs/modules/manasik-intelligence-build-roadmap.md.
 *
 * Generalises `lib/agent/kernel/runner.ts` (Anthropic client, model id,
 * `isAiConfigured()`) with model tiering, a structured-output helper that
 * matches the JSON-schema pattern already used by
 * `lib/data/documents-ai.ts`, and a budget check before every call. Every
 * surface's workflow module should call `generateStructured()` here rather
 * than opening its own Anthropic client or `fetch`ing OpenRouter directly —
 * that is what makes one telemetry table and one cost ledger possible.
 *
 * `runner.ts` re-exports `getClient`/`isAiConfigured`/`MODEL_ID` from this
 * module (not the other way around) so nothing importing the old path
 * breaks, but there is only ever one lazily-constructed Anthropic client in
 * the process.
 */

import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

import { checkBudget } from "@/lib/ai/budget";
import type { Db } from "@/lib/ai/db";
import { fetchWithProviderPreferences } from "@/lib/ai/openrouter-privacy";
import { recordAiRun } from "@/lib/ai/telemetry";

/**
 * `classify` — cheap, high-volume, low-latency (triage, sentiment, intent,
 * field extraction). `draft` — customer-facing copy, translation,
 * summaries. `reason` — an explanation that touches money, eligibility or
 * margin. `agent` — a multi-turn tool-calling loop (departure ops and
 * anything built the same way).
 */
export type AiTier = "classify" | "draft" | "reason" | "agent";

/**
 * OpenRouter model slug per tier, each overridable by an environment variable (see .env.example).
 *
 * Chosen on 2026-09-19 by running the same tool-calling turns (greeting, price lookup, Sinhala, Tamil)
 * through six models via OpenRouter; see docs/architecture/ai-model-selection.md. `gpt-5.6-luna` answered
 * every turn correctly, in about 1-4 s, for roughly $0.0001 a turn, about 30-100x cheaper than the
 * previous default (claude-opus-5, $5/$25 per million tokens). The `reason`/`draft` tiers, which explain
 * money or eligibility to staff, use the stronger-but-still-cheap gemini flash.
 */
const DEFAULT_FAST_MODEL = "openai/gpt-5.6-luna";
const DEFAULT_REASON_MODEL = "google/gemini-3.8-flash";

export const MODEL_FOR_TIER: Record<AiTier, string> = {
  classify: process.env.AI_CLASSIFY_MODEL?.trim() || DEFAULT_FAST_MODEL,
  draft: process.env.AI_DRAFT_MODEL?.trim() || DEFAULT_REASON_MODEL,
  reason: process.env.AI_REASON_MODEL?.trim() || DEFAULT_REASON_MODEL,
  agent: process.env.AI_AGENT_MODEL?.trim() || DEFAULT_FAST_MODEL,
};

/** The model the WhatsApp assistant and the other tool-calling agents use. An OpenRouter model slug. */
export const MODEL_ID = MODEL_FOR_TIER.agent;

/**
 * All AI goes through OpenRouter (one key, one bill). The Anthropic SDK is kept only as the client for
 * OpenRouter's Anthropic-compatible endpoint, so tool-calling stays the same; there is no Anthropic key.
 */
const OPENROUTER_ANTHROPIC_BASE_URL = "https://openrouter.ai/api";

let client: Anthropic | null = null;

export function isAiConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY?.trim();
}

export function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      baseURL: OPENROUTER_ANTHROPIC_BASE_URL,
      apiKey: null,
      authToken: process.env.OPENROUTER_API_KEY?.trim() ?? null,
      // Adds OPENROUTER_DATA_POLICY's provider restriction to every request; a no-op until that is set.
      fetch: fetchWithProviderPreferences(),
    });
  }
  return client;
}

/** Where a result actually came from — shown to staff so nothing pretends to be AI when it isn't. */
export type AiSource = "RULES" | "LLM";

export interface Citation {
  documentIndex: number;
  documentTitle: string | null;
  citedText: string;
}

export interface AiResult<T> {
  value: T | null;
  source: AiSource;
  /** Set whenever `value` is null or a fallback was used — always explains why. */
  note: string | null;
  /** The `ai_runs` row id this call wrote, if any (null when the call never reached the model — e.g. budget refusal). */
  runId: string | null;
  citations?: Citation[];
}

export interface GenerateStructuredInput<T> {
  tier: AiTier;
  /** Frozen, cacheable content — persona, rules, agency config. */
  system: string;
  /** Volatile content — the actual question/pack for this call. */
  instruction: string;
  /** Optional image/PDF supplied to the same budgeted and metered provider seam. */
  media?: {
    bytes: ArrayBuffer;
    mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  };
  /** Plain JSON Schema (not zod) — matches `documents-ai.ts`'s `output_config.format` shape. */
  jsonSchema: Record<string, unknown>;
  /** Runtime-validates the parsed JSON before it is trusted. */
  schema: z.ZodType<T>;
  surface: string;
  agencyId: string;
  subjectType?: string;
  subjectId?: string;
  maxTokens?: number;
  db: Db;
}

/**
 * One structured-output call through the shared seam. Never throws to the
 * caller — a budget refusal, a model error, or a schema-validation failure
 * all come back as `{ value: null, source: "RULES", note }` so every
 * surface's own deterministic fallback (never guessing, never blocking the
 * page) stays the caller's responsibility, not this function's.
 */
export async function generateStructured<T>(input: GenerateStructuredInput<T>): Promise<AiResult<T>> {
  if (!isAiConfigured()) {
    return { value: null, source: "RULES", note: "OPENROUTER_API_KEY is not configured.", runId: null };
  }

  const budget = await checkBudget(input.agencyId, input.surface, input.db);
  if (!budget.ok) {
    return { value: null, source: "RULES", note: budget.reason ?? "Monthly AI budget exceeded.", runId: null };
  }

  const model = MODEL_FOR_TIER[input.tier];
  const startedAt = Date.now();
  let runId: string | null = null;

  try {
    const userContent = input.media
      ? [
          input.media.mimeType === "application/pdf"
            ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: Buffer.from(input.media.bytes).toString("base64") } }
            : { type: "image" as const, source: { type: "base64" as const, media_type: input.media.mimeType, data: Buffer.from(input.media.bytes).toString("base64") } },
          { type: "text" as const, text: input.instruction },
        ]
      : input.instruction;
    const response = await getClient().messages.create({
      model,
      max_tokens: input.maxTokens ?? 4096,
      thinking: { type: "adaptive" },
      output_config: { effort: input.tier === "classify" ? "low" : "medium", format: { type: "json_schema", schema: input.jsonSchema } },
      system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
    });

    runId = await recordAiRun(input.db, {
      agencyId: input.agencyId,
      surface: input.surface,
      tier: input.tier,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      model,
      usage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        cacheRead: response.usage.cache_read_input_tokens ?? 0,
        cacheCreation: response.usage.cache_creation_input_tokens ?? 0,
      },
      latencyMs: Date.now() - startedAt,
      status: response.stop_reason === "refusal" ? "REFUSAL" : "OK",
      stopReason: response.stop_reason ?? null,
    });

    if (response.stop_reason === "refusal") {
      return { value: null, source: "RULES", note: "Manasik Copilot declined to answer this.", runId };
    }

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { value: null, source: "RULES", note: "No structured output returned.", runId };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return { value: null, source: "RULES", note: "The model did not return valid JSON.", runId };
    }

    const validated = input.schema.safeParse(parsed);
    if (!validated.success) {
      return {
        value: null,
        source: "RULES",
        note: `The model's JSON failed validation: ${validated.error.issues[0]?.message ?? "unknown error"}`,
        runId,
      };
    }

    return { value: validated.data, source: "LLM", note: null, runId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!runId) {
      runId = await recordAiRun(input.db, {
        agencyId: input.agencyId,
        surface: input.surface,
        tier: input.tier,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        model,
        usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        latencyMs: Date.now() - startedAt,
        status: "MODEL_ERROR",
        stopReason: null,
        error: message,
      }).catch(() => null);
    }
    return { value: null, source: "RULES", note: `AI call failed: ${message}`, runId };
  }
}

/**
 * The audio-capable model for voice-note transcription. An OpenRouter slug, overridable per deployment. Audio input
 * is only available on some models, so this is separate from the text tiers above.
 */
export const TRANSCRIBE_MODEL = process.env.AI_TRANSCRIBE_MODEL?.trim() || DEFAULT_REASON_MODEL;

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const AUDIO_REQUEST_TIMEOUT_MS = 60_000;

export type AudioTranscriptFailure = "DISABLED" | "QUOTA_EXCEEDED" | "PROVIDER_ERROR" | "TIMEOUT";

export type AudioTranscriptResult<T> =
  | { ok: true; value: T; model: string; runId: string | null; latencyMs: number }
  | { ok: false; reason: AudioTranscriptFailure; note: string };

export interface GenerateAudioTranscriptInput<T> {
  system: string;
  instruction: string;
  audio: { bytes: ArrayBuffer; format: "ogg" | "mp3" | "m4a" | "wav" | "aac" | "flac" };
  jsonSchema: Record<string, unknown>;
  schema: z.ZodType<T>;
  surface: string;
  agencyId: string;
  subjectType?: string;
  subjectId?: string;
  maxTokens?: number;
  db: Db;
  /** Aborts the request, e.g. when the lane's budget is spent. */
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/**
 * Sends one voice note through the same configuration, budget gate and `ai_runs` metering as every other surface.
 * Never throws: every refusal or failure comes back as a reason code. The audio and the model's reply are never
 * written to telemetry or to the returned note, since both are customer content.
 */
export async function generateAudioTranscript<T>(input: GenerateAudioTranscriptInput<T>): Promise<AudioTranscriptResult<T>> {
  if (!isAiConfigured()) return { ok: false, reason: "DISABLED", note: "AI is not configured." };

  const budget = await checkBudget(input.agencyId, input.surface, input.db);
  if (!budget.ok) {
    return { ok: false, reason: budget.degradation ? "QUOTA_EXCEEDED" : "DISABLED", note: budget.reason ?? "AI is unavailable for this agency." };
  }
  // The shared gate only pauses text-drafting surfaces once the allowance is spent. Audio is the costliest input, so
  // any degraded allowance state stops it.
  if (budget.degradation === "RULES_AND_MATCHING_ONLY" || budget.degradation === "DETERMINISTIC_ONLY") {
    return { ok: false, reason: "QUOTA_EXCEEDED", note: "The agency's AI allowance is exhausted." };
  }

  const startedAt = Date.now();
  const fail = async (reason: Exclude<AudioTranscriptFailure, "DISABLED" | "QUOTA_EXCEEDED">, note: string): Promise<AudioTranscriptResult<T>> => {
    await recordAiRun(input.db, {
      agencyId: input.agencyId,
      surface: input.surface,
      tier: null,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      model: TRANSCRIBE_MODEL,
      usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      latencyMs: Date.now() - startedAt,
      status: "MODEL_ERROR",
      stopReason: null,
      error: note,
    }).catch(() => null);
    return { ok: false, reason, note };
  };

  try {
    const timeout = AbortSignal.timeout(AUDIO_REQUEST_TIMEOUT_MS);
    const response = await (input.fetchImpl ?? fetchWithProviderPreferences())(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENROUTER_API_KEY?.trim() ?? ""}` },
      signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
      body: JSON.stringify({
        model: TRANSCRIBE_MODEL,
        max_tokens: input.maxTokens ?? 4096,
        messages: [
          { role: "system", content: input.system },
          {
            role: "user",
            content: [
              { type: "text", text: input.instruction },
              { type: "input_audio", input_audio: { data: Buffer.from(input.audio.bytes).toString("base64"), format: input.audio.format } },
            ],
          },
        ],
        response_format: { type: "json_schema", json_schema: { name: "voice_transcript", strict: true, schema: input.jsonSchema } },
      }),
    });
    // The provider's error body can echo the request, so only the status is kept.
    if (!response.ok) return fail("PROVIDER_ERROR", `The transcription provider returned HTTP ${response.status}.`);

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = body.choices?.[0]?.message?.content;
    let parsed: unknown;
    try {
      parsed = typeof content === "string" ? JSON.parse(content) : null;
    } catch {
      return fail("PROVIDER_ERROR", "The transcription provider did not return valid JSON.");
    }
    const validated = input.schema.safeParse(parsed);
    if (!validated.success) return fail("PROVIDER_ERROR", "The transcription output failed validation.");

    const latencyMs = Date.now() - startedAt;
    const runId = await recordAiRun(input.db, {
      agencyId: input.agencyId,
      surface: input.surface,
      tier: null,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      model: TRANSCRIBE_MODEL,
      usage: { input: body.usage?.prompt_tokens ?? 0, output: body.usage?.completion_tokens ?? 0, cacheRead: 0, cacheCreation: 0 },
      latencyMs,
      status: "OK",
      stopReason: null,
    });
    return { ok: true, value: validated.data, model: TRANSCRIBE_MODEL, runId, latencyMs };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return name === "TimeoutError" || name === "AbortError"
      ? fail("TIMEOUT", "The transcription request timed out.")
      : fail("PROVIDER_ERROR", "The transcription request failed.");
  }
}
