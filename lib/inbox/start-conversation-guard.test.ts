import { describe, expect, it } from "vitest";

import { decideStartOnExistingConversation } from "./start-conversation-guard";

const base = { id: "c1", state: "HUMAN_ACTIVE", assigned_to_id: "other", assigned_to_name: "Nadeesha" };

describe("decideStartOnExistingConversation", () => {
  it("allows a brand-new contact", () => {
    expect(decideStartOnExistingConversation({ existing: null, currentStaffId: "me", contactNoun: "number" })).toEqual({ ok: true });
  });
  it("refuses an open chat a colleague owns, naming them", () => {
    const result = decideStartOnExistingConversation({ existing: base, currentStaffId: "me", contactNoun: "number" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Nadeesha");
  });
  it("allows a chat the person already owns", () => {
    expect(decideStartOnExistingConversation({ existing: { ...base, assigned_to_id: "me" }, currentStaffId: "me", contactNoun: "number" }).ok).toBe(true);
  });
  it("allows an unowned chat and an assistant-handled chat", () => {
    expect(decideStartOnExistingConversation({ existing: { ...base, assigned_to_id: null, assigned_to_name: null, state: "AI_ACTIVE" }, currentStaffId: "me", contactNoun: "email address" }).ok).toBe(true);
  });
  it("allows a closed chat even if a colleague owned it", () => {
    expect(decideStartOnExistingConversation({ existing: { ...base, state: "CLOSED" }, currentStaffId: "me", contactNoun: "number" }).ok).toBe(true);
  });
  it("falls back to 'a colleague' when the owner has no name", () => {
    const result = decideStartOnExistingConversation({ existing: { ...base, assigned_to_name: " " }, currentStaffId: "me", contactNoun: "number" });
    if (!result.ok) expect(result.error).toContain("a colleague");
  });
});
