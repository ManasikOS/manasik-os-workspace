import { describe, expect, it } from "vitest";

import { AUTONOMY_LEVELS, findNeverPromise, NEVER_AUTONOMOUS, NEVER_AUTONOMOUS_IDS, refuseNeverPromise, type NeverAutonomousId } from "./never-promise";

/** One phrase a model might really write for each entry, and one near-miss that says something harmless. */
const CASES: Record<NeverAutonomousId, { says: string[]; harmless: string[] }> = {
  CONFIRM_PAYMENT: {
    says: ["We have received your payment, thank you.", "Your payment is confirmed.", "Payment confirmed for booking BK012", "I've received the transfer."],
    harmless: ["Please send the payment slip and we will check it.", "How would you like to pay?", "A colleague will confirm once they have checked the statement."],
  },
  PROMISE_VISA_APPROVAL: {
    says: ["Your visa will be approved.", "We guarantee your visa.", "The visa is guaranteed, don't worry."],
    harmless: ["A colleague will help with your visa documents.", "Visa processing takes several days."],
  },
  GRANT_DISCOUNT: {
    says: ["We can give you a discount.", "I can offer you a special discount.", "That is 10% off for you.", "We will reduce the price for your group."],
    harmless: ["The price is as listed.", "There is an early-bird price on this departure, a colleague can explain."],
  },
  CONFIRM_UNAVAILABLE_INVENTORY: {
    says: ["Your seats are guaranteed.", "We have reserved your seats.", "Your rooms are confirmed."],
    harmless: ["Seats are limited on this departure.", "A colleague will check availability for you."],
  },
  MATERIAL_BOOKING_CHANGE: {
    says: ["We have changed your booking to December.", "Your booking has been transferred.", "I've moved your package to the later departure."],
    harmless: ["Would you like to change your booking?", "A colleague can look at your booking."],
  },
  SEND_UNAPPROVED_BANK_DETAILS: {
    says: ["Please transfer to bank account 8001 2345 6789."],
    harmless: ["Call us on 0112 345 678.", "Please ask a colleague for our bank details."],
  },
  COMMIT_REFUND_OR_CANCELLATION: {
    says: ["We will refund you in full.", "You will get a full refund.", "Your refund has been approved.", "Cancellation is free for you."],
    harmless: ["A colleague will look into your refund request.", "Please tell us what happened and we will review it."],
  },
  RELIGIOUS_RULING: {
    says: ["That is permissible.", "It is haram to do that.", "Here is the fatwa on this.", "You must pay a dam for that.", "Your umrah is invalid."],
    harmless: ["Please ask a scholar about this.", "Umrah packages include guided rituals."],
  },
  HEALTH_OR_SAFETY_ADVICE: {
    says: ["You should stop taking your medicine before the flight.", "It is safe for you to travel with your condition.", "No need to see a doctor."],
    harmless: ["Please speak to your doctor before travelling.", "We can arrange a wheelchair at the airport."],
  },
  CLOSE_COMPLAINT: {
    says: ["Your complaint is resolved.", "We consider this matter closed.", "The issue has been closed."],
    harmless: ["We are sorry to hear that and a colleague will call you.", "Thank you for telling us."],
  },
  MARKETING_BROADCAST: {
    says: ["We are sending this offer to all customers.", "This is a bulk message."],
    harmless: ["We have a December departure with seats left."],
  },
};

describe("the never-autonomous list (Architecture 10.3)", () => {
  it("has exactly the eleven entries of the architecture, in code", () => {
    expect(NEVER_AUTONOMOUS_IDS).toHaveLength(11);
    expect(NEVER_AUTONOMOUS.map((entry) => entry.id).sort()).toEqual([...NEVER_AUTONOMOUS_IDS].sort());
    expect(Object.keys(CASES).sort()).toEqual([...NEVER_AUTONOMOUS_IDS].sort());
  });

  for (const id of NEVER_AUTONOMOUS_IDS) {
    describe(id, () => {
      it("is refused at EVERY autonomy level: no level can unlock it", () => {
        for (const text of CASES[id].says) {
          for (const level of AUTONOMY_LEVELS) {
            const result = refuseNeverPromise(text, { level });
            expect(result.refused, `${level}: ${text}`).toBe(true);
            expect(result.matches.map((match) => match.id), `${level}: ${text}`).toContain(id);
          }
        }
      });

      it("leaves a harmless near-miss alone", () => {
        for (const text of CASES[id].harmless) expect(findNeverPromise(text).map((match) => match.id), text).not.toContain(id);
      });
    });
  }

  it("the answer is the same at every level (the level is never an input)", () => {
    const text = "We have received your payment and we will refund you in full.";
    const answers = AUTONOMY_LEVELS.map((level) => JSON.stringify(refuseNeverPromise(text, { level })));
    expect(new Set(answers).size).toBe(1);
  });

  it("bank details are allowed only when they are on the approved list, however they are spaced", () => {
    expect(findNeverPromise("Please transfer to account 1234 5678 9012", ["123456789012"])).toEqual([]);
    expect(findNeverPromise("bank a/c 1234-5678-9012", ["123456789012"])).toEqual([]);
    expect(findNeverPromise("Please transfer to account 1234 5678 9012", ["999999999999"]).map((match) => match.id)).toEqual(["SEND_UNAPPROVED_BANK_DETAILS"]);
    expect(findNeverPromise("Please transfer to account 1234 5678 9012").map((match) => match.id)).toEqual(["SEND_UNAPPROVED_BANK_DETAILS"]);
  });

  it("a number that is not a bank account is not bank details", () => {
    expect(findNeverPromise("Call 0771234567 tomorrow", [])).toEqual([]);
    expect(findNeverPromise("the account holder name please", [])).toEqual([]);
  });

  it("reports the words that triggered it, so a person can see why a draft was withheld", () => {
    expect(findNeverPromise("Good news: your payment is confirmed!")[0]).toMatchObject({ id: "CONFIRM_PAYMENT", span: expect.stringContaining("payment is confirmed") });
  });
});
