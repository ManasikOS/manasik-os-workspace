import { describe, expect, it } from "vitest";

import { chunkKnowledgeText, estimateTokens } from "./chunker";
import { containsCurrencyAmount } from "./price-scan";

describe("chunkKnowledgeText", () => {
  it("returns nothing for empty or whitespace-only text", () => {
    expect(chunkKnowledgeText("")).toEqual([]);
    expect(chunkKnowledgeText("   \n\n \t \n")).toEqual([]);
  });

  it("keeps a short document as one piece", () => {
    const chunks = chunkKnowledgeText("Cancel up to 30 days before travel for a full refund.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ chunkIndex: 0, content: "Cancel up to 30 days before travel for a full refund." });
    expect(chunks[0].tokenEstimate).toBe(estimateTokens(chunks[0].content));
  });

  it("splits on paragraph boundaries and numbers pieces from zero", () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} `.padEnd(400, "x"));
    const chunks = chunkKnowledgeText(paragraphs.join("\n\n"), { targetChars: 1000, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    for (const chunk of chunks) expect(chunk.content.length).toBeLessThanOrEqual(1000);
    // No paragraph is cut in half when no paragraph is oversized.
    for (const chunk of chunks) for (const part of chunk.content.split("\n\n")) expect(part).toMatch(/^Paragraph \d /);
  });

  it("repeats the end of one piece at the start of the next", () => {
    const first = "First paragraph. ".repeat(40).trim();
    const second = "Second paragraph. ".repeat(40).trim();
    const chunks = chunkKnowledgeText(`${first}\n\n${second}`, { targetChars: 900, overlapChars: 120 });
    expect(chunks.length).toBeGreaterThan(1);
    const tail = chunks[0].content.slice(-60);
    expect(chunks[1].content.includes(tail.split(" ").slice(-3).join(" "))).toBe(true);
  });

  it("breaks a single oversized paragraph without exceeding the target", () => {
    const sentence = "Pilgrims must carry a valid passport. ";
    const chunks = chunkKnowledgeText(sentence.repeat(200), { targetChars: 1000, overlapChars: 100 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) expect(chunk.content.length).toBeLessThanOrEqual(1000);
  });

  it("hard-cuts text that has no spaces at all", () => {
    const chunks = chunkKnowledgeText("a".repeat(5000), { targetChars: 1000, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(5);
    for (const chunk of chunks) expect(chunk.content.length).toBeLessThanOrEqual(1000);
  });

  it("normalises Windows line endings", () => {
    const chunks = chunkKnowledgeText("One.\r\n\r\nTwo.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("One.\n\nTwo.");
  });
});

describe("containsCurrencyAmount", () => {
  it("flags amounts written with a currency code or symbol", () => {
    for (const text of ["Fee is LKR 15,000.", "Rs. 2500 per person", "USD 1,200.50", "Costs $450", "15,000 LKR", "2500 rupees"]) {
      expect(containsCurrencyAmount(text), text).toBe(true);
    }
  });

  it("does not flag percentages, day counts or plain numbers", () => {
    for (const text of ["Refund 25% of the fee", "Cancel 30 days before", "Room 1204", "Call 0112345678", "Pay in 3 instalments"]) {
      expect(containsCurrencyAmount(text), text).toBe(false);
    }
  });
});
