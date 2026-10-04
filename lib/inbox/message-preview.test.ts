import { describe, expect, it } from "vitest";

import { inboxListMessagePreview } from "./message-preview";

describe("inboxListMessagePreview", () => {
  it("keeps the latest typed message", () => {
    expect(inboxListMessagePreview({ content: "  Can you send the brochure?  ", messageType: "TEXT" })).toBe(
      "Can you send the brochure?",
    );
  });

  it.each([
    ["AUDIO", "Voice message"],
    ["DOCUMENT", "Document"],
    ["IMAGE", "Photo"],
    ["INTERACTIVE", "Interactive message"],
    ["TEMPLATE", "Template message"],
  ])("labels an empty %s message", (messageType, expectedPreview) => {
    expect(inboxListMessagePreview({ content: "", messageType })).toBe(expectedPreview);
  });

  it("keeps a visible fallback for an unrecognised empty attachment", () => {
    expect(inboxListMessagePreview({ content: null, messageType: "UNKNOWN" })).toBe("Attachment");
  });
});
