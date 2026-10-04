import { describe, expect, it } from "vitest";

import { customerMessage, facts, MESSAGE_ID } from "../fixtures";
import { detectMinorOrAssistanceNeeded } from "./minor-or-assistance-needed";

const traveller = (dateOfBirth: string | null) => ({ name: "Aisha", passportExpiry: null, dateOfBirth });

describe("MINOR_OR_ASSISTANCE_NEEDED", () => {
  it("fires for a traveller under 18 on the departure date", () => {
    const finding = detectMinorOrAssistanceNeeded(facts({ departureDate: "2026-11-12", passengers: [traveller("2010-01-05")] }));
    expect(finding).toMatchObject({ code: "MINOR_OR_ASSISTANCE_NEEDED", messageId: null });
    expect(finding?.evidence[0].snippet).toContain("Aisha is under 18");
  });

  it("near-miss: turns 18 before the departure date is an adult; the day before is still a minor", () => {
    expect(detectMinorOrAssistanceNeeded(facts({ departureDate: "2026-11-12", passengers: [traveller("2008-11-12")] }))).toBeNull();
    expect(detectMinorOrAssistanceNeeded(facts({ departureDate: "2026-11-11", passengers: [traveller("2008-11-12")] }))).not.toBeNull();
  });

  it("fires when Copilot read an accessibility need", () => {
    expect(detectMinorOrAssistanceNeeded(facts({ accessibilityNeeds: ["wheelchair"], latest: customerMessage("hello") }))).toMatchObject({ messageId: MESSAGE_ID });
  });

  it("fires on an assistance word in the customer's message", () => {
    expect(detectMinorOrAssistanceNeeded(facts({ latest: customerMessage("My mother needs a wheelchair at the airport") }))).not.toBeNull();
    expect(detectMinorOrAssistanceNeeded(facts({ latest: customerMessage("we have an elderly father") }))).not.toBeNull();
  });

  it("near-miss: 'help' alone, or an adult with a date of birth on file, does not fire", () => {
    expect(detectMinorOrAssistanceNeeded(facts({ latest: customerMessage("can you help me with the price?"), departureDate: "2026-11-12", passengers: [traveller("1985-06-01")] }))).toBeNull();
  });

  it("negative: nothing known", () => {
    expect(detectMinorOrAssistanceNeeded(facts())).toBeNull();
  });
});
