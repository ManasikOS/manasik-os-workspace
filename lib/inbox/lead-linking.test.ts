import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agent/whatsapp/phone", () => ({ waIdToMobile: (id: string) => id.replace(/^94/, "") }));
vi.mock("@/lib/date", () => ({ colomboDayKey: () => "2026-09-27" }));

const ensureSubjectIdentity = vi.fn();
const lookUpGraph = vi.fn();
const recordProposals = vi.fn();
vi.mock("@/lib/data/identity-graph-repository", () => ({
  ensureSubjectIdentity: (...args: unknown[]) => ensureSubjectIdentity(...args),
  lookUpGraph: (...args: unknown[]) => lookUpGraph(...args),
  recordProposals: (...args: unknown[]) => recordProposals(...args),
}));

const { linkConversationToLead } = await import("./lead-linking");

const AGENCY = "0b8e7c3a-1f4d-4e6a-9d2b-7a1c5e3f9b10";
const CONVERSATION = "5d2f9a41-8c7e-4b3a-a6d1-2e9f0c7b4a83";
const LEAD = { id: "lead-1", reference: "LD-2026-0001", full_name: "Aisha Perera", mobile: "771234567", stage: "NEW_LEAD" };
const OWNER = { id: "staff-1", name: "Nimal Fernando" };

type Call = { table: string; op: "select" | "update" | "upsert" | "insert" | "delete"; values?: Record<string, unknown> | Array<Record<string, unknown>>; options?: unknown; filters: Array<[string, string, unknown]>; limit?: number };
type Reply = { data?: unknown; error?: { message: string } | null };

interface World {
  conversation: { lead_id: string | null } | null;
  leadsById: Record<string, typeof LEAD>;
  identityLeadId: string | null;
  phoneLeads: Array<typeof LEAD>;
  references: string[];
  configuredOwnerId: string | null;
  staffById: Record<string, { id: string; full_name: string }>;
  staffByRole: Record<string, { id: string; full_name: string } | null>;
  errors: Record<string, string>;
}

const calls: Call[] = [];
let world: World;

const freshWorld = (): World => ({
  conversation: { lead_id: null },
  leadsById: { [LEAD.id]: LEAD },
  identityLeadId: null,
  phoneLeads: [],
  references: [],
  configuredOwnerId: null,
  staffById: {},
  staffByRole: { MARKETING: { id: "staff-1", full_name: "Nimal Fernando" }, ADMIN: null },
  errors: {},
});

function respond(call: Call): Reply {
  const key = `${call.table}.${call.op}`;
  if (world.errors[key]) return { error: { message: world.errors[key] } };
  const filter = (column: string) => call.filters.find(([, name]) => name === column)?.[2];
  switch (key) {
    case "conversations.select":
      return { data: world.conversation };
    case "leads.select":
      if (filter("id")) return { data: world.leadsById[String(filter("id"))] ?? null };
      if (filter("mobile")) return { data: world.phoneLeads };
      return { data: world.references.map((reference) => ({ reference })) };
    case "contact_identities.select":
      return { data: world.identityLeadId ? { lead_id: world.identityLeadId } : null };
    case "ai_settings.select":
      return { data: { default_lead_owner_id: world.configuredOwnerId } };
    case "staff_profiles.select":
      if (filter("id")) return { data: world.staffById[String(filter("id"))] ?? null };
      return { data: world.staffByRole[String(filter("role"))] ?? null };
    case "contact_identities.upsert":
      return { data: { id: "identity-1" } };
    case "leads.insert": {
      const values = call.values as Record<string, unknown>;
      return { data: { id: "lead-new", reference: values.reference, full_name: values.full_name, mobile: values.mobile, stage: "NEW_LEAD" } };
    }
    default:
      return {};
  }
}

