import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const generateStructured = vi.fn();
vi.mock("@/lib/ai/provider", () => ({ generateStructured: (input: unknown) => generateStructured(input) }));

const { readTravelIntent, INBOX_INTENT_SURFACE } = await import("./travel-intent");

const NOW = "2026-09-20T10:00:00.000Z";
const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONVERSATION = "3f1d2c4e-5a6b-4c7d-8e9f-000000000001";
const PDF_EXAMPLE = "4 adults from Kandy, December, school holidays, close hotel, quad";
const ALL_RESOLVED = "Umrah for 4 adults from Kandy in December, quad room, close to the Haram, budget 400000 per person";

const read = (text: string) => readTravelIntent({ agencyId: AGENCY, conversationId: CONVERSATION, customerMessages: [{ id: "m1", text }], now: NOW, db: {} as never });
const instructionOfCall = (index = 0) => (generateStructured.mock.calls[index][0] as { instruction: string }).instruction;

beforeEach(() => generateStructured.mockReset());

describe("readTravelIntent — rules first, the model only for what is left", () => {
  it("a rules-only path makes no model call", async () => {
    const result = await read(ALL_RESOLVED);
    expect(generateStructured).not.toHaveBeenCalled();
    expect(result).toMatchObject({ source: "RULES", note: null, modelCalls: 0, aiRunId: null });
    expect(Object.keys(result.readings)).toHaveLength(7);
  });

  it("a partial rule result triggers exactly ONE call, on the INBOX_INTENT surface, asking only about the unresolved fields", async () => {
    generateStructured.mockResolvedValue({ value: { hotelDistance: { value: "VERY_CLOSE", quote: "close hotel" } }, source: "LLM", note: null, runId: "run-1" });
    const result = await read(PDF_EXAMPLE);

    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(generateStructured).toHaveBeenCalledWith(expect.objectContaining({ tier: "classify", surface: INBOX_INTENT_SURFACE, agencyId: AGENCY, subjectType: "CONVERSATION", subjectId: CONVERSATION }));
    const instruction = instructionOfCall();
    for (const asked of ["journey:", "hotelDistance:", "budget:"]) expect(instruction).toContain(asked);
    for (const notAsked of ["travellers:", "window:", "room:", "origin:"]) expect(instruction).not.toContain(notAsked);

    expect(result).toMatchObject({ source: "LLM", modelCalls: 1, aiRunId: "run-1", note: null });
    expect(result.readings.hotelDistance).toMatchObject({ source: "LLM", evidence: [{ messageId: "m1", snippet: "close hotel" }] });
    expect(result.readings.travellers?.source).toBe("RULES");
  });

  it("says the source is RULES when the model added nothing", async () => {
    generateStructured.mockResolvedValue({ value: {}, source: "LLM", note: null, runId: "run-2" });
    expect(await read(PDF_EXAMPLE)).toMatchObject({ source: "RULES", modelCalls: 1 });
  });

  it("a model failure keeps the rule readings and says why", async () => {
    generateStructured.mockResolvedValue({ value: null, source: "RULES", note: "AI call failed: 503", runId: "run-3" });
    const result = await read(PDF_EXAMPLE);
    expect(result).toMatchObject({ source: "RULES", note: "AI call failed: 503", modelCalls: 1, aiRunId: "run-3" });
    expect(Object.keys(result.readings).sort()).toEqual(["origin", "room", "travellers", "window"]);
  });

  it("a refused call (no key, or the surface is switched off) is not counted as a model call", async () => {
    generateStructured.mockResolvedValue({ value: null, source: "RULES", note: 'AI surface "INBOX_INTENT" is turned off for this agency.', runId: null });
    expect(await read(PDF_EXAMPLE)).toMatchObject({ modelCalls: 0, note: expect.stringContaining("turned off") });
  });

  it("discards a detail the model gave without a real quote, and says so, instead of showing it", async () => {
    generateStructured.mockResolvedValue({ value: { budget: { value: 400000, quote: "we can spend 4 lakh" }, hotelDistance: { value: "VERY_CLOSE", quote: "close hotel" } }, source: "LLM", note: null, runId: "run-4" });
    const result = await read(PDF_EXAMPLE);
    expect(result.readings.budget).toBeUndefined();
    expect(result.readings.hotelDistance).toBeDefined();
    expect(result.note).toBe("Left out 1 detail the model gave without a matching quote from the customer.");
  });

  it("reads Sinhala and Tamil messages through the model, since no English rule can", async () => {
    generateStructured.mockResolvedValue({ value: { travellers: { adults: 4, children: 0, infants: 0, quote: "අපි 4 දෙනෙක්" } }, source: "LLM", note: null, runId: "run-5" });
    const result = await read("උම්රා යන්න ඕන. අපි 4 දෙනෙක්");
    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(result.readings.travellers).toMatchObject({ source: "LLM", value: "4 adults", evidence: [{ messageId: "m1", snippet: "අපි 4 දෙනෙක්" }] });
  });

  it("puts the customer's messages, and only theirs, in the prompt", async () => {
    generateStructured.mockResolvedValue({ value: {}, source: "LLM", note: null, runId: null });
    await readTravelIntent({ agencyId: AGENCY, conversationId: CONVERSATION, customerMessages: [{ id: "a", text: "First   message" }, { id: "b", text: "Second message" }], now: NOW, db: {} as never });
    expect(instructionOfCall()).toContain("- First message\n- Second message");
  });
});
