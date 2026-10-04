import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let embeddingConfigured = true;
const embedTexts = vi.fn(async (texts: string[]) => texts.map((_, index) => [index, 1, 2]));
vi.mock("@/lib/ai/embeddings", () => ({
  isEmbeddingConfigured: () => embeddingConfigured,
  embedTexts: (texts: string[]) => embedTexts(texts),
  knowledgeEmbeddingModel: () => "test-embedding-model",
  toPgVector: (vector: number[]) => `[${vector.join(",")}]`,
}));

import type { Db } from "@/lib/data/whatsapp-repository";
import { EMBED_STEP_CHUNKS, embedKnowledgeChunkRange, finalizeKnowledgeDocument, markKnowledgeDocumentEmbedding } from "./ingest";

const AGENCY = "0b8e7c3a-1f4d-4e6a-9d2b-7a1c5e3f9b10";
const DOC = "5d2f9a41-8c7e-4b3a-a6d1-2e9f0c7b4a83";

afterEach(() => {
  embeddingConfigured = true;
  embedTexts.mockClear();
  vi.restoreAllMocks();
});

/** Records the range asked for and every embedding written; the count query answers `missing`. */
function world(input: { rows?: Array<{ id: string; content: string }>; missing?: number; updateError?: boolean }) {
  const ranges: Array<[number, number]> = [];
  const embeddingUpdates: Array<{ id: unknown; values: Record<string, unknown> }> = [];
  const documentUpdates: Array<Record<string, unknown>> = [];
  const db = {
    from: (table: string) => {
      let updating: Record<string, unknown> | null = null;
      let counting = false;
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        select: (_columns: string, options?: { head?: boolean }) => {
          counting = Boolean(options?.head);
          return chain;
        },
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        is: () => chain,
        order: () => chain,
        range: async (from: number, to: number) => {
          ranges.push([from, to]);
          return { data: input.rows ?? [], error: null };
        },
        update: (values: Record<string, unknown>) => {
          updating = values;
          return chain;
        },
        then: (resolve: (value: { data: null; error: unknown; count?: number }) => void) => {
          if (updating && table === "knowledge_chunks") {
            embeddingUpdates.push({ id: filters.id, values: updating });
            return resolve({ data: null, error: input.updateError ? { message: "write failed" } : null });
          }
          if (updating && table === "knowledge_documents") {
            documentUpdates.push(updating);
            return resolve({ data: null, error: null });
          }
          if (counting) return resolve({ data: null, error: null, count: input.missing ?? 0 });
          return resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  };
  return { db: db as unknown as Db, ranges, embeddingUpdates, documentUpdates };
}

describe("embedKnowledgeChunkRange", () => {
  it("embeds one bounded slice of pieces and stores each vector on its own piece", async () => {
    const w = world({ rows: [{ id: "c1", content: "first" }, { id: "c2", content: "second" }] });
    expect(await embedKnowledgeChunkRange(w.db, AGENCY, DOC, 64)).toBe(2);
    expect(w.ranges).toEqual([[64, 64 + EMBED_STEP_CHUNKS - 1]]);
    expect(embedTexts).toHaveBeenCalledWith(["first", "second"]);
    expect(w.embeddingUpdates.map((update) => update.id)).toEqual(["c1", "c2"]);
    expect(w.embeddingUpdates[0].values).toEqual({ embedding: "[0,1,2]" });
  });

  it("does nothing, and reads nothing, when embedding is not configured", async () => {
    embeddingConfigured = false;
    const w = world({ rows: [{ id: "c1", content: "x" }] });
    expect(await embedKnowledgeChunkRange(w.db, AGENCY, DOC, 0)).toBe(0);
    expect(w.ranges).toHaveLength(0);
  });

  it("keeps the pieces on keyword search when the embedding call fails, instead of failing the document", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    embedTexts.mockRejectedValueOnce(new Error("provider down"));
    const w = world({ rows: [{ id: "c1", content: "x" }] });
    expect(await embedKnowledgeChunkRange(w.db, AGENCY, DOC, 0)).toBe(0);
    expect(w.embeddingUpdates).toHaveLength(0);
  });

  it("raises when a vector cannot be stored, so the step retries", async () => {
    const w = world({ rows: [{ id: "c1", content: "x" }], updateError: true });
    await expect(embedKnowledgeChunkRange(w.db, AGENCY, DOC, 0)).rejects.toThrow("Could not store an embedding");
  });

  it("returns 0 past the end of the document", async () => {
    expect(await embedKnowledgeChunkRange(world({ rows: [] }).db, AGENCY, DOC, 320)).toBe(0);
  });
});

describe("finalizeKnowledgeDocument", () => {
  const prepared = { chunkCount: 40, hasPriceWarning: true };

  it("marks the document READY and records the embedding model only when every piece has a vector", async () => {
    const w = world({ missing: 0 });
    expect(await finalizeKnowledgeDocument(w.db, AGENCY, DOC, prepared)).toEqual({ embeddedAll: true });
    expect(w.documentUpdates[0]).toEqual({ status: "READY", status_detail: null, embedding_model: "test-embedding-model", chunk_count: 40, has_price_warning: true });
  });

  it("is still READY, on keyword search, when some pieces have no vector, and records no model", async () => {
    const w = world({ missing: 5 });
    expect(await finalizeKnowledgeDocument(w.db, AGENCY, DOC, prepared)).toEqual({ embeddedAll: false });
    expect(w.documentUpdates[0]).toMatchObject({ status: "READY", embedding_model: null, chunk_count: 40 });
  });

  it("records no model when embedding is not configured at all", async () => {
    embeddingConfigured = false;
    const w = world({ missing: 0 });
    expect((await finalizeKnowledgeDocument(w.db, AGENCY, DOC, prepared)).embeddedAll).toBe(false);
    expect(w.documentUpdates[0]).toMatchObject({ embedding_model: null });
  });
});

describe("markKnowledgeDocumentEmbedding", () => {
  it("shows the document as being embedded only when embedding is configured", async () => {
    const on = world({});
    await markKnowledgeDocumentEmbedding(on.db, AGENCY, DOC);
    expect(on.documentUpdates).toEqual([{ status: "EMBEDDING" }]);
    embeddingConfigured = false;
    const off = world({});
    await markKnowledgeDocumentEmbedding(off.db, AGENCY, DOC);
    expect(off.documentUpdates).toHaveLength(0);
  });
});
