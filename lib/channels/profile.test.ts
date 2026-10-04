import { describe, expect, it } from "vitest";

import { getChannelProfile, isAgentChannel } from "./profile";

describe("channel profiles", () => {
  it("keeps WhatsApp exactly as the guardrail previously assumed", () => {
    const profile = getChannelProfile("WHATSAPP");
    expect(profile.displayName).toBe("WhatsApp");
    expect(profile.preferredReplyChars).toBe(1200);
    expect(profile.replyWindowHours).toBe(24);
    expect(profile.requiresAutomationDisclosure).toBe(false);
    expect(profile.businessCanStartConversation).toBe(true);
  });

  it("counts Instagram's text limit in bytes, at Meta's documented 1000", () => {
    const profile = getChannelProfile("INSTAGRAM");
    expect(profile.maxTextUnit).toBe("bytes");
    expect(profile.maxTextSize).toBe(1000);
  });

  it("marks Messenger and Instagram as customer-first channels that require an automation disclosure", () => {
    for (const provider of ["MESSENGER", "INSTAGRAM"] as const) {
      const profile = getChannelProfile(provider);
      expect(profile.businessCanStartConversation).toBe(false);
      expect(profile.requiresAutomationDisclosure).toBe(true);
      expect(profile.replyWindowHours).toBe(24);
    }
  });

  it("knows which channels address a customer by phone number", () => {
    expect(getChannelProfile("WHATSAPP").identifiesByPhone).toBe(true);
    expect(getChannelProfile("MESSENGER").identifiesByPhone).toBe(false);
    expect(getChannelProfile("INSTAGRAM").identifiesByPhone).toBe(false);
  });

  it("refuses a provider the agent has no profile for, rather than guessing", () => {
    expect(() => getChannelProfile("WEB_CHAT")).toThrow("No channel profile is defined for WEB_CHAT.");
    expect(isAgentChannel("WEB_CHAT")).toBe(false);
    expect(isAgentChannel("INSTAGRAM")).toBe(true);
  });

  it("gives Email a profile for the composer/outbox to read, but keeps it out of the agent's channel list", () => {
    const profile = getChannelProfile("GMAIL");
    expect(profile.displayName).toBe("Email");
    expect(profile.businessCanStartConversation).toBe(true);
    expect(profile.identifiesByPhone).toBe(false);
    // Never autonomous: docs/inbox/email-channel-implementation-plan.md, D4.
    expect(isAgentChannel("GMAIL")).toBe(false);
  });
});
