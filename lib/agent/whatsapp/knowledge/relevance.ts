/**
 * Query clean-up and relevance floor for knowledge search. Pure, so it is unit tested — see
 * relevance.test.ts and §7 of docs/modules/whatsapp-knowledge-base-implementation-plan.md.
 *
 * Why the query is cleaned here: Sinhala and Tamil documents are indexed with Postgres' plain
 * ('simple') configuration, which keeps stop words. A question of "what is the policy on this" would
 * otherwise match any such chunk containing "the" or "is". Dropping English stop words from the query
 * before it reaches the database means a match has to come from a content word.
 */

export const KNOWLEDGE_MAX_PASSAGES = 4;
/** Any full-text match on a content word scores above this; it only exists so the floor is tunable on real documents. */
export const KNOWLEDGE_MIN_FTS_RANK = 0.001;
/**
 * Cosine similarity a passage needs on meaning alone. A starting point for baai/bge-m3, NOT yet tuned:
 * per plan D7 it must be checked against real English, Sinhala and Tamil documents before those
 * languages are relied on.
 */
export const KNOWLEDGE_MIN_VECTOR_SIMILARITY = 0.5;
export const KNOWLEDGE_MAX_QUERY_CHARS = 300;

const ENGLISH_STOP_WORDS = new Set(
  (
    "a an and are as at be but by can could did do does for from had has have how i if in into is it its me my of on or our " +
    "please so than that the their them then there these they this to us was we were what when where which who why will with would you your " +
    "tell about know need want get give say said"
  ).split(" "),
);

/** Lower-cases, drops stop words and punctuation, and caps length. Empty result means "nothing worth searching for". */
export function prepareKnowledgeQuery(rawQuery: string): string {
  const words = rawQuery
    .slice(0, KNOWLEDGE_MAX_QUERY_CHARS)
    .toLowerCase()
    // \p{M}: Sinhala and Tamil vowel signs and viramas are combining marks, not letters.
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((word) => word.length > 1 && !ENGLISH_STOP_WORDS.has(word));
  return Array.from(new Set(words)).join(" ");
}

export interface KnowledgeSearchRow {
  chunk_id: string;
  document_id: string;
  document_title: string;
  document_kind: string;
  content: string;
  fts_rank: number | null;
  vector_similarity: number | null;
  score: number | null;
}

/** Keeps rows that clear the floor, best first, at most `KNOWLEDGE_MAX_PASSAGES`. Returns [] rather than a weak match. */
export function selectRelevantKnowledgeRows(rows: KnowledgeSearchRow[]): KnowledgeSearchRow[] {
  return rows
    // Either a content-word match or close enough in meaning.
    .filter(
      (row) =>
        (row.fts_rank ?? 0) >= KNOWLEDGE_MIN_FTS_RANK || (row.vector_similarity ?? 0) >= KNOWLEDGE_MIN_VECTOR_SIMILARITY,
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, KNOWLEDGE_MAX_PASSAGES);
}
