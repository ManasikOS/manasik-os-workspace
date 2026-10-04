import "server-only";
import { createHash } from "node:crypto";
import type { Db } from "@/lib/ai/db";
import { embedTexts, toPgVector } from "@/lib/ai/embeddings";
import type { IntentCode } from "@/lib/inbox/intelligence/contracts";
import { answerCacheEligibility } from "./eligibility";
import { ANSWER_CACHE_SIMILARITY_THRESHOLD } from "./cache";

export async function lookupApprovedInboxAnswer(db: Db, input: { agencyId: string; question: string; knowledgeVersion: number }): Promise<{ id: string; answerText: string; sourceChunkIds: string[] } | null> {
  const [embedding] = await embedTexts([input.question]);
  const { data, error } = await db.rpc("match_conversation_answer_cache", { p_agency_id: input.agencyId, p_embedding: toPgVector(embedding), p_knowledge_version: input.knowledgeVersion, p_threshold: ANSWER_CACHE_SIMILARITY_THRESHOLD });
  if (error) throw new Error(`Unable to search approved Inbox answers: ${error.message}`);
  const row = (data as Array<{ id: string; answer_text: string; source_chunk_ids: string[] }> | null)?.[0];
  if (!row) return null;
  await db.rpc("record_conversation_answer_cache_hit", { p_agency_id: input.agencyId, p_id: row.id });
  return { id: row.id, answerText: row.answer_text, sourceChunkIds: row.source_chunk_ids ?? [] };
}

/** Records a heavy staff correction of a cached answer; the second correction retires it atomically. */
export async function rejectApprovedInboxAnswer(db: Db, input: { agencyId: string; answerId: string; reason: string }): Promise<void> {
  const { error } = await db.rpc("reject_conversation_answer_cache_hit", {
    p_agency_id: input.agencyId,
    p_id: input.answerId,
    p_reason: input.reason,
  });
  if (error) throw new Error(`Unable to review the approved Inbox answer: ${error.message}`);
}

function normalizeQuestion(question: string): string {
  return question.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

/** Records only a verified, eligible answer; the database increments retries atomically. */
export async function recordInboxAnswerCandidate(db: Db, input: {
  agencyId: string;
  question: string;
  answer: string;
  intentCode: IntentCode;
  knowledgeVersion: number;
  sourceChunkIds?: string[];
}): Promise<void> {
  if (!answerCacheEligibility({ intentCode: input.intentCode, question: input.question, answer: input.answer }).eligible) return;
  const normalized = normalizeQuestion(input.question);
  const [embedding] = await embedTexts([normalized]);
  const fingerprint = createHash("sha256").update(normalized).digest("hex");
  const { error } = await db.rpc("record_conversation_answer_candidate", {
    p_agency_id: input.agencyId,
    p_question_fingerprint: fingerprint,
    p_normalized_question: normalized,
    p_question_embedding: toPgVector(embedding),
    p_answer_text: input.answer,
    p_intent_code: input.intentCode,
    p_knowledge_version: input.knowledgeVersion,
    p_source_chunk_ids: input.sourceChunkIds ?? [],
  });
  if (error) throw new Error(`Unable to record the repeated Inbox answer: ${error.message}`);
}
