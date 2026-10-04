import { describe, expect, it } from "vitest";
import { resolveChannelPolicyState, type ChannelPolicyInput } from "./policy-state";

const now = new Date("2026-09-21T12:00:00Z");
const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
const base: ChannelPolicyInput = { channel: "MESSENGER", now, serviceWindowExpiresAt: at(1), humanAgentWindowExpiresAt: at(120), handlingMode: "HUMAN_ACTIVE", hasOpenSupportCase: true, author: "HUMAN", projectedTemplateCharge: null, chargeCurrency: null };

describe("channel policy state", () => {
  it("allows WhatsApp free-form inside the service window", () => expect(resolveChannelPolicyState({ ...base, channel: "WHATSAPP" }).action).toBe("FREE_FORM"));
  it("requires a charged approved template outside the WhatsApp window", () => expect(resolveChannelPolicyState({ ...base, channel: "WHATSAPP", serviceWindowExpiresAt: at(-1), projectedTemplateCharge: 0.03, chargeCurrency: "USD" })).toMatchObject({ action: "APPROVED_TEMPLATE", projectedCharge: { amount: 0.03, currency: "USD" } }));
  it("allows HUMAN_AGENT only for a human on an active support case", () => expect(resolveChannelPolicyState({ ...base, serviceWindowExpiresAt: at(-1) }).action).toBe("HUMAN_AGENT"));
  it.each(["AUTOMATION" as const])("refuses HUMAN_AGENT to %s at every autonomy level", (author) => expect(resolveChannelPolicyState({ ...base, serviceWindowExpiresAt: at(-1), author }).humanAgentTagEligible).toBe(false));
  it("blocks after seven days and recommends re-engagement", () => expect(resolveChannelPolicyState({ ...base, serviceWindowExpiresAt: at(-150), humanAgentWindowExpiresAt: at(-1) })).toMatchObject({ action: "BLOCKED" }));

  it.each(["MESSENGER", "INSTAGRAM"])("covers the complete %s HUMAN_AGENT eligibility matrix", (channel) => {
    const outside24h = { ...base, channel, serviceWindowExpiresAt: at(-1) };
    expect(resolveChannelPolicyState(outside24h).action).toBe("HUMAN_AGENT");
    expect(resolveChannelPolicyState({ ...outside24h, hasOpenSupportCase: false }).action).toBe("BLOCKED");
    expect(resolveChannelPolicyState({ ...outside24h, handlingMode: "AI_ACTIVE" }).action).toBe("BLOCKED");
    expect(resolveChannelPolicyState({ ...outside24h, author: "AUTOMATION" }).action).toBe("BLOCKED");
    expect(resolveChannelPolicyState({ ...outside24h, humanAgentWindowExpiresAt: at(0) }).action).toBe("HUMAN_AGENT");
    expect(resolveChannelPolicyState({ ...outside24h, humanAgentWindowExpiresAt: at(-0.001) }).action).toBe("BLOCKED");
  });

  it("treats the exact WhatsApp service-window expiry as open and one millisecond later as template-only", () => {
    expect(resolveChannelPolicyState({ ...base, channel: "WHATSAPP", serviceWindowExpiresAt: at(0) }).action).toBe("FREE_FORM");
    expect(resolveChannelPolicyState({ ...base, channel: "WHATSAPP", serviceWindowExpiresAt: new Date(now.getTime() - 1).toISOString() }).action).toBe("APPROVED_TEMPLATE");
  });

  it("allows channels without a Meta window to keep free-form replies", () => {
    expect(resolveChannelPolicyState({ ...base, channel: "GMAIL", serviceWindowExpiresAt: null }).action).toBe("FREE_FORM");
  });
});
