export type EmailDeliveryFeedbackState = "NOT_SENT" | "SENT_TO_PROVIDER" | "WRONG_ADDRESS" | "TEMPORARILY_DELAYED" | "DELIVERY_RISK" | "DELIVERY_UNKNOWN";
export function deriveEmailDeliveryFeedback(input: { outboxStatus: "QUEUED" | "SENT" | "FAILED"; deliveryStatus: "PERMANENT_BOUNCE" | "TEMPORARY_FAILURE" | "UNKNOWN" | null; dnsRisk: boolean }): { state: EmailDeliveryFeedbackState; message: string } {
  if (input.deliveryStatus === "PERMANENT_BOUNCE") return { state: "WRONG_ADDRESS", message: "The recipient address could not receive this email. Check the address before trying again." };
  if (input.deliveryStatus === "TEMPORARY_FAILURE") return { state: "TEMPORARILY_DELAYED", message: "The recipient mail server temporarily delayed this email. It was not marked as a bad address." };
  if (input.outboxStatus === "FAILED") return { state: "NOT_SENT", message: "This email was not sent. Check the delivery error and try again." };
  if (input.outboxStatus === "QUEUED") return { state: "DELIVERY_UNKNOWN", message: "This email is waiting to be sent." };
  if (input.dnsRisk) return { state: "DELIVERY_RISK", message: "The provider accepted this email, but sender DNS needs attention. Inbox or Spam placement cannot be confirmed." };
  return { state: "SENT_TO_PROVIDER", message: "The mail provider accepted this email. Recipient Inbox or Spam placement cannot be confirmed." };
}