const db = {
  from(table: string) {
    const call: Call = { table, op: "select", filters: [] };
    calls.push(call);
    const settle = () => {
      const reply = respond(call);
      return { data: reply.data ?? null, error: reply.error ?? null };
    };
    const query: Record<string, unknown> = {
      select: () => query,
      update: (values: Call["values"]) => Object.assign(call, { op: "update", values }) && query,
      upsert: (values: Call["values"], options: unknown) => Object.assign(call, { op: "upsert", values, options }) && query,
      insert: (values: Call["values"]) => Object.assign(call, { op: "insert", values }) && query,
      delete: () => Object.assign(call, { op: "delete" }) && query,
      eq: (column: string, value: unknown) => call.filters.push(["eq", column, value]) && query,
      not: (column: string, _operator: string, value: unknown) => call.filters.push(["not", column, value]) && query,
      like: (column: string, value: unknown) => call.filters.push(["like", column, value]) && query,
      order: () => query,
      limit: (count: number) => Object.assign(call, { limit: count }) && query,
      maybeSingle: async () => settle(),
      single: async () => settle(),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(settle()).then(resolve, reject),
    };
    return query;
  },
};

const link = (over: Record<string, unknown> = {}) =>
  linkConversationToLead(db as never, { agencyId: AGENCY, conversationId: CONVERSATION, provider: "WHATSAPP", externalSubjectId: "94771234567", ...over } as never);

const callsTo = (table: string, op?: Call["op"]) => calls.filter((call) => call.table === table && (!op || call.op === op));
const writes = () => calls.filter((call) => call.op !== "select");
const hasFilter = (call: Call, column: string, value: unknown) => call.filters.some(([, name, filterValue]) => name === column && filterValue === value);

