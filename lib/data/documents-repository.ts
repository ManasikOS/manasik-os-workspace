/**
 * Supabase persistence for Documents Operations.
 *
 * `document_queue_rows` (the view) is read-only — never diffed, never
 * written. Mutations to the underlying `departure_group_pilgrim_documents`
 * status/file fields continue to run through the existing
 * `lib/data/departure-groups-documents.ts` mutators via
 * `lib/data/departure-groups.ts`'s `submitGroupPilgrimDocument` /
 * `verifyGroupPilgrimDocument` / `rejectGroupPilgrimDocument` /
 * `waiveGroupPilgrimDocument` — reusing them rather than re-implementing the
 * role gate and the derivable-document guard is what keeps there being only
 * one verify path. This repository owns only the fields those mutators don't
 * touch: `assigned_to`, `due_at`/`expires_at` edits, the AI cache columns,
 * and the two new append-only tables.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  DocumentAiAnalysisRow,
  DocumentQueueRow,
  DocumentReviewEventRow,
} from "@/lib/types/documents";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class DocumentsPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Documents: ${operation} on ${table} failed — ${detail}`);
    this.name = "DocumentsPersistenceError";
  }
}

/** Loads the full active-group document queue. Filtered client-side by the
 *  Documents list — the row count (hundreds, not tens of thousands) doesn't
 *  yet justify server-side filter params. */
export async function loadDocumentQueue(db: Db): Promise<DocumentQueueRow[]> {
  const { data, error } = await db
    .from("document_queue_rows")
    .select("*")
    .order("due_at", { ascending: true, nullsFirst: false });
  if (error) throw new DocumentsPersistenceError("document_queue_rows", "select", error);
  return (data ?? []) as DocumentQueueRow[];
}

export async function loadLatestAiAnalyses(
  db: Db,
  documentIds: string[],
): Promise<DocumentAiAnalysisRow[]> {
  if (documentIds.length === 0) return [];
  const { data, error } = await db
    .from("document_ai_analyses")
    .select("*")
    .in("document_id", documentIds)
    .order("created_at", { ascending: false });
  if (error) throw new DocumentsPersistenceError("document_ai_analyses", "select", error);
  return (data ?? []) as DocumentAiAnalysisRow[];
}

export async function loadReviewHistory(db: Db, documentId: string): Promise<DocumentReviewEventRow[]> {
  const { data, error } = await db
    .from("document_review_events")
    .select("*")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false });
  if (error) throw new DocumentsPersistenceError("document_review_events", "select", error);
  return (data ?? []) as DocumentReviewEventRow[];
}

export async function insertReviewEvent(
  db: Db,
  event: Omit<DocumentReviewEventRow, "id" | "created_at">,
): Promise<void> {
  const { error } = await db.from("document_review_events").insert(event);
  if (error) throw new DocumentsPersistenceError("document_review_events", "insert", error);
}

/** Direct, single-row updates to the fields this module owns on the document
 *  row (assignment, schedule, AI cache). No `departure-groups*.ts` mutator
 *  touches these, so a raw update carries no diff risk. */
export async function updateDocumentFields(
  db: Db,
  documentId: string,
  patch: Partial<{
    assigned_to: string | null;
    assigned_to_name: string | null;
    assigned_at: string | null;
    due_at: string | null;
    expires_at: string | null;
    last_activity_at: string;
    priority_score: number;
    ai_analysis_id: string | null;
    ai_verdict: string | null;
    ai_confidence: number | null;
  }>,
): Promise<void> {
  const { error } = await db
    .from("departure_group_pilgrim_documents")
    .update(patch)
    .eq("id", documentId);
  if (error) throw new DocumentsPersistenceError("departure_group_pilgrim_documents", "update", error);
}

export async function insertAiAnalysis(
  db: Db,
  row: Omit<DocumentAiAnalysisRow, "id" | "created_at">,
): Promise<DocumentAiAnalysisRow> {
  const { data, error } = await db
    .from("document_ai_analyses")
    .insert(row)
    .select("*")
    .single();
  if (error) throw new DocumentsPersistenceError("document_ai_analyses", "insert", error);
  return data as DocumentAiAnalysisRow;
}

export async function updateAiAnalysis(
  db: Db,
  id: string,
  patch: Partial<Omit<DocumentAiAnalysisRow, "id" | "document_id" | "created_at">>,
): Promise<void> {
  const { error } = await db.from("document_ai_analyses").update(patch).eq("id", id);
  if (error) throw new DocumentsPersistenceError("document_ai_analyses", "update", error);
}
