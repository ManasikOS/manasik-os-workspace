import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  VOICE_TRANSCRIPT_LOW_CONFIDENCE_BELOW,
  attachVoiceTranscripts,
  canViewVoiceTranscripts,
  VOICE_TRANSCRIPT_MAX_BYTES,
  VOICE_TRANSCRIPT_MAX_SECONDS,
  checkVoiceTranscriptEligibility,
  isRetryableVoiceTranscriptFailure,
  oggOpusDurationSeconds,
  settleVoiceTranscript,
  toVoiceTranscriptView,
  voiceAudioFormat,
  voiceTranscriptModelOutputSchema,
} from "./voice-transcript";
import { concat, oggPage, opusHead } from "./voice-transcript.test-fixtures";

describe("voiceAudioFormat", () => {
  it("maps supported audio types, ignoring case and codec parameters", () => {
    expect(voiceAudioFormat("audio/ogg; codecs=opus")).toBe("ogg");
    expect(voiceAudioFormat("AUDIO/MPEG")).toBe("mp3");
    expect(voiceAudioFormat("audio/mp4")).toBe("m4a");
    expect(voiceAudioFormat("audio/x-m4a")).toBe("m4a");
    expect(voiceAudioFormat("audio/wav")).toBe("wav");
    expect(voiceAudioFormat("audio/x-wav")).toBe("wav");
    expect(voiceAudioFormat("audio/aac")).toBe("aac");
    expect(voiceAudioFormat("audio/flac")).toBe("flac");
  });

  it("returns null for anything the provider cannot take", () => {
    expect(voiceAudioFormat("audio/amr")).toBeNull();
    expect(voiceAudioFormat("video/mp4")).toBeNull();
    expect(voiceAudioFormat("application/pdf")).toBeNull();
    expect(voiceAudioFormat("")).toBeNull();
  });
});

describe("checkVoiceTranscriptEligibility", () => {
  const ok = { enabled: true, mimeType: "audio/ogg", byteSize: 120_000, durationSeconds: 42 };

  it("accepts an enabled, supported, in-limit voice note", () => {
    expect(checkVoiceTranscriptEligibility(ok)).toEqual({ eligible: true, format: "ogg" });
  });

  it("accepts a note whose duration is not known yet", () => {
    expect(checkVoiceTranscriptEligibility({ ...ok, durationSeconds: null })).toEqual({ eligible: true, format: "ogg" });
  });

  it("refuses before anything else when the feature is off", () => {
    expect(checkVoiceTranscriptEligibility({ ...ok, enabled: false, mimeType: "audio/amr", byteSize: 1e9 })).toEqual({
      eligible: false,
      reason: "DISABLED",
    });
  });

  it("refuses an unsupported format, an empty file, an oversized file and an over-long note", () => {
    expect(checkVoiceTranscriptEligibility({ ...ok, mimeType: "audio/amr" })).toEqual({ eligible: false, reason: "UNSUPPORTED_FORMAT" });
    expect(checkVoiceTranscriptEligibility({ ...ok, byteSize: 0 })).toEqual({ eligible: false, reason: "UNSUPPORTED_FORMAT" });
    expect(checkVoiceTranscriptEligibility({ ...ok, byteSize: VOICE_TRANSCRIPT_MAX_BYTES + 1 })).toEqual({ eligible: false, reason: "TOO_LARGE" });
    expect(checkVoiceTranscriptEligibility({ ...ok, durationSeconds: VOICE_TRANSCRIPT_MAX_SECONDS + 1 })).toEqual({ eligible: false, reason: "TOO_LONG" });
  });

  it("allows exactly the limits", () => {
    expect(checkVoiceTranscriptEligibility({ ...ok, byteSize: VOICE_TRANSCRIPT_MAX_BYTES, durationSeconds: VOICE_TRANSCRIPT_MAX_SECONDS }).eligible).toBe(true);
  });
});