beforeEach(() => {
  calls.length = 0;
  world = freshWorld();
  ensureSubjectIdentity.mockReset().mockResolvedValue("subject-1");
  lookUpGraph.mockReset().mockResolvedValue({ graph: { exact: [], proposals: [] }, candidates: [], leads: new Map() });
  recordProposals.mockReset().mockResolvedValue(0);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("linkConversationToLead: finding the conversation", () => {
  it("refuses a conversation that is not in this agency", async () => {
    world.conversation = null;

    await expect(link()).rejects.toThrow("Conversation was not found for this agency.");
    expect(writes()).toEqual([]);
  });

  it("refuses when the conversation cannot be read", async () => {
    world.errors["conversations.select"] = "connection reset";

    await expect(link()).rejects.toThrow("Conversation was not found for this agency.");
  });

  it("reads the conversation by id and agency together", async () => {
    await link();

    const read = callsTo("conversations", "select")[0];
    expect(hasFilter(read, "id", CONVERSATION)).toBe(true);
    expect(hasFilter(read, "agency_id", AGENCY)).toBe(true);
  });
});

describe("linkConversationToLead: a conversation that already has a lead", () => {
  beforeEach(() => {
    world.conversation = { lead_id: "lead-1" };
  });

  it("returns that lead and writes nothing", async () => {
    const result = await link({ createIfMissing: true });

    expect(result).toEqual({ lead: LEAD, source: "EXISTING_CONVERSATION" });
    expect(writes()).toEqual([]);
  });

  it("does not look for another match", async () => {
    await link({ createIfMissing: true });

    expect(callsTo("contact_identities")).toEqual([]);
    expect(ensureSubjectIdentity).not.toHaveBeenCalled();
  });

  it("reads the lead within this agency only", async () => {
    await link();

    const leadRead = callsTo("leads", "select")[0];
    expect(hasFilter(leadRead, "id", "lead-1")).toBe(true);
    expect(hasFilter(leadRead, "agency_id", AGENCY)).toBe(true);
  });

  it("treats a lead that no longer exists as no lead, and matches again from the provider identity", async () => {
    world.conversation = { lead_id: "deleted-lead" };
    world.identityLeadId = "lead-1";

    const result = await link();

    expect(result).toEqual({ lead: LEAD, source: "EXACT_IDENTITY" });
  });
});

describe("linkConversationToLead: a known provider identity", () => {
  beforeEach(() => {
    world.identityLeadId = "lead-1";
  });

  it("links to the identity's lead, and does not search by phone", async () => {
    const result = await link();

    expect(result).toEqual({ lead: LEAD, source: "EXACT_IDENTITY" });
    expect(callsTo("leads", "select").some((call) => hasFilter(call, "mobile", "771234567"))).toBe(false);
  });

  it("puts the lead on the conversation, scoped to this conversation and agency", async () => {
    await link();

    const update = callsTo("conversations", "update")[0];
    expect(update.values).toEqual({ lead_id: "lead-1" });
    expect(hasFilter(update, "id", CONVERSATION)).toBe(true);
    expect(hasFilter(update, "agency_id", AGENCY)).toBe(true);
  });

  it("saves the identity as an exact match, with the phone the subject id implies", async () => {
    await link();

    const upsert = callsTo("contact_identities", "upsert")[0];
    expect(upsert.values).toMatchObject({ agency_id: AGENCY, provider: "WHATSAPP", external_subject_id: "94771234567", normalized_phone: "771234567", lead_id: "lead-1", match_confidence: "EXACT_IDENTITY" });
    expect(upsert.options).toEqual({ onConflict: "agency_id,provider,external_subject_id" });
  });

  it("records the link in the match history", async () => {
    await link();

    expect(callsTo("identity_match_events", "insert")[0].values).toMatchObject({
      agency_id: AGENCY,
      contact_identity_id: "identity-1",
      action: "LINKED",
      next_lead_id: "lead-1",
      confidence: "EXACT_IDENTITY",
      evidence: { provider: "WHATSAPP", external_subject_id: "94771234567" },
    });
  });

  it("ignores an identity whose lead is not in this agency, and does not link", async () => {
    world.leadsById = {};

    const result = await link();

    expect(result).toEqual({ lead: null, source: "AMBIGUOUS" });
    expect(writes()).toEqual([]);
  });
});

describe("linkConversationToLead: matching by phone", () => {
  it("uses the number implied by a WhatsApp subject id when none was given", async () => {
    await link();

    expect(callsTo("leads", "select").some((call) => hasFilter(call, "mobile", "771234567"))).toBe(true);
  });

  it("prefers a phone number that was given over the one implied by the subject id", async () => {
    await link({ normalizedPhone: "779999999" });

    expect(callsTo("leads", "select").some((call) => hasFilter(call, "mobile", "779999999"))).toBe(true);
    expect(callsTo("leads", "select").some((call) => hasFilter(call, "mobile", "771234567"))).toBe(false);
  });

  it("does not invent a number for a channel that has none", async () => {
    await link({ provider: "INSTAGRAM", externalSubjectId: "ig-123" });

    expect(callsTo("leads", "select").some((call) => call.filters.some(([, name]) => name === "mobile"))).toBe(false);
  });

  it("links to a single phone match as a verified contact, and remembers the number", async () => {
    world.phoneLeads = [LEAD];

    const result = await link();

    expect(result).toEqual({ lead: LEAD, source: "EXACT_PHONE" });
    expect(callsTo("contact_identities", "upsert")[0].values).toMatchObject({ match_confidence: "VERIFIED_CONTACT", normalized_phone: "771234567", lead_id: "lead-1" });
    expect(callsTo("identity_match_events", "insert")[0].values).toMatchObject({ confidence: "VERIFIED_CONTACT" });
  });

  it("asks for at most two candidates, in this agency, because two already means a person must decide", async () => {
    await link();

    const search = callsTo("leads", "select").find((call) => hasFilter(call, "mobile", "771234567"))!;
    expect(search.limit).toBe(2);
    expect(hasFilter(search, "agency_id", AGENCY)).toBe(true);
  });

  it("leaves two matching leads unlinked, and changes nothing", async () => {
    world.phoneLeads = [LEAD, { ...LEAD, id: "lead-2", reference: "LD-2026-0002" }];

    const result = await link({ createIfMissing: true });

    expect(result).toEqual({ lead: null, source: "AMBIGUOUS" });
    expect(writes()).toEqual([]);
  });

  it("fails loudly when the lead search itself fails, rather than creating a duplicate", async () => {
    world.errors["leads.select"] = "timeout";

    await expect(link({ createIfMissing: true })).rejects.toThrow("Could not search existing leads: timeout");
    expect(callsTo("leads", "insert")).toEqual([]);
  });
});

describe("linkConversationToLead: nothing matches", () => {
  it("leaves the conversation unlinked, and does not consult the identity graph, unless creating was asked for", async () => {
    const result = await link();

    expect(result).toEqual({ lead: null, source: "AMBIGUOUS" });
    expect(ensureSubjectIdentity).not.toHaveBeenCalled();
    expect(lookUpGraph).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it("asks the graph about this contact, with everything known about them, before creating anything", async () => {
    await link({ createIfMissing: true, displayName: "Aisha", email: "a@b.com", messageText: "Assalamu alaikum" });

    expect(ensureSubjectIdentity).toHaveBeenCalledWith(db, expect.objectContaining({ agencyId: AGENCY, provider: "WHATSAPP", externalSubjectId: "94771234567", displayName: "Aisha", normalizedPhone: "771234567" }));
    expect(lookUpGraph).toHaveBeenCalledWith(db, expect.objectContaining({ agencyId: AGENCY, subjectIdentityId: "subject-1", subject: { displayName: "Aisha", phone: "771234567", email: "a@b.com", messageText: "Assalamu alaikum" } }));
  });

  it("links to the graph's single exact match instead of creating a duplicate", async () => {
    lookUpGraph.mockResolvedValue({ graph: { exact: [LEAD], proposals: [] }, candidates: [], leads: new Map() });

    const result = await link({ createIfMissing: true });

    expect(result).toEqual({ lead: LEAD, source: "EXACT_IDENTITY" });
    expect(callsTo("leads", "insert")).toEqual([]);
  });

  it("only proposes a lookalike, records just the ones a person must confirm, and links nothing", async () => {
    const needsPerson = { id: "c1", autoConfirm: false };
    const autoConfirmed = { id: "c2", autoConfirm: true };
    lookUpGraph.mockResolvedValue({ graph: { exact: [], proposals: [LEAD] }, candidates: [needsPerson, autoConfirmed], leads: new Map() });

    const result = await link({ createIfMissing: true });

    expect(result).toEqual({ lead: null, source: "PROPOSED" });
    expect(recordProposals).toHaveBeenCalledWith(db, { agencyId: AGENCY, subjectIdentityId: "subject-1", candidates: [needsPerson] });
    expect(writes()).toEqual([]);
  });

  it("carries on and creates the lead when the graph lookup fails, and says so in the log", async () => {
    lookUpGraph.mockRejectedValue(new Error("graph unavailable"));

    const result = await link({ createIfMissing: true, displayName: "Aisha" });

    expect(result.source).toBe("CREATED");
    expect(console.error).toHaveBeenCalledWith("Identity graph lookup failed; continuing without it:", "graph unavailable");
  });
});

describe("linkConversationToLead: creating a lead", () => {
  const created = async (over: Record<string, unknown> = {}) => link({ createIfMissing: true, displayName: "Aisha Perera", owner: OWNER, ...over });

  it("creates a new lead, saves the identity, links the conversation, then records the link and the activity, in that order", async () => {
    const result = await created();

    expect(result).toEqual({ lead: { id: "lead-new", reference: "LD-2026-0001", full_name: "Aisha Perera", mobile: "771234567", stage: "NEW_LEAD" }, source: "CREATED" });
    const order = writes().map((call) => `${call.table}.${call.op}`);
    expect(order).toEqual(["leads.insert", "contact_identities.upsert", "conversations.update", "identity_match_events.insert", "lead_activity.insert"]);
    expect(callsTo("contact_identities", "upsert")[0].values).toMatchObject({ match_confidence: "VERIFIED_CONTACT", lead_id: "lead-new" });
  });

  it("starts the lead as a new WhatsApp lead owned by the given staff member", async () => {
    await created();

    expect(callsTo("leads", "insert")[0].values).toMatchObject({
      agency_id: AGENCY,
      stage: "NEW_LEAD",
      journey_type: "UMRAH",
      assigned_to_id: "staff-1",
      assigned_to_name: "Nimal Fernando",
      follow_up_owner_id: "staff-1",
      full_name: "Aisha Perera",
      mobile: "771234567",
      source: "WHATSAPP",
      preferred_channel: "WHATSAPP",
    });
  });

  it("logs the creation and the scheduled follow-up against the new lead", async () => {
    await created({ provider: "INSTAGRAM", externalSubjectId: "ig-1", normalizedPhone: null });

    const activity = callsTo("lead_activity", "insert")[0].values as Array<Record<string, unknown>>;
    expect(activity.map((entry) => entry.type)).toEqual(["CREATED", "FOLLOW_UP_SCHEDULED"]);
    expect(activity[0]).toMatchObject({ agency_id: AGENCY, lead_id: "lead-new", message: "Lead captured from INSTAGRAM Inbox conversation.", actor_name: "Inbox" });
  });

  it("writes a channel's own labels for a lead that came from Instagram, and stores no phone rather than the channel's id", async () => {
    await created({ provider: "INSTAGRAM", externalSubjectId: "ig-1", displayName: "", normalizedPhone: null });

    expect(callsTo("leads", "insert")[0].values).toMatchObject({ source: "INSTAGRAM", preferred_channel: "INSTAGRAM", mobile: "", full_name: "New inbox contact" });
  });

  it.each([
    ["the trimmed display name", "  Aisha Perera  ", "Aisha Perera"],
    ["the phone number when the name is blank", "   ", "+771234567"],
    ["the phone number when there is no name", null, "+771234567"],
  ])("names the lead with %s", async (_label, displayName, expected) => {
    await created({ displayName });

    expect(callsTo("leads", "insert")[0].values).toMatchObject({ full_name: expected });
  });

  it("numbers the lead after the highest reference this year in this agency, ignoring malformed ones", async () => {
    world.references = ["LD-2026-0003", "LD-2026-0007", "LD-2026-abc", "LD-2026-0005"];

    await created();

    expect(callsTo("leads", "insert")[0].values).toMatchObject({ reference: "LD-2026-0008" });
    const search = callsTo("leads", "select").find((call) => call.filters.some(([type]) => type === "like"))!;
    expect(hasFilter(search, "reference", "LD-2026-%")).toBe(true);
    expect(hasFilter(search, "agency_id", AGENCY)).toBe(true);
  });

  it("fails loudly when the reference cannot be allocated, and creates nothing", async () => {
    world.errors["leads.select"] = "boom";

    await expect(created()).rejects.toThrow();
    expect(callsTo("leads", "insert")).toEqual([]);
  });

  it("fails without linking anything when the lead cannot be created", async () => {
    world.errors["leads.insert"] = "duplicate reference";

    await expect(created()).rejects.toThrow("Could not create the inbox lead: duplicate reference");
    expect(callsTo("conversations", "update")).toEqual([]);
  });
});

describe("linkConversationToLead: who owns a new lead", () => {
  const ownerless = () => link({ createIfMissing: true, displayName: "Aisha" });

  it("uses the agency's configured default owner when they are active", async () => {
    world.configuredOwnerId = "staff-9";
    world.staffById = { "staff-9": { id: "staff-9", full_name: "Default Owner" } };

    await ownerless();

    expect(callsTo("leads", "insert")[0].values).toMatchObject({ assigned_to_id: "staff-9", assigned_to_name: "Default Owner" });
    expect(callsTo("staff_profiles").some((call) => hasFilter(call, "status", "ACTIVE"))).toBe(true);
  });

  it("falls back to the first active marketing staff member when the configured owner is inactive or gone", async () => {
    world.configuredOwnerId = "staff-9";
    world.staffById = {};

    await ownerless();

    expect(callsTo("leads", "insert")[0].values).toMatchObject({ assigned_to_id: "staff-1" });
  });

  it("falls back to an admin when there is no marketing staff", async () => {
    world.staffByRole = { MARKETING: null, ADMIN: { id: "admin-1", full_name: "Admin User" } };

    await ownerless();

    expect(callsTo("leads", "insert")[0].values).toMatchObject({ assigned_to_id: "admin-1", assigned_to_name: "Admin User" });
  });

  it("refuses to create a lead that nobody would own, and writes nothing", async () => {
    world.staffByRole = { MARKETING: null, ADMIN: null };

    await expect(ownerless()).rejects.toThrow("No active staff member is available to own this new lead.");
    expect(writes()).toEqual([]);
  });

  it("does not look up an owner when one is given", async () => {
    await link({ createIfMissing: true, owner: OWNER });

    expect(callsTo("ai_settings")).toEqual([]);
    expect(callsTo("staff_profiles")).toEqual([]);
  });
});

describe("linkConversationToLead: when a write fails, nothing is left half-linked", () => {
  beforeEach(() => {
    world.identityLeadId = "lead-1";
  });

  it("saves the identity before it links the conversation, and records the link last", async () => {
    await link();

    expect(writes().map((call) => `${call.table}.${call.op}`)).toEqual(["contact_identities.upsert", "conversations.update", "identity_match_events.insert"]);
  });

  it("leaves the conversation unlinked, with nothing recorded, when the identity cannot be saved", async () => {
    world.errors["contact_identities.upsert"] = "constraint";

    await expect(link()).rejects.toThrow("Could not save this contact identity: constraint");
    expect(callsTo("conversations", "update")).toEqual([]);
    expect(callsTo("identity_match_events", "insert")).toEqual([]);
  });

  it("does not record a link that did not happen when the conversation cannot be linked", async () => {
    world.errors["conversations.update"] = "row locked";

    await expect(link()).rejects.toThrow("Could not link this conversation to its lead: row locked");
    expect(callsTo("identity_match_events", "insert")).toEqual([]);
  });

  it("recovers on the next message: a saved identity with no linked conversation is found and linked", async () => {
    world.errors["conversations.update"] = "row locked";
    await expect(link()).rejects.toThrow();
    calls.length = 0;
    world.errors = {};
    world.conversation = { lead_id: null };

    const result = await link();

    expect(result).toEqual({ lead: LEAD, source: "EXACT_IDENTITY" });
    expect(callsTo("conversations", "update")[0].values).toEqual({ lead_id: "lead-1" });
  });

  it("saves the identity with the same key each time, so the retry overwrites it instead of duplicating it", async () => {
    await link();

    expect(callsTo("contact_identities", "upsert")[0].options).toEqual({ onConflict: "agency_id,provider,external_subject_id" });
  });
});

describe("linkConversationToLead: a failed history or activity write is reported, never silent, and never undoes the link", () => {
  it("logs a failed match-history write and still returns the link", async () => {
    world.identityLeadId = "lead-1";
    world.errors["identity_match_events.insert"] = "history table unavailable";

    const result = await link();

    expect(result).toEqual({ lead: LEAD, source: "EXACT_IDENTITY" });
    expect(console.error).toHaveBeenCalledWith("Could not record the identity match history:", "history table unavailable");
  });

  it("leaves the conversation linked when the match-history write fails", async () => {
    world.identityLeadId = "lead-1";
    world.errors["identity_match_events.insert"] = "history table unavailable";

    await link();

    expect(callsTo("conversations", "update")[0].values).toEqual({ lead_id: "lead-1" });
  });

  it("logs a failed activity write for a new lead and still returns the created lead", async () => {
    world.errors["lead_activity.insert"] = "activity table unavailable";

    const result = await link({ createIfMissing: true, displayName: "Aisha", owner: OWNER });

    expect(result.source).toBe("CREATED");
    expect(result.lead).toMatchObject({ id: "lead-new" });
    expect(console.error).toHaveBeenCalledWith("Could not log the new lead's activity:", "activity table unavailable");
  });

  it("stays quiet when both writes succeed", async () => {
    world.identityLeadId = "lead-1";

    await link();

    expect(console.error).not.toHaveBeenCalled();
  });

  it("logs both failures when a new lead's history and activity writes both fail", async () => {
    world.errors["identity_match_events.insert"] = "history down";
    world.errors["lead_activity.insert"] = "activity down";

    const result = await link({ createIfMissing: true, displayName: "Aisha", owner: OWNER });

    expect(result.source).toBe("CREATED");
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe("linkConversationToLead: a new lead is never left behind unlinked", () => {
  // A channel with no phone number (Instagram, Messenger) cannot be re-found by phone, so a lead stranded by a failed identity save
  // would be created again on the retry. The lead is removed only while nothing else refers to it.
  const instagram = { createIfMissing: true, provider: "INSTAGRAM", externalSubjectId: "ig-1", displayName: "Aisha", owner: OWNER };

  it("removes the lead it just created when the identity cannot be saved, and still fails with the original reason", async () => {
    world.errors["contact_identities.upsert"] = "constraint";

    await expect(link(instagram)).rejects.toThrow("Could not save this contact identity: constraint");

    const removal = callsTo("leads", "delete");
    expect(removal).toHaveLength(1);
    expect(hasFilter(removal[0], "id", "lead-new")).toBe(true);
    expect(hasFilter(removal[0], "agency_id", AGENCY)).toBe(true);
  });

  it("does not leave the conversation linked, or a history entry, when it removes the lead", async () => {
    world.errors["contact_identities.upsert"] = "constraint";

    await expect(link(instagram)).rejects.toThrow();

    expect(callsTo("conversations", "update")).toEqual([]);
    expect(callsTo("identity_match_events", "insert")).toEqual([]);
    expect(callsTo("lead_activity", "insert")).toEqual([]);
  });

  it("still throws the original error, and names the stranded lead in the log, when the removal itself fails", async () => {
    world.errors["contact_identities.upsert"] = "constraint";
    world.errors["leads.delete"] = "permission denied";

    await expect(link(instagram)).rejects.toThrow("Could not save this contact identity: constraint");

    expect(console.error).toHaveBeenCalledWith("Could not remove lead lead-new after its identity failed to save:", "permission denied");
  });

  it("keeps the lead when the identity was saved but the conversation could not be linked, because the retry finds it by identity", async () => {
    world.errors["conversations.update"] = "row locked";

    await expect(link(instagram)).rejects.toThrow("Could not link this conversation to its lead: row locked");

    expect(callsTo("leads", "delete")).toEqual([]);
    expect(callsTo("contact_identities", "upsert")).toHaveLength(1);
  });

  it("never removes a lead that already existed, however the link fails", async () => {
    world.identityLeadId = "lead-1";
    world.errors["contact_identities.upsert"] = "constraint";

    await expect(link()).rejects.toThrow();

    expect(callsTo("leads", "delete")).toEqual([]);
  });

  it("never removes a lead found by phone when the link fails", async () => {
    world.phoneLeads = [LEAD];
    world.errors["contact_identities.upsert"] = "constraint";

    await expect(link()).rejects.toThrow();

    expect(callsTo("leads", "delete")).toEqual([]);
  });

  it("does not pile up leads across retries: every failed attempt takes back the lead it made", async () => {
    world.errors["contact_identities.upsert"] = "constraint";
    await expect(link(instagram)).rejects.toThrow();
    await expect(link(instagram)).rejects.toThrow();
    world.errors = {};

    const result = await link(instagram);

    expect(result.source).toBe("CREATED");
    expect(callsTo("leads", "insert")).toHaveLength(3);
    expect(callsTo("leads", "delete")).toHaveLength(2);
  });

  it("does not remove anything when the lead was created and linked normally", async () => {
    await link(instagram);

    expect(callsTo("leads", "delete")).toEqual([]);
  });
});
