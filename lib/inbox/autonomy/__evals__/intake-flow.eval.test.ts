import { describe, expect, it } from "vitest";
import { advanceIntakeFlow, type IntakeState } from "../intake-flow";

const initial = (): IntakeState => ({ step: "DATES", answers: {}, stalledTurns: 0 });

describe("MI6.2 bounded intake evaluation", () => {
  it("reproduces the eight-turn worked example and stops at human review", () => {
    const turns = [
      ["DATES", "December 2026"],
      ["DEPARTURE_CITY", "Colombo"],
      ["ROOM_ARRANGEMENT", "One quad room"],
      ["PASSPORT_READINESS", "All four passports are ready"],
    ] as const;
    let state = initial();
    for (const [expectedStep, answer] of turns) {
      expect(state.step).toBe(expectedStep);
      state = advanceIntakeFlow(state, answer).state;
    }
    expect(state).toMatchObject({ step: "HUMAN_REVIEW", answers: {
      DATES: "December 2026",
      DEPARTURE_CITY: "Colombo",
      ROOM_ARRANGEMENT: "One quad room",
      PASSPORT_READINESS: "All four passports are ready",
    } });
  });

  it.each([
    ["Sinhala", ["දෙසැම්බර්", "කොළඹ", "හතර දෙනාගේ කාමරයක්", "ගමන් බලපත්‍ර සූදානම්"]],
    ["Tamil", ["டிசம்பர்", "கொழும்பு", "நால்வர் அறை", "கடவுச்சீட்டுகள் தயார்"]],
  ] as const)("completes the approved questions in %s", (_language, answers) => {
    let state = initial();
    for (const answer of answers) state = advanceIntakeFlow(state, answer).state;
    expect(state.step).toBe("HUMAN_REVIEW");
  });
});
