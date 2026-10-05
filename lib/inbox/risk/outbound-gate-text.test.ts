import { describe, expect, it } from "vitest";

import { evaluateProtection } from "./protection-gate";
import { outboundGateText } from "./outbound-gate-text";

describe("outboundGateText", () => {
  it("joins subject, body and file name, skipping what is missing", () => {
    expect(outboundGateText({ subject: " Re: Umrah ", body: "Hello", filename: "itinerary.pdf" })).toBe("Re: Umrah\nHello\nitinerary.pdf");
    expect(outboundGateText({ subject: null, body: "Hello", filename: undefined })).toBe("Hello");
    expect(outboundGateText({})).toBe("");
  });

  it("lets the gate see a payment claim that appears only in the subject or the file name", () => {
    const openReviews = [{ id: "r1", kind: "PAYMENT_CLAIM", severity: "BLOCK", status: "OPEN", headline: "Customer says they paid" }] as never;
    const gate = (text: string) => evaluateProtection({ text, audience: "STAFF_SEND", openReviews, approvedAccountDigits: [] });
    expect(gate("Thank you for your message").allowed).toBe(true);
    expect(gate(outboundGateText({ subject: "Payment received - thank you", body: "Thank you for your message" })).allowed).toBe(false);
    expect(gate(outboundGateText({ body: "Please see attached", filename: "payment received.pdf" })).allowed).toBe(false);
  });
});