describe("voiceTranscriptModelOutputSchema", () => {
  const valid = { hasSpeech: true, transcript: "Salaam, two seats please.", language: "en", confidence: 0.9 };

  it("accepts English, Arabic and mixed-language output and an unlisted language", () => {
    for (const language of ["en", "ar", "mixed", "other"]) {
      expect(voiceTranscriptModelOutputSchema.safeParse({ ...valid, language }).success).toBe(true);
    }
  });

  it("rejects malformed model output instead of trusting it", () => {
    expect(voiceTranscriptModelOutputSchema.safeParse({ ...valid, confidence: 1.4 }).success).toBe(false);
    expect(voiceTranscriptModelOutputSchema.safeParse({ ...valid, language: "klingon" }).success).toBe(false);
    expect(voiceTranscriptModelOutputSchema.safeParse({ ...valid, extra: "field" }).success).toBe(false);
    expect(voiceTranscriptModelOutputSchema.safeParse({ ...valid, transcript: "x".repeat(20_001) }).success).toBe(false);
  });
});

describe("settleVoiceTranscript", () => {
  const speech = { hasSpeech: true, transcript: "  Salaam, two seats please.  ", language: "en" as const, confidence: 0.9 };

  it("completes a confident transcript in an allowed language, trimmed", () => {
    expect(settleVoiceTranscript(speech)).toEqual({
      status: "COMPLETE",
      transcriptText: "Salaam, two seats please.",
      language: "en",
      confidence: 0.9,
    });
  });

  it("labels a transcript low confidence below the threshold, never discarding it", () => {
    const result = settleVoiceTranscript({ ...speech, confidence: VOICE_TRANSCRIPT_LOW_CONFIDENCE_BELOW - 0.01 });
    expect(result).toMatchObject({ status: "LOW_CONFIDENCE", transcriptText: "Salaam, two seats please." });
    expect(settleVoiceTranscript({ ...speech, confidence: VOICE_TRANSCRIPT_LOW_CONFIDENCE_BELOW })).toMatchObject({ status: "COMPLETE" });
  });

  it("treats Arabic and mixed-language output as normal", () => {
    expect(settleVoiceTranscript({ ...speech, language: "ar", transcript: "السلام عليكم" })).toMatchObject({ status: "COMPLETE", language: "ar" });
    expect(settleVoiceTranscript({ ...speech, language: "mixed" })).toMatchObject({ status: "COMPLETE", language: "mixed" });
  });

  it("flags a language outside the agreed set as low confidence however sure the model is", () => {
    expect(settleVoiceTranscript({ ...speech, language: "other", confidence: 0.99 })).toMatchObject({ status: "LOW_CONFIDENCE", language: "other" });
  });

  it("reports no speech when the model heard none or returned only whitespace", () => {
    expect(settleVoiceTranscript({ ...speech, hasSpeech: false, transcript: "" })).toEqual({ status: "FAILED", failureReason: "NO_SPEECH" });
    expect(settleVoiceTranscript({ ...speech, transcript: "   " })).toEqual({ status: "FAILED", failureReason: "NO_SPEECH" });
  });

  it("rounds confidence to the two decimals the column stores", () => {
    expect(settleVoiceTranscript({ ...speech, confidence: 0.8449 })).toMatchObject({ confidence: 0.84 });
  });
});

describe("isRetryableVoiceTranscriptFailure", () => {
  it("retries only transient provider problems", () => {
    expect(isRetryableVoiceTranscriptFailure("PROVIDER_ERROR")).toBe(true);
    expect(isRetryableVoiceTranscriptFailure("TIMEOUT")).toBe(true);
    for (const reason of ["DISABLED", "QUOTA_EXCEEDED", "UNSUPPORTED_FORMAT", "TOO_LONG", "TOO_LARGE", "NO_SPEECH"] as const) {
      expect(isRetryableVoiceTranscriptFailure(reason)).toBe(false);
    }
  });
});

