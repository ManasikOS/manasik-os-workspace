import { describe, expect, it } from "vitest";
import { agencySmtpSettingsSchema } from "./agency-email-settings";

const base = {
  host: "smtp.example.com", port: 587, security: "STARTTLS" as const,
  username: "user@example.com", password: "secret", fromName: "Agency",
  fromEmail: "agency@example.com", replyTo: "",
  imapHost: "", imapPort: "" as const, imapSecurity: "" as const,
};

describe("agencySmtpSettingsSchema", () => {
  it("accepts SMTP-only settings with every IMAP field left blank", () => {
    expect(agencySmtpSettingsSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a complete IMAP configuration alongside SMTP", () => {
    const result = agencySmtpSettingsSchema.safeParse({
      ...base, imapHost: "imap.example.com", imapPort: 993, imapSecurity: "TLS",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an IMAP host with no port or encryption, so the Inbox never polls a half-configured mailbox", () => {
    const missingPort = agencySmtpSettingsSchema.safeParse({ ...base, imapHost: "imap.example.com", imapSecurity: "TLS" });
    expect(missingPort.success).toBe(false);

    const missingSecurity = agencySmtpSettingsSchema.safeParse({ ...base, imapHost: "imap.example.com", imapPort: 993 });
    expect(missingSecurity.success).toBe(false);

    const hostOnly = agencySmtpSettingsSchema.safeParse({ ...base, imapHost: "imap.example.com" });
    expect(hostOnly.success).toBe(false);
  });

  it("rejects an IMAP hostname that carries a URL or port", () => {
    const result = agencySmtpSettingsSchema.safeParse({ ...base, imapHost: "https://imap.example.com:993", imapPort: 993, imapSecurity: "TLS" });
    expect(result.success).toBe(false);
  });
});
