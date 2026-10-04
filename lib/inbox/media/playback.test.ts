import { describe, expect, it } from "vitest";

import { shouldRenewInboxAudioSource } from "./playback";

describe("shouldRenewInboxAudioSource", () => {
  it("renews an audio source once when the browser rejects it", () => {
    expect(
      shouldRenewInboxAudioSource({
        attachmentId: "attachment-1",
        mimeType: "audio/ogg",
        sourceHref: "https://storage.example/expired",
        renewedAttachmentIds: new Set(),
      }),
    ).toBe(true);
  });

  it("does not retry a source repeatedly or renew non-audio attachments", () => {
    expect(
      shouldRenewInboxAudioSource({
        attachmentId: "attachment-1",
        mimeType: "audio/ogg",
        sourceHref: "https://storage.example/expired",
        renewedAttachmentIds: new Set(["attachment-1"]),
      }),
    ).toBe(false);
    expect(
      shouldRenewInboxAudioSource({
        attachmentId: "attachment-2",
        mimeType: "application/pdf",
        sourceHref: "https://storage.example/file",
        renewedAttachmentIds: new Set(),
      }),
    ).toBe(false);
  });
});
