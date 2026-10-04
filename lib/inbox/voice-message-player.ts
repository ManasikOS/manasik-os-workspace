/**
 * Pure helpers for the voice-message player. The bars are a stand-in for a real waveform (the channel does not give us
 * one): they are drawn from the attachment id, so the same voice note always looks the same.
 */

export const VOICE_WAVEFORM_BAR_COUNT = 32;
/** Bar heights as a share of the full height; never zero so a quiet note still reads as a bar. */
const MIN_BAR_SHARE = 0.18;

function seedFrom(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Same seed, same bars. Values are between MIN_BAR_SHARE and 1. */
export function voiceWaveformBars(seed: string, count: number = VOICE_WAVEFORM_BAR_COUNT): number[] {
  let state = seedFrom(seed) || 1;
  return Array.from({ length: count }, () => {
    // xorshift32: small, deterministic and good enough for a decorative shape.
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return MIN_BAR_SHARE + (state / 0xffffffff) * (1 - MIN_BAR_SHARE);
  });
}

/** "0:07", "1:05". Anything that is not a usable number reads as 0:00. */
export function formatVoiceClock(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export const VOICE_PLAYBACK_RATES = [1, 1.5, 2] as const;
export type VoicePlaybackRate = (typeof VOICE_PLAYBACK_RATES)[number];

export function nextVoicePlaybackRate(current: number): VoicePlaybackRate {
  const index = VOICE_PLAYBACK_RATES.findIndex((rate) => rate === current);
  return VOICE_PLAYBACK_RATES[(index + 1) % VOICE_PLAYBACK_RATES.length];
}

/**
 * Some voice notes report no length until they are played (the browser says Infinity or NaN). Those show the elapsed
 * time and an empty track instead of a wrong total.
 */
export function usableVoiceDuration(duration: number): number | null {
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

/** How far through, 0 to 1. */
export function voicePlayedShare(currentTime: number, duration: number | null): number {
  if (duration === null || duration <= 0) return 0;
  return Math.min(1, Math.max(0, currentTime / duration));
}

/** The time a click or key press at `share` (0 to 1) along the track means. */
export function voiceSeekTime(share: number, duration: number | null): number | null {
  if (duration === null) return null;
  return Math.min(duration, Math.max(0, share * duration));
}
