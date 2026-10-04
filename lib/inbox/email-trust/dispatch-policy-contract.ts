import { z } from "zod";

export const EMAIL_DISPATCH_DIAGNOSTIC_CODES = [
  "EMAIL_CONNECTION_NOT_READY",
  "SENDER_IDENTITY_UNVERIFIED",
  "RECIPIENT_INVALID",
  "RECIPIENT_SUPPRESSED",
  "DNS_AUTHENTICATION_WARNING",
  "EMAIL_QUOTA_TEMPORARILY_LIMITED",
] as const;

export type EmailDispatchDiagnosticCode = (typeof EMAIL_DISPATCH_DIAGNOSTIC_CODES)[number];

/** Safe, deterministic input for TG4's central dispatch policy. */
export const emailDispatchPolicyInputSchema = z.object({
  connectionState: z.enum(["NOT_CONFIGURED", "CHECK_FAILED", "READY"]),
  senderState: z.enum(["UNVERIFIED", "VERIFIED"]),
  recipientState: z.enum(["INVALID", "VALID"]),
  suppressionState: z.enum(["NOT_SUPPRESSED", "SUPPRESSED"]),
  dnsRiskState: z.enum(["CLEAR", "WARNING", "UNKNOWN"]),
  quotaState: z.enum(["AVAILABLE", "TEMPORARILY_LIMITED"]),
}).strict();

export type EmailDispatchPolicyInput = z.infer<typeof emailDispatchPolicyInputSchema>;

/** Safe, content-free result shape returned to the composer and outbox. */
export const emailDispatchPolicyResultSchema = z.object({
  decision: z.enum(["ALLOW", "WARN", "BLOCK"]),
  diagnosticCodes: z.array(z.enum(EMAIL_DISPATCH_DIAGNOSTIC_CODES)).max(6),
  requiresAcknowledgement: z.boolean(),
}).strict();

export type EmailDispatchPolicyResult = z.infer<typeof emailDispatchPolicyResultSchema>;
