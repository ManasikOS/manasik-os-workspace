import { describe, expect, it } from "vitest";

import { modelTextForMessage, VOICE_DISABLED_TEXT, voiceMediaFromWebhook } from "./voice-note";

describe("voice-note helpers", () => {
  it("keeps the provider media reference needed for staff playback", () => {
    expect(voiceMediaFromWebhook({ audio: { id: "media-1", mime_type: "audio/ogg" } })).toEqual({
      mediaId: "media-1",
      mimeType: "audio/ogg",
    });
    expect(voiceMediaFromWebhook({})).toBeNull();
  });

  it("uses a non-transcription placeholder for audio-only model context", () => {
    expect(modelTextForMessage({ content: "", message_type: "AUDIO" })).toBe(VOICE_DISABLED_TEXT);
    expect(modelTextForMessage({ content: "typed text", message_type: "AUDIO" })).toBe("typed text");
  });
});
