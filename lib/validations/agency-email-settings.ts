import { z } from "zod";

/**
 * IMAP is optional: leaving it blank keeps SMTP sending working with no inbound polling.
 * The three fields are all-or-nothing so the Inbox never polls a half-configured mailbox
 * (docs/inbox/email-channel-implementation-plan.md, Phase 0).
 */
export const agencySmtpSettingsSchema = z.object({
  host: z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/, "Enter an SMTP hostname without a URL or port."),
  port: z.coerce.number().int().min(1).max(65535),
  security: z.enum(["STARTTLS", "TLS"]),
  username: z.string().trim().min(1).max(320),
  password: z.string().max(4096),
  fromName: z.string().trim().max(200),
  fromEmail: z.string().trim().email(),
  replyTo: z.union([z.string().trim().email(), z.literal("")]),
  imapHost: z.union([z.string().trim().max(253).regex(/^[a-zA-Z0-9.-]+$/, "Enter an IMAP hostname without a URL or port."), z.literal("")]),
  imapPort: z.union([z.coerce.number().int().min(1).max(65535), z.literal("")]),
  imapSecurity: z.union([z.enum(["STARTTLS", "TLS"]), z.literal("")]),
}).refine(data => !data.imapHost || (data.imapPort !== "" && data.imapSecurity !== ""), {
  message: "Enter the IMAP port and encryption to enable receiving mail, or clear the IMAP host to leave it disabled.",
  path: ["imapHost"],
});

export type AgencySmtpSettingsInput = z.infer<typeof agencySmtpSettingsSchema>;
