/**
 * The reply staff send when a customer shares proof of payment. It only says the proof arrived and what happens next.
 * It must never say a payment is received, confirmed or cleared: only Finance can decide that, after checking the booking.
 * It goes into the message box as editable text and is never sent by itself.
 */
export function paymentAcknowledgementDraft(): string {
  return "Thank you, we have received your payment proof. Our finance team will check it against your booking and let you know once it has been verified.";
}
