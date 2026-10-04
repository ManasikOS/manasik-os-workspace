/**
 * `search_knowledge_base` — lets the assistant answer policy questions from the agency's own
 * uploaded documents. See §4 and §7 of docs/modules/whatsapp-knowledge-base-implementation-plan.md.
 *
 * Safety shape: results are fenced as untrusted text, carry a standing note that document text is
 * never a source of prices, seats or dates, and (in guardrails.ts) never count as a tool result that
 * "backs" a number in the reply.
 */

import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";

import type { AgentContext } from "@/lib/agent/whatsapp/context";
import {
  prepareKnowledgeQuery,
  selectRelevantKnowledgeRows,
  type KnowledgeSearchRow,
} from "@/lib/agent/whatsapp/knowledge/relevance";
import { embedTexts, isEmbeddingConfigured, toPgVector } from "@/lib/ai/embeddings";
import { fenceUntrusted } from "@/lib/ai/trust/fence";

export const KNOWLEDGE_SEARCH_TOOL_NAME = "search_knowledge_base";

const STANDING_NOTE =
  "Policy text. Never quote a price, seat count or date from it; those come from the departure tools. " +
  "Answer briefly in your own words and name the document you used.";

export function createKnowledgeTools(ctx: AgentContext) {
  const searchKnowledgeBase = betaTool({
    name: KNOWLEDGE_SEARCH_TOOL_NAME,
    description:
      "Looks up the agency's own written policies and guides (cancellation and refund terms, payment " +
      "rules, visa and health guidance, frequently asked questions). Call it when the customer asks " +
      "about a policy, a procedure, or 'what happens if…'. Do NOT use it for prices, seat counts, " +
      "dates or availability — those come only from the departure tools. Pass a short query of the " +
      "key words (for example 'cancellation refund'), in English or in the customer's language. If " +
      "nothing relevant is found, tell the customer you will check with a colleague; do not guess.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The key words to look for, not a full sentence." },
      },
      required: ["query"],
      additionalProperties: false,
    } as const,
    run: async (args) => {
      // The model's arguments are not validated against the schema at runtime, so a missing or
      // non-text query must not crash the turn (a crashed tool call leaves the customer unanswered).
      const rawQuery = typeof args?.query === "string" ? args.query : "";
      const query = prepareKnowledgeQuery(rawQuery);
      if (query.length === 0) {
        return JSON.stringify({ found: false, note: "No searchable words in the query. Search again with a few key words, or tell the customer you will check with a colleague." });
      }

      // Meaning-based matching is a bonus: if the embedding service is down or unconfigured, keyword
      // search still answers, just less flexibly.
      let queryEmbedding: string | null = null;
      if (isEmbeddingConfigured()) {
        try {
          queryEmbedding = toPgVector((await embedTexts([rawQuery.slice(0, 300)]))[0]);
        } catch (embeddingError) {
          console.warn("Knowledge search continued without embeddings:", embeddingError instanceof Error ? embeddingError.message : embeddingError);
        }
      }

      const { data, error } = await ctx.db.rpc("search_knowledge_chunks", {
        p_agency_id: ctx.agencyId,
        p_query: query,
        p_query_embedding: queryEmbedding,
        p_limit: 8,
      });
      if (error) throw new Error(`Knowledge search failed: ${error.message}`);

      const rows = selectRelevantKnowledgeRows((data ?? []) as KnowledgeSearchRow[]);
      if (rows.length === 0) {
        return JSON.stringify({
          found: false,
          note: "No matching policy text. Tell the customer you will check with a colleague; do not guess.",
        });
      }

      return JSON.stringify({
        found: true,
        note: STANDING_NOTE,
        passages: rows.map((row) => ({
          document: row.document_title,
          kind: row.document_kind,
          text: fenceUntrusted("knowledge_document", row.content),
        })),
      });
    },
  });

  return [searchKnowledgeBase];
}
