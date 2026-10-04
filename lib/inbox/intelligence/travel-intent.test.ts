import { describe, expect, it } from "vitest";

import { TRAVEL_INTENT_FIELDS } from "./contracts";
import { locateMessage, mergeModelAnswer, runRulePass, travelModelAnswerSchema, describeTravellers, type CustomerMessage } from "./travel-intent";

const NOW = "2026-09-20T10:00:00.000Z";
const one = (text: string, id = "m1"): CustomerMessage[] => [{ id, text }];

/** The example from the product brief's section 3. */
const PDF_EXAMPLE = "4 adults from Kandy, December, school holidays, close hotel, quad";

describe("runRulePass — the brief's worked example", () => {
  it("reads travellers, window, room and origin by rule, each with its evidence and message", () => {
    const pass = runRulePass(one(PDF_EXAMPLE), NOW);
    expect(pass.readings.travellers).toMatchObject({ source: "RULES", value: "4 adults", evidence: [{ messageId: "m1", snippet: PDF_EXAMPLE }] });
    expect(pass.readings.window).toMatchObject({ source: "RULES", value: "December 2026" });
    expect(pass.readings.room).toMatchObject({ source: "RULES", value: "Quad room (4 sharing)" });
    expect(pass.readings.origin).toMatchObject({ source: "RULES", value: "Kandy", evidence: [{ messageId: "m1" }] });
    for (const field of ["travellers", "window", "room", "origin"] as const) expect(pass.readings[field]?.evidence.length, field).toBeGreaterThan(0);
  });

  it("leaves 'close hotel' (no Haram named), the journey and the budget unresolved, for the model", () => {
    expect(runRulePass(one(PDF_EXAMPLE), NOW).unresolved).toEqual(["journey", "hotelDistance", "budget"]);
  });

  it("after a model reads the rest with quotes, every field has a value and evidence", () => {
    const messages = one(PDF_EXAMPLE);
    const pass = runRulePass(messages, NOW);
    const answer = travelModelAnswerSchema.parse({ hotelDistance: { value: "VERY_CLOSE", quote: "close hotel" }, journey: null, budget: null });
    const merged = mergeModelAnswer(pass, answer, pass.unresolved, messages);
    expect(merged.readings.hotelDistance).toEqual({ source: "LLM", value: "Very close to the Haram", evidence: [{ messageId: "m1", snippet: "close hotel" }] });
    expect(merged.intent.accommodationPreferences.hotelDistancePreference).toBe("VERY_CLOSE");
    // Nothing the model was not asked to fill, and nothing it left null, appears.
    expect(Object.keys(merged.readings).sort()).toEqual(["hotelDistance", "origin", "room", "travellers", "window"]);
    expect(merged.rejected).toEqual([]);
  });

  it("keeps the source per field: rule readings stay RULES even after a model contributes", () => {
    const messages = one(PDF_EXAMPLE);
    const pass = runRulePass(messages, NOW);
    const merged = mergeModelAnswer(pass, travelModelAnswerSchema.parse({ hotelDistance: { value: "VERY_CLOSE", quote: "close hotel" } }), pass.unresolved, messages);
    expect(Object.fromEntries(Object.entries(merged.readings).map(([field, reading]) => [field, reading.source]))).toEqual({
      travellers: "RULES",
      window: "RULES",
      room: "RULES",
      origin: "RULES",
      hotelDistance: "LLM",
    });
  });
});

describe("runRulePass — when the rules read everything", () => {
  it("leaves nothing unresolved, so no model would be asked", () => {
    const pass = runRulePass(one("Umrah for 4 adults from Kandy in December, quad room, close to the Haram, budget 400000 per person"), NOW);
    expect(pass.unresolved).toEqual([]);
    expect(Object.keys(pass.readings).sort()).toEqual([...TRAVEL_INTENT_FIELDS].sort());
    expect(pass.readings.budget?.value).toBe("LKR 400,000 per person");
  });

  it("reads nothing from a message that says nothing, and asks the model about everything", () => {
    const pass = runRulePass(one("Hello, are you open?"), NOW);
    expect(pass.readings).toEqual({});
    expect(pass.unresolved).toEqual([...TRAVEL_INTENT_FIELDS]);
  });

  it("reads across several messages, and points each fact at the message it is in", () => {
    const messages: CustomerMessage[] = [
      { id: "m1", text: "Assalamu alaikum, we want to do Umrah." },
      { id: "m2", text: "There will be 3 adults and 2 children." },
      { id: "m3", text: "We would like to go in March." },
    ];
    const pass = runRulePass(messages, NOW);
    expect(pass.readings.journey?.evidence[0].messageId).toBe("m1");
    expect(pass.readings.travellers?.value).toBe("3 adults, 2 children");
    expect(pass.readings.travellers?.evidence.every((item) => item.messageId === "m2")).toBe(true);
    expect(pass.readings.window?.evidence[0].messageId).toBe("m3");
  });

  it("does not invent an origin from a city named for another reason", () => {
    expect(runRulePass(one("Is the flight to Colombo airport included?"), NOW).readings.origin).toBeUndefined();
    expect(runRulePass(one("We are from Kandy"), NOW).readings.origin?.value).toBe("Kandy");
  });
});

