import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const generateStructured = vi.fn();
vi.mock("@/lib/ai/provider", () => ({ generateStructured: (input: unknown) => generateStructured(input) }));

const { triageConversation, INBOX_TRIAGE_SURFACE } = await import("./triage");

const base = { agencyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", conversationId: "3f1d2c4e-5a6b-4c7d-8e9f-000000000001", digest: "C: hi", db: {} as never };
const answer = { intent: "PRICE_REQUEST", intentConfidence: 0.91, urgency: "NORMAL", sentiment: "NEUTRAL", languageCode: "en" };

beforeEach(() => generateStructured.mockReset());

describe("triageConversation", () => {
  it("makes exactly one classify-tier call on the INBOX_TRIAGE surface, scoped to the agency and conversation", async () => {
    generateStructured.mockResolvedValue({ value: answer, source: "LLM", note: null, runId: "run-1" });
    const outcome = await triageConversation({ ...base, latestMessage: "How much is the December package?" });
    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(generateStructured).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "classify", surface: INBOX_TRIAGE_SURFACE, agencyId: base.agencyId, subjectType: "CONVERSATION", subjectId: base.conversationId }),
    );
    expect(outcome).toMatchObject({ intentCode: "PRICE_REQUEST", intentConfidence: 0.91, source: "LLM", note: null, aiRunId: "run-1" });
  });

  it("a model failure leaves source RULES and a populated note, with a keyword reading and the run id kept", async () => {
    generateStructured.mockResolvedValue({ value: null, source: "RULES", note: "AI call failed: 503", runId: "run-2" });
    const outcome = await triageConversation({ ...base, latestMessage: "I want to cancel my booking" });
    expect(outcome).toMatchObject({ intentCode: "CANCELLATION", source: "RULES", note: "AI call failed: 503", aiRunId: "run-2" });
  });

  it("an answer outside the closed enums (which generateStructured reports as a validation failure) falls back to rules with the reason", async () => {
    generateStructured.mockResolvedValue({ value: null, source: "RULES", note: "The model's JSON failed validation: Invalid option", runId: "run-3" });
    const outcome = await triageConversation({ ...base, latestMessage: "visa eka awada?" });
    expect(outcome.source).toBe("RULES");
    expect(outcome.intentCode).toBe("VISA_QUERY");
    expect(outcome.note).toContain("failed validation");
  });

  it("gives a note even when the failure carried none", async () => {
    generateStructured.mockResolvedValue({ value: null, source: "RULES", note: null, runId: null });
    expect((await triageConversation({ ...base, latestMessage: "Hello" })).note).toBeTruthy();
  });

  it("does not believe a model that calls a genuine Umrah enquiry SPAM", async () => {
    generateStructured.mockResolvedValue({ value: { ...answer, intent: "SPAM" }, source: "LLM", note: null, runId: "run-4" });
    const outcome = await triageConversation({ ...base, latestMessage: "Do you have Umrah packages in March? Saw your ad https://fb.me/x" });
    expect(outcome.intentCode).not.toBe("SPAM");
    expect(outcome.source).toBe("RULES");
    expect(outcome.note).toContain("spam");
  });

  it("accepts a SPAM verdict on a message that is not about the agency", async () => {
    generateStructured.mockResolvedValue({ value: { ...answer, intent: "SPAM" }, source: "LLM", note: null, runId: "run-5" });
    expect((await triageConversation({ ...base, latestMessage: "Buy followers cheap, crypto accepted" })).intentCode).toBe("SPAM");
  });

  it("puts the digest and the newest message in the prompt, and a placeholder when there is no digest", async () => {
    generateStructured.mockResolvedValue({ value: answer, source: "LLM", note: null, runId: null });
    await triageConversation({ ...base, digest: null, latestMessage: "Hello there" });
    const instruction = (generateStructured.mock.calls[0][0] as { instruction: string }).instruction;
    expect(instruction).toContain("(no earlier messages)");
    expect(instruction).toContain("Hello there");
  });
});
