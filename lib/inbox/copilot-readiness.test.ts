import { describe, expect, it } from "vitest";

import { copilotReadinessFor, missingDetailsDraft, type CopilotReadinessInput } from "./copilot-readiness";

describe("missingDetailsDraft", () => {
  it("asks for each missing detail on its own line", () => {
    expect(missingDetailsDraft(["Travel period", "Room preference"])).toBe(
      "To find the best option for you, could you please share:\n- Travel period\n- Room preference",
    );
  });

  it("words the package question for a customer, not for staff", () => {
    expect(missingDetailsDraft(["Package the customer wants"])).toContain("- Which package you are interested in");
  });
});

const complete: CopilotReadinessInput = { desiredPackageName: "14-Day Standard Umrah", preferredPeriod: "Nov–Jan", adults: 2, children: 0, roomPreference: "QUAD" };

describe("copilotReadinessFor", () => {
  it("is ready when every deciding detail is known", () => {
    expect(copilotReadinessFor(complete)).toEqual({ ready: true, stillNeeded: [] });
  });

  it("lists every missing detail in the order staff should ask", () => {
    const result = copilotReadinessFor({ desiredPackageName: null, preferredPeriod: "", adults: 0, children: 0, roomPreference: "UNDECIDED" });
    expect(result.ready).toBe(false);
    expect(result.stillNeeded).toEqual(["Package the customer wants", "Travel period", "Number of travellers", "Room preference"]);
  });

  it("treats blank text as missing and children alone as enough travellers", () => {
    expect(copilotReadinessFor({ ...complete, desiredPackageName: "   " }).stillNeeded).toEqual(["Package the customer wants"]);
    expect(copilotReadinessFor({ ...complete, adults: 0, children: 1 }).ready).toBe(true);
  });
});
