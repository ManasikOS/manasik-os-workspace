import { describe, expect, it } from "vitest";

import { INTENT_CODES } from "./contracts";
import { TRIAGE_FIXTURES } from "./triage-fixtures";
import { detectLanguage, looksLikeSpam, shouldOverrideSpam, triageByRules } from "./triage-lexicon";

describe("the labelled triage set", () => {
  it("has 60 messages covering every script, and every intent it can be scored on", () => {
    expect(TRIAGE_FIXTURES).toHaveLength(60);
    expect(new Set(TRIAGE_FIXTURES.map((fixture) => fixture.language))).toEqual(new Set(["en", "si", "ta"]));
    for (const intent of INTENT_CODES) expect(TRIAGE_FIXTURES.some((fixture) => fixture.intent === intent)).toBe(true);
  });

  it("the rule reading gets intent right on at least 85 % of it", () => {
    const misses = TRIAGE_FIXTURES.flatMap((fixture) => {
      const got = triageByRules(fixture.text).intentCode;
      return got === fixture.intent ? [] : [`${fixture.text} → expected ${fixture.intent}, got ${got}`];
    });
    const accuracy = 1 - misses.length / TRIAGE_FIXTURES.length;
    // Failure output lists exactly which messages were misread.
    expect({ accuracy: accuracy >= 0.85, misses: accuracy >= 0.85 ? [] : misses }).toEqual({ accuracy: true, misses: [] });
  });

  it("detects the language of every message", () => {
    for (const fixture of TRIAGE_FIXTURES) expect(detectLanguage(fixture.text), fixture.text).toBe(fixture.language);
  });

  it("never calls a genuine enquiry SPAM — including ones that mention 'free' or carry a link", () => {
    const genuine = TRIAGE_FIXTURES.filter((fixture) => fixture.intent !== "SPAM");
    for (const fixture of genuine) expect(triageByRules(fixture.text).intentCode, fixture.text).not.toBe("SPAM");
    expect(triageByRules("Is the free breakfast included in the Umrah package? https://fb.me/abc").intentCode).not.toBe("SPAM");
    expect(triageByRules("Saw your offer on Facebook https://fb.me/abc — how much is the Hajj package?").intentCode).toBe("PRICE_REQUEST");
  });

  it("still catches obvious spam", () => {
    expect(looksLikeSpam("You've won a lottery! Click here to claim")).toBe(true);
    expect(looksLikeSpam("Earn $900 a day, guaranteed profit")).toBe(true);
    expect(looksLikeSpam("Free offer!! https://spam.example/win")).toBe(true);
  });
});

describe("spam override for a model verdict", () => {
  it("overrules SPAM on a message about the agency's business, but not on real spam", () => {
    expect(shouldOverrideSpam("Do you have Umrah packages in March?")).toBe(true);
    expect(shouldOverrideSpam("Buy followers cheap, crypto payments")).toBe(false);
    expect(shouldOverrideSpam("Guaranteed profit on Umrah forex trading")).toBe(false);
  });
});

describe("urgency and sentiment", () => {
  it("reads deadlines as HIGH and emergencies as CRITICAL", () => {
    expect(triageByRules("I need the visa urgently, we fly tomorrow").urgency).toBe("HIGH");
    expect(triageByRules("My mother is in hospital, we are stranded at the airport").urgency).toBe("CRITICAL");
    expect(triageByRules("Just asking about next year's Umrah, no hurry").urgency).toBe("LOW");
    expect(triageByRules("What packages do you have?").urgency).toBe("NORMAL");
  });

  it("reads anger, worry, thanks and distress", () => {
    expect(triageByRules("This is the worst service!!!").sentiment).toBe("ANGRY");
    expect(triageByRules("I'm worried, still waiting for my visa").sentiment).toBe("CONCERNED");
    expect(triageByRules("Jazakallah, thank you so much").sentiment).toBe("POSITIVE");
    expect(triageByRules("We are stranded and I lost my passport").sentiment).toBe("DISTRESSED");
    expect(triageByRules("Please send the brochure").sentiment).toBe("NEUTRAL");
  });

  it("is never more than modestly confident — a keyword is a hint, not a reading", () => {
    for (const fixture of TRIAGE_FIXTURES) expect(triageByRules(fixture.text).intentConfidence).toBeLessThanOrEqual(0.75);
    expect(triageByRules("ok").intentCode).toBe("OTHER");
    expect(triageByRules("ok").intentConfidence).toBeLessThan(0.5);
  });
});
