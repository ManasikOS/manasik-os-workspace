import { describe, expect, it } from "vitest";

import { paymentAcknowledgementDraft } from "./payment-acknowledgement";

describe("paymentAcknowledgementDraft", () => {
  it("says the proof arrived and that Finance will check it", () => {
    const text = paymentAcknowledgementDraft();
    expect(text).toContain("received your payment proof");
    expect(text).toContain("finance team will check it");
  });

  it("never claims the payment itself is received, confirmed or cleared", () => {
    const text = paymentAcknowledgementDraft().toLowerCase();
    expect(text).not.toMatch(/received your payment(?! proof)/);
    expect(text).not.toMatch(/payment (has been|is|was) (confirmed|received|cleared|verified)/);
    expect(text).not.toContain("confirmed your payment");
  });
});
