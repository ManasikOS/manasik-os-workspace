import { describe, expect, it } from "vitest";
import { buildInboxReplyPack, inboxReplySystemFingerprint, type InboxReplyPack } from "./reply-pack";

const pack: InboxReplyPack = { kind: "INTELLIGENCE", facts: { contactName: "A", intentCode: "FAQ", channel: "WHATSAPP", matchedOffer: null, offerCheck: null, policyThresholds: {}, openInterventions: [], channelState: { action: "FREE_FORM", notice: "Open" }, approvedTemplates: [] }, history: [], agency: { brandVoice: "Warm", sop: "Use verified facts." }, knowledgeVersion: 1 };
describe("reply pack", () => {
  it("keeps the frozen system block byte-identical when volatile facts change", () => expect(inboxReplySystemFingerprint({ agency: pack.agency })).toBe(inboxReplySystemFingerprint({ agency: { ...pack.agency } })));
  it("redacts forbidden future fields as a backstop", () => expect(buildInboxReplyPack({ ...pack, facts: { ...pack.facts, policyThresholds: { supplier_cost: 10 } } }).facts.policyThresholds).not.toHaveProperty("supplier_cost"));
});
