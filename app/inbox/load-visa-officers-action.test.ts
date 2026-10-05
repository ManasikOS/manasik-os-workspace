import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BUG-10 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): the visa-officer list took the first 100 active staff by name and only
 * then kept the ones with a visa role, so in a large agency an officer whose name sorted late never appeared. The role filter now runs in
 * the query, before the limit.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const role = { value: "ADMIN" as string };

vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: ACTOR }) }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => ({ role: role.value, agencyId: AGENCY, staffId: ACTOR, name: "Test Actor" }), createGroupBooking: vi.fn() }));
vi.mock("@/lib/data/leads", () => ({ markLeadBookedInStore: vi.fn(), pricePerPerson: vi.fn(), selectDepartureGroupInStore: vi.fn(), setFollowUpInStore: vi.fn() }));
vi.mock("@/lib/data/leads-repository", () => ({ loadLeadStore: vi.fn(), changeOneLead: vi.fn(), persistLeadStore: vi.fn(), snapshotLeadStore: vi.fn() }));
vi.mock("@/lib/whatsapp/send-template-message", () => ({ sendApprovedTemplate: vi.fn() }));
vi.mock("@/lib/inbox/outbox/drain", () => ({ processDueInboxOutbox: vi.fn(async () => undefined) }));
vi.mock("@/lib/channels/profile", () => ({ getChannelProfile: () => ({ displayName: "WhatsApp" }) }));
vi.mock("@/lib/channels/registry", () => ({ hasChannelAdapter: () => true }));
vi.mock("@/lib/inbox/lead-linking", () => ({ linkConversationToLead: vi.fn() }));
vi.mock("@/lib/inbox/conversation-booking", () => ({ deriveBookingFromLead: vi.fn() }));
vi.mock("@/lib/inbox/reply-context", () => ({ loadReplyContextPack: vi.fn() }));
vi.mock("@/lib/ai/surfaces/inbox/workflows", () => ({ suggestConversationReply: vi.fn() }));
vi.mock("@/lib/ai/trust/consent-gate", () => ({ checkConsent: vi.fn() }));
vi.mock("@/lib/agent/whatsapp/phone", () => ({ waIdToMobile: vi.fn() }));
vi.mock("@/lib/copilot/sales/knowledge-context", () => ({ loadCopilotKnowledgeContext: vi.fn() }));
vi.mock("@/lib/data/inbox-offer-repository", () => ({ checkStoredOffer: vi.fn() }));
vi.mock("@/lib/data/identity-graph-repository", () => ({ confirmIdentityLink: vi.fn(), rejectIdentityLinks: vi.fn(), unlinkIdentityLink: vi.fn() }));
vi.mock("@/app/(main)/leads/copilot-actions", () => ({ saveQuoteDraftAction: vi.fn() }));
vi.mock("@/lib/data/inbox-risk-repository", () => ({ loadProtectionContext: vi.fn() }));
vi.mock("@/lib/data/inbox-composer-presence-repository", () => ({ claimComposerPresence: vi.fn(), releaseComposerPresence: vi.fn(), syncConcurrentComposerSignal: vi.fn() }));
vi.mock("@/lib/data/conversation-handoff-repository", () => ({
  acknowledgeConversationHandoff: vi.fn(),
  buildHandoffForConversation: vi.fn(),
  createConversationHandoff: vi.fn(),
  loadConversationHandoff: vi.fn(async () => null),
  attachHandoffNarration: vi.fn(),
  handoffNeedsNarration: () => false,
}));
vi.mock("@/lib/data/staff-notifications", () => ({
  notifyConversationWaiting: vi.fn(async () => ({ ok: true, notified: 1 })),
  notifyWorkflowCreated: vi.fn(async () => undefined),
  listActiveStaffIdsByRole: async () => [],
}));
vi.mock("@/lib/ai/surfaces/inbox/handoff-narrate", () => ({ narrateHandoffExpectations: vi.fn() }));
vi.mock("@/lib/data/conversation-intelligence-repository", () => ({
  loadIntelligence: vi.fn(),
  listInterventions: vi.fn(),
  acknowledgeIntervention: vi.fn(async () => ({})),
  resolveIntervention: vi.fn(async () => ({})),
}));
vi.mock("@/lib/inbox/attachments/staged-file", () => ({ verifyStagedAttachment: vi.fn(), createStaffAttachmentUpload: vi.fn() }));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => ({}) }));

