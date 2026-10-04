import type { IntentCode } from "@/lib/inbox/intelligence/contracts";
import { answerCacheEligibility } from "./eligibility";

export const ANSWER_CACHE_SIMILARITY_THRESHOLD = 0.88;
export const ANSWER_CACHE_MIN_OCCURRENCES = 3;
export const ANSWER_CACHE_EXPIRY_DAYS = 90;

export interface AnswerCacheEntry {
  agencyId: string;
  intentCode: IntentCode;
  knowledgeVersion: number;
  answerText: string;
  status: "CANDIDATE" | "APPROVED" | "RETIRED";
  occurrenceCount: number;
  rejectionCount: number;
  lastUsedAt: Date | null;
  expiresAt: Date;
  retiredReason: string | null;
}

export function canServeAnswerCache(entry: AnswerCacheEntry, input: { agencyId: string; knowledgeVersion: number; similarity: number; now: Date }): boolean {
  return entry.agencyId === input.agencyId
    && entry.status === "APPROVED"
    && entry.knowledgeVersion === input.knowledgeVersion
    && input.similarity >= ANSWER_CACHE_SIMILARITY_THRESHOLD
    && entry.expiresAt.getTime() > input.now.getTime();
}

export function recordConsistentAnswer(entry: AnswerCacheEntry | null, input: { agencyId: string; intentCode: IntentCode; question: string; answer: string; knowledgeVersion: number; now: Date }): AnswerCacheEntry | null {
  if (!answerCacheEligibility({ intentCode: input.intentCode, question: input.question, answer: input.answer }).eligible) return null;
  const occurrenceCount = (entry?.occurrenceCount ?? 0) + 1;
  return {
    agencyId: input.agencyId,
    intentCode: input.intentCode,
    knowledgeVersion: input.knowledgeVersion,
    answerText: input.answer,
    status: occurrenceCount >= ANSWER_CACHE_MIN_OCCURRENCES ? (entry?.status === "APPROVED" ? "APPROVED" : "CANDIDATE") : "CANDIDATE",
    occurrenceCount,
    rejectionCount: entry?.rejectionCount ?? 0,
    lastUsedAt: entry?.lastUsedAt ?? null,
    expiresAt: new Date(input.now.getTime() + ANSWER_CACHE_EXPIRY_DAYS * 86_400_000),
    retiredReason: entry?.retiredReason ?? null,
  };
}

export function rejectAnswerCacheEntry(entry: AnswerCacheEntry, reason: string): AnswerCacheEntry {
  const rejectionCount = entry.rejectionCount + 1;
  return { ...entry, rejectionCount, status: rejectionCount >= 2 ? "RETIRED" : entry.status, retiredReason: rejectionCount >= 2 ? reason : entry.retiredReason };
}
