/**
 * Text embeddings through OpenRouter — used by the WhatsApp knowledge base so a question phrased
 * differently from the document (or written in Sinhala or Tamil) can still find the right passage.
 * See P3 in docs/modules/whatsapp-knowledge-base-implementation-plan.md.
 *
 * Server-only; reuses OPENROUTER_API_KEY. The model is configurable with KNOWLEDGE_EMBEDDING_MODEL
 * and must produce 1024-dimensional vectors to match `knowledge_chunks.embedding`.
 */

import "server-only";

import { z } from "zod";

const ENDPOINT = "https://openrouter.ai/api/v1/embeddings";
export const DEFAULT_KNOWLEDGE_EMBEDDING_MODEL = "baai/bge-m3";
export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 1024;
const BATCH_SIZE = 32;
const TIMEOUT_MS = 30_000;

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export function isEmbeddingConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export function knowledgeEmbeddingModel(): string {
  return process.env.KNOWLEDGE_EMBEDDING_MODEL?.trim() || DEFAULT_KNOWLEDGE_EMBEDDING_MODEL;
}

const embeddingResponseSchema = z.object({
  data: z.array(z.object({ index: z.number().int(), embedding: z.array(z.number()) })),
});

/** Validates a response body and returns vectors in input order. Pure — see embeddings.test.ts. */
export function parseEmbeddingResponse(body: unknown, expectedCount: number): number[][] {
  const parsed = embeddingResponseSchema.safeParse(body);
  if (!parsed.success) throw new EmbeddingError("The embedding service returned an unexpected response.");
  if (parsed.data.data.length !== expectedCount) {
    throw new EmbeddingError(`Expected ${expectedCount} embeddings but received ${parsed.data.data.length}.`);
  }
  const ordered = [...parsed.data.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
  for (const vector of ordered) {
    if (vector.length !== KNOWLEDGE_EMBEDDING_DIMENSIONS) {
      throw new EmbeddingError(
        `The embedding model returned ${vector.length} dimensions; the knowledge base expects ${KNOWLEDGE_EMBEDDING_DIMENSIONS}.`,
      );
    }
  }
  return ordered;
}

/** pgvector's text input format, which PostgREST accepts for a vector column or function argument. */
export function toPgVector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

async function embedBatch(apiKey: string, texts: string[]): Promise<number[][]> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "Manasik OS" },
      body: JSON.stringify({ model: knowledgeEmbeddingModel(), input: texts }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    throw new EmbeddingError(error instanceof Error ? error.message : "Network error");
  }
  if (!response.ok) throw new EmbeddingError(`The embedding service returned HTTP ${response.status}.`);
  return parseEmbeddingResponse(await response.json().catch(() => null), texts.length);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new EmbeddingError("OPENROUTER_API_KEY is not set");
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    vectors.push(...(await embedBatch(apiKey, texts.slice(start, start + BATCH_SIZE))));
  }
  return vectors;
}
