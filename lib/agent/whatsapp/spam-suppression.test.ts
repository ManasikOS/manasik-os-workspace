import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isSpamConversation } from "./spam-suppression";

describe("isSpamConversation", () => {
  it("is spam when the conversation's lifecycle is SPAM", () => {
    expect(isSpamConversation({ lifecycleStatus: "SPAM", leadStage: null })).toBe(true);
  });

  it("is spam when the linked lead's stage is SPAM, even if the conversation is open", () => {
    expect(isSpamConversation({ lifecycleStatus: "OPEN", leadStage: "SPAM" })).toBe(true);
  });

  it.each([
    ["OPEN", null],
    ["CLOSED", "NEW"],
    [null, null],
    [undefined, undefined],
  ])("is not spam for lifecycle %s and lead stage %s (legacy rows have no lifecycle)", (lifecycleStatus, leadStage) => {
    expect(isSpamConversation({ lifecycleStatus, leadStage })).toBe(false);
  });
});

describe("the assistant turn", () => {
  const source = readFileSync(join(process.cwd(), "lib/agent/whatsapp/drain.ts"), "utf8");

  it("checks for spam before it types, runs the intake flow, creates a lead or calls the model", () => {
    const check = source.indexOf("await isSpamChat(");
    expect(check).toBeGreaterThan(-1);
    for (const later of ["getChannelAdapterForAgency(context.db", "runBoundedInboxIntake({", "ensureLeadWhenEnabled(context, conversation)", "runAgentTurn(context, conversation)"]) {
      const at = source.indexOf(later, check);
      expect(at, later).toBeGreaterThan(check);
    }
  });
});
