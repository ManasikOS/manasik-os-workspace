import { describe, expect, it } from "vitest";
import { classifyProposalReview, proposalSimilarity } from "./review";

describe("Copilot proposal reviews", () => {
  it("treats whitespace and case-only edits as acceptance", () => expect(classifyProposalReview("Hello there", "  hello   THERE ")).toMatchObject({ decision: "SENT", correct: true }));
  it("records a replacement as rejection evidence", () => expect(classifyProposalReview("Your payment is confirmed", "A colleague will check the proof and reply.")).toMatchObject({ decision: "REJECTED", correct: false }));
  it("returns a bounded similarity", () => expect(proposalSimilarity("abc", "xyz")).toBeGreaterThanOrEqual(0));
});
