import { describe, expect, it } from "vitest";

import { failedTurnNote, shouldHandOffAfterTurn } from "./failed-turn-handoff";
import { maxTurnsReason, parseMaxTurnsReason } from "./guardrails";

describe("shouldHandOffAfterTurn", () => {
  it("does not hand off a turn that succeeded", () => {
    expect(shouldHandOffAfterTurn({ status: "OK", reply: "Hi", buttons: [] })).toBe(false);
  });

  it.each([
    [{ status: "MODEL_ERROR", error: "timeout" }],
    [{ status: "TOOL_ERROR", error: "db down" }],
    [{ status: "REFUSAL" }],
    [{ status: "GUARDRAIL_BLOCKED", reason: "reply exceeds 1200 characters" }],
    [{ status: "GUARDRAIL_BLOCKED", reason: "reply contains a number with no tool call to back it this turn" }],
    [{ status: "GUARDRAIL_BLOCKED", reason: "max_turns_per_conversation reached" }],
  ] as const)("hands off when the assistant failed to answer: %j", (outcome) => {
    expect(shouldHandOffAfterTurn(outcome)).toBe(true);
  });

  it.each(["AI disabled for this agency", "conversation is HUMAN_ACTIVE", "conversation is CLOSED"])(
    "leaves the chat alone when the assistant was not meant to speak (%s)",
    (reason) => {
      expect(shouldHandOffAfterTurn({ status: "GUARDRAIL_BLOCKED", reason })).toBe(false);
    },
  );
});

describe("failedTurnNote", () => {
  it("says the chat was passed to staff and why, in plain words", () => {
    expect(failedTurnNote({ status: "REFUSAL" })).toContain("passed to staff");
    expect(failedTurnNote({ status: "MODEL_ERROR", error: "OPENROUTER_API_KEY is not configured" })).toContain("OPENROUTER_API_KEY");
    expect(failedTurnNote({ status: "GUARDRAIL_BLOCKED", reason: "empty reply" })).toContain("empty reply");
  });

  it("keeps a long error short", () => {
    const note = failedTurnNote({ status: "TOOL_ERROR", error: "x".repeat(1000) });
    expect(note.length).toBeLessThan(400);
  });
});

describe("max turns handoff", () => {
  it("tells staff the assistant reached its limit, in plain words", () => {
    const outcome = { status: "GUARDRAIL_BLOCKED" as const, reason: maxTurnsReason(40) };
    expect(shouldHandOffAfterTurn(outcome)).toBe(true);
    expect(failedTurnNote(outcome)).toBe("The assistant handed this chat to staff after 40 replies, which is its limit for one conversation.");
  });

  it("recognises only its own reason", () => {
    expect(parseMaxTurnsReason(maxTurnsReason(12))).toBe(12);
    expect(parseMaxTurnsReason("max_turns_per_conversation reached")).toBeNull();
    expect(parseMaxTurnsReason("reply exceeds 1200 characters")).toBeNull();
  });
});
