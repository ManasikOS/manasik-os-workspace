import { createHash } from "node:crypto";

/** Every signup or resend request counts as one attempt, whether or not it succeeds. */
export const SIGNUP_LIMIT_WINDOW_MINUTES = 60;
export const SIGNUP_LIMIT_PER_EMAIL = 3;
/** Higher than the per-email limit so an office sharing one connection is not locked out. */
export const SIGNUP_LIMIT_PER_IP = 10;

export type SignupRateLimitDecision = { allowed: true } | { allowed: false; message: string };

/**
 * Decides from the attempts already recorded inside the window. Pure so the
 * limits can be tested without a database.
 */
export function evaluateSignupRateLimit(counts: { emailAttempts: number; ipAttempts: number }): SignupRateLimitDecision {
  if (counts.emailAttempts >= SIGNUP_LIMIT_PER_EMAIL || counts.ipAttempts >= SIGNUP_LIMIT_PER_IP) {
    return {
      allowed: false,
      message: "Too many attempts. Please wait an hour before trying again, or check your inbox for the link we already sent.",
    };
  }
  return { allowed: true };
}

/** SHA-256 of a trimmed, lower-cased value, so the ledger never stores an email or IP in the clear. */
export function hashSignupIdentifier(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}
