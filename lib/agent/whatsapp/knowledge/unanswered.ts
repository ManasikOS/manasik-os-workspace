/**
 * Turns the assistant's document lookups that found nothing into a short list staff can act on:
 * "customers keep asking about X and we have no document that covers it". Pure so it is unit tested.
 *
 * A lookup that found nothing is recorded by the tool wrapper as a result summary starting with
 * `{"found":false` — see lib/agent/whatsapp/tools/knowledge.ts. The text shown is the short keyword
 * query the assistant chose, never the customer's own message.
 */

import { prepareKnowledgeQuery } from "@/lib/agent/whatsapp/knowledge/relevance";

export interface KnowledgeLookupRow {
  arguments: unknown;
  result_summary: string | null;
  created_at: string;
}

export interface UnansweredQuestion {
  /** Cleaned key words, lower case — also the grouping key. */
  topic: string;
  timesAsked: number;
  lastAskedAt: string;
}

export const UNANSWERED_LIST_LIMIT = 20;

export function isNothingFoundSummary(summary: string | null): boolean {
  return summary !== null && summary.startsWith('{"found":false');
}

function queryFromArguments(args: unknown): string {
  if (args && typeof args === "object" && "query" in args && typeof (args as { query: unknown }).query === "string") {
    return (args as { query: string }).query;
  }
  return "";
}

export function summariseUnansweredQuestions(rows: KnowledgeLookupRow[]): UnansweredQuestion[] {
  const byTopic = new Map<string, UnansweredQuestion>();

  for (const row of rows) {
    if (!isNothingFoundSummary(row.result_summary)) continue;
    const topic = prepareKnowledgeQuery(queryFromArguments(row.arguments));
    if (topic.length === 0) continue;

    const existing = byTopic.get(topic);
    if (!existing) {
      byTopic.set(topic, { topic, timesAsked: 1, lastAskedAt: row.created_at });
    } else {
      existing.timesAsked += 1;
      if (row.created_at > existing.lastAskedAt) existing.lastAskedAt = row.created_at;
    }
  }

  return [...byTopic.values()]
    .sort((a, b) => b.timesAsked - a.timesAsked || (a.lastAskedAt < b.lastAskedAt ? 1 : -1))
    .slice(0, UNANSWERED_LIST_LIMIT);
}
