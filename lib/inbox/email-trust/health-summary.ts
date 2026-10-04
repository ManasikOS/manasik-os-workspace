export type EmailHealthState = "NOT_CONFIGURED" | "CONNECTION_FAILED" | "SENDER_NEEDS_VERIFICATION" | "DNS_NEEDS_ATTENTION" | "TEMPORARILY_LIMITED" | "READY_WITH_WARNINGS" | "READY";
export function deriveEmailHealthSummary(input: { configured: boolean; smtp: string; imap: string; senderVerified: boolean; dnsStates: string[]; quotaAvailable: boolean }): { state: EmailHealthState; nextAction: string } {
  if (!input.configured) return { state: "NOT_CONFIGURED", nextAction: "Save your email server settings to begin." };
  if (input.smtp !== "PASS" || input.imap !== "PASS") return { state: "CONNECTION_FAILED", nextAction: "Run email checks and correct the server settings." };
  if (!input.senderVerified) return { state: "SENDER_NEEDS_VERIFICATION", nextAction: "Verify the sender address before sending from it." };
  if (!input.quotaAvailable) return { state: "TEMPORARILY_LIMITED", nextAction: "Wait for the sending limit to reset before trying again." };
  if (input.dnsStates.some((state) => state !== "PASS")) return { state: "DNS_NEEDS_ATTENTION", nextAction: "Review SPF, DKIM, and DMARC, then recheck DNS." };
  return { state: "READY", nextAction: "Email is ready for staff-sent messages." };
}
