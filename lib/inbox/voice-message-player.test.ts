import { describe, expect, it } from "vitest";

import {
  VOICE_WAVEFORM_BAR_COUNT,
  formatVoiceClock,
  nextVoicePlaybackRate,
  usableVoiceDuration,
  voicePlayedShare,
  voiceSeekTime,
  voiceWaveformBars,
} from "./voice-message-player";

describe("voiceWaveformBars", () => {
  it("is the same for the same voice note and differs between notes", () => {
    expect(voiceWaveformBars("a1")).toEqual(voiceWaveformBars("a1"));
    expect(voiceWaveformBars("a1")).not.toEqual(voiceWaveformBars("b2"));
  });

  it("returns the requested number of bars, all visible and none taller than the track", () => {
    const bars = voiceWaveformBars("a1");
    expect(bars).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
    for (const bar of bars) {
      expect(bar).toBeGreaterThanOrEqual(0.18);
      expect(bar).toBeLessThanOrEqual(1);
    }
    expect(voiceWaveformBars("", 5)).toHaveLength(5);
  });
});

describe("formatVoiceClock", () => {
  it("formats minutes and padded seconds", () => {
    expect(formatVoiceClock(7.9)).toBe("0:07");
    expect(formatVoiceClock(65)).toBe("1:05");
    expect(formatVoiceClock(600)).toBe("10:00");
  });

  it("reads anything unusable as 0:00", () => {
    expect(formatVoiceClock(Number.NaN)).toBe("0:00");
    expect(formatVoiceClock(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(formatVoiceClock(-3)).toBe("0:00");
  });
});

describe("playback rate and progress", () => {
  it("cycles 1x, 1.5x, 2x and back", () => {
    expect(nextVoicePlaybackRate(1)).toBe(1.5);
    expect(nextVoicePlaybackRate(1.5)).toBe(2);
    expect(nextVoicePlaybackRate(2)).toBe(1);
    expect(nextVoicePlaybackRate(0.75)).toBe(1);
  });

  it("treats an unknown length as unknown and never divides by it", () => {
    expect(usableVoiceDuration(Number.POSITIVE_INFINITY)).toBeNull();
    expect(usableVoiceDuration(Number.NaN)).toBeNull();
    expect(usableVoiceDuration(0)).toBeNull();
    expect(usableVoiceDuration(12)).toBe(12);
    expect(voicePlayedShare(5, null)).toBe(0);
  });

  it("clamps progress and seeking to the length of the note", () => {
    expect(voicePlayedShare(5, 10)).toBe(0.5);
    expect(voicePlayedShare(20, 10)).toBe(1);
    expect(voiceSeekTime(0.25, 8)).toBe(2);
    expect(voiceSeekTime(1.4, 8)).toBe(8);
    expect(voiceSeekTime(-1, 8)).toBe(0);
    expect(voiceSeekTime(0.5, null)).toBeNull();
  });
});
