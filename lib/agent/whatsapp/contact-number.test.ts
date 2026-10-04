import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getChannelProfile } from "@/lib/channels/profile";
import { fakeSupabase, opsOn, type FakeOperation } from "@/lib/test-utils/fake-supabase";

const { captureContactNumber, normaliseTypedNumber, resolveBookingContactPhone } = await import("./contact-number");

interface World {
  /** The lead linked to the conversation; null = none. */
  conversationLeadId?: string | null;
  leadMobile?: string;
  leadExists?: boolean;
  /** Other leads that already hold the typed number. */
  otherLeads?: Array<{ id: string; reference: string }>;
  identityId?: string | null;
}

function setup(world: World, channel: "MESSENGER" | "INSTAGRAM" | "WHATSAPP" = "MESSENGER") {
  const { db, operations } = fakeSupabase((op: FakeOperation) => {
    if (op.table === "conversations" && op.action === "select") {
      const leadId = world.conversationLeadId === undefined ? "lead-1" : world.conversationLeadId;
      return { data: { lead_id: leadId, external_conversation_id: "psid-9" }, error: null };
    }
    if (op.table === "leads" && op.action === "select") {
      // The "other leads holding this number" query is the only one that filters on mobile.
      if (op.filters.some(([key]) => key === "eq:mobile")) return { data: world.otherLeads ?? [], error: null };
      return world.leadExists === false ? { data: null, error: null } : { data: { id: "lead-1", mobile: world.leadMobile ?? "" }, error: null };
    }
    if (op.table === "contact_identities" && op.action === "select") {
      return { data: world.identityId === null ? null : { id: world.identityId ?? "ident-1" }, error: null };
    }
    return undefined;
  });
  const ctx = {
    db,
    agencyId: "agency-1",
    conversationId: "conv-1",
    channel,
    profile: getChannelProfile(channel),
  };
  return { ctx, operations };
}

describe("normaliseTypedNumber", () => {
  it("accepts the ways a Sri Lankan number is typed", () => {
    for (const typed of ["077 123 4567", "+94 77 123 4567", "0094771234567", "94771234567", "771234567"]) {
      expect(normaliseTypedNumber(typed)).toBe("771234567");
    }
  });

  it("refuses a foreign number: the CRM would show and dial it as +94 followed by its digits", () => {
    for (const typed of ["+44 7911 123456", "+971 50 123 4567", "+1 415 555 2671"]) expect(normaliseTypedNumber(typed)).toBeNull();
  });

  it("rejects too few or too many digits and non-numbers", () => {
    for (const typed of ["", "hello", "12345", "077 12", "0771234567890"]) expect(normaliseTypedNumber(typed)).toBeNull();
  });
});

