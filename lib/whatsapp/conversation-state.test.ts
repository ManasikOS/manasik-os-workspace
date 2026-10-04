import { describe, expect, it } from "vitest";

import { stateAfterInbound } from "@/lib/whatsapp/conversation-state";

describe("stateAfterInbound", () => {
  it.each(["AI_RESUMED", "CLOSED"] as const)("reactivates %s conversations", (state) => {
    expect(stateAfterInbound(state)).toBe("AI_ACTIVE");
  });

  it.each(["AI_ACTIVE", "HUMAN_REQUESTED", "HUMAN_ACTIVE"] as const)("preserves %s conversations", (state) => {
    expect(stateAfterInbound(state)).toBe(state);
  });
});
