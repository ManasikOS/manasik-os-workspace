import "server-only";

import {
  summariseUnansweredQuestions,
  type KnowledgeLookupRow,
  type UnansweredQuestion,
} from "@/lib/agent/whatsapp/knowledge/unanswered";
import type { Db } from "@/lib/data/whatsapp-repository";

export const UNANSWERED_LOOKBACK_DAYS = 30;
const MAX_ROWS_READ = 2000;

/**
 * Topics the assistant searched the documents for and found nothing. Pass the signed-in person's own
 * client: agent_tool_calls RLS already limits it to ADMIN and CEO, so this never widens access.
 */
export async function getUnansweredKnowledgeTopics(db: Db, agencyId: string): Promise<UnansweredQuestion[]> {
  const since = new Date(Date.now() - UNANSWERED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("agent_tool_calls")
    .select("arguments, result_summary, created_at")
    .eq("agency_id", agencyId)
    .eq("tool_name", "search_knowledge_base")
    .like("result_summary", '{"found":false%')
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS_READ);
  if (error) throw new Error(`Could not read knowledge lookups: ${error.message}`);
  return summariseUnansweredQuestions((data ?? []) as KnowledgeLookupRow[]);
}
