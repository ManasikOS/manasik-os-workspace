/**
 * The `EMBED_DOCUMENT` job: download a knowledge document, read its text, cut it into pieces and
 * store them. Runs with the service-role client (a queue worker has no session), so every query
 * carries an explicit agency filter. Idempotent — a re-run deletes and rebuilds that document's
 * pieces. See §6 of docs/modules/whatsapp-knowledge-base-implementation-plan.md.
 *
 * Embedding is best-effort: if it fails a document is still READY on full-text search alone.
 * Works for both uploaded files and written policies (`knowledge_articles`).
 */

import "server-only";

import { chunkKnowledgeText } from "@/lib/agent/whatsapp/knowledge/chunker";
import { embedTexts, isEmbeddingConfigured, knowledgeEmbeddingModel, toPgVector } from "@/lib/ai/embeddings";
import { extractKnowledgeText, KnowledgeExtractionError } from "@/lib/agent/whatsapp/knowledge/extract";
import { containsCurrencyAmount } from "@/lib/agent/whatsapp/knowledge/price-scan";
import type { Db } from "@/lib/data/whatsapp-repository";

const KNOWLEDGE_BUCKET = "knowledge-base";
const CHUNK_INSERT_BATCH = 100;
/** ~1.3M characters — far more than a policy document. A larger file is almost certainly the wrong file. */
const MAX_CHUNKS_PER_DOCUMENT = 400;

interface KnowledgeDocumentForIngest {
  id: string;
  agency_id: string;
  source_kind: "UPLOAD" | "ARTICLE";
  article_id: string | null;
  storage_path: string | null;
  mime_type: string | null;
  language: string;
}

async function setDocumentStatus(
  db: Db,
  agencyId: string,
  documentId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from("knowledge_documents").update(fields).eq("id", documentId).eq("agency_id", agencyId);
  if (error) throw new Error(`Could not update knowledge document ${documentId}: ${error.message}`);
}

/** Shown on the knowledge screen when a document could not be prepared. Plain language, no stack traces. */
export async function markKnowledgeDocumentFailed(db: Db, agencyId: string, documentId: string, reason: string): Promise<void> {
  await db
    .from("knowledge_documents")
    .update({ status: "FAILED", status_detail: reason.slice(0, 500), chunk_count: 0 })
    .eq("id", documentId)
    .eq("agency_id", agencyId);
}

/** Returns the document's text, or null after marking the document FAILED for a reason retrying cannot fix. */
async function loadKnowledgeText(db: Db, agencyId: string, document: KnowledgeDocumentForIngest): Promise<string | null> {
  if (document.source_kind === "ARTICLE") {
    const { data, error } = await db
      .from("knowledge_articles")
      .select("title, body")
      .eq("id", document.article_id ?? "")
      .eq("agency_id", agencyId)
      .maybeSingle();
    if (error) throw new Error(`Could not load the written policy: ${error.message}`);
    const article = data as { title: string; body: string } | null;
    if (!article || article.body.trim().length === 0) {
      await markKnowledgeDocumentFailed(db, agencyId, document.id, "This written policy has no text.");
      return null;
    }
    return article.title + "\n\n" + article.body;
  }

  if (!document.storage_path || !document.mime_type) {
    await markKnowledgeDocumentFailed(db, agencyId, document.id, "This document has no file attached.");
    return null;
  }

  const download = await db.storage.from(KNOWLEDGE_BUCKET).download(document.storage_path);
  if (download.error || !download.data) {
    // Transient storage trouble is worth a retry; the job's retry budget decides when to give up.
    throw new Error(`Could not download the file: ${download.error?.message ?? "no data"}`);
  }
  const bytes = new Uint8Array(await download.data.arrayBuffer());

  try {
    return await extractKnowledgeText(bytes, document.mime_type);
  } catch (cause) {
    if (cause instanceof KnowledgeExtractionError && cause.permanent) {
      await markKnowledgeDocumentFailed(db, agencyId, document.id, cause.message);
      return null;
    }
    throw cause;
  }
}

interface ChunkedKnowledgeDocument {
  document: KnowledgeDocumentForIngest;
  text: string;
  chunks: ReturnType<typeof chunkKnowledgeText>;
  ftsConfig: "english" | "simple";
}

