import { describe, expect, it } from "vitest";

import { AGENT_FIELD_LIMITS, cleanEmail, cleanLine, cleanText, cleanTravellerCount } from "./lead-input";

describe("cleanLine", () => {
  it("cuts to the limit and collapses whitespace", () => {
    expect(cleanLine("x".repeat(50_000), AGENT_FIELD_LIMITS.city)).toHaveLength(AGENT_FIELD_LIMITS.city);
    expect(cleanLine("  Colombo \n\t  Fort  ", 80)).toBe("Colombo Fort");
  });

  it("removes control, zero-width and bidirectional-override characters", () => {
    const sneaky = "Ay\u0000e​sha‮ gnirts⁦﻿";
    expect(cleanLine(sneaky, 120)).toBe("Ayesha gnirts");
  });

  it("turns a Unicode line separator into a space, not a line break", () => {
    expect(cleanLine("one two", 80)).toBe("one two");
  });
});

describe("cleanText", () => {
  it("keeps paragraphs but bounds them", () => {
    expect(cleanText("line one\r\n\r\n\r\n\r\nline two", 1000)).toBe("line one\n\nline two");
    expect(cleanText("y".repeat(5000), AGENT_FIELD_LIMITS.note)).toHaveLength(AGENT_FIELD_LIMITS.note);
  });

  it("strips controls from a note too", () => {
    expect(cleanText("a\u0007b‏c", 100)).toBe("abc");
  });
});

describe("cleanEmail", () => {
  it("accepts an address and rejects everything else", () => {
    expect(cleanEmail(" ayesha@example.com ")).toBe("ayesha@example.com");
    expect(cleanEmail("my email is ayesha@example.com thanks")).toBeNull();
    expect(cleanEmail("not-an-email")).toBeNull();
    expect(cleanEmail("<script>@x.io")).toBeNull();
    expect(cleanEmail(`${"a".repeat(300)}@example.com`)).toBeNull();
    expect(cleanEmail("")).toBeNull();
  });
});

describe("cleanTravellerCount", () => {
  it("accepts a plausible head-count", () => {
    expect(cleanTravellerCount(4, 1)).toBe(4);
    expect(cleanTravellerCount(0, 0)).toBe(0);
    expect(cleanTravellerCount(AGENT_FIELD_LIMITS.maxTravellers, 1)).toBe(20);
  });

  it("ignores an implausible or malformed one rather than inventing a number", () => {
    expect(cleanTravellerCount(900_000, 1)).toBeNull();
    expect(cleanTravellerCount(0, 1)).toBeNull();
    expect(cleanTravellerCount(-2, 0)).toBeNull();
    expect(cleanTravellerCount(2.5, 1)).toBeNull();
    expect(cleanTravellerCount("3", 1)).toBeNull();
    expect(cleanTravellerCount(Number.NaN, 1)).toBeNull();
  });
});
