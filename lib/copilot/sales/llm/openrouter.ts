/**
 * Minimal OpenRouter client (OpenAI-compatible chat completions).
 *
 * Server-only: the API key never reaches the browser. No SDK dependency —
 * a single `fetch` with a timeout. Configure with:
 *   OPENROUTER_API_KEY  (required to enable)
 *   OPENROUTER_MODEL    (optional, default below — see openrouter.ai/models)
 */

import "server-only";

import { z } from "zod";

import { openRouterProviderPreferences } from "@/lib/ai/openrouter-privacy";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_OPENROUTER_MODEL = "google/gemini-3.8-flash";
const TIMEOUT_MS = 25_000;

export function isOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export function openRouterModel(): string {
  return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
}

export class OpenRouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenRouterError";
  }
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const responseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable().optional() }).optional() }))
    .optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

export async function openRouterChat(
  messages: ChatMessage[],
  options: { json?: boolean; maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new OpenRouterError("OPENROUTER_API_KEY is not set");

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Manasik OS",
      },
      body: JSON.stringify({
        ...openRouterProviderPreferences(),
        model: openRouterModel(),
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 1200,
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    throw new OpenRouterError(error instanceof Error ? error.message : "Network error");
  }

  let body: z.infer<typeof responseSchema> = {};
  try {
    const parsed = responseSchema.safeParse(await response.json());
    if (parsed.success) body = parsed.data;
  } catch {
    // Non-JSON error body — reported by status below.
  }

  if (!response.ok) {
    throw new OpenRouterError(body.error?.message ?? `OpenRouter returned HTTP ${response.status}`);
  }
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) throw new OpenRouterError("OpenRouter returned an empty response");
  return content;
}

/** Chat call whose reply must be JSON matching `schema`; throws otherwise. */
export async function openRouterJson<T>(
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  options: { maxTokens?: number } = {},
): Promise<T> {
  const raw = await openRouterChat(messages, { ...options, json: true, temperature: 0 });
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new OpenRouterError("The model did not return valid JSON");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new OpenRouterError(`The model's JSON failed validation: ${z.prettifyError(result.error).slice(0, 300)}`);
  }
  return result.data;
}
