import { describe, expect, it } from "vitest";
import { advanceIntakeFlow, intakeQuestion, type IntakeState } from "./intake-flow";

const start = (): IntakeState => ({ step: "DATES", answers: {}, stalledTurns: 0 });
describe("bounded autonomous intake", () => {
  it("collects four approved facts then requires human review", () => {
    let state = start();
    for (const answer of ["December", "Colombo", "Quad", "Ready"]) state = advanceIntakeFlow(state, answer).state;
    expect(state.step).toBe("HUMAN_REVIEW");
  });
  it("hands a price question to a person instead of answering", () => expect(advanceIntakeFlow(start(), "What is the price?").handover).toBe(true));
  it("never completes a booking", () => expect(advanceIntakeFlow(start(), "Book it now")).toMatchObject({ handover: true, replyKey: null }));
  it("hands off a stalled flow with a summary", () => expect(advanceIntakeFlow({ ...start(), stalledTurns: 1 }, "").summary).toContain("stalled"));
  it("repeats the current question on the first empty answer", () => expect(advanceIntakeFlow(start(), "")).toMatchObject({ handover: false, replyKey: "ASK_DATES", state: { stalledTurns: 1 } }));
  it.each(["දෙසැම්බර්", "டிசம்பர்"])("accepts multilingual answers without changing the bounded flow: %s", (answer) => expect(advanceIntakeFlow(start(), answer).state.step).toBe("DEPARTURE_CITY"));
  it("uses the customer's script for deterministic questions", () => {
    expect(intakeQuestion("ASK_DEPARTURE_CITY", "දෙසැම්බර්")).toMatch(/[඀-෿]/u);
    expect(intakeQuestion("ASK_DEPARTURE_CITY", "டிசம்பர்")).toMatch(/[஀-௿]/u);
  });
});

describe("bounded autonomous intake — FIX4 first-turn and multilingual safety", () => {
  it.each([
    ["English", "What is the price of the December package?"],
    ["Sinhala", "පැකේජයේ මිල කීයද?"],
    ["Tamil", "பேக்கேஜின் விலை என்ன?"],
    ["Singlish", "package eke gaana kiyada"],
  ])("hands over a %s first message asking about price, without ever asking the dates question", (_language, text) => {
    const transition = advanceIntakeFlow(start(), text, { isFirstTurn: true });
    expect(transition).toMatchObject({ handover: true, replyKey: null });
  });

  it.each([
    ["payment", "I have already paid the advance"],
    ["booking", "I want to book two seats now"],
    ["refund/cancellation", "I want to cancel and get a refund"],
    ["visa", "Has my visa been approved yet?"],
    ["medical", "I have a medical condition"],
    ["religious", "Is it halal to shorten the prayer during travel?"],
  ])("hands over a first message about %s exactly like it would at any later step", (_topic, text) => {
    expect(advanceIntakeFlow(start(), text, { isFirstTurn: true })).toMatchObject({ handover: true, replyKey: null });
    // The same topic raised after DATES/DEPARTURE_CITY have already been answered still hands over — it is not a first-turn-only check.
    expect(advanceIntakeFlow({ step: "ROOM_ARRANGEMENT", answers: { DATES: "December", DEPARTURE_CITY: "Colombo" }, stalledTurns: 0 }, text)).toMatchObject({ handover: true, replyKey: null });
  });

  it("still asks DATES on a first message that names no period, instead of filing the greeting as the answer", () => {
    const transition = advanceIntakeFlow(start(), "Hi, I am interested in your Umrah packages", { isFirstTurn: true });
    expect(transition).toMatchObject({ handover: false, replyKey: "ASK_DATES" });
    expect(transition.state).toMatchObject({ step: "DATES", answers: {} });
  });

  it("skips the redundant DATES question when the first message already names a period", () => {
    const transition = advanceIntakeFlow(start(), "Hi, we are looking to travel in December", { isFirstTurn: true });
    expect(transition).toMatchObject({ handover: false, replyKey: "ASK_DEPARTURE_CITY" });
    expect(transition.state.answers.DATES).toBe("Hi, we are looking to travel in December");
  });

  it("a later turn is always taken as answering the pending question, unlike the first turn", () => {
    // Without isFirstTurn, even a message naming no obvious date still advances (this is a direct reply to "what dates suit you?").
    const transition = advanceIntakeFlow(start(), "Not sure yet, maybe soon");
    expect(transition).toMatchObject({ handover: false, replyKey: "ASK_DEPARTURE_CITY" });
  });
});
