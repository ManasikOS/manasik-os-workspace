import { describe, expect, it } from "vitest";

import { SIGNUP_SPIKE_MIN_LAST_HOUR, detectSignupSpike } from "./signup-spike";

describe("detectSignupSpike", () => {
  it("is quiet on a normal day", () => {
    expect(detectSignupSpike({ lastHourAttempts: 3, previous24hAttempts: 48 }).spike).toBe(false);
  });

  it("flags a burst well above the recent hourly average", () => {
    const result = detectSignupSpike({ lastHourAttempts: 60, previous24hAttempts: 48 });
    expect(result.spike).toBe(true);
    expect(result.baselinePerHour).toBe(2);
  });

  it("does not flag a small absolute number even when the baseline is zero", () => {
    expect(detectSignupSpike({ lastHourAttempts: SIGNUP_SPIKE_MIN_LAST_HOUR - 1, previous24hAttempts: 0 }).spike).toBe(false);
  });

  it("flags a first-ever burst from a standing start", () => {
    expect(detectSignupSpike({ lastHourAttempts: SIGNUP_SPIKE_MIN_LAST_HOUR + 20, previous24hAttempts: 0 }).spike).toBe(true);
  });

  it("stays quiet when a busy baseline simply continues", () => {
    expect(detectSignupSpike({ lastHourAttempts: 40, previous24hAttempts: 24 * 35 }).spike).toBe(false);
  });
});
