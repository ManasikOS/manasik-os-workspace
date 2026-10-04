export interface ReceiptCandidate { amount: number | null; reference: string | null; paidAt: string | null; confidence: number }

export function receiptReview(candidate: ReceiptCandidate, attachmentId: string): { paymentStateMutation: null; intervention: { kind: "PAYMENT_CLAIM"; severity: "BLOCK"; proofAttachmentId: string; candidate: ReceiptCandidate } } {
  return { paymentStateMutation: null, intervention: { kind: "PAYMENT_CLAIM", severity: "BLOCK", proofAttachmentId: attachmentId, candidate } };
}