/**
 * Loads a document, reads its text and cuts it into pieces. When there is nothing to do (the document was deleted, it has no usable text,
 * or it is too long) it marks the document FAILED where that is the answer, and returns null. Shared by the one-shot job and the
 * resumable phases below, so both apply exactly the same rules.
 */
async function readAndChunkKnowledgeDocument(db: Db, agencyId: string, documentId: string): Promise<ChunkedKnowledgeDocument | null> {
  const { data, error } = await db
    .from("knowledge_documents")
    .select("id, agency_id, source_kind, article_id, storage_path, mime_type, language")
    .eq("id", documentId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (error) throw new Error(`Could not load knowledge document ${documentId}: ${error.message}`);
  // Deleted between upload and processing — nothing left to do, and retrying can't bring it back.
  if (!data) return null;
  const document = data as KnowledgeDocumentForIngest;

  await setDocumentStatus(db, agencyId, documentId, { status: "EXTRACTING", status_detail: null });

  const text = await loadKnowledgeText(db, agencyId, document);
  if (text === null) return null;

  await setDocumentStatus(db, agencyId, documentId, { status: "CHUNKING" });

  const chunks = chunkKnowledgeText(text);
  if (chunks.length === 0) {
    await markKnowledgeDocumentFailed(db, agencyId, documentId, "We couldn't find any text in this file.");
    return null;
  }
  if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) {
    await markKnowledgeDocumentFailed(
      db,
      agencyId,
      documentId,
      "This document is too long for the assistant to use. Split it into smaller documents, for example one per topic.",
    );
    return null;
  }

  // English gets stemming; Sinhala and Tamil use the plain configuration (plan D1).
  const ftsConfig = document.language === "en" ? "english" : "simple";
  return { document, text, chunks, ftsConfig };
}

export async function ingestKnowledgeDocument(db: Db, agencyId: string, documentId: string): Promise<void> {
  const prepared = await readAndChunkKnowledgeDocument(db, agencyId, documentId);
  if (!prepared) return;
  const { text, chunks, ftsConfig } = prepared;

  // Embeddings are best-effort: a failure leaves the document READY on keyword search alone.
  let embeddings: number[][] | null = null;
  if (isEmbeddingConfigured()) {
    await setDocumentStatus(db, agencyId, documentId, { status: "EMBEDDING" });
    try {
      embeddings = await embedTexts(chunks.map((chunk) => chunk.content));
    } catch (embeddingError) {
      console.warn(`Knowledge document ${documentId} kept without embeddings:`, embeddingError instanceof Error ? embeddingError.message : embeddingError);
    }
  }

  // Rebuild from scratch so a re-index never leaves stale pieces behind.
  const cleared = await db.from("knowledge_chunks").delete().eq("document_id", documentId).eq("agency_id", agencyId);
  if (cleared.error) throw new Error(`Could not clear old pieces: ${cleared.error.message}`);

  for (let start = 0; start < chunks.length; start += CHUNK_INSERT_BATCH) {
    const batch = chunks.slice(start, start + CHUNK_INSERT_BATCH).map((chunk, offset) => ({
      agency_id: agencyId,
      document_id: documentId,
      chunk_index: chunk.chunkIndex,
      content: chunk.content,
      token_estimate: chunk.tokenEstimate,
      fts_config: ftsConfig,
      embedding: embeddings ? toPgVector(embeddings[start + offset]) : null,
    }));
    const inserted = await db.from("knowledge_chunks").insert(batch);
    if (inserted.error) throw new Error(`Could not store the document's text: ${inserted.error.message}`);
  }

  await setDocumentStatus(db, agencyId, documentId, {
    status: "READY",
    status_detail: null,
    embedding_model: embeddings ? knowledgeEmbeddingModel() : null,
    chunk_count: chunks.length,
    has_price_warning: containsCurrencyAmount(text),
  });
}

/* ── The same work in resumable phases (I5) ───────────────────────────────────
 * Currently UNUSED: an Inngest function ran these as separate steps so a long document survived a restart, and that function is gone
 * (decision R9; making the job resumable, T12, was skipped). They are kept, with their tests, as the starting point if resumable
 * ingestion is ever wanted: each phase is idempotent, and nothing but a count crosses a phase boundary (the text lives in Postgres). */

export interface PreparedKnowledgeDocument {
  chunkCount: number;
  hasPriceWarning: boolean;
}

