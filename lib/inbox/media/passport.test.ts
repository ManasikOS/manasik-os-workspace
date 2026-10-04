import { describe, expect, it } from "vitest";

import { reviewPassportCandidate, type PassportCandidate, type PassportReviewContext } from "./passport";

const NOW = new Date("2026-09-21T10:00:00.000Z");
const aisha = { id: "traveller-1", fullName: "Aisha Perera", passportNumber: "N1234567" };
const fatima = { id: "traveller-2", fullName: "Fatima Perera", passportNumber: "N7654321" };

const context = (over: Partial<PassportReviewContext> = {}): PassportReviewContext => ({
  travellers: [aisha],
  departureDate: "2026-12-01",
  passportValidityMonths: 6,
  ...over,
});

const clearCandidate = (over: Partial<PassportCandidate> = {}): PassportCandidate => ({
  passportNumber: "N1234567",
  expiryDate: "2030-01-01",
  fullName: "Aisha Perera",
  confidence: 0.99,
  ...over,
});

const review = (candidate: Partial<PassportCandidate> = {}, over: Partial<PassportReviewContext> = {}) => reviewPassportCandidate(clearCandidate(candidate), context(over), NOW);

describe("reviewPassportCandidate: how sure the reading is", () => {
  it("treats a reading at exactly 90% confidence as certain", () => {
    expect(review({ confidence: 0.9 }).uncertainFields).toEqual([]);
  });

  it("flags every field when confidence is just under 90%, even though all three were read", () => {
    expect(review({ confidence: 0.8999 }).uncertainFields).toEqual(["passportNumber", "expiryDate", "fullName"]);
  });

  it.each([
    ["passportNumber", { passportNumber: undefined }],
    ["expiryDate", { expiryDate: undefined }],
    ["fullName", { fullName: undefined }],
  ])("flags only the %s field when just that one is missing", (field, missing) => {
    expect(review(missing).uncertainFields).toEqual([field]);
  });

  it("treats an empty string as a missing field", () => {
    expect(review({ fullName: "" }).uncertainFields).toEqual(["fullName"]);
  });

  it("requires review for a missing field even when the traveller still matches", () => {
    const result = review({ expiryDate: undefined });

    expect(result.matchedTravellerId).toBe("traveller-1");
    expect(result.reviewRequired).toBe(true);
  });
});

describe("reviewPassportCandidate: matching the traveller", () => {
  it("matches by name alone, ignoring case, spacing and punctuation", () => {
    expect(review({ passportNumber: undefined, fullName: "AISHA  perera" }).matchedTravellerId).toBe("traveller-1");
    expect(review({ passportNumber: undefined, fullName: "Aisha-Perera" }).matchedTravellerId).toBe("traveller-1");
  });

  it("matches by passport number alone, ignoring case, spaces and dashes", () => {
    expect(review({ fullName: undefined, passportNumber: "n-1234 567" }).matchedTravellerId).toBe("traveller-1");
  });

  it("never matches a candidate with no passport number to a traveller with none on file", () => {
    const result = reviewPassportCandidate(clearCandidate({ passportNumber: undefined, fullName: "Someone Else" }), context({ travellers: [{ id: "traveller-3", fullName: "Noor Khan", passportNumber: null }] }), NOW);

    expect(result.matchedTravellerId).toBeNull();
  });

  it("does not report a passport-number mismatch when the traveller has no number on file", () => {
    const result = reviewPassportCandidate(clearCandidate(), context({ travellers: [{ ...aisha, passportNumber: null }] }), NOW);

    expect(result.matchedTravellerId).toBe("traveller-1");
    expect(result.fieldMismatches).toEqual([]);
  });

  it("asks staff to choose when the number matches one traveller and the name matches another, and offers only those two", () => {
    const three = [aisha, fatima, { id: "traveller-3", fullName: "Noor Khan", passportNumber: "N1111111" }];

    const result = reviewPassportCandidate(clearCandidate({ passportNumber: "N1234567", fullName: "Fatima Perera" }), context({ travellers: three }), NOW);

    expect(result.matchedTravellerId).toBeNull();
    expect(result.travellerSelectionRequired).toBe(true);
    expect(result.candidateTravellerIds).toEqual(["traveller-1", "traveller-2"]);
  });

  it("offers every traveller when none match and there is more than one", () => {
    const result = reviewPassportCandidate(clearCandidate({ passportNumber: "X999", fullName: "Unknown Person" }), context({ travellers: [aisha, fatima] }), NOW);

    expect(result.candidateTravellerIds).toEqual(["traveller-1", "traveller-2"]);
    expect(result.travellerSelectionRequired).toBe(true);
  });

  it("does not ask for a choice with a single traveller who does not match, but still requires review", () => {
    const result = reviewPassportCandidate(clearCandidate({ passportNumber: "X999", fullName: "Unknown Person" }), context({ travellers: [aisha] }), NOW);

    expect(result.matchedTravellerId).toBeNull();
    expect(result.travellerSelectionRequired).toBe(false);
    expect(result.candidateTravellerIds).toEqual(["traveller-1"]);
    expect(result.reviewRequired).toBe(true);
  });

  it("lets a staff selection override a unique match, and reports the mismatches against the selected traveller", () => {
    const result = reviewPassportCandidate(clearCandidate(), context({ travellers: [aisha, fatima], selectedTravellerId: "traveller-2" }), NOW);

    expect(result.matchedTravellerId).toBe("traveller-2");
    expect(result.fieldMismatches).toEqual(["passportNumber", "fullName"]);
    expect(result.travellerSelectionRequired).toBe(false);
  });

  it("ignores a selection that is not one of the booking's travellers and falls back to the unique match", () => {
    const result = reviewPassportCandidate(clearCandidate(), context({ selectedTravellerId: "not-on-this-booking" }), NOW);

    expect(result.matchedTravellerId).toBe("traveller-1");
  });

  it("requires review when the only problem is a name mismatch against the selected traveller", () => {
    const result = review({ fullName: "Aisha Silva" }, { selectedTravellerId: "traveller-1" });

    expect(result.fieldMismatches).toEqual(["fullName"]);
    expect(result.reviewRequired).toBe(true);
  });
});

