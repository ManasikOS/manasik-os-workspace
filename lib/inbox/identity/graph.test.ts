import { describe, expect, it } from "vitest";

import { bandOf, nameTokens, phoneTail, proposeCandidates, scoreCandidate, type LeadForMatching } from "./graph";

const NOW = "2026-09-20T10:00:00.000Z";

const lead = (over: Partial<LeadForMatching> & { leadId: string }): LeadForMatching => ({ fullName: "Someone Else", mobile: null, email: null, preferredPeriod: null, ...over });

describe("names", () => {
  it("compares words, not spelling accidents: case, accents, punctuation and titles are ignored", () => {
    expect(nameTokens("Mr. Fáthima  RIZVI")).toEqual(["fathima", "rizvi"]);
    expect(nameTokens("Haji Abdul-Rahman")).toEqual(["abdul", "rahman"]);
    expect(nameTokens("")).toEqual([]);
  });
});

describe("phone tail", () => {
  it("treats 0771234567 and +94 77 123 4567 as the same line without guessing a country code", () => {
    expect(phoneTail("0771234567")).toBe(phoneTail("+94771234567"));
    expect(phoneTail("12345")).toBeNull();
  });
});

describe("scoring one lead", () => {
  it("an exact phone is EXACT_IDENTITY and the only thing that may auto-confirm", () => {
    const candidate = scoreCandidate({ displayName: "x", phone: "94771234567", email: null }, lead({ leadId: "a", mobile: "94771234567" }), NOW);
    expect(candidate).toMatchObject({ band: "EXACT_IDENTITY", autoConfirm: true, score: 1 });
  });

  it("an exact email is EXACT_IDENTITY too", () => {
    const candidate = scoreCandidate({ displayName: "x", phone: null, email: "Fathima@Example.com" }, lead({ leadId: "a", email: "fathima@example.com" }), NOW);
    expect(candidate).toMatchObject({ band: "EXACT_IDENTITY", autoConfirm: true });
  });

  it("only EXACT_IDENTITY auto-confirms: every other band waits for a person", () => {
    const subject = { displayName: "Fathima Rizvi", phone: "0771234567", email: null, messageText: "we want to go in December" };
    const candidates = [
      scoreCandidate(subject, lead({ leadId: "a", fullName: "Fathima Rizvi", mobile: "94771234567", preferredPeriod: "December" }), NOW),
      scoreCandidate(subject, lead({ leadId: "b", fullName: "Fathima Rizvi" }), NOW),
      scoreCandidate(subject, lead({ leadId: "c", fullName: "Fathima Other" }), NOW),
    ];
    for (const candidate of candidates) expect(candidate.autoConfirm, candidate.leadId).toBe(false);
  });

  it("the same line with a different prefix is a strong reason, and with the same name it is HIGH", () => {
    const subject = { displayName: "Fathima Rizvi", phone: "0771234567", email: null };
    expect(scoreCandidate(subject, lead({ leadId: "a", mobile: "94771234567" }), NOW)).toMatchObject({ band: "MEDIUM", signals: ["PHONE_TAIL"] });
    expect(scoreCandidate(subject, lead({ leadId: "a", fullName: "Fathima Rizvi", mobile: "94771234567" }), NOW).band).toBe("HIGH");
  });

  it("the Instagram → WhatsApp worked example: same full name and the same travel month is a MEDIUM suggestion", () => {
    const subject = { displayName: "Fathima Rizvi", phone: "94712223333", email: null, messageText: "Assalamu alaikum, we want Umrah in December" };
    const candidate = scoreCandidate(subject, lead({ leadId: "ig", fullName: "Fathima Rizvi", mobile: "", preferredPeriod: "December school holidays" }), NOW);
    expect(candidate).toMatchObject({ band: "MEDIUM", score: 0.7 });
    expect(candidate.signals).toEqual(["NAME_EXACT", "TRAVEL_MONTH"]);
    expect(candidate.reasons).toContain("Same full name.");
  });

  it("a name alone is not evidence: a single shared first name is LOW", () => {
    expect(scoreCandidate({ displayName: "Fathima", phone: null, email: null }, lead({ leadId: "a", fullName: "Fathima" }), NOW).band).toBe("LOW");
  });

  it("a different person is LOW and scores nothing", () => {
    const candidate = scoreCandidate({ displayName: "Ahmed Nazar", phone: "0771234567", email: null }, lead({ leadId: "a", fullName: "Fathima Rizvi", mobile: "0112223333" }), NOW);
    expect(candidate).toMatchObject({ band: "LOW", score: 0, signals: [] });
  });

  it("never scores above 0.99, so nothing but an exact match reaches 1", () => {
    const subject = { displayName: "Fathima Rizvi", phone: "0771234567", email: null, messageText: "in December" };
    expect(scoreCandidate(subject, lead({ leadId: "a", fullName: "Fathima Rizvi", mobile: "94771234567", preferredPeriod: "December" }), NOW).score).toBeLessThan(1);
  });

  it("bands: HIGH from 0.75, MEDIUM from 0.5", () => {
    expect([0.99, 0.75, 0.74, 0.5, 0.49, 0].map(bandOf)).toEqual(["HIGH", "HIGH", "MEDIUM", "MEDIUM", "LOW", "LOW"]);
  });
});

describe("proposing candidates", () => {
  const subject = { displayName: "Fathima Rizvi", phone: "0771234567", email: null };
  const leads = [
    lead({ leadId: "low", fullName: "Nobody Related" }),
    lead({ leadId: "medium", mobile: "94771234567" }),
    lead({ leadId: "high", fullName: "Fathima Rizvi", mobile: "94771234567" }),
  ];

  it("returns the leads worth a person's attention, best first, and drops LOW", () => {
    expect(proposeCandidates({ subject, leads, now: NOW }).map((candidate) => candidate.leadId)).toEqual(["high", "medium"]);
  });

  it("a rejected pair is never re-proposed", () => {
    expect(proposeCandidates({ subject, leads, rejectedLeadIds: ["high"], now: NOW }).map((candidate) => candidate.leadId)).toEqual(["medium"]);
    expect(proposeCandidates({ subject, leads, rejectedLeadIds: ["high", "medium"], now: NOW })).toEqual([]);
  });

  it("ties break by lead id, so the order is stable", () => {
    const twins = [lead({ leadId: "b", mobile: "94771234567" }), lead({ leadId: "a", mobile: "94771234567" })];
    expect(proposeCandidates({ subject, leads: twins, now: NOW }).map((candidate) => candidate.leadId)).toEqual(["a", "b"]);
  });
});
