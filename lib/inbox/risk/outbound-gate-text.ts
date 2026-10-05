/**
 * Everything the customer will read in one outgoing message, for the protection gate. The gate looks for words a blocking review guards
 * (a payment confirmation, bank details, a refund promise); those words are as dangerous in an email subject or a file name as in the body,
 * so the gate must be shown all of them, not only the body. The text actually sent is never changed by this.
 */
export function outboundGateText(parts: { subject?: string | null; body?: string | null; filename?: string | null }): string {
  return [parts.subject, parts.body, parts.filename]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0)
    .join("\n");
}