describe("reviewPassportCandidate: expiry and validity", () => {
  it("is not expired and raises no signal for a passport valid well beyond the trip", () => {
    const result = review();

    expect(result).toMatchObject({ expired: false, insufficientValidityAtDeparture: false, signal: null, reviewRequired: false });
  });

  it("accepts an expiry exactly on the last day the destination requires", () => {
    expect(review({ expiryDate: "2027-06-01" }).insufficientValidityAtDeparture).toBe(false);
  });

  it("refuses an expiry the day before the last required day", () => {
    expect(review({ expiryDate: "2027-05-31" }).insufficientValidityAtDeparture).toBe(true);
  });

  it("uses the agency's configured number of months", () => {
    expect(review({ expiryDate: "2027-03-01" }, { passportValidityMonths: 3 }).insufficientValidityAtDeparture).toBe(false);
    expect(review({ expiryDate: "2027-03-01" }, { passportValidityMonths: 6 }).insufficientValidityAtDeparture).toBe(true);
  });

  it("requires validity only through the departure date when the configured months are zero", () => {
    expect(review({ expiryDate: "2026-12-01" }, { passportValidityMonths: 0 }).insufficientValidityAtDeparture).toBe(false);
    expect(review({ expiryDate: "2026-11-30" }, { passportValidityMonths: 0 }).insufficientValidityAtDeparture).toBe(true);
  });

  it("cannot judge validity at departure when the booking has no departure date, and does not raise a false alarm", () => {
    const result = review({ expiryDate: "2026-10-01" }, { departureDate: null });

    expect(result.insufficientValidityAtDeparture).toBe(false);
    expect(result.expired).toBe(false);
  });

  it("reads an expiry that carries a time of day", () => {
    expect(review({ expiryDate: "2020-01-01T00:00:00Z" }).expired).toBe(true);
    expect(review({ expiryDate: "2030-01-01T00:00:00Z" }).expired).toBe(false);
  });

  it("raises one PASSPORT_EXPIRY_RISK signal when the passport is both expired and too short, not two", () => {
    const result = review({ expiryDate: "2020-01-01" });

    expect(result).toMatchObject({ expired: true, insufficientValidityAtDeparture: true, signal: "PASSPORT_EXPIRY_RISK" });
  });

  it("raises the signal for short validity even when the passport is not yet expired", () => {
    const result = review({ expiryDate: "2027-01-01" });

    expect(result).toMatchObject({ expired: false, insufficientValidityAtDeparture: true, signal: "PASSPORT_EXPIRY_RISK", reviewRequired: true });
  });

  it("does not raise the expiry signal for a missing expiry date, but does require review", () => {
    const result = review({ expiryDate: undefined });

    expect(result.signal).toBeNull();
    expect(result.reviewRequired).toBe(true);
  });
});

describe("reviewPassportCandidate: an expiry date that is not a readable ISO date", () => {
  // The extraction schema accepts any non-empty string for the expiry date. One this function cannot read is never guessed at:
  // it cannot be judged expired or valid, so it is treated as an uncertain field and a person checks the passport.
  it.each([
    ["day/month/year", "31/12/2019"],
    ["words", "15 Mar 2030"],
    ["not a date at all", "not a date"],
    ["a month that does not exist", "2030-13-01"],
    ["a day that does not exist", "2030-02-30"],
    ["a two-digit year", "30-01-01"],
  ])("requires review and marks the expiry date uncertain for %s", (_label, expiryDate) => {
    const result = review({ expiryDate });

    expect(result.reviewRequired).toBe(true);
    expect(result.uncertainFields).toEqual(["expiryDate"]);
  });

  it("does not guess: an unreadable date is neither called expired nor called too short", () => {
    const result = review({ expiryDate: "31/12/2019" });

    expect(result).toMatchObject({ expired: false, insufficientValidityAtDeparture: false, signal: null });
  });

  it("still matches the traveller when only the expiry date is unreadable", () => {
    expect(review({ expiryDate: "31/12/2019" }).matchedTravellerId).toBe("traveller-1");
  });

  it("does not flag a valid ISO date, with or without a time of day", () => {
    expect(review({ expiryDate: "2030-01-01" }).uncertainFields).toEqual([]);
    expect(review({ expiryDate: "2030-01-01T00:00:00Z" }).uncertainFields).toEqual([]);
  });

  it("accepts 29 February in a leap year and refuses it in any other year", () => {
    expect(review({ expiryDate: "2032-02-29" }).uncertainFields).toEqual([]);
    expect(review({ expiryDate: "2031-02-29" }).uncertainFields).toEqual(["expiryDate"]);
  });
});
