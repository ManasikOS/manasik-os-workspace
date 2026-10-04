import { describe, expect, it } from "vitest";

import { adjacentConversationId, isTypingTarget } from "./keyboard-navigation";

const ids = ["a", "b", "c"];

describe("adjacentConversationId", () => {
  it("moves one step either way", () => {
    expect(adjacentConversationId(ids, "b", 1)).toBe("c");
    expect(adjacentConversationId(ids, "b", -1)).toBe("a");
  });

  it("stops at either end instead of wrapping", () => {
    expect(adjacentConversationId(ids, "c", 1)).toBeNull();
    expect(adjacentConversationId(ids, "a", -1)).toBeNull();
  });

  it("starts at the first or last when none is open, or the open one is not in the list", () => {
    expect(adjacentConversationId(ids, null, 1)).toBe("a");
    expect(adjacentConversationId(ids, null, -1)).toBe("c");
    expect(adjacentConversationId(ids, "gone", 1)).toBe("a");
  });

  it("does nothing on an empty list", () => {
    expect(adjacentConversationId([], "a", 1)).toBeNull();
  });
});

describe("isTypingTarget", () => {
  it("leaves text fields alone", () => {
    for (const tagName of ["INPUT", "textarea", "Select"]) expect(isTypingTarget({ tagName })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("allows shortcuts everywhere else", () => {
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget({ tagName: "BODY" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
