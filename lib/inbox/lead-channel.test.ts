import { describe, expect, it } from "vitest";

import { leadChannelDefaults, mobileForNewLead } from "./lead-channel";

describe("leadChannelDefaults", () => {
  it("labels a Messenger enquiry FACEBOOK / MESSENGER and an Instagram one INSTAGRAM / INSTAGRAM (F3, F4)", () => {
    expect(leadChannelDefaults("MESSENGER")).toEqual({ source: "FACEBOOK", preferredChannel: "MESSENGER" });
    expect(leadChannelDefaults("INSTAGRAM")).toEqual({ source: "INSTAGRAM", preferredChannel: "INSTAGRAM" });
  });

  it("keeps what WhatsApp and Gmail always got", () => {
    expect(leadChannelDefaults("WHATSAPP")).toEqual({ source: "WHATSAPP", preferredChannel: "WHATSAPP" });
    expect(leadChannelDefaults("GMAIL")).toEqual({ source: "WHATSAPP", preferredChannel: "EMAIL" });
  });

  it("defaults any other provider to WhatsApp as before", () => {
    for (const provider of ["WEB_CHAT", "SMS", "OTHER"] as const) {
      expect(leadChannelDefaults(provider)).toEqual({ source: "WHATSAPP", preferredChannel: "WHATSAPP" });
    }
  });
});

describe("mobileForNewLead", () => {
  it("keeps a real number", () => {
    expect(mobileForNewLead("771234567")).toBe("771234567");
  });

  it("is the empty string — never a channel id — when there is no number (F2)", () => {
    for (const none of [null, undefined, "", "   "]) expect(mobileForNewLead(none)).toBe("");
  });
});
