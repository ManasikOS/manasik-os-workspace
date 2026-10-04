import { describe, expect, it } from "vitest";

import { splitForChannel } from "./text-split";

const bytes = (value: string) => new TextEncoder().encode(value).length;
const INSTAGRAM = { unit: "bytes", size: 1000 } as const;
const MESSENGER = { unit: "chars", size: 2000 } as const;

/** Whitespace-insensitive equality: splitting may re-join with a single space/newline but must lose no words. */
const words = (parts: string[]) => parts.join(" ").split(/\s+/).filter(Boolean);

describe("splitForChannel", () => {
  it("returns a short reply untouched", () => {
    expect(splitForChannel("Salam, how can I help?", INSTAGRAM)).toEqual(["Salam, how can I help?"]);
  });

  it("returns nothing for empty or whitespace-only text", () => {
    expect(splitForChannel("", INSTAGRAM)).toEqual([]);
    expect(splitForChannel("   \n ", INSTAGRAM)).toEqual([]);
  });

  it("treats Instagram's limit as strictly under 1000 bytes", () => {
    expect(splitForChannel("a".repeat(999), INSTAGRAM)).toHaveLength(1);
    const parts = splitForChannel(`${"a".repeat(600)} ${"b".repeat(400)}`, INSTAGRAM); // 1001 bytes
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(bytes(part)).toBeLessThan(1000);
  });

  it("counts Messenger in characters, not bytes", () => {
    const sinhala = "ඔබට ස්තූතියි. ".repeat(100); // ~1400 chars, ~4000 bytes
    expect(splitForChannel(sinhala, MESSENGER)).toHaveLength(1);
    const long = "word ".repeat(600); // 3000 chars
    for (const part of splitForChannel(long, MESSENGER)) expect(part.length).toBeLessThanOrEqual(2000);
  });

  it("splits a Sinhala reply that is short in characters but over 1000 bytes, losing nothing", () => {
    const sentence = "ඔබට උමරා ගමන සඳහා අවශ්‍ය තොරතුරු මම ලබා දෙන්නම්. ";
    const text = sentence.repeat(20).trim();
    expect(text.length).toBeLessThan(1200); // the old character guardrail would have let this through
    expect(bytes(text)).toBeGreaterThan(1000); // …and Instagram would have rejected it

    const parts = splitForChannel(text, INSTAGRAM);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(bytes(part)).toBeLessThan(1000);
    expect(words(parts)).toEqual(words([text]));
  });

  it("splits Tamil and Arabic the same way", () => {
    const tamil = "உங்களுக்கு உதவ நான் தயாராக இருக்கிறேன். ".repeat(30).trim();
    const arabic = "يسعدني مساعدتك في رحلة العمرة. ".repeat(40).trim();
    for (const text of [tamil, arabic]) {
      const parts = splitForChannel(text, INSTAGRAM);
      expect(parts.length).toBeGreaterThan(1);
      for (const part of parts) expect(bytes(part)).toBeLessThan(1000);
      expect(words(parts)).toEqual(words([text]));
    }
  });

  it("prefers paragraph boundaries over cutting mid-paragraph", () => {
    const paragraph = (letter: string) => `${letter.repeat(400)}.`;
    const parts = splitForChannel([paragraph("a"), paragraph("b"), paragraph("c")].join("\n\n"), INSTAGRAM);
    expect(parts).toEqual([`${"a".repeat(400)}.\n\n${"b".repeat(400)}.`, `${"c".repeat(400)}.`]);
  });

  it("falls back to sentences, then words, when a paragraph is itself too long", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const parts = splitForChannel(text, INSTAGRAM);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(bytes(part)).toBeLessThan(1000);
      expect(part.endsWith(".")).toBe(true); // cut between sentences, not inside one
    }
    expect(words(parts)).toEqual(words([text]));
  });

  it("cuts an unbroken string only as a last resort, and never through a surrogate pair or emoji", () => {
    const text = "😀".repeat(600); // 2400 bytes, no whitespace anywhere
    const parts = splitForChannel(text, INSTAGRAM);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(bytes(part)).toBeLessThan(1000);
      expect([...part].every((character) => character === "😀")).toBe(true); // no lone surrogate halves
    }
    expect(parts.join("")).toBe(text);
  });

  it("keeps multi-codepoint characters whole: a ZWJ emoji family and a Sinhala conjunct", () => {
    const family = "👨‍👩‍👧‍👦"; // one grapheme, 25 bytes
    const conjunct = "ක්‍ෂ"; // consonant + virama + ZWJ + consonant
    for (const unit of [family, conjunct]) {
      const text = unit.repeat(200);
      const parts = splitForChannel(text, INSTAGRAM);
      expect(parts.join("")).toBe(text);
      for (const part of parts) {
        expect(bytes(part)).toBeLessThan(1000);
        expect(part.length % unit.length).toBe(0); // every part is a whole number of clusters
      }
    }
  });

  it("returns ordered parts with no empty entries", () => {
    const parts = splitForChannel(`First.\n\n\n\n${"x ".repeat(700)}\n\nLast.`, INSTAGRAM);
    expect(parts.every((part) => part.length > 0)).toBe(true);
    expect(parts[0].startsWith("First.")).toBe(true);
    expect(parts[parts.length - 1].endsWith("Last.")).toBe(true);
  });
});
