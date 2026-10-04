import { describe, expect, it } from "vitest";

import { assertSimulatedAccountId } from "../../lib/inbox/simulator/inbound-payloads";
import {
  assertInboxLr2FixtureTarget,
  inboxLr2FixtureConversations,
  inboxLr2FixtureSimulatedCredentialRef,
  inboxLr2FixtureSimulatedNumbers,
  inboxLr2FixtureWindowTimes,
} from "./inbox-lr2-fixtures-config";

const base = { INBOX_E2E_ENVIRONMENT: "staging", NEXT_PUBLIC_SUPABASE_URL: "https://abc123.supabase.co", INBOX_E2E_PROJECT_REF: "abc123", INBOX_E2E_PRODUCTION_PROJECT_REF: "prod999" };

describe("LR2 fixture seeding target", () => {
  it("accepts a named non-production project", () => {
    expect(assertInboxLr2FixtureTarget(base).projectRef).toBe("abc123");
  });
  it("refuses production, a mismatched URL and an unknown environment", () => {
    expect(() => assertInboxLr2FixtureTarget({ ...base, INBOX_E2E_PRODUCTION_PROJECT_REF: "abc123" })).toThrow(/must not match/);
    expect(() => assertInboxLr2FixtureTarget({ ...base, NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" })).toThrow(/does not point/);
    expect(() => assertInboxLr2FixtureTarget({ ...base, INBOX_E2E_ENVIRONMENT: "production" })).toThrow(/staging or disposable/);
  });
});

describe("LR2 fixture simulated WhatsApp numbers", () => {
  it("use simulator ids, so the signed-webhook builders can address them and a real account cannot be mistaken for them", () => {
    for (const number of Object.values(inboxLr2FixtureSimulatedNumbers)) {
      expect(() => assertSimulatedAccountId(number.phoneNumberId, "the fixture number")).not.toThrow();
    }
  });

  it("give each fixture agency its own number, because a phone_number_id resolves to exactly one agency", () => {
    const { agencyA, agencyB } = inboxLr2FixtureSimulatedNumbers;
    expect(agencyA.phoneNumberId).not.toBe(agencyB.phoneNumberId);
    expect(agencyA.displayPhoneNumber).not.toBe(agencyB.displayPhoneNumber);
  });

  it("use a placeholder credential reference that cannot be mistaken for a real Vault secret", () => {
    expect(inboxLr2FixtureSimulatedCredentialRef).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});

describe("LR2 fixture conversations", () => {
  it("cover every id the browser suite requires, with distinct external ids", () => {
    const plans = Object.values(inboxLr2FixtureConversations);
    expect(plans.map((plan) => plan.envKey).sort()).toEqual(["INBOX_E2E_A_CLOSED_WINDOW_CONVERSATION_ID", "INBOX_E2E_A_COWORKER_CONVERSATION_ID", "INBOX_E2E_A_LEAD_LINKED_CONVERSATION_ID", "INBOX_E2E_A_OPEN_CONVERSATION_ID", "INBOX_E2E_A_TAKE_CONTROL_CONVERSATION_ID", "INBOX_E2E_B_CONVERSATION_ID"]);
    expect(new Set(plans.map((plan) => plan.externalId)).size).toBe(plans.length);
  });
  it("keeps the closed-window fixture past its 24h window and the others inside it", () => {
    const now = new Date("2026-09-26T12:00:00Z");
    expect(new Date(inboxLr2FixtureWindowTimes(inboxLr2FixtureConversations.CLOSED_WINDOW.windowHours, now).serviceWindowExpiresAt) < now).toBe(true);
    expect(new Date(inboxLr2FixtureWindowTimes(inboxLr2FixtureConversations.OPEN.windowHours, now).serviceWindowExpiresAt) > now).toBe(true);
  });
});
