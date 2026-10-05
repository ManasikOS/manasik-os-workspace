import { describe, expect, it } from "vitest";

import { decideReleaseToAi, decideReplyOnOwnedConversation, decideTakeControl } from "./ownership-guard";

const ME = "11111111-1111-4111-8111-111111111111";
const COLLEAGUE = "22222222-2222-4222-8222-222222222222";
const chat = (state: string, owner: string | null, ownerName: string | null = owner ? "Nimal" : null) => ({ state, assigned_to_id: owner, assigned_to_name: ownerName });

describe("decideTakeControl", () => {
  it.each(["AI_ACTIVE", "AI_RESUMED", "HUMAN_REQUESTED", "HUMAN_ACTIVE"])("allows an unowned %s chat", (state) => {
    expect(decideTakeControl({ conversation: chat(state, null), currentStaffId: ME })).toEqual({ ok: true });
  });
  it("allows a chat the person already owns", () => {
    expect(decideTakeControl({ conversation: chat("HUMAN_ACTIVE", ME), currentStaffId: ME })).toEqual({ ok: true });
  });
  it("refuses a chat a colleague owns, naming them", () => {
    const decision = decideTakeControl({ conversation: chat("HUMAN_ACTIVE", COLLEAGUE), currentStaffId: ME });
    expect(decision).toMatchObject({ ok: false });
    expect(decision.ok ? "" : decision.error).toContain("Nimal");
  });
  it("refuses a colleague's chat that the assistant is handling (the owner is still on it)", () => {
    expect(decideTakeControl({ conversation: chat("AI_RESUMED", COLLEAGUE), currentStaffId: ME }).ok).toBe(false);
  });
  it("refuses a closed chat, owned or not, instead of silently reopening it", () => {
    expect(decideTakeControl({ conversation: chat("CLOSED", null), currentStaffId: ME }).ok).toBe(false);
    expect(decideTakeControl({ conversation: chat("CLOSED", COLLEAGUE), currentStaffId: ME }).ok).toBe(false);
  });
  it("treats an unknown caller as not the owner", () => {
    expect(decideTakeControl({ conversation: chat("HUMAN_ACTIVE", COLLEAGUE), currentStaffId: null }).ok).toBe(false);
  });
  it("falls back to 'a colleague' when the owner's name is missing", () => {
    const decision = decideTakeControl({ conversation: chat("HUMAN_ACTIVE", COLLEAGUE, " "), currentStaffId: ME });
    expect(decision.ok ? "" : decision.error).toContain("a colleague");
  });
});

describe("decideReplyOnOwnedConversation", () => {
  it("allows unowned and own chats, refuses a colleague's", () => {
    expect(decideReplyOnOwnedConversation({ conversation: chat("AI_ACTIVE", null), currentStaffId: ME }).ok).toBe(true);
    expect(decideReplyOnOwnedConversation({ conversation: chat("HUMAN_ACTIVE", ME), currentStaffId: ME }).ok).toBe(true);
    expect(decideReplyOnOwnedConversation({ conversation: chat("HUMAN_ACTIVE", COLLEAGUE), currentStaffId: ME }).ok).toBe(false);
  });
});

describe("decideReleaseToAi", () => {
  const base = { currentStaffId: ME, isAdministrator: false, openReviewCount: 0 };
  it("lets the owner hand a chat back", () => {
    expect(decideReleaseToAi({ ...base, conversation: chat("HUMAN_ACTIVE", ME) })).toEqual({ ok: true });
  });
  it("refuses a non-owner but lets an administrator", () => {
    expect(decideReleaseToAi({ ...base, conversation: chat("HUMAN_ACTIVE", COLLEAGUE) }).ok).toBe(false);
    expect(decideReleaseToAi({ ...base, isAdministrator: true, conversation: chat("HUMAN_ACTIVE", COLLEAGUE) }).ok).toBe(true);
  });
  it("refuses while any review is open, even for the owner or an administrator", () => {
    expect(decideReleaseToAi({ ...base, openReviewCount: 1, conversation: chat("HUMAN_ACTIVE", ME) }).ok).toBe(false);
    expect(decideReleaseToAi({ ...base, isAdministrator: true, openReviewCount: 2, conversation: chat("HUMAN_ACTIVE", COLLEAGUE) }).ok).toBe(false);
  });
});
