import { describe, expect, it } from "vitest";

import { isNothingFoundSummary, summariseUnansweredQuestions, type KnowledgeLookupRow } from "./unanswered";

const NOT_FOUND = '{"found":false,"note":"No matching policy text."}';
const FOUND = '{"found":true,"note":"Policy text.","passages":[]}';

const lookup = (query: string, summary: string | null, createdAt: string): KnowledgeLookupRow => ({
  arguments: { query },
  result_summary: summary,
  created_at: createdAt,
});

describe("isNothingFoundSummary", () => {
  it("recognises only a not-found result", () => {
    expect(isNothingFoundSummary(NOT_FOUND)).toBe(true);
    expect(isNothingFoundSummary(FOUND)).toBe(false);
    expect(isNothingFoundSummary(null)).toBe(false);
  });
});

describe("summariseUnansweredQuestions", () => {
  it("counts repeated topics together, ignoring case, stop words and punctuation", () => {
    const rows = [
      lookup("Baggage allowance?", NOT_FOUND, "2026-09-10T10:00:00Z"),
      lookup("the baggage allowance", NOT_FOUND, "2026-09-12T10:00:00Z"),
      lookup("visa fees", NOT_FOUND, "2026-09-11T10:00:00Z"),
    ];
    expect(summariseUnansweredQuestions(rows)).toEqual([
      { topic: "baggage allowance", timesAsked: 2, lastAskedAt: "2026-09-12T10:00:00Z" },
      { topic: "visa fees", timesAsked: 1, lastAskedAt: "2026-09-11T10:00:00Z" },
    ]);
  });

  it("ignores lookups that found something and queries with no searchable words", () => {
    const rows = [
      lookup("refund policy", FOUND, "2026-09-10T10:00:00Z"),
      lookup("the and of", NOT_FOUND, "2026-09-10T11:00:00Z"),
      { arguments: null, result_summary: NOT_FOUND, created_at: "2026-09-10T12:00:00Z" },
    ];
    expect(summariseUnansweredQuestions(rows)).toEqual([]);
  });

  it("puts the most asked topic first and caps the list", () => {
    const rows = Array.from({ length: 30 }, (_, i) => lookup(`topic${i}`, NOT_FOUND, "2026-09-10T10:00:00Z"));
    rows.push(lookup("topic7", NOT_FOUND, "2026-09-11T10:00:00Z"));
    const result = summariseUnansweredQuestions(rows);
    expect(result).toHaveLength(20);
    expect(result[0].topic).toBe("topic7");
  });
});