describe("the guard around a model answer", () => {
  const messages: CustomerMessage[] = [
    { id: "m1", text: "We are a family of 5 living in Galle." },
    { id: "m2", text: "Budget is around 4 lakh each, quad room please" },
  ];
  const merge = (answer: unknown, asked = [...TRAVEL_INTENT_FIELDS]) => {
    const pass = runRulePass([{ id: "m0", text: "hello" }], NOW);
    return mergeModelAnswer(pass, travelModelAnswerSchema.parse(answer), asked, messages);
  };

  it("drops a field whose quote is not in anything the customer wrote — a model assertion is not evidence", () => {
    const merged = merge({ budget: { value: 400000, quote: "we can spend four lakh" } });
    expect(merged.readings.budget).toBeUndefined();
    expect(merged.rejected).toEqual([{ field: "budget", reason: "the quoted words are not in the customer's messages" }]);
  });

  it("accepts a field whose quote is verbatim, ignoring case and spacing, and links the message", () => {
    const merged = merge({ budget: { value: 400000, quote: "budget is AROUND 4 lakh   each" } });
    expect(merged.readings.budget).toMatchObject({ source: "LLM", value: "LKR 400,000 per person", evidence: [{ messageId: "m2" }] });
    expect(merged.intent.commercialSignals.statedBudget).toBe(400000);
  });

  it("requires an origin the quote actually names", () => {
    expect(merge({ origin: { value: "Kandy", quote: "living in Galle" } }).rejected).toEqual([{ field: "origin", reason: "the quote does not contain the value" }]);
    expect(merge({ origin: { value: "Galle", quote: "living in Galle" } }).readings.origin?.value).toBe("Galle");
  });

  it("never overwrites a rule reading, and ignores fields it was not asked about", () => {
    const pass = runRulePass(one("2 adults, quad"), NOW);
    const answer = travelModelAnswerSchema.parse({ room: { value: "DOUBLE", quote: "2 adults, quad" }, origin: { value: "Galle", quote: "2 adults" } });
    const merged = mergeModelAnswer(pass, answer, pass.unresolved, one("2 adults, quad"));
    expect(merged.readings.room?.value).toBe("Quad room (4 sharing)");
    expect(merged.readings.room?.source).toBe("RULES");
    expect(merged.readings.origin).toBeUndefined();
  });

  it("sets travellers and a sensible group type from a family reading", () => {
    const merged = merge({ travellers: { adults: 2, children: 3, infants: 0, quote: "a family of 5" } });
    expect(merged.readings.travellers?.value).toBe("2 adults, 3 children");
    expect(merged.intent.travellers).toMatchObject({ adults: 2, children: 3, groupType: "FAMILY" });
  });

  it("does not store 'zero adults' as a reading", () => {
    expect(merge({ travellers: { adults: 0, children: 0, infants: 0, quote: "family of 5" } }).readings.travellers).toBeUndefined();
  });

  it("rejects out-of-range or out-of-list values at the schema, before the guard sees them", () => {
    expect(travelModelAnswerSchema.safeParse({ room: { value: "PENTHOUSE", quote: "x" } }).success).toBe(false);
    expect(travelModelAnswerSchema.safeParse({ budget: { value: 5, quote: "x" } }).success).toBe(false);
    expect(travelModelAnswerSchema.safeParse({ window: { value: "Smarch", quote: "x" } }).success).toBe(false);
    expect(travelModelAnswerSchema.safeParse({ travellers: { adults: 999, children: 0, infants: 0, quote: "x" } }).success).toBe(false);
    expect(travelModelAnswerSchema.safeParse({}).success).toBe(true);
  });
});

describe("helpers", () => {
  it("locateMessage prefers the latest message that says it, tolerates a truncated snippet, and returns null when it cannot place it", () => {
    const messages: CustomerMessage[] = [{ id: "a", text: "We are 4 adults" }, { id: "b", text: "Sorry, we are 4 adults and 1 child" }];
    expect(locateMessage("we are 4 adults", messages)).toBe("b");
    expect(locateMessage("Sorry, we are 4 adu…", messages)).toBe("b");
    expect(locateMessage("nothing like this", messages)).toBeNull();
    expect(locateMessage("", messages)).toBeNull();
  });

  it("describes travellers in plain words with correct plurals", () => {
    expect(describeTravellers({ adults: 1, children: 0, infants: 0 })).toBe("1 adult");
    expect(describeTravellers({ adults: 2, children: 1, infants: 1 })).toBe("2 adults, 1 child, 1 infant");
  });
});
