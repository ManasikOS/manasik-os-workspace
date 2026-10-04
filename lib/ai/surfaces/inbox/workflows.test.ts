import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const generateStructured = vi.fn();
vi.mock("@/lib/ai/provider", () => ({ generateStructured: (input: unknown) => generateStructured(input) }));
const lookupApprovedInboxAnswer = vi.fn();
const recordInboxAnswerCandidate = vi.fn();
vi.mock("@/lib/inbox/answers/repository", () => ({
  lookupApprovedInboxAnswer: (...args: unknown[]) => lookupApprovedInboxAnswer(...args),
  recordInboxAnswerCandidate: (...args: unknown[]) => recordInboxAnswerCandidate(...args),
}));

const { suggestConversationReply } = await import("./workflows");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const pack = { facts: { leadName: "Aisha", balance: 100000 }, history: [{ speaker: "customer", text: "I paid LKR 250,000 yesterday" }], consent: null } as never;
const paymentReview = { kind: "PAYMENT_CLAIM" as const, severity: "BLOCK" as const, headline: "The customer says they paid, but no payment is recorded" };

const draftOf = (reply: string) => generateStructured.mockResolvedValue({ value: { reply }, source: "LLM", note: null, runId: "run-1" });
const suggest = (protection?: Parameters<typeof suggestConversationReply>[5]) => suggestConversationReply(pack, AGENCY, "c1", {} as never, "INBOX_REPLY", protection);

beforeEach(() => {
  generateStructured.mockReset();
  lookupApprovedInboxAnswer.mockReset().mockResolvedValue(null);
  recordInboxAnswerCandidate.mockReset().mockResolvedValue(undefined);
});

describe("suggestConversationReply — the protection gate", () => {
  it("refuses a widened draft when priced_at changed before the model is called", async () => {
    const intelligencePack = {
      kind: "INTELLIGENCE",
      facts: {
        contactName: "Aisha", intentCode: null, channel: "WHATSAPP",
        matchedOffer: { departureGroupId: "g1" }, offerCheck: "PRICE_CHANGED",
        policyThresholds: {}, openInterventions: [],
        channelState: { action: "FREE_FORM", notice: "Open" }, approvedTemplates: [],
      },
      history: [{ speaker: "customer", text: "How much is it?" }],
      agency: { brandVoice: "Warm", sop: "Use verified facts." }, knowledgeVersion: 1,
    } as never;
    const result = await suggestConversationReply(intelligencePack, AGENCY, "c1", {} as never);
    expect(result).toMatchObject({ value: null, source: "RULES" });
    expect(result.note).toMatch(/offer changed/i);
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("withholds a draft that confirms a payment while the payment review is open, and says why", async () => {
    draftOf("Thank you, we have received your payment.");
    const result = await suggest({ openReviews: [paymentReview], approvedAccountDigits: [] });
    expect(result.value).toBeNull();
    expect(result.note).toContain("Suggestion withheld");
    expect(result.note).toMatch(/payment/i);
  });

  it("offers a draft that acknowledges without confirming (the brief's worked example)", async () => {
    draftOf("Thank you for letting us know, Aisha. A colleague will check your payment and come back to you.");
    const result = await suggest({ openReviews: [paymentReview], approvedAccountDigits: [] });
    expect(result.value?.reply).toContain("A colleague will check");
  });

  it("tells the model about the open review, so it acknowledges instead of confirming", async () => {
    draftOf("A colleague will check your payment.");
    await suggest({ openReviews: [paymentReview], approvedAccountDigits: [] });
    const instruction = (generateStructured.mock.calls[0][0] as { instruction: string }).instruction;
    expect(instruction).toContain("Open reviews on this conversation");
    expect(instruction).toContain(paymentReview.headline);
  });

  it("withholds a never-autonomous draft even with no review open", async () => {
    draftOf("We can give you a discount.");
    expect((await suggest()).value).toBeNull();
  });

  it("still withholds an ungrounded figure, as before", async () => {
    draftOf("The balance is 999,000.");
    const result = await suggest();
    expect(result.value).toBeNull();
    expect(result.note).toContain("999,000");
  });

  it("passes a plain grounded draft through untouched when nothing is open", async () => {
    draftOf("Your balance is 100,000.");
    expect((await suggest()).value?.reply).toBe("Your balance is 100,000.");
    expect((generateStructured.mock.calls[0][0] as { instruction: string }).instruction).not.toContain("Open reviews");
  });

  it("serves the second identical cacheable question without a second model call", async () => {
    const cacheablePack = {
      kind: "INTELLIGENCE",
      facts: { contactName: "Aisha", intentCode: "FAQ", channel: "WHATSAPP", matchedOffer: null, offerCheck: null, policyThresholds: {}, openInterventions: [], channelState: { action: "FREE_FORM", notice: "Open" }, approvedTemplates: [] },
      history: [{ speaker: "customer", text: "Is breakfast included?" }],
      agency: { brandVoice: "Warm", sop: "Use verified facts." },
      knowledgeVersion: 4,
    } as never;
    draftOf("Breakfast is included.");
    const first = await suggestConversationReply(cacheablePack, AGENCY, "c1", {} as never);
    lookupApprovedInboxAnswer.mockResolvedValueOnce({ id: "11111111-1111-4111-8111-111111111111", answerText: "Breakfast is included.", sourceChunkIds: [] });
    const second = await suggestConversationReply(cacheablePack, AGENCY, "c1", {} as never);
    expect(first.value?.reply).toBe("Breakfast is included.");
    expect(second).toMatchObject({ value: { reply: "Breakfast is included.", cacheEntryId: "11111111-1111-4111-8111-111111111111" }, source: "RULES" });
    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(recordInboxAnswerCandidate).toHaveBeenCalledTimes(1);
  });

  it("refuses direct answer-cache execution when the plan disables it", async () => {
    const cacheablePack = {
      kind: "INTELLIGENCE",
      facts: { contactName: "Aisha", intentCode: "FAQ", channel: "WHATSAPP", matchedOffer: null, offerCheck: null, policyThresholds: {}, openInterventions: [], channelState: { action: "FREE_FORM", notice: "Open" }, approvedTemplates: [] },
      history: [{ speaker: "customer", text: "Is breakfast included?" }], agency: { brandVoice: "Warm", sop: "Use verified facts." }, knowledgeVersion: 4,
    } as never;
    draftOf("Breakfast is included.");
    await suggestConversationReply(cacheablePack, AGENCY, "c1", {} as never, "INBOX_REPLY", undefined, { answerCacheEnabled: false });
    expect(lookupApprovedInboxAnswer).not.toHaveBeenCalled();
    expect(recordInboxAnswerCandidate).not.toHaveBeenCalled();
  });
});
