import { describe, expect, it } from "vitest";

import { checkConsent, type ConsentFacts } from "./consent-gate";

const optedIn: ConsentFacts = {
  consentStatus: "OPTED_IN",
  doNotContact: false,
  contactableChannels: ["WHATSAPP", "EMAIL"],
};

describe("checkConsent", () => {
  it("allows a channel the person has consented to, with a contact value", () => {
    expect(checkConsent(optedIn, "WHATSAPP", true)).toEqual({ allowed: true });
  });

  it("refuses when do_not_contact is set, even if otherwise opted in", () => {
    const facts: ConsentFacts = { ...optedIn, doNotContact: true };
    expect(checkConsent(facts, "WHATSAPP", true)).toEqual({ allowed: false, reason: "DO_NOT_CONTACT" });
  });

  it("refuses when consent status is OPTED_OUT", () => {
    const facts: ConsentFacts = { ...optedIn, consentStatus: "OPTED_OUT" };
    expect(checkConsent(facts, "WHATSAPP", true)).toEqual({ allowed: false, reason: "OPTED_OUT" });
  });

  it("refuses a channel not in contactableChannels", () => {
    expect(checkConsent(optedIn, "SMS", true)).toEqual({ allowed: false, reason: "NO_CHANNEL_CONSENT:SMS" });
  });

  it("refuses when the channel is consented to but there is no contact value on file", () => {
    expect(checkConsent(optedIn, "WHATSAPP", false)).toEqual({ allowed: false, reason: "NO_CONTACT_VALUE" });
  });

  it("checks do_not_contact before consent status before channel before contact value, in that priority order", () => {
    const worstCase: ConsentFacts = { consentStatus: "OPTED_OUT", doNotContact: true, contactableChannels: [] };
    expect(checkConsent(worstCase, "SMS", false)).toEqual({ allowed: false, reason: "DO_NOT_CONTACT" });
  });
});
