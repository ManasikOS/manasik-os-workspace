import { describe, expect, it } from "vitest";

import { prepareKnowledgeQuery, selectRelevantKnowledgeRows, type KnowledgeSearchRow } from "./relevance";

const row = (over: Partial<KnowledgeSearchRow>): KnowledgeSearchRow => ({
  chunk_id: "c",
  document_id: "d",
  document_title: "Policy",
  document_kind: "POLICY",
  content: "text",
  fts_rank: 0.1,
  vector_similarity: null,
  score: 0.03,
  ...over,
});

describe("prepareKnowledgeQuery", () => {
  it("drops stop words and punctuation, keeps content words", () => {
    expect(prepareKnowledgeQuery("What is your cancellation policy?")).toBe("cancellation policy");
  });

  it("returns empty when the query is only stop words", () => {
    expect(prepareKnowledgeQuery("the and of is")).toBe("");
    expect(prepareKnowledgeQuery("   ")).toBe("");
  });

  it("keeps non-English words and removes duplicates", () => {
    expect(prepareKnowledgeQuery("ඉවත්වීම cancel cancel")).toBe("ඉවත්වීම cancel");
  });
});

describe("selectRelevantKnowledgeRows", () => {
  it("returns nothing when no row has a full-text match", () => {
    expect(selectRelevantKnowledgeRows([row({ fts_rank: 0 }), row({ fts_rank: null })])).toEqual([]);
  });

  it("keeps a row that matches on meaning alone and drops a weak vector match", () => {
    const meaning = row({ chunk_id: "meaning", fts_rank: 0, vector_similarity: 0.72 });
    const weak = row({ chunk_id: "weak", fts_rank: 0, vector_similarity: 0.31 });
    expect(selectRelevantKnowledgeRows([meaning, weak]).map((r) => r.chunk_id)).toEqual(["meaning"]);
  });

  it("returns at most four rows, best score first", () => {
    const rows = Array.from({ length: 6 }, (_, i) => row({ chunk_id: `c${i}`, score: i / 100 }));
    const picked = selectRelevantKnowledgeRows(rows);
    expect(picked).toHaveLength(4);
    expect(picked[0].chunk_id).toBe("c5");
  });
});
