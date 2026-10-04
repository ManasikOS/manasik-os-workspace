/** A spike needs at least this many attempts in the last hour, so a quiet system never alarms on a handful. */
export const SIGNUP_SPIKE_MIN_LAST_HOUR = 15;
/** ...and at least this many times the recent hourly average. */
export const SIGNUP_SPIKE_MULTIPLIER = 3;

export interface SignupSpikeResult {
  spike: boolean;
  lastHourAttempts: number;
  baselinePerHour: number;
}

/**
 * Compares the last hour's signup requests (`signup_attempts`) with the average
 * hour over the 24 hours before it. Every request can send an email, so a burst
 * is the signature of someone using signup to email-bomb, or a bot run.
 */
export function detectSignupSpike(input: { lastHourAttempts: number; previous24hAttempts: number }): SignupSpikeResult {
  const baselinePerHour = input.previous24hAttempts / 24;
  const spike =
    input.lastHourAttempts >= SIGNUP_SPIKE_MIN_LAST_HOUR &&
    input.lastHourAttempts > SIGNUP_SPIKE_MULTIPLIER * Math.max(baselinePerHour, 1);

  return { spike, lastHourAttempts: input.lastHourAttempts, baselinePerHour };
}
