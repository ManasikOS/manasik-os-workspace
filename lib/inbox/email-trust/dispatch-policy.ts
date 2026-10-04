import type { EmailDispatchPolicyInput, EmailDispatchPolicyResult } from "./dispatch-policy-contract";
export function evaluateEmailDispatchPolicy(input: EmailDispatchPolicyInput): EmailDispatchPolicyResult {
  if (input.connectionState !== "READY") return { decision: "BLOCK", diagnosticCodes: ["EMAIL_CONNECTION_NOT_READY"], requiresAcknowledgement: false };
  if (input.senderState !== "VERIFIED") return { decision: "BLOCK", diagnosticCodes: ["SENDER_IDENTITY_UNVERIFIED"], requiresAcknowledgement: false };
  if (input.recipientState !== "VALID") return { decision: "BLOCK", diagnosticCodes: ["RECIPIENT_INVALID"], requiresAcknowledgement: false };
  if (input.suppressionState === "SUPPRESSED") return { decision: "BLOCK", diagnosticCodes: ["RECIPIENT_SUPPRESSED"], requiresAcknowledgement: false };
  if (input.quotaState !== "AVAILABLE") return { decision: "BLOCK", diagnosticCodes: ["EMAIL_QUOTA_TEMPORARILY_LIMITED"], requiresAcknowledgement: false };
  if (input.dnsRiskState !== "CLEAR") return { decision: "WARN", diagnosticCodes: ["DNS_AUTHENTICATION_WARNING"], requiresAcknowledgement: true };
  return { decision: "ALLOW", diagnosticCodes: [], requiresAcknowledgement: false };
}
