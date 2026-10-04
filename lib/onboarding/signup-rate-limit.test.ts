import { describe, expect, it } from "vitest";

import {
  SIGNUP_LIMIT_PER_EMAIL,
  SIGNUP_LIMIT_PER_IP,
  SIGNUP_LIMIT_WINDOW_MINUTES,
  evaluateSignupRateLimit,
  hashSignupIdentifier,
} from "./signup-rate-limit";

describe("evaluateSignupRateLimit", () => {
  it("allows the first three attempts for one email in the window", () => {
    for (const emailAttempts of [0, 1, 2]) {
      expect(evaluateSignupRateLimit({ emailAttempts, ipAttempts: 0 }).allowed).toBe(true);
    }
  });

  it("refuses the fourth attempt for the same email with clear copy", () => {
    const result = evaluateSignupRateLimit({ emailAttempts: SIGNUP_LIMIT_PER_EMAIL, ipAttempts: 0 });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.message).toMatch(/too many/i);
  });

  it("refuses when one network address has sent too many attempts, even for new emails", () => {
    const result = evaluateSignupRateLimit({ emailAttempts: 0, ipAttempts: SIGNUP_LIMIT_PER_IP });
    expect(result.allowed).toBe(false);
  });

  it("uses a one hour window", () => {
    expect(SIGNUP_LIMIT_WINDOW_MINUTES).toBe(60);
    expect(SIGNUP_LIMIT_PER_EMAIL).toBe(3);
  });
});

describe("hashSignupIdentifier", () => {
  it("is stable, case-insensitive and never returns the raw value", () => {
    const hashed = hashSignupIdentifier("Owner@Agency.com");
    expect(hashed).toBe(hashSignupIdentifier("owner@agency.com"));
    expect(hashed).not.toContain("agency");
    expect(hashed).toHaveLength(64);
  });
});