describe("oggOpusDurationSeconds", () => {
  it("derives duration from the last granule position minus the pre-skip at 48 kHz", () => {
    const stream = concat(
      oggPage({ headerType: 2, granule: BigInt(0), sequence: 0, data: opusHead(312) }),
      oggPage({ granule: BigInt(48_000) * BigInt(10) + BigInt(312), sequence: 1, data: new Uint8Array(20) }),
      oggPage({ headerType: 4, granule: BigInt(48_000) * BigInt(42) + BigInt(312), sequence: 2, data: new Uint8Array(20) }),
    );
    expect(oggOpusDurationSeconds(stream)).toBe(42);
  });

  it("ignores pages with no granule position", () => {
    const stream = concat(
      oggPage({ headerType: 2, granule: BigInt(0), sequence: 0, data: opusHead(0) }),
      oggPage({ granule: BigInt(48_000) * BigInt(5), sequence: 1, data: new Uint8Array(20) }),
      oggPage({ granule: BigInt(-1), sequence: 2, data: new Uint8Array(20) }),
    );
    expect(oggOpusDurationSeconds(stream)).toBe(5);
  });

  it("returns null for anything that is not a readable Ogg Opus stream", () => {
    expect(oggOpusDurationSeconds(new ArrayBuffer(0))).toBeNull();
    expect(oggOpusDurationSeconds(new TextEncoder().encode("not audio at all").buffer)).toBeNull();
    expect(oggOpusDurationSeconds(concat(oggPage({ headerType: 2, granule: BigInt(0), sequence: 0, data: new Uint8Array(19) })))).toBeNull();
  });

  it("returns null instead of throwing on a truncated stream", () => {
    const whole = new Uint8Array(concat(oggPage({ headerType: 2, granule: BigInt(0), sequence: 0, data: opusHead(0) })));
    expect(oggOpusDurationSeconds(whole.slice(0, 20).buffer)).toBeNull();
  });
});

describe("toVoiceTranscriptView", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    status: "COMPLETE",
    transcript_text: "Salaam, two seats please.",
    language: "en",
    confidence: "0.92",
    failure_reason: null,
    ...overrides,
  });

  it("describes a complete transcript as a machine aid, with the text", () => {
    expect(toVoiceTranscriptView(row())).toMatchObject({
      state: "COMPLETE",
      text: "Salaam, two seats please.",
      language: "en",
      confidence: 0.92,
      tone: "info",
    });
    expect(toVoiceTranscriptView(row()).notice).toMatch(/machine transcript/i);
    expect(toVoiceTranscriptView(row()).notice).toMatch(/original/i);
  });

  it("visibly labels a low-confidence transcript while still showing it", () => {
    const view = toVoiceTranscriptView(row({ status: "LOW_CONFIDENCE", confidence: "0.41" }));
    expect(view).toMatchObject({ state: "LOW_CONFIDENCE", text: "Salaam, two seats please.", tone: "warning" });
    expect(view.notice).toMatch(/low confidence/i);
  });

  it("explains an unrecognised language", () => {
    const view = toVoiceTranscriptView(row({ status: "LOW_CONFIDENCE", language: "other", confidence: "0.95" }));
    expect(view.notice).toMatch(/language/i);
  });

  it("shows a pending note as transcribing and says the audio can already be played", () => {
    for (const status of ["PENDING", "PROCESSING"]) {
      const view = toVoiceTranscriptView(row({ status, transcript_text: null, confidence: null }));
      expect(view).toMatchObject({ state: "PENDING", text: null, tone: "neutral" });
      expect(view.notice).toMatch(/play/i);
    }
  });

  it("gives every failure and skip reason plain words, never raw codes", () => {
    const reasons = ["NO_SPEECH", "PROVIDER_ERROR", "TIMEOUT", "DISABLED", "QUOTA_EXCEEDED", "UNSUPPORTED_FORMAT", "TOO_LONG", "TOO_LARGE"];
    for (const reason of reasons) {
      const status = ["DISABLED", "QUOTA_EXCEEDED", "UNSUPPORTED_FORMAT", "TOO_LONG", "TOO_LARGE"].includes(reason) ? "SKIPPED" : "FAILED";
      const view = toVoiceTranscriptView(row({ status, transcript_text: null, confidence: null, failure_reason: reason }));
      expect(view.state).toBe(status === "SKIPPED" ? "UNAVAILABLE" : "FAILED");
      expect(view.text).toBeNull();
      expect(view.notice).not.toMatch(/[A-Z]{2,}_[A-Z]{2,}/);
      expect(view.notice.length).toBeGreaterThan(10);
    }
    expect(toVoiceTranscriptView(row({ status: "SKIPPED", transcript_text: null, failure_reason: "DISABLED" })).notice).toMatch(/turned off/i);
  });

  it("reminds staff in every state that the original audio is the record", () => {
    for (const status of ["PENDING", "COMPLETE", "LOW_CONFIDENCE", "FAILED", "SKIPPED"]) {
      expect(toVoiceTranscriptView(row({ status, failure_reason: status === "FAILED" || status === "SKIPPED" ? "TIMEOUT" : null })).originalStillAvailable).toBe(true);
    }
  });

  it("never exposes text for a state that has none, even if a stray value is stored", () => {
    expect(toVoiceTranscriptView(row({ status: "FAILED", failure_reason: "TIMEOUT", transcript_text: "stray" })).text).toBeNull();
  });
});