type Staff = { id: string; full_name: string | null; role: string; status: string };
let staff: Staff[] = [];
let readFails = false;
const calls: Array<{ method: string; args: unknown[] }> = [];

vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: () => {
      const filters: Record<string, unknown> = {};
      let inRoles: string[] | null = null;
      let limit = Infinity;
      const query: Record<string, unknown> = {};
      query.select = (...args: unknown[]) => (calls.push({ method: "select", args }), query);
      query.eq = (column: string, value: unknown) => ((filters[column] = value), calls.push({ method: "eq", args: [column, value] }), query);
      query.in = (column: string, values: string[]) => ((inRoles = column === "role" ? values : null), calls.push({ method: "in", args: [column, values] }), query);
      query.order = (...args: unknown[]) => (calls.push({ method: "order", args }), query);
      query.limit = (count: number) => ((limit = count), calls.push({ method: "limit", args: [count] }), query);
      query.then = (resolve: (value: unknown) => unknown) => {
        if (readFails) return resolve({ data: null, error: { message: "boom" } });
        // Like the database: filter first, then order, then limit.
        const rows = staff
          .filter((row) => row.status === filters.status && (inRoles === null || inRoles.includes(row.role)))
          .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""))
          .slice(0, limit);
        return resolve({ data: rows, error: null });
      };
      return query;
    },
  }),
}));

const { loadVisaOfficersAction } = await import("./actions");

const member = (id: string, name: string, memberRole: string, status = "ACTIVE"): Staff => ({ id, full_name: name, role: memberRole, status });

beforeEach(() => {
  role.value = "ADMIN";
  staff = [];
  readFails = false;
  calls.length = 0;
});

describe("loadVisaOfficersAction", () => {
  it("BUG-10: still lists a visa officer whose name sorts after 100 other active staff", async () => {
    staff = [...Array.from({ length: 120 }, (_, index) => member(`guide-${index}`, `Aaron ${String(index).padStart(3, "0")}`, "GUIDE")), member("officer-late", "Zainab", "VISA")];
    const result = await loadVisaOfficersAction();
    expect(result).toEqual({ ok: true, officers: [{ id: "officer-late", name: "Zainab" }] });
  });

  it("asks the database for the visa roles and active staff of this agency only, before it limits", async () => {
    await loadVisaOfficersAction();
    expect(calls).toContainEqual({ method: "eq", args: ["agency_id", AGENCY] });
    expect(calls).toContainEqual({ method: "eq", args: ["status", "ACTIVE"] });
    const roleFilter = calls.find((call) => call.method === "in");
    expect((roleFilter?.args[1] as string[]).slice().sort()).toEqual(["ADMIN", "OPERATIONS", "VISA"]);
    expect(calls.map((call) => call.method).indexOf("in")).toBeLessThan(calls.map((call) => call.method).indexOf("limit"));
  });

  it("leaves out inactive staff and roles that cannot do visa work, and names a nameless officer 'Staff'", async () => {
    staff = [member("a", "Amina", "VISA"), member("b", "Bilal", "VISA", "SUSPENDED"), member("c", "Chandra", "FINANCE"), { id: "d", full_name: null, role: "OPERATIONS", status: "ACTIVE" }];
    const result = await loadVisaOfficersAction();
    expect(result).toEqual({ ok: true, officers: [{ id: "d", name: "Staff" }, { id: "a", name: "Amina" }] });
  });

  it("refuses a role that cannot assign visa officers, before reading anything", async () => {
    role.value = "FINANCE";
    expect(await loadVisaOfficersAction()).toEqual({ ok: false, error: "Your role cannot assign visa officers." });
    expect(calls).toEqual([]);
  });

  it("reports a failed read instead of an empty list", async () => {
    readFails = true;
    expect(await loadVisaOfficersAction()).toMatchObject({ ok: false });
  });
});
