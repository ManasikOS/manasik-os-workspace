/**
 * Email composition depends on the inbound mailbox too: the Inbox needs IMAP
 * to receive and thread the customer's replies, not merely SMTP to send one.
 */
export function isInboxEmailMailboxReady(
  connection: { status: string; provider_metadata: unknown } | null,
): boolean {
  if (connection?.status !== "CONNECTED") return false;

  const metadata = connection.provider_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;

  const { imapHost, imapPort, imapSecurity } = metadata as Record<string, unknown>;
  return (
    typeof imapHost === "string" &&
    imapHost.trim().length > 0 &&
    typeof imapPort === "number" &&
    Number.isInteger(imapPort) &&
    imapPort >= 1 &&
    imapPort <= 65_535 &&
    (imapSecurity === "TLS" || imapSecurity === "STARTTLS")
  );
}