describe("attachVoiceTranscripts", () => {
  const analyses = [
    { id: "a1", attachment_id: "att-1", kind: "VOICE" },
    { id: "a2", attachment_id: "att-2", kind: "RECEIPT" },
    { id: "a3", attachment_id: "att-3", kind: "VOICE" },
  ];
  const transcripts = [
    { attachment_id: "att-1", status: "COMPLETE", transcript_text: "hello", language: "en", confidence: 0.9, failure_reason: null },
    { attachment_id: "att-2", status: "COMPLETE", transcript_text: "must not attach", language: "en", confidence: 0.9, failure_reason: null },
  ];

  it("attaches a transcript view to the matching voice analysis only", () => {
    const result = attachVoiceTranscripts(analyses, transcripts, true);
    expect(result[0].voice_transcript).toMatchObject({ state: "COMPLETE", text: "hello" });
    expect(result[1].voice_transcript).toBeNull();
    expect(result[2].voice_transcript).toBeNull();
  });

  it("attaches nothing, and keeps no text, when the viewer may not read transcripts", () => {
    const result = attachVoiceTranscripts(analyses, transcripts, false);
    expect(result.every((analysis) => analysis.voice_transcript === null)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("hello");
  });
});

describe("voice transcript containment", () => {
  it("is read only by the Inbox artifact loader, the metrics loader and the worker", () => {
    const root = process.cwd();
    const offenders: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
        const relative = `${directory}/${entry.name}`;
        if (entry.isDirectory()) {
          if (!["node_modules", ".next", ".git"].includes(entry.name)) visit(relative);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx")) {
          if (readFileSync(join(root, relative), "utf8").includes("inbox_voice_transcripts")) offenders.push(relative);
        }
      }
    };
    for (const directory of ["app", "lib"]) visit(directory);
    expect(offenders.sort()).toEqual([
      "lib/data/inbox-repository.ts",
      "lib/inbox/media/voice-transcript-worker.ts",
      "lib/metrics/inbox-intelligence-metrics.ts",
    ]);
  });
});

describe("canViewVoiceTranscripts", () => {
  it("mirrors the table's read policy: Inbox staff roles only, never Guide", () => {
    for (const role of ["ADMIN", "CEO", "MARKETING", "OPERATIONS", "FINANCE", "VISA"] as const) {
      expect(canViewVoiceTranscripts(role)).toBe(true);
    }
    expect(canViewVoiceTranscripts("GUIDE")).toBe(false);
  });
});
