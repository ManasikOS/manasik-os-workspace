import { describe, expect, it } from "vitest";

import { templateSendRoute, templateValuesComplete } from "./template-step";

describe("templateSendRoute", () => {
  it("starts a chat for a new number and for a closed conversation", () => {
    expect(templateSendRoute({ kind: "NEEDS_TEMPLATE", reason: "NEW_NUMBER", conversationId: null })).toEqual({ kind: "START_CHAT" });
    expect(templateSendRoute({ kind: "NEEDS_TEMPLATE", reason: "CONVERSATION_CLOSED", conversationId: "c-1" })).toEqual({ kind: "START_CHAT" });
  });

  it("sends into the conversation when only its reply window has closed", () => {
    expect(templateSendRoute({ kind: "NEEDS_TEMPLATE", reason: "WINDOW_CLOSED", conversationId: "c-1" })).toEqual({
      kind: "IN_CONVERSATION",
      conversationId: "c-1",
    });
  });

  it("falls back to starting a chat if a window-closed target somehow has no conversation", () => {
    expect(templateSendRoute({ kind: "NEEDS_TEMPLATE", reason: "WINDOW_CLOSED", conversationId: null })).toEqual({ kind: "START_CHAT" });
  });
});

describe("templateValuesComplete", () => {
  it("needs every variable filled with something other than blanks", () => {
    expect(templateValuesComplete(["Amina", "LKR 450,000"], 2)).toBe(true);
    expect(templateValuesComplete(["Amina", "  "], 2)).toBe(false);
    expect(templateValuesComplete(["Amina"], 2)).toBe(false);
  });

  it("is complete for a template with no variables", () => {
    expect(templateValuesComplete([], 0)).toBe(true);
  });
});
