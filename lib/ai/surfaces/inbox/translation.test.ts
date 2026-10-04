import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const generateStructured = vi.fn();
vi.mock("@/lib/ai/provider", () => ({ generateStructured: (...args: unknown[]) => generateStructured(...args) }));

const { translateInboxText, INBOX_TRANSLATION_SURFACE } = await import("./translation");

describe("translateInboxText — FIX10", () => {
  beforeEach(() => generateStructured.mockReset());

  it.each([
    ["English", "Hello", "en"],
    ["Sinhala", "හෙලෝ", "si"],
    ["Tamil", "வணக்கம்", "ta"],
    ["mixed", "Hello வணக்கம்", "mixed"],
  ])("uses the shared metered seam for a %s original", async (_label, text, detectedLanguage) => {
    generateStructured.mockResolvedValue({ value: { translation: "Hello", detectedLanguage, confidence: 0.94 }, source: "LLM", note: null, runId: "run-1" });
    const result = await translateInboxText({ agencyId: "a", conversationId: "c", text, targetLanguage: "English", db: {} as never });
    expect(result.value?.translation).toBe("Hello");
    expect(generateStructured).toHaveBeenCalledWith(expect.objectContaining({ surface: INBOX_TRANSLATION_SURFACE, tier: "draft", subjectType: "CONVERSATION", instruction: expect.stringContaining(text) }));
  });

  it("keeps a useful deterministic fallback when the provider fails", async () => {
    generateStructured.mockResolvedValue({ value: null, source: "RULES", note: "provider failed", runId: null });
    const result = await translateInboxText({ agencyId: "a", conversationId: "c", text: "வணக்கம்", targetLanguage: "English", db: {} as never });
    expect(result).toMatchObject({ value: null, source: "RULES", note: expect.stringContaining("original message") });
  });
});
