import { describe, expect, it } from "vitest";

import { renderBehaviourInstructions } from "@/lib/agent/whatsapp/behaviour-prompt";
import { aiBehaviourSchema, parseAiBehaviour } from "@/lib/validations/ai-behaviour";

const defaults = aiBehaviourSchema.parse({});

describe("parseAiBehaviour", () => {
  it("gives the defaults for an empty or missing value", () => {
    expect(parseAiBehaviour({})).toEqual(defaults);
    expect(parseAiBehaviour(null)).toEqual(defaults);
  });

  it("falls back to the defaults for a stored value that no longer fits", () => {
    expect(parseAiBehaviour({ replyLength: "ENORMOUS" })).toEqual(defaults);
  });
});

describe("renderBehaviourInstructions", () => {
  it("is deterministic for the same settings", () => {
    expect(renderBehaviourInstructions(defaults)).toBe(renderBehaviourInstructions(defaults));
  });

  it("lists only the package details the agency chose, and forbids inventing others", () => {
    const text = renderBehaviourInstructions({ ...defaults, detailsToShow: ["dates", "hotels"] });
    expect(text).toContain("with: travel dates, hotels.");
    expect(text).not.toContain("with: travel dates, hotels, flights");
    expect(text).toContain("never invent it");
  });

  it("changes the package enquiry behaviour with the chosen style", () => {
    expect(renderBehaviourInstructions({ ...defaults, packageEnquiry: "ASK_FIRST" })).toContain("do NOT list packages yet");
    expect(renderBehaviourInstructions({ ...defaults, packageEnquiry: "SHORT_SUMMARY" })).toContain("short summary of each open departure");
    expect(renderBehaviourInstructions({ ...defaults, packageEnquiry: "FULL_DETAILS" })).toContain("show each open departure with");
  });

  it("orders the enquiry questions as configured", () => {
    const text = renderBehaviourInstructions({ ...defaults, questionsToAsk: ["name", "city", "travellers"], oneQuestionAtATime: true });
    expect(text).toContain("their name, then their city, then how many travellers");
    expect(text).toContain("one question per message");
  });

  it("covers reply length, emoji, format, handoff, greeting, closing and extra rules", () => {
    const text = renderBehaviourInstructions({
      ...defaults,
      replyLength: "SHORT",
      emoji: "NONE",
      format: "PLAIN",
      handoff: "WHEN_ASKED",
      greeting: "Assalamu alaikum, welcome!",
      closing: "We will call you within an hour.",
      extraRules: "Never discuss visa fees.",
    });
    expect(text).toContain("one to three short sentences");
    expect(text).toContain("Do not use emoji");
    expect(text).toContain("plain sentences");
    expect(text).toContain("only when the customer asks for a person");
    expect(text).toContain("Assalamu alaikum, welcome!");
    expect(text).toContain("We will call you within an hour.");
    expect(text).toContain("Never discuss visa fees.");
  });
});
