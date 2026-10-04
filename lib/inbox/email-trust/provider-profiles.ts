import { z } from "zod";

export const EMAIL_DELIVERY_PROVIDER_IDS = [
  "HOSTINGER",
  "GOOGLE_WORKSPACE",
  "MICROSOFT_365",
  "GENERIC",
] as const;

export type EmailDeliveryProviderId = (typeof EMAIL_DELIVERY_PROVIDER_IDS)[number];

type EmailTransportSecurity = "STARTTLS" | "TLS";

interface EmailDeliveryTransportProfile {
  host: string;
  port: number;
  security: EmailTransportSecurity;
}

export interface EmailDeliveryProviderProfile {
  id: EmailDeliveryProviderId;
  label: string;
  smtp: EmailDeliveryTransportProfile;
  imap: EmailDeliveryTransportProfile;
  supportedSmtpSecurity: readonly EmailTransportSecurity[];
  supportedImapSecurity: readonly EmailTransportSecurity[];
  dkimSelectorGuidance: string | null;
}

/** Public setup defaults only. Credentials never belong in a provider profile. */
export const EMAIL_DELIVERY_PROVIDER_PROFILES: readonly EmailDeliveryProviderProfile[] = [
  {
    id: "HOSTINGER",
    label: "Hostinger",
    smtp: { host: "smtp.hostinger.com", port: 465, security: "TLS" },
    imap: { host: "imap.hostinger.com", port: 993, security: "TLS" },
    supportedSmtpSecurity: ["TLS"],
    supportedImapSecurity: ["TLS"],
    dkimSelectorGuidance: "Find the DKIM selector in Hostinger Email DNS settings before running a DNS check.",
  },
  {
    id: "GOOGLE_WORKSPACE",
    label: "Google Workspace",
    smtp: { host: "smtp.gmail.com", port: 587, security: "STARTTLS" },
    imap: { host: "imap.gmail.com", port: 993, security: "TLS" },
    supportedSmtpSecurity: ["STARTTLS"],
    supportedImapSecurity: ["TLS"],
    dkimSelectorGuidance: "Use the DKIM selector shown in the Google Admin console.",
  },
  {
    id: "MICROSOFT_365",
    label: "Microsoft 365",
    smtp: { host: "smtp.office365.com", port: 587, security: "STARTTLS" },
    imap: { host: "outlook.office365.com", port: 993, security: "TLS" },
    supportedSmtpSecurity: ["STARTTLS"],
    supportedImapSecurity: ["TLS"],
    dkimSelectorGuidance: "Use the two selector names shown in Microsoft 365 DKIM settings.",
  },
  {
    id: "GENERIC",
    label: "Generic SMTP + IMAP",
    smtp: { host: "", port: 587, security: "STARTTLS" },
    imap: { host: "", port: 993, security: "TLS" },
    supportedSmtpSecurity: ["STARTTLS", "TLS"],
    supportedImapSecurity: ["STARTTLS", "TLS"],
    dkimSelectorGuidance: "Ask your email provider for the DKIM selector, then enter it before running a DNS check.",
  },
];

const hostnameSchema = z.string().trim().min(1).max(253)
  .regex(/^[a-zA-Z0-9.-]+$/, "Enter a mail hostname without a URL or port.");

const deliveryProfileSetupBaseSchema = z.object({
  provider: z.enum(EMAIL_DELIVERY_PROVIDER_IDS),
  smtpHost: hostnameSchema,
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpSecurity: z.enum(["STARTTLS", "TLS"]),
  imapHost: hostnameSchema,
  imapPort: z.coerce.number().int().min(1).max(65535),
  imapSecurity: z.enum(["STARTTLS", "TLS"]),
  username: z.string().trim().email("Enter the mailbox email address.").max(320),
  fromEmail: z.string().trim().email("Enter a valid From email address.").max(320),
}).strict();

function emailDomain(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1).toLowerCase();
}

function matchesSupportedConnection(profile: EmailDeliveryProviderProfile, input: z.infer<typeof deliveryProfileSetupBaseSchema>): boolean {
  if (input.provider === "GENERIC") {
    const supportsSmtp = (input.smtpSecurity === "STARTTLS" && input.smtpPort === 587)
      || (input.smtpSecurity === "TLS" && input.smtpPort === 465);
    const supportsImap = (input.imapSecurity === "STARTTLS" && input.imapPort === 143)
      || (input.imapSecurity === "TLS" && input.imapPort === 993);
    return supportsSmtp && supportsImap;
  }

  return input.smtpPort === profile.smtp.port
    && input.smtpSecurity === profile.smtp.security
    && input.imapPort === profile.imap.port
    && input.imapSecurity === profile.imap.security;
}

/**
 * TG0's persistence-boundary contract. It deliberately permits a same-domain
 * alias; TG2 adds the separate time-bound verification requirement for that case.
 */
export const emailDeliveryProfileSetupSchema = deliveryProfileSetupBaseSchema.superRefine((input, context) => {
  const profile = EMAIL_DELIVERY_PROVIDER_PROFILES.find((candidate) => candidate.id === input.provider);
  if (!profile || !matchesSupportedConnection(profile, input)) {
    context.addIssue({
      code: "custom",
      path: ["smtpPort"],
      message: "This provider does not support the selected mail ports and encryption settings.",
    });
  }

  if (emailDomain(input.username) !== emailDomain(input.fromEmail)) {
    context.addIssue({
      code: "custom",
      path: ["fromEmail"],
      message: "Use a From address on the same domain as the authenticated mailbox.",
    });
  }
});

export type EmailDeliveryProfileSetupInput = z.infer<typeof emailDeliveryProfileSetupSchema>;
