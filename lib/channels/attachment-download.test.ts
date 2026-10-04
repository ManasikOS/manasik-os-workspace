import { describe, expect, it, vi } from "vitest";

import { AttachmentDownloadError, audioMimeForResponse, downloadMetaAttachment, downloadMetaFile, isAllowedAttachmentUrl } from "./attachment-download";

const CDN = "https://scontent-sin6-1.xx.fbcdn.net/v/t42/voice.mp4";

const audioResponse = (bytes = 100, headers: Record<string, string> = { "content-type": "audio/mp4" }) => new Response(new Uint8Array(bytes), { status: 200, headers });

describe("isAllowedAttachmentUrl", () => {
  it("accepts https Meta content hosts", () => {
    for (const url of [CDN, "https://lookaside.fbsbx.com/x", "https://scontent.cdninstagram.com/x", "https://cdn.facebook.com/x"]) {
      expect(isAllowedAttachmentUrl(url)).toBe(true);
    }
  });

  it("refuses everything else: other hosts, look-alike domains, plain http, credentials, ports, garbage", () => {
    for (const url of [
      "https://evil.example.com/x",
      "https://fbcdn.net.evil.com/x",
      "https://evilfbcdn.net/x",
      "http://scontent.xx.fbcdn.net/x",
      "https://user:pw@scontent.xx.fbcdn.net/x",
      "https://scontent.xx.fbcdn.net:8443/x",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/x",
      "not a url",
      "",
    ]) {
      expect(isAllowedAttachmentUrl(url)).toBe(false);
    }
  });
});

describe("audioMimeForResponse", () => {
  it("keeps a real audio type and defaults a generic one to MP4 audio, which is what voice notes are", () => {
    expect(audioMimeForResponse("audio/aac")).toBe("audio/aac");
    expect(audioMimeForResponse("audio/mp4; codecs=mp4a.40.2")).toBe("audio/mp4");
    expect(audioMimeForResponse("application/octet-stream")).toBe("audio/mp4");
    expect(audioMimeForResponse("video/mp4")).toBe("audio/mp4");
    expect(audioMimeForResponse(null)).toBe("audio/mp4");
  });
});

describe("downloadMetaAttachment", () => {
  it("downloads without sending the access token when Meta's CDN does not ask for it", async () => {
    const fetchImpl = vi.fn(async () => audioResponse(64));
    const result = await downloadMetaAttachment(CDN, "page-token", { maxBytes: 1000, fetchImpl });
    expect(result.bytes.byteLength).toBe(64);
    expect(result.mimeType).toBe("audio/mp4");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({});
  });

  it("retries once with the Page token when Meta answers 401 or 403", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("", { status: 403 })).mockResolvedValueOnce(audioResponse(10));
    await downloadMetaAttachment(CDN, "page-token", { maxBytes: 1000, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].headers).toEqual({ Authorization: "Bearer page-token" });
  });

  it("does not retry with a token it does not have", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 403 }));
    await expect(downloadMetaAttachment(CDN, null, { maxBytes: 1000, fetchImpl })).rejects.toBeInstanceOf(AttachmentDownloadError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses a URL that is not a Meta content host without making any request, as a permanent failure", async () => {
    const fetchImpl = vi.fn();
    await expect(downloadMetaAttachment("https://evil.example.com/a.mp4", "page-token", { maxBytes: 1000, fetchImpl })).rejects.toMatchObject({ permanent: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("follows a redirect to another Meta host but refuses one to anywhere else", async () => {
    const good = vi.fn().mockResolvedValueOnce(new Response("", { status: 302, headers: { location: "https://video.xx.fbcdn.net/final.mp4" } })).mockResolvedValueOnce(audioResponse(8));
    await expect(downloadMetaAttachment(CDN, null, { maxBytes: 1000, fetchImpl: good })).resolves.toMatchObject({ bytes: expect.any(ArrayBuffer) });
    expect(good).toHaveBeenCalledTimes(2);

    const bad = vi.fn().mockResolvedValueOnce(new Response("", { status: 302, headers: { location: "http://169.254.169.254/latest" } }));
    await expect(downloadMetaAttachment(CDN, "page-token", { maxBytes: 1000, fetchImpl: bad })).rejects.toMatchObject({ permanent: true });
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it("stops after too many redirects", async () => {
    const loop = vi.fn(async () => new Response("", { status: 302, headers: { location: CDN } }));
    await expect(downloadMetaAttachment(CDN, null, { maxBytes: 1000, fetchImpl: loop })).rejects.toMatchObject({ permanent: true });
  });

  it("refuses a file over the size cap, whether Meta declares the size or not", async () => {
    const declared = vi.fn(async () => new Response(new Uint8Array(10), { status: 200, headers: { "content-length": "5000" } }));
    await expect(downloadMetaAttachment(CDN, null, { maxBytes: 1000, fetchImpl: declared })).rejects.toMatchObject({ permanent: true });

    const undeclared = vi.fn(async () => audioResponse(5000, {}));
    await expect(downloadMetaAttachment(CDN, null, { maxBytes: 1000, fetchImpl: undeclared })).rejects.toMatchObject({ permanent: true });
  });

  it("treats a removed attachment as permanent and a server error as worth retrying", async () => {
    await expect(downloadMetaAttachment(CDN, null, { maxBytes: 1000, fetchImpl: async () => new Response("", { status: 404 }) })).rejects.toMatchObject({ permanent: true });
    await expect(downloadMetaAttachment(CDN, null, { maxBytes: 1000, fetchImpl: async () => new Response("", { status: 503 }) })).rejects.toMatchObject({ permanent: false });
  });
});

describe("downloadMetaFile", () => {
  it("preserves an image MIME type instead of coercing it to audio", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg; charset=binary" } }));
    await expect(downloadMetaFile(CDN, null, { maxBytes: 1000, fetchImpl })).resolves.toMatchObject({ mimeType: "image/jpeg" });
  });
});
