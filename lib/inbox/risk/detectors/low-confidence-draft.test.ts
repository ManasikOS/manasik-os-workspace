import { describe, expect, it } from "vitest";

import { customerMessage, facts, MESSAGE_ID } from "../fixtures";
import { detectLowConfidenceDraft } from "./low-confidence-draft";

describe("LOW_CONFIDENCE_DRAFT", () => {
  it("fires when Copilot is under 60% sure, and says how sure", () => {
    const finding = detectLowConfidenceDraft(facts({ intentConfidence: 0.42, latest: customerMessage("hmm") }));
    expect(finding).toMatchObject({ code: "LOW_CONFIDENCE_DRAFT", messageId: MESSAGE_ID });
    expect(finding?.evidence[0].snippet).toBe("Only 42% sure what the customer wants");
  });

  it("near-miss: exactly the threshold is confident enough", () => {
    expect(detectLowConfidenceDraft(facts({ intentConfidence: 0.6 }))).toBeNull();
    expect(detectLowConfidenceDraft(facts({ intentConfidence: 0.59 }))).not.toBeNull();
  });

  it("negative: a confident reading, or no reading at all (unknown is not low)", () => {
    expect(detectLowConfidenceDraft(facts({ intentConfidence: 0.95 }))).toBeNull();
    expect(detectLowConfidenceDraft(facts({ intentConfidence: null }))).toBeNull();
  });
});
