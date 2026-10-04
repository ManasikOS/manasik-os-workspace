import { describe, expect, it } from "vitest";
import { answerCacheEligibility, NEVER_CACHEABLE } from "./eligibility";
import { canServeAnswerCache, recordConsistentAnswer, rejectAnswerCacheEntry, type AnswerCacheEntry } from "./cache";

const now = new Date("2026-09-21T00:00:00Z");
const entry = (over: Partial<AnswerCacheEntry> = {}): AnswerCacheEntry => ({ agencyId: "a", intentCode: "FAQ", knowledgeVersion: 2, answerText: "Breakfast is included.", status: "APPROVED", occurrenceCount: 3, rejectionCount: 0, lastUsedAt: null, expiresAt: new Date("2026-12-20T00:00:00Z"), retiredReason: null, ...over });

describe("answer cache", () => {
  it("requires tenant, version, approval, similarity and a live expiry", () => {
    expect(canServeAnswerCache(entry(), { agencyId: "a", knowledgeVersion: 2, similarity: 0.9, now })).toBe(true);
    expect(canServeAnswerCache(entry(), { agencyId: "b", knowledgeVersion: 2, similarity: 0.9, now })).toBe(false);
    expect(canServeAnswerCache(entry(), { agencyId: "a", knowledgeVersion: 3, similarity: 0.9, now })).toBe(false);
    expect(canServeAnswerCache(entry({ status: "CANDIDATE" }), { agencyId: "a", knowledgeVersion: 2, similarity: 0.9, now })).toBe(false);
    expect(canServeAnswerCache(entry(), { agencyId: "a", knowledgeVersion: 2, similarity: 0.5, now })).toBe(false);
    expect(canServeAnswerCache(entry({ expiresAt: new Date("2026-01-01") }), { agencyId: "a", knowledgeVersion: 2, similarity: 0.9, now })).toBe(false);
  });

  it("does not reach three occurrences on the first or second consistent answer", () => {
    const input = { agencyId: "a", intentCode: "FAQ" as const, question: "What is included?", answer: "Breakfast is included.", knowledgeVersion: 2, now };
    const first = recordConsistentAnswer(null, input)!;
    const second = recordConsistentAnswer(first, input)!;
    const third = recordConsistentAnswer(second, input)!;
    expect([first.occurrenceCount, second.occurrenceCount, third.occurrenceCount]).toEqual([1, 2, 3]);
  });

  it.each([
    ["PRICE_OR_AVAILABILITY", "Is a seat available?", "The price is LKR 20,000."],
    ["VISA_OUTCOME_OR_ELIGIBILITY", "Will my visa be approved?", "Yes"],
    ["PAYMENT_OR_REFUND", "Where is my refund?", "It is pending"],
    ["MEDICAL_ADVICE", "Give medical advice", "Ask a doctor"],
    ["RELIGIOUS_RULING", "Is this halal?", "This is a religious ruling"],
    ["NAMED_TRAVELLER", "What about Mr Ahmed?", "His file is ready"],
  ])("refuses the %s class even for an approver", (kind, question, answer) => {
    const result = answerCacheEligibility({ intentCode: "FAQ", question, answer });
    expect(result.blockers).toContain(kind);
    expect(result.eligible).toBe(false);
    expect(NEVER_CACHEABLE).toContain(kind);
  });

  it("retires after two rejections and records why", () => {
    const once = rejectAnswerCacheEntry(entry(), "Incorrect wording");
    const twice = rejectAnswerCacheEntry(once, "Still incorrect");
    expect(once.status).toBe("APPROVED");
    expect(twice).toMatchObject({ status: "RETIRED", retiredReason: "Still incorrect" });
  });
});
