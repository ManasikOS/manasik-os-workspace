import { describe, expect, it } from "vitest";
import { findIntakeDenyTopic, INTAKE_DENY_TOPIC_IDS } from "./intake-deny-topics";

describe("intake deny-topic detector (FIX4)", () => {
  it.each([
    ["price — English", "What is the price of the package?", "PRICE_OR_BOOKING_REQUEST"],
    ["price — Sinhala", "පැකේජයේ මිල කීයද?", "PRICE_OR_BOOKING_REQUEST"],
    ["price — Tamil", "பேக்கேஜின் விலை என்ன?", "PRICE_OR_BOOKING_REQUEST"],
    ["price — Singlish", "package eke gaana kiyada", "PRICE_OR_BOOKING_REQUEST"],
    ["booking — English", "I want to book two seats now", "PRICE_OR_BOOKING_REQUEST"],
    ["payment — English", "I have already paid the deposit", "CONFIRM_PAYMENT"],
    ["payment — Sinhala", "මම ගෙවුවා", "CONFIRM_PAYMENT"],
    ["payment — Tamil", "நான் செலுத்தினேன்", "CONFIRM_PAYMENT"],
    ["payment — Singlish", "gewwa already the advance", "CONFIRM_PAYMENT"],
    ["refund/cancel — English", "I want to cancel and get a refund", "COMMIT_REFUND_OR_CANCELLATION"],
    ["refund/cancel — Sinhala", "මුදල් ආපසු ලබා දෙන්න", "COMMIT_REFUND_OR_CANCELLATION"],
    ["refund/cancel — Tamil", "பணம் திருப்பி தரவும்", "COMMIT_REFUND_OR_CANCELLATION"],
    ["visa — English", "Has my visa been approved?", "PROMISE_VISA_APPROVAL"],
    ["visa — Sinhala", "මගේ වීසා එකක් තියෙනවද?", "PROMISE_VISA_APPROVAL"],
    ["visa — Tamil", "எனது விசா எப்போது வரும்?", "PROMISE_VISA_APPROVAL"],
    ["medical — English", "I have a medical condition, is that okay?", "HEALTH_OR_SAFETY_ADVICE"],
    ["medical — Sinhala", "මට වෛද්‍ය ගැටලුවක් තියෙනවා", "HEALTH_OR_SAFETY_ADVICE"],
    ["medical — Tamil", "எனக்கு மருத்துவ பிரச்சனை உள்ளது", "HEALTH_OR_SAFETY_ADVICE"],
    ["religious — English", "Is it halal to do this during ihram?", "RELIGIOUS_RULING"],
    ["religious — loanword inside a Sinhala sentence", "මට fatwa එකක් ඕන", "RELIGIOUS_RULING"],
    ["religious — loanword inside a Tamil sentence", "எனக்கு fatwa தேவை", "RELIGIOUS_RULING"],
  ])("flags a first-message %s question and names the right topic", (_label, text, expectedId) => {
    expect(findIntakeDenyTopic(text)).toMatchObject({ id: expectedId });
  });

  it("is case-insensitive and normalises the text before matching", () => {
    expect(findIntakeDenyTopic("WHAT IS THE PRICE?")).toMatchObject({ id: "PRICE_OR_BOOKING_REQUEST" });
  });

  it("returns null for an ordinary, non-forbidden message", () => {
    expect(findIntakeDenyTopic("I am interested in an Umrah trip")).toBeNull();
    expect(findIntakeDenyTopic("December")).toBeNull();
    expect(findIntakeDenyTopic("Colombo")).toBeNull();
  });

  it("every topic id is stable and named in the exported list", () => {
    expect(INTAKE_DENY_TOPIC_IDS).toEqual(["PRICE_OR_BOOKING_REQUEST", "CONFIRM_PAYMENT", "COMMIT_REFUND_OR_CANCELLATION", "PROMISE_VISA_APPROVAL", "HEALTH_OR_SAFETY_ADVICE", "RELIGIOUS_RULING"]);
  });
});
