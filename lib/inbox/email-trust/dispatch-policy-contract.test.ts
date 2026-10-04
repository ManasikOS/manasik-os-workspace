import { describe, expect, it } from "vitest";

import {
  EMAIL_DISPATCH_DIAGNOSTIC_CODES,
  emailDispatchPolicyInputSchema,
  emailDispatchPolicyResultSchema,
} from "./dispatch-policy-contract";

describe("email dispatch policy contract", () => {
  it("accepts a redacted deterministic policy input and warning result", () => {
    const input = emailDispatchPolicyInputSchema.safeParse({
      connectionState: "READY",
      senderState: "VERIFIED",
      recipientState: "VALID",
      suppressionState: "NOT_SUPPRESSED",
      dnsRiskState: "WARNING",
      quotaState: "AVAILABLE",
    });
    const result = emailDispatchPolicyResultSchema.safeParse({
      decision: "WARN",
      diagnosticCodes: ["DNS_AUTHENTICATION_WARNING"],
      requiresAcknowledgement: true,
    });

    expect(input.success).toBe(true);
    expect(result.success).toBe(true);
  });

  it("keeps diagnostics stable and free of transport transcript fields", () => {
    expect(EMAIL_DISPATCH_DIAGNOSTIC_CODES).toContain("RECIPIENT_SUPPRESSED");
    expect(emailDispatchPolicyResultSchema.safeParse({
      decision: "BLOCK",
      diagnosticCodes: ["RECIPIENT_SUPPRESSED"],
      requiresAcknowledgement: false,
      smtpTranscript: "secret server response",
    }).success).toBe(false);
  });
});
