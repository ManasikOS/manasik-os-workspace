export type EmailDeliveryStatus = "SENT" | "TEMPORARY_FAILURE" | "PERMANENT_BOUNCE" | "UNKNOWN" | "AUTO_REPLY";
export function classifyEmailDeliveryStatus(input: { from: string; subject: string; body: string }): EmailDeliveryStatus {
  const text = `${input.from}\n${input.subject}\n${input.body}`.toLowerCase();
  if (/out of office|automatic reply|auto-?reply/.test(text)) return "AUTO_REPLY";
  if (!/mailer-daemon|postmaster|delivery status notification|undeliverable|failed/.test(text)) return "UNKNOWN";
  if (/\b5\d\d\b|status:\s*5\.\d\.\d|permanent failure/.test(text)) return "PERMANENT_BOUNCE";
  if (/\b4\d\d\b|status:\s*4\.\d\.\d|temporary failure|try again/.test(text)) return "TEMPORARY_FAILURE";
  return "UNKNOWN";
}
