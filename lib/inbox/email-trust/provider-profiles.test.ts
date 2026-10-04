import { describe, expect, it } from "vitest";

import {
  EMAIL_DELIVERY_PROVIDER_PROFILES,
  emailDeliveryProfileSetupSchema,
} from "./provider-profiles";

const genericSetup = {
  provider: "GENERIC" as const,
  smtpHost: "smtp.example.test",
  smtpPort: 587,
  smtpSecurity: "STARTTLS" as const,
  imapHost: "imap.example.test",
  imapPort: 993,
  imapSecurity: "TLS" as const,
  username: "support@example.test",
  fromEmail: "support@example.test",
};

describe("email delivery provider profiles", () => {
  it("defines the supported presets and their public connection defaults", () => {
    expect(EMAIL_DELIVERY_PROVIDER_PROFILES.map((profile) => profile.id)).toEqual([
      "HOSTINGER",
      "GOOGLE_WORKSPACE",
      "MICROSOFT_365",
      "GENERIC",
    ]);
    expect(EMAIL_DELIVERY_PROVIDER_PROFILES.find((profile) => profile.id === "HOSTINGER")).toMatchObject({
      smtp: { port: 465, security: "TLS" },
      imap: { port: 993, security: "TLS" },
    });
  });

  it("validates the connection defaults for every provider preset", () => {
    const setupByProvider = {
      HOSTINGER: {
        smtpHost: "smtp.hostinger.com", smtpPort: 465, smtpSecurity: "TLS",
        imapHost: "imap.hostinger.com", imapPort: 993, imapSecurity: "TLS",
      },
      GOOGLE_WORKSPACE: {
        smtpHost: "smtp.gmail.com", smtpPort: 587, smtpSecurity: "STARTTLS",
        imapHost: "imap.gmail.com", imapPort: 993, imapSecurity: "TLS",
      },
      MICROSOFT_365: {
        smtpHost: "smtp.office365.com", smtpPort: 587, smtpSecurity: "STARTTLS",
        imapHost: "outlook.office365.com", imapPort: 993, imapSecurity: "TLS",
      },
      GENERIC: genericSetup,
    } as const;

    for (const provider of EMAIL_DELIVERY_PROVIDER_PROFILES) {
      expect(emailDeliveryProfileSetupSchema.safeParse({
        ...setupByProvider[provider.id],
        provider: provider.id,
        username: "support@example.test",
        fromEmail: "support@example.test",
      }).success).toBe(true);
    }
  });

  it("accepts a generic STARTTLS setup", () => {
    expect(emailDeliveryProfileSetupSchema.safeParse(genericSetup).success).toBe(true);
  });

  it("rejects a port and encryption pairing the chosen provider does not support", () => {
    const result = emailDeliveryProfileSetupSchema.safeParse({
      ...genericSetup,
      provider: "HOSTINGER",
      smtpHost: "smtp.hostinger.com",
      smtpPort: 587,
      smtpSecurity: "STARTTLS",
      imapHost: "imap.hostinger.com",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a From address on another domain before settings can be persisted", () => {
    const result = emailDeliveryProfileSetupSchema.safeParse({
      ...genericSetup,
      fromEmail: "support@another.test",
    });

    expect(result.success).toBe(false);
  });
});
