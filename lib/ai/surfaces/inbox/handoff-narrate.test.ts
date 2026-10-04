import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const generateStructured = vi.fn();
vi.mock("@/lib/ai/provider", () => ({ generateStructured: (input: unknown) => generateStructured(input) }));

const { narrateHandoffExpectations } = await import("./handoff-narrate");

const base = {
  agencyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  conversationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  customerMessages: ["Please keep our family together and call before departure."],
  facts: { booking: { reference: "BK-100" } },
  db: {} as never,
};

describe("narrateHandoffExpectations", () => {
  beforeEach(() => generateStructured.mockReset());

  it("keeps customer expectations and sentiment separate from deterministic facts", async () => {
    generateStructured.mockResolvedValue({
      value: { expectations: ["Keep the family together"], sentiment: "CONCERNED", confidence: 0.86 },
      source: "LLM",
      note: null,
    });
    await expect(narrateHandoffExpectations(base)).resolves.toEqual({
      value: { expectations: ["Keep the family together"], sentiment: "CONCERNED", confidence: 0.86 },
      source: "LLM",
      note: null,
    });
    expect(generateStructured).toHaveBeenCalledWith(expect.objectContaining({
      surface: "INBOX_HANDOFF",
      agencyId: base.agencyId,
      subjectType: "CONVERSATION",
      subjectId: base.conversationId,
    }));
  });

  it("rejects a narration that introduces a figure absent from the deterministic handoff", async () => {
    generateStructured.mockResolvedValue({
      value: { expectations: ["Promise a room upgrade worth 250000"], sentiment: "POSITIVE", confidence: 0.9 },
      source: "LLM",
      note: null,
    });
    await expect(narrateHandoffExpectations(base)).resolves.toMatchObject({ value: null, source: "RULES" });
  });

  it("falls back without throwing when the model call fails", async () => {
    const failingProvider = async () => { throw new Error("provider unavailable"); };
    await expect(narrateHandoffExpectations(base, failingProvider as never)).resolves.toEqual({ value: null, source: "RULES", note: "provider unavailable" });
  });
});
