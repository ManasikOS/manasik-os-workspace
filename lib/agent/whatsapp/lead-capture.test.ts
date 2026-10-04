import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getChannelProfile } from "@/lib/channels/profile";
import type { ChannelProvider } from "@/lib/inbox/contracts";
import { fakeSupabase, opsOn, type FakeOperation } from "@/lib/test-utils/fake-supabase";

const { ensureLeadForConversation, mobileForConversation } = await import("./lead-capture");

const EXISTING = { id: "lead-existing", reference: "LD-2026-0007", full_name: "Placeholder", mobile: "", stage: "NEW_LEAD" };

interface Scenario {
  channel: ChannelProvider;
  conversation: { lead_id: string | null; contact_phone: string };
  /** What a lookup of an existing lead returns. */
  existingLead?: typeof EXISTING | null;
}

function run(scenario: Scenario) {
  const created: Array<Record<string, unknown>> = [];
  const { db, operations } = fakeSupabase((op: FakeOperation) => {
    if (op.table === "conversations" && op.action === "select") {
      return {
        data: {
          ...scenario.conversation,
          attributed_campaign_id: null,
          attribution_channel: null,
          attribution_tracking_code: null,
          attribution_source_detail: null,
          attribution_confidence: null,
        },
        error: null,
      };
    }
    if (op.table === "leads" && op.action === "select") {
      if (op.filters.some(([key]) => key === "like:reference")) return { data: [], error: null };
      return { data: scenario.existingLead ?? null, error: null };
    }
    if (op.table === "leads" && op.action === "insert") {
      created.push(op.payload as Record<string, unknown>);
      return { data: { id: "lead-new", reference: "LD-2026-0001", full_name: "x", mobile: (op.payload as { mobile: string }).mobile, stage: "NEW_LEAD" }, error: null };
    }
    if (op.table === "ai_settings") return { data: { default_lead_owner_id: null }, error: null };
    if (op.table === "staff_profiles") return { data: { id: "staff-1", full_name: "Sam" }, error: null };
    return undefined;
  });
  const ctx = {
    db,
    agencyId: "agency-1",
    conversationId: "conv-1",
    leadId: null,
    channel: scenario.channel,
    profile: getChannelProfile(scenario.channel as "WHATSAPP" | "MESSENGER" | "INSTAGRAM"),
    locale: "en",
  };
  return { ctx, operations, created, ensure: () => ensureLeadForConversation(ctx as never, { fullName: "Aisha" }) };
}

const mobileLookups = (operations: FakeOperation[]) =>
  opsOn(operations, "leads", "select").filter((op) => op.filters.some(([key]) => key === "eq:mobile"));

describe("mobileForConversation", () => {
  it("is the normalised number on WhatsApp, where the conversation id is the phone", () => {
    expect(mobileForConversation({ identifiesByPhone: true }, "94771234567")).toBe("771234567");
  });

  it("is null on a channel with no phone number, whatever is in contact_phone", () => {
    expect(mobileForConversation({ identifiesByPhone: false }, "")).toBeNull();
    expect(mobileForConversation({ identifiesByPhone: false }, "94771234567")).toBeNull();
  });

  it("is null for an unusable WhatsApp value rather than an empty string", () => {
    expect(mobileForConversation({ identifiesByPhone: true }, "")).toBeNull();
  });
});

describe("ensureLeadForConversation — phone-less channels (the cross-customer bug)", () => {
  it("returns the lead already linked to the conversation and never searches by mobile", async () => {
    const { ensure, operations, created } = run({
      channel: "MESSENGER",
      conversation: { lead_id: "lead-existing", contact_phone: "" },
      existingLead: EXISTING,
    });
    const result = await ensure();

    expect(result).toEqual({ created: false, lead: EXISTING });
    expect(created).toEqual([]);
    // A lookup by mobile '' would match ANY other phone-less customer's placeholder lead.
    expect(mobileLookups(operations)).toEqual([]);
    const byId = opsOn(operations, "leads", "select")[0];
    expect(byId.filters).toContainEqual(["eq:id", "lead-existing"]);
    expect(byId.filters).toContainEqual(["eq:agency_id", "agency-1"]);
  });

  it("creates a lead with an empty mobile and the channel's own source and preferred channel", async () => {
    for (const [channel, source, preferred] of [
      ["MESSENGER", "FACEBOOK", "MESSENGER"],
      ["INSTAGRAM", "INSTAGRAM", "INSTAGRAM"],
    ] as const) {
      const { ensure, operations, created } = run({ channel, conversation: { lead_id: null, contact_phone: "" } });
      const result = await ensure();

      expect(result.created).toBe(true);
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ agency_id: "agency-1", full_name: "Aisha", mobile: "", source, preferred_channel: preferred });
      expect(mobileLookups(operations)).toEqual([]);
    }
  });

  it("does not write the channel id, or the conversation's contact_phone, into mobile", async () => {
    const { ensure, created } = run({ channel: "INSTAGRAM", conversation: { lead_id: null, contact_phone: "1784000000000001" } });
    await ensure();
    expect(created[0].mobile).toBe("");
  });

  it("records the channel by name in the activity feed", async () => {
    const { ensure, operations } = run({ channel: "MESSENGER", conversation: { lead_id: null, contact_phone: "" } });
    await ensure();
    const activity = opsOn(operations, "lead_activity", "insert")[0].payload as Array<{ message: string }>;
    expect(activity[0].message).toBe("Lead captured by Manasik Copilot on Messenger.");
  });
});

describe("ensureLeadForConversation — WhatsApp is unchanged", () => {
  it("looks the lead up by the normalised number, as it always has", async () => {
    const { ensure, operations } = run({
      channel: "WHATSAPP",
      conversation: { lead_id: null, contact_phone: "94771234567" },
      existingLead: { ...EXISTING, mobile: "771234567" },
    });
    const result = await ensure();
    expect(result.created).toBe(false);
    expect(mobileLookups(operations)[0].filters).toContainEqual(["eq:mobile", "771234567"]);
  });

  it("creates a WhatsApp lead with the customer's number, source and preferred channel", async () => {
    const { ensure, created } = run({ channel: "WHATSAPP", conversation: { lead_id: null, contact_phone: "94771234567" } });
    await ensure();
    expect(created[0]).toMatchObject({ mobile: "771234567", source: "WHATSAPP", preferred_channel: "WHATSAPP" });
  });
});