describe("captureContactNumber", () => {
  it("has nothing to do on WhatsApp, where the conversation id is the number", async () => {
    const { ctx, operations } = setup({}, "WHATSAPP");
    await expect(captureContactNumber(ctx, { phone: "0771234567" })).resolves.toEqual({ ok: false, reason: "NOT_NEEDED" });
    expect(operations).toEqual([]);
  });

  it("asks again for a number that is not a full number, touching nothing", async () => {
    const { ctx, operations } = setup({});
    await expect(captureContactNumber(ctx, { phone: "12345" })).resolves.toEqual({ ok: false, reason: "INVALID_NUMBER" });
    expect(operations).toEqual([]);
  });

  it("needs a lead first", async () => {
    const { ctx } = setup({ conversationLeadId: null });
    await expect(captureContactNumber(ctx, { phone: "0771234567" })).resolves.toEqual({ ok: false, reason: "NO_LEAD" });
    const gone = setup({ leadExists: false });
    await expect(captureContactNumber(gone.ctx, { phone: "0771234567" })).resolves.toEqual({ ok: false, reason: "NO_LEAD" });
  });

  it("never overwrites a number the lead already has", async () => {
    const { ctx, operations } = setup({ leadMobile: "770000000" });
    await expect(captureContactNumber(ctx, { phone: "0771234567" })).resolves.toEqual({ ok: true, outcome: "ALREADY_KNOWN" });
    expect(opsOn(operations, "leads", "update")).toEqual([]);
  });

  it("saves a number nobody else holds on THIS customer's lead and identity, as unverified", async () => {
    const { ctx, operations } = setup({ otherLeads: [] });
    await expect(captureContactNumber(ctx, { phone: "+94 77 123 4567" })).resolves.toEqual({ ok: true, outcome: "RECORDED" });

    const leadUpdate = opsOn(operations, "leads", "update")[0];
    expect(leadUpdate.payload).toEqual({ mobile: "771234567" });
    expect(leadUpdate.filters).toContainEqual(["eq:id", "lead-1"]);
    expect(leadUpdate.filters).toContainEqual(["eq:agency_id", "agency-1"]);
    expect(leadUpdate.filters).toContainEqual(["eq:mobile", ""]); // compare-and-set: a concurrent save wins

    expect(opsOn(operations, "contact_identities", "update")[0].payload).toEqual({ normalized_phone: "771234567" });
    const note = opsOn(operations, "lead_notes", "insert")[0].payload as { body: string; lead_id: string };
    expect(note.lead_id).toBe("lead-1");
    expect(note.body).toContain("not verified");
    expect(opsOn(operations, "identity_match_events")).toEqual([]);
  });

  it("does NOT merge or attach when the number already belongs to another lead — it flags staff instead", async () => {
    const { ctx, operations } = setup({ otherLeads: [{ id: "lead-other", reference: "LD-2026-0042" }] });
    await expect(captureContactNumber(ctx, { phone: "0771234567" })).resolves.toEqual({ ok: true, outcome: "NEEDS_STAFF_CONFIRMATION" });

    // The conversation stays on its own lead; the number is not saved anywhere.
    expect(opsOn(operations, "leads", "update")).toEqual([]);
    expect(opsOn(operations, "contact_identities", "update")).toEqual([]);
    expect(opsOn(operations, "conversations", "update")).toEqual([]);

    const note = opsOn(operations, "lead_notes", "insert")[0].payload as { body: string };
    expect(note.body).toContain("LD-2026-0042");
    expect(note.body).toContain("Nothing was merged");

    const event = opsOn(operations, "identity_match_events", "insert")[0].payload as { action: string; evidence: Record<string, unknown> };
    expect(event.action).toBe("AMBIGUOUS");
    expect(event.evidence).toMatchObject({ reason: "TYPED_PHONE_MATCHES_EXISTING_LEAD", matched_lead_ids: ["lead-other"] });
  });

  it("says only that several leads match when more than one does, and still merges nothing", async () => {
    const { ctx, operations } = setup({
      otherLeads: [
        { id: "a", reference: "LD-1" },
        { id: "b", reference: "LD-2" },
      ],
    });
    await captureContactNumber(ctx, { phone: "0771234567" });
    const note = opsOn(operations, "lead_notes", "insert")[0].payload as { body: string };
    expect(note.body).toContain("more than one existing lead");
    expect(opsOn(operations, "leads", "update")).toEqual([]);
  });

  it("still records the number when the customer has no contact identity row yet", async () => {
    const { ctx, operations } = setup({ identityId: null });
    await expect(captureContactNumber(ctx, { phone: "0771234567" })).resolves.toEqual({ ok: true, outcome: "RECORDED" });
    expect(opsOn(operations, "contact_identities", "update")).toEqual([]);
  });

  it("searches only within the agency, so another agency's leads can never match", async () => {
    const { ctx, operations } = setup({});
    await captureContactNumber(ctx, { phone: "0771234567" });
    const search = opsOn(operations, "leads", "select").find((op) => op.filters.some(([key]) => key === "eq:mobile"))!;
    expect(search.filters).toContainEqual(["eq:agency_id", "agency-1"]);
    expect(search.filters).toContainEqual(["neq:id", "lead-1"]);
  });
});

describe("resolveBookingContactPhone", () => {
  const withLeadMobile = (mobile: string | null) => {
    const { db } = fakeSupabase((op) => (op.table === "leads" ? { data: mobile === null ? null : { mobile }, error: null } : undefined));
    return { db, agencyId: "agency-1" };
  };

  it("prefers the traveller's own number, then the conversation's", async () => {
    expect(await resolveBookingContactPhone(withLeadMobile("771111111"), { travellerPhone: " 0772222222 ", conversationPhone: "94773333333", leadId: "l" })).toBe("0772222222");
    expect(await resolveBookingContactPhone(withLeadMobile("771111111"), { conversationPhone: "94773333333", leadId: "l" })).toBe("94773333333");
  });

  it("falls back to the lead's saved number on a channel with no phone of its own", async () => {
    expect(await resolveBookingContactPhone(withLeadMobile("771111111"), { conversationPhone: "", leadId: "l" })).toBe("771111111");
  });

  it("is empty — so the booking tool refuses — when nobody has given a number", async () => {
    expect(await resolveBookingContactPhone(withLeadMobile(""), { conversationPhone: "", leadId: "l" })).toBe("");
    expect(await resolveBookingContactPhone(withLeadMobile(null), { leadId: "l" })).toBe("");
    expect(await resolveBookingContactPhone(withLeadMobile("771111111"), { conversationPhone: "" })).toBe("");
  });
});
