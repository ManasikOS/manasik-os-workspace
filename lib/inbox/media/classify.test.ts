import { describe, expect, it } from "vitest";

import { inboxAttachmentFamily } from "./classify";

describe("inboxAttachmentFamily", () => {
  it("accepts images, documents and audio, including WhatsApp voice notes", () => {
    expect(inboxAttachmentFamily({ mimeType: "image/jpeg" })).toBe("IMAGE");
    expect(inboxAttachmentFamily({ mimeType: "application/pdf" })).toBe("DOCUMENT");
    expect(inboxAttachmentFamily({ mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBe("DOCUMENT");
    expect(inboxAttachmentFamily({ mimeType: "audio/ogg; codecs=opus" })).toBe("AUDIO");
  });

  it("rejects video however the provider labels it", () => {
    expect(inboxAttachmentFamily({ mimeType: "video/mp4" })).toBeNull();
    expect(inboxAttachmentFamily({ mimeType: "application/octet-stream", providerType: "video" })).toBeNull();
    expect(inboxAttachmentFamily({ mimeType: "image/gif", providerType: "video" })).toBeNull();
  });

  it("rejects file types the Inbox does not keep", () => {
    expect(inboxAttachmentFamily({ mimeType: "application/zip" })).toBeNull();
    expect(inboxAttachmentFamily({ mimeType: "application/x-msdownload" })).toBeNull();
    expect(inboxAttachmentFamily({ mimeType: "application/octet-stream" })).toBeNull();
  });
});
