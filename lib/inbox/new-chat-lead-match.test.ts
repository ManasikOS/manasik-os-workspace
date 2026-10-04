import { describe, expect, it } from "vitest";

import { dialableDigits, leadMatchMessage } from "./new-chat-lead-match";

describe("dialableDigits", () => {
  it("accepts a full international number, however it is typed", () => {
    expect(dialableDigits("94771234567")).toBe("94771234567");
    expect(dialableDigits("+94 77 123 4567")).toBe("94771234567");
  });

  it("waits until it could be a full number", () => {
    expect(dialableDigits("")).toBeNull();
    expect(dialableDigits("94771")).toBeNull();
    expect(dialableDigits("9477123456789012")).toBeNull();
  });
});

describe("leadMatchMessage", () => {
  it("names the lead the chat will attach to", () => {
    expect(leadMatchMessage([{ name: "Afraz", reference: "LD-1042" }])).toEqual({ tone: "LINKED", text: "This chat will be linked to Afraz (LD-1042)." });
  });

  it("says no lead is created when none matches", () => {
    const result = leadMatchMessage([]);
    expect(result.tone).toBe("NONE");
    expect(result.text).toContain("will not create one");
  });

  it("does not pick between several matches", () => {
    const result = leadMatchMessage([{ name: "A", reference: "LD-1" }, { name: "B", reference: "LD-2" }]);
    expect(result.tone).toBe("AMBIGUOUS");
    expect(result.text).not.toContain("LD-1");
  });
});