/** Phase 1: read, chunk and store the pieces WITHOUT embeddings. Returns null when the document could not be prepared (it is already marked FAILED). */
export async function prepareKnowledgeDocument(db: Db, agencyId: string, documentId: string): Promise<PreparedKnowledgeDocument | null> {
  const prepared = await readAndChunkKnowledgeDocument(db, agencyId, documentId);
  if (!prepared) return null;
  const { text, chunks, ftsConfig } = prepared;

  // Rebuild from scratch so a re-run never leaves stale or duplicate pieces behind.
  const cleared = await db.from("knowledge_chunks").delete().eq("document_id", documentId).eq("agency_id", agencyId);
  if (cleared.error) throw new Error(`Could not clear old pieces: ${cleared.error.message}`);
  for (let start = 0; start < chunks.length; start += CHUNK_INSERT_BATCH) {
    const batch = chunks.slice(start, start + CHUNK_INSERT_BATCH).map((chunk) => ({
      agency_id: agencyId,
      document_id: documentId,
      chunk_index: chunk.chunkIndex,
      content: chunk.content,
      token_estimate: chunk.tokenEstimate,
      fts_config: ftsConfig,
      embedding: null,
    }));
    const inserted = await db.from("knowledge_chunks").insert(batch);
    if (inserted.error) throw new Error(`Could not store the document's text: ${inserted.error.message}`);
  }
  return { chunkCount: chunks.length, hasPriceWarning: containsCurrencyAmount(text) };
}

/** How many pieces one embedding step handles. Small enough that a step is quick and a retry repeats little. */
export const EMBED_STEP_CHUNKS = 32;

/**
 * Phase 2, one step: embed pieces `[from, from + EMBED_STEP_CHUNKS)`. Best-effort, as in the one-shot job: a failure leaves those pieces
 * to keyword search and the document is still usable. Returns how many pieces now have an embedding.
 */
export async function embedKnowledgeChunkRange(db: Db, agencyId: string, documentId: string, from: number): Promise<number> {
  if (!isEmbeddingConfigured()) return 0;
  const { data, error } = await db
    .from("knowledge_chunks")
    .select("id, content")
    .eq("agency_id", agencyId)
    .eq("document_id", documentId)
    .order("chunk_index", { ascending: true })
    .range(from, from + EMBED_STEP_CHUNKS - 1);
  if (error) throw new Error(`Could not read the pieces to embed: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; content: string }>;
  if (rows.length === 0) return 0;
  let vectors: number[][];
  try {
    vectors = await embedTexts(rows.map((row) => row.content));
  } catch (embeddingError) {
    console.warn(`Knowledge document ${documentId} kept without embeddings for pieces from ${from}:`, embeddingError instanceof Error ? embeddingError.message : embeddingError);
    return 0;
  }
  const results = await Promise.all(
    rows.map((row, index) => db.from("knowledge_chunks").update({ embedding: toPgVector(vectors[index]) }).eq("id", row.id).eq("agency_id", agencyId)),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(`Could not store an embedding: ${failed.error.message}`);
  return rows.length;
}

/** Phase 3: mark the document READY. The embedding model is recorded only when every piece has an embedding. */
export async function finalizeKnowledgeDocument(db: Db, agencyId: string, documentId: string, prepared: PreparedKnowledgeDocument): Promise<{ embeddedAll: boolean }> {
  const missing = await db
    .from("knowledge_chunks")
    .select("id", { count: "exact", head: true })
    .eq("agency_id", agencyId)
    .eq("document_id", documentId)
    .is("embedding", null);
  if (missing.error) throw new Error(`Could not count the unembedded pieces: ${missing.error.message}`);
  const embeddedAll = isEmbeddingConfigured() && (missing.count ?? 0) === 0;
  await setDocumentStatus(db, agencyId, documentId, {
    status: "READY",
    status_detail: null,
    embedding_model: embeddedAll ? knowledgeEmbeddingModel() : null,
    chunk_count: prepared.chunkCount,
    has_price_warning: prepared.hasPriceWarning,
  });
  return { embeddedAll };
}

/** Marks the document as being embedded, when embedding is configured (the one-shot job does this too). */
export async function markKnowledgeDocumentEmbedding(db: Db, agencyId: string, documentId: string): Promise<void> {
  if (isEmbeddingConfigured()) await setDocumentStatus(db, agencyId, documentId, { status: "EMBEDDING" });
}
