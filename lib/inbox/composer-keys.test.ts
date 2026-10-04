import { describe, expect, it } from "vitest";

import { canSubmitComposer, enterKeyAction } from "./composer-keys";

const press = (overrides: Partial<Parameters<typeof enterKeyAction>[0]> = {}) =>
  enterKeyAction({ key: "Enter", shiftKey: false, isComposing: false, canSubmit: true, ...overrides });

describe("enterKeyAction", () => {
  it("sends on a plain Enter", () => {
    expect(press()).toBe("SUBMIT");
  });

  it("leaves Shift+Enter to the browser so it adds a new line", () => {
    expect(press({ shiftKey: true })).toBe("LET_BROWSER_HANDLE");
  });

  it("does not send while a text-input method is composing (Enter accepts the suggestion)", () => {
    expect(press({ isComposing: true })).toBe("LET_BROWSER_HANDLE");
  });

  it("does not send when sending is not allowed, so a blocked reply box never fires a send", () => {
    expect(press({ canSubmit: false })).toBe("LET_BROWSER_HANDLE");
  });

  it("ignores every other key", () => {
    expect(press({ key: "a" })).toBe("LET_BROWSER_HANDLE");
  });
});

describe("canSubmitComposer", () => {
  it("needs some text", () => {
    expect(canSubmitComposer({ mode: "reply", enabled: true, text: "   " })).toBe(false);
    expect(canSubmitComposer({ mode: "reply", enabled: true, text: "Hi" })).toBe(true);
  });

  it("blocks a reply when replying is not allowed, but never blocks an internal note", () => {
    expect(canSubmitComposer({ mode: "reply", enabled: false, text: "Hi" })).toBe(false);
    expect(canSubmitComposer({ mode: "note", enabled: false, text: "Hi" })).toBe(true);
  });
});

describe("canSubmitComposer with a file", () => {
  it("lets a reply go with a ready file and no text (the text is the caption)", () => {
    expect(canSubmitComposer({ mode: "reply", enabled: true, text: "", hasAttachment: true })).toBe(true);
    expect(canSubmitComposer({ mode: "reply", enabled: true, text: "Here is the itinerary", hasAttachment: true })).toBe(true);
  });

  it("waits for a file that is still uploading, even with text typed", () => {
    expect(canSubmitComposer({ mode: "reply", enabled: true, text: "Hi", attachmentUploading: true })).toBe(false);
  });

  it("still blocks a reply that is not allowed, file or not", () => {
    expect(canSubmitComposer({ mode: "reply", enabled: false, text: "", hasAttachment: true })).toBe(false);
  });

  it("never treats a file as a note: a note needs text", () => {
    expect(canSubmitComposer({ mode: "note", enabled: true, text: "", hasAttachment: true })).toBe(false);
  });
});
