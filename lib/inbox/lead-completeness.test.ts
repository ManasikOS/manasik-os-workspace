import { describe, expect, it } from "vitest";

import { leadCompletenessFor, nextQuestionDraft, type LeadCompletenessInput } from "./lead-completeness";

const complete: LeadCompletenessInput = {
  desiredPackageName: "14-Day Standard Umrah",
  preferredPeriod: "Nov–Jan",
  mobile: "94771234567",
  email: null,
  adults: 2,
  children: 0,
  roomPreference: "QUAD",
};

describe("leadCompletenessFor", () => {
  it("counts every detail as collected and has no next question when complete", () => {
    expect(leadCompletenessFor(complete)).toMatchObject({ collectedCount: 5, totalCount: 5, next: null });
  });

  it("names what is missing and asks for the earliest missing item first", () => {
    const result = leadCompletenessFor({ ...complete, desiredPackageName: null, adults: 0, roomPreference: "UNDECIDED" });
    expect(result.collectedCount).toBe(2);
    expect(result.items.filter((item) => !item.collected).map((item) => item.key)).toEqual(["PACKAGE", "TRAVELLERS", "ROOM"]);
    expect(result.next?.key).toBe("PACKAGE");
  });

  it("treats blank text as missing, and either phone or email as contact details", () => {
    expect(leadCompletenessFor({ ...complete, preferredPeriod: "  " }).next?.key).toBe("PERIOD");
    expect(leadCompletenessFor({ ...complete, mobile: "", email: "a@b.co" }).items.find((item) => item.key === "CONTACT")?.collected).toBe(true);
    expect(leadCompletenessFor({ ...complete, mobile: "", email: null }).next?.key).toBe("CONTACT");
  });

  it("does not count a lone child as missing travellers", () => {
    expect(leadCompletenessFor({ ...complete, adults: 0, children: 1 }).items.find((item) => item.key === "TRAVELLERS")?.collected).toBe(true);
  });
});

describe("nextQuestionDraft", () => {
  it("has a customer-worded question for every item", () => {
    for (const key of ["PACKAGE", "PERIOD", "CONTACT", "TRAVELLERS", "ROOM"] as const) {
      expect(nextQuestionDraft(key)).toMatch(/\?$/);
    }
  });
});
