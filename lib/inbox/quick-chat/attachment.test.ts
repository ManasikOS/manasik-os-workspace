import { describe, expect, it } from "vitest";

import { canSendQuickChat, checkQuickChatAttachment, type QuickChatAttachmentState } from "./attachment";

describe("checkQuickChatAttachment", () => {
  it("accepts a PDF within the document limit", () => {
    expect(checkQuickChatAttachment({ filename: "Invoice.pdf", mimeType: "application/pdf", byteSize: 120_000 })).toEqual({ ok: true });
  });

  it("refuses other types, empty files and files over the limit, with a plain sentence", () => {
    expect(checkQuickChatAttachment({ filename: "a.png", mimeType: "image/png", byteSize: 10 })).toEqual({ ok: false, error: "Only a PDF can be attached here." });
    expect(checkQuickChatAttachment({ filename: "a.pdf", mimeType: "application/pdf", byteSize: 0 })).toEqual({ ok: false, error: "That file is empty." });
    const tooBig = checkQuickChatAttachment({ filename: "a.pdf", mimeType: "application/pdf", byteSize: 11 * 1024 * 1024 });
    expect(tooBig).toMatchObject({ ok: false, error: expect.stringContaining("10 MB") });
  });
});

describe("canSendQuickChat", () => {
  const ref = { path: "agency/outbound/c/x.pdf", filename: "Invoice.pdf", mimeType: "application/pdf" };
  const state = (status: QuickChatAttachmentState["status"]): QuickChatAttachmentState =>
    status === "ready"
      ? { status, filename: "Invoice.pdf", byteSize: 1, ref }
      : status === "uploading"
        ? { status, filename: "Invoice.pdf", byteSize: 1 }
        : status === "failed"
          ? { status, filename: "Invoice.pdf", byteSize: 1, error: "x" }
          : { status };

  it("needs text when there is no file", () => {
    expect(canSendQuickChat({ draft: "Hello", attachment: state("none") })).toBe(true);
    expect(canSendQuickChat({ draft: "   ", attachment: state("none") })).toBe(false);
  });

  it("lets a ready file go with or without a caption", () => {
    expect(canSendQuickChat({ draft: "", attachment: state("ready") })).toBe(true);
    expect(canSendQuickChat({ draft: "Here it is", attachment: state("ready") })).toBe(true);
  });

  it("blocks while the file uploads or after it failed, even with text, so the file is never left out silently", () => {
    expect(canSendQuickChat({ draft: "Hello", attachment: state("uploading") })).toBe(false);
    expect(canSendQuickChat({ draft: "Hello", attachment: state("failed") })).toBe(false);
  });
});
