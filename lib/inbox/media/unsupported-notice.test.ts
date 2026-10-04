import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/channels/registry", () => ({ getChannelAdapter: vi.fn() }));
vi.mock("@/lib/whatsapp/client", () => ({ sendText: vi.fn() }));
vi.mock("@/lib/whatsapp/vault", () => ({ readWhatsAppToken: vi.fn() }));

const { isUnsupportedWhatsAppMessage } = await import("./unsupported-notice");

describe("isUnsupportedWhatsAppMessage", () => {
  it.each(["contacts", "location", "order", "interactive", "button", "unsupported", "unknown", "future_media_type", undefined])("refuses %s instead of letting it become an empty text message", (type) => {
    expect(isUnsupportedWhatsAppMessage({ type })).toBe(true);
  });

  it("flags video and stickers", () => {
    expect(isUnsupportedWhatsAppMessage({ type: "video" })).toBe(true);
    expect(isUnsupportedWhatsAppMessage({ type: "sticker" })).toBe(true);
  });

  it("flags documents that are not an accepted type, and accepts the rest", () => {
    expect(isUnsupportedWhatsAppMessage({ type: "document", document: { mime_type: "application/zip" } })).toBe(true);
    expect(isUnsupportedWhatsAppMessage({ type: "document", document: { mime_type: "application/pdf" } })).toBe(false);
    expect(isUnsupportedWhatsAppMessage({ type: "image" })).toBe(false);
    expect(isUnsupportedWhatsAppMessage({ type: "audio" })).toBe(false);
    expect(isUnsupportedWhatsAppMessage({ type: "text" })).toBe(false);
  });
});
