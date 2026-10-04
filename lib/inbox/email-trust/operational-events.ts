export const EMAIL_OPERATIONAL_EVENT_TYPES = ["CHECK_COMPLETED", "POLICY_BLOCKED", "POLICY_WARNING", "SMTP_FAILURE", "DNS_LOOKUP_FAILED", "PERMANENT_BOUNCE", "SUPPRESSION_CREATED", "QUOTA_EXHAUSTED"] as const;
export type EmailOperationalEventType = (typeof EMAIL_OPERATIONAL_EVENT_TYPES)[number];
export function createEmailOperationalEvent(input: { agencyId: string; type: EmailOperationalEventType; code: string }): { agencyId: string; type: EmailOperationalEventType; code: string; occurredAt: string } { return { ...input, occurredAt: new Date().toISOString() }; }
