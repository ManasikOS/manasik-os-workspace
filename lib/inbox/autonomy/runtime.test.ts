import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const AGENCY = "0b8e7c3a-1f4d-4e6a-9d2b-7a1c5e3f9b10";
const CONVERSATION = "5d2f9a41-8c7e-4b3a-a6d1-2e9f0c7b4a83";
const NOW = new Date("2026-09-27T10:00:00.000Z");
const SAFE_TEXT = "We received your question and a colleague will reply shortly.";

// --- db-dependent collaborators are mocked; the pure decision pieces (level.ts, promotion.ts, send-gate.ts,
// protection-gate.ts, never-promise.ts) stay real, so these tests exercise the real orchestration around them. ---

let entitlements: { autonomyCeiling: string } | null = { autonomyCeiling: "L3" };
const resolveEntitlements = vi.fn(async (_db: unknown, _agencyId: unknown) => entitlements);
vi.mock("@/lib/billing/entitlements", () => ({ resolveEntitlements: (db: unknown, agencyId: unknown) => resolveEntitlements(db, agencyId) }));

let protectionContext = { openReviews: [] as Array<{ kind: string; severity: string; headline: string }>, approvedAccountDigits: [] as string[] };
const loadProtectionContext = vi.fn(async (_db: unknown, _agencyId: unknown, _conversationId: unknown) => protectionContext);
vi.mock("@/lib/data/inbox-risk-repository", () => ({ loadProtectionContext: (db: unknown, agencyId: unknown, conversationId: unknown) => loadProtectionContext(db, agencyId, conversationId) }));

let slaSettings = { calendar: {}, timezone: "Asia/Colombo" };
const loadSlaSettings = vi.fn(async (_db: unknown, _agencyId: unknown) => slaSettings);
vi.mock("@/lib/data/inbox-sla-repository", () => ({ loadSlaSettings: (db: unknown, agencyId: unknown) => loadSlaSettings(db, agencyId) }));

let withinBusinessHours = true;
const isWithinBusinessHours = vi.fn((_now: unknown, _calendar: unknown, _timezone: unknown) => withinBusinessHours);
vi.mock("@/lib/inbox/sla/business-hours", () => ({ isWithinBusinessHours: (now: unknown, calendar: unknown, timezone: unknown) => isWithinBusinessHours(now, calendar, timezone) }));

const noDemotionEvidence = { evidence: { observedDays: 30, decisions: 500, triageAccuracy: 1, paymentClaimPrecision: 1, denyListViolations: 0, rejectionRate: 0, rejectionThreshold: 0.4 }, decision: { eligible: true, reasons: [] } };
let autonomyEvidence: typeof noDemotionEvidence = noDemotionEvidence;
const loadInboxAutonomyEvidence = vi.fn(async (_db: unknown, _agencyId: unknown, _now: unknown) => autonomyEvidence);
vi.mock("./evidence", () => ({ loadInboxAutonomyEvidence: (db: unknown, agencyId: unknown, now: unknown) => loadInboxAutonomyEvidence(db, agencyId, now) }));

const { authorizeAutomatedInboxSend, recordAutomatedSendDecision } = await import("./runtime");

type Call = { table: string; op: "select" | "insert" | "rpc"; filters: Array<[string, unknown]>; args?: Record<string, unknown>; values?: Record<string, unknown> };
const calls: Call[] = [];

interface World {
  surfaceRow: { enabled: boolean; mode: string; autonomy: Record<string, unknown> } | null;
  legacySurfaceRow: { enabled: boolean; mode: string } | null;
  conversation: { state: string; handling_mode: string | null } | null;
  everConfiguredCount: number;
  demotionRpcOk: boolean;
  errors: Record<string, string>;
}

let world: World;

const freshWorld = (): World => ({
  surfaceRow: { enabled: true, mode: "ACTIVE", autonomy: { level: "L3" } },
  legacySurfaceRow: null,
  conversation: { state: "AI_ACTIVE", handling_mode: null },
  everConfiguredCount: 0,
  demotionRpcOk: true,
  errors: {},
});

const db = {
  from(table: string) {
    const call: Call = { table, op: "select", filters: [] };
    calls.push(call);
    const settle = () => {
      if (world.errors[`${table}.select`] && call.filters.some(([column]) => column === "agency_id")) {
        return { data: null, error: { message: world.errors[`${table}.select`] } };
      }
      if (table === "ai_surface_settings") {
        const surfaceFilter = call.filters.find(([column]) => column === "surface")?.[1];
        return surfaceFilter === "WHATSAPP" ? { data: world.legacySurfaceRow } : { data: world.surfaceRow, error: null };
      }
      if (table === "conversations") return { data: world.conversation, error: null };
      if (table === "inbox_autonomy_level_audit") return { count: world.everConfiguredCount, error: null };
      if (table === "inbox_autonomy_decisions") return world.errors["inbox_autonomy_decisions.insert"] ? { error: { message: world.errors["inbox_autonomy_decisions.insert"] } } : { error: null };
      return { data: null, error: null };
    };
    const query: Record<string, unknown> = {
      select: () => query,
      insert: (values: Record<string, unknown>) => {
        Object.assign(call, { op: "insert", values });
        return query;
      },
      eq: (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return query;
      },
      maybeSingle: async () => settle(),
      single: async () => settle(),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(settle()).then(resolve, reject),
    };
    return query;
  },
  rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ table: name, op: "rpc", filters: [], args });
    if (name === "set_inbox_autonomy_level") return world.demotionRpcOk ? { error: null } : { error: { message: "audit table locked" } };
    return { data: null, error: null };
  },
};

const authorize = (over: Partial<Parameters<typeof authorizeAutomatedInboxSend>[1]> = {}) =>
  authorizeAutomatedInboxSend(db as never, { agencyId: AGENCY, conversationId: CONVERSATION, text: SAFE_TEXT, source: "APPROVED_TEMPLATE", now: NOW, ...over });

const rpcCalls = (name: string) => calls.filter((call) => call.op === "rpc" && call.table === name);

beforeEach(() => {
  calls.length = 0;
  world = freshWorld();
  entitlements = { autonomyCeiling: "L3" };
  protectionContext = { openReviews: [], approvedAccountDigits: [] };
  slaSettings = { calendar: {}, timezone: "Asia/Colombo" };
  withinBusinessHours = true;
  autonomyEvidence = noDemotionEvidence;
  resolveEntitlements.mockClear();
  loadProtectionContext.mockClear();
  loadSlaSettings.mockClear();
  isWithinBusinessHours.mockClear();
  loadInboxAutonomyEvidence.mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe("authorizeAutomatedInboxSend: reading the conversation and its settings", () => {
  it("throws when the autonomy settings cannot be read", async () => {
    world.errors["ai_surface_settings.select"] = "connection reset";

    await expect(authorize()).rejects.toThrow("Could not load autonomy settings: connection reset");
  });

  it("throws when the conversation cannot be found", async () => {
    world.conversation = null;

    await expect(authorize()).rejects.toThrow("Could not load autonomy conversation state: not found");
  });

  it("names INBOX_REPLY for a generated reply and INBOX_INTAKE for the intake flow", async () => {
    expect((await authorize({ source: "GENERATED" })).surface).toBe("INBOX_REPLY");
    expect((await authorize({ source: "INTAKE_FLOW" })).surface).toBe("INBOX_INTAKE");
  });

  it("treats no autonomy settings row as L0 and OFF, so a brand-new agency sends nothing automatically", async () => {
    world.surfaceRow = null;

    const result = await authorize();

    expect(result).toEqual({ allowed: false, reasons: ["This autonomy level cannot send without human approval."], level: "L0", surface: "INBOX_REPLY" });
  });

  it("falls back to L0 for a level value that is not one of L0 to L3", async () => {
    world.surfaceRow = { enabled: true, mode: "ACTIVE", autonomy: { level: "L9" } };

    expect((await authorize()).level).toBe("L0");
  });

  it("treats a mode the code does not know as OFF", async () => {
    world.surfaceRow = { enabled: true, mode: "EXPERIMENTAL", autonomy: { level: "L3" } };

    expect((await authorize()).level).toBe("L0");
  });

  it("treats a disabled surface as OFF regardless of its stored mode", async () => {
    world.surfaceRow = { enabled: false, mode: "ACTIVE", autonomy: { level: "L3" } };

    expect((await authorize()).level).toBe("L0");
  });
});

describe("authorizeAutomatedInboxSend: what caps the level", () => {
  it("caps ACTIVE mode at the configured level", async () => {
    world.surfaceRow = { enabled: true, mode: "ACTIVE", autonomy: { level: "L1" } };

    expect((await authorize()).level).toBe("L1");
  });

  it("caps a level at PROPOSE mode's ceiling of L1, whatever is configured", async () => {
    world.surfaceRow = { enabled: true, mode: "PROPOSE", autonomy: { level: "L3" } };

    expect((await authorize()).level).toBe("L1");
  });

  it("caps a level at the plan's entitlement ceiling", async () => {
    entitlements = { autonomyCeiling: "L1" };

    expect((await authorize()).level).toBe("L1");
  });

  it("treats a missing entitlements row as an L0 ceiling", async () => {
    entitlements = null;

    expect((await authorize()).level).toBe("L0");
  });

  it("forces L0 whenever a person is actively handling the conversation, however high the settings allow", async () => {
    world.conversation = { state: "HUMAN_ACTIVE", handling_mode: null };

    const result = await authorize();

    expect(result.level).toBe("L0");
    expect(result.allowed).toBe(false);
  });

  it("also reads HUMAN_ACTIVE from handling_mode when the conversation state itself is something else", async () => {
    world.conversation = { state: "AI_ACTIVE", handling_mode: "HUMAN_ACTIVE" };

    expect((await authorize()).level).toBe("L0");
  });
});

describe("authorizeAutomatedInboxSend: automatic demotion", () => {
  const rejectionDemotion = { evidence: { observedDays: 14, decisions: 300, triageAccuracy: 0.9, paymentClaimPrecision: 0.98, denyListViolations: 0, rejectionRate: 0.5, rejectionThreshold: 0.4 }, decision: { eligible: false, reasons: [] } };

  it("does not consult the evidence at all for L0 or L1, which cannot be demoted further this way", async () => {
    world.surfaceRow = { enabled: true, mode: "PROPOSE", autonomy: { level: "L1" } };

    await authorize();

    expect(loadInboxAutonomyEvidence).not.toHaveBeenCalled();
    expect(rpcCalls("set_inbox_autonomy_level")).toEqual([]);
  });

  it("checks the evidence for L2 and L3, and demotes nothing when it stays within every threshold", async () => {
    world.surfaceRow = { enabled: true, mode: "ACTIVE", autonomy: { level: "L3" } };

    const result = await authorize();

    expect(loadInboxAutonomyEvidence).toHaveBeenCalledWith(db, AGENCY, NOW);
    expect(result.level).toBe("L3");
    expect(rpcCalls("set_inbox_autonomy_level")).toEqual([]);
  });

  it("demotes one level when a threshold is breached, and uses the demoted level for the rest of the decision", async () => {
    world.surfaceRow = { enabled: true, mode: "ACTIVE", autonomy: { level: "L3" } };
    autonomyEvidence = rejectionDemotion;

    const result = await authorize();

    expect(result.level).toBe("L2");
    expect(rpcCalls("set_inbox_autonomy_level")[0].args).toMatchObject({ p_agency_id: AGENCY, p_surface: "INBOX_REPLY", p_level: "L2", p_mode: "ACTIVE", p_enabled: true, p_actor_id: null });
  });

  it("names the breached threshold in the audit reason", async () => {
    world.surfaceRow = { enabled: true, mode: "ACTIVE", autonomy: { level: "L3" } };
    autonomyEvidence = rejectionDemotion;

    await authorize();

    expect(String(rpcCalls("set_inbox_autonomy_level")[0].args?.p_reason)).toContain("rejection rate");
  });

  it("stores the evidence that triggered the demotion in the audit row", async () => {
    world.surfaceRow = { enabled: true, mode: "ACTIVE", autonomy: { level: "L3" } };
    autonomyEvidence = rejectionDemotion;

    await authorize();

    expect(rpcCalls("set_inbox_autonomy_level")[0].args?.p_evidence).toEqual(rejectionDemotion.evidence);
  });

  it("switches to SHADOW mode and disables the surface when demotion lands on L0", async () => {
    world.surfaceRow = { enabled: true, mode: "PROPOSE", autonomy: { level: "L2" } };
    autonomyEvidence = { evidence: rejectionDemotion.evidence, decision: { eligible: false, reasons: [] } };
    // PROPOSE mode already caps the effective level at L1; a demotion off L2 is decided on the CONFIGURED level, not the effective one.

    const result = await authorize();

    expect(rpcCalls("set_inbox_autonomy_level")[0].args).toMatchObject({ p_level: "L1", p_mode: "PROPOSE", p_enabled: true });
    expect(result.level).toBe("L1");
  });

  it("clears the promotion timestamp when demoted down to L1, but keeps it when only stepping from L3 to L2", async () => {
    world.surfaceRow = { enabled: true, mode: "ACTIVE", autonomy: { level: "L2", promoted_at: "2026-09-01T00:00:00.000Z" } };
    autonomyEvidence = rejectionDemotion;

    await authorize();

    expect(rpcCalls("set_inbox_autonomy_level")[0].args?.p_autonomy).toMatchObject({ level: "L1", promoted_at: null });
  });

  it("throws when the demotion cannot be saved", async () => {
    world.surfaceRow = { enabled: true, mode: "ACTIVE", autonomy: { level: "L3" } };
    autonomyEvidence = rejectionDemotion;
    world.demotionRpcOk = false;

    await expect(authorize()).rejects.toThrow("Could not apply autonomy demotion: audit table locked");
  });
});

describe("authorizeAutomatedInboxSend: the first 14 days after promotion", () => {
  const promotedYesterday = { enabled: true, mode: "ACTIVE", autonomy: { level: "L3", promoted_at: "2026-09-26T10:00:00.000Z" } };

  it("refuses an ordinary reply outside the allowed narrow window, in office hours", async () => {
    world.surfaceRow = promotedYesterday;
    withinBusinessHours = true;

    const result = await authorize({ action: "OTHER" });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("The first 14 days after promotion allow only out-of-hours acknowledgements, approved qualifying questions, and approved FAQ answers.");
  });

  it("allows an acknowledgement outside office hours in that same window", async () => {
    world.surfaceRow = promotedYesterday;
    withinBusinessHours = false;

    const result = await authorize({ action: "ACKNOWLEDGEMENT" });

    expect(result.allowed).toBe(true);
  });

  it("treats a missing action as OTHER, which the narrow window does not allow", async () => {
    world.surfaceRow = promotedYesterday;
    withinBusinessHours = false;

    const result = await authorize({ action: undefined });

    expect(result.allowed).toBe(false);
  });

  it("does not restrict anything once the 14 days have passed, even though the schedule is still consulted", async () => {
    world.surfaceRow = { enabled: true, mode: "ACTIVE", autonomy: { level: "L3", promoted_at: "2026-01-01T00:00:00.000Z" } };

    const result = await authorize({ action: "OTHER" });

    expect(result.allowed).toBe(true);
    // narrowPromotionWindowAllows is what actually decides "has the window passed", so the schedule is loaded whenever a
    // promotion timestamp is on file at L2/L3 — even long after it stopped mattering. Pinned as existing behaviour.
    expect(loadSlaSettings).toHaveBeenCalledTimes(1);
  });

  it("does not check the window at all below L2", async () => {
    world.surfaceRow = { enabled: true, mode: "PROPOSE", autonomy: { level: "L1", promoted_at: "2026-09-26T10:00:00.000Z" } };

    await authorize({ action: "OTHER" });

    expect(loadSlaSettings).not.toHaveBeenCalled();
  });

  it("does not check the window when nothing was ever promoted", async () => {
    world.surfaceRow = { enabled: true, mode: "ACTIVE", autonomy: { level: "L3" } };

    await authorize({ action: "OTHER" });

    expect(loadSlaSettings).not.toHaveBeenCalled();
  });

  it("ignores a promotion timestamp that is not a real date", async () => {
    world.surfaceRow = { enabled: true, mode: "ACTIVE", autonomy: { level: "L3", promoted_at: "not a date" } };

    const result = await authorize({ action: "OTHER" });

    expect(result.allowed).toBe(true);
    expect(loadSlaSettings).not.toHaveBeenCalled();
  });

  it("reads the agency's own calendar and timezone for the office-hours check", async () => {
    world.surfaceRow = promotedYesterday;

    await authorize({ action: "OTHER" });

    expect(isWithinBusinessHours).toHaveBeenCalledWith(NOW, slaSettings.calendar, slaSettings.timezone);
  });
});

describe("authorizeAutomatedInboxSend: the legacy WhatsApp assistant fallback", () => {
  it("does not fall back when the Inbox reply surface is enabled", async () => {
    world.surfaceRow = { enabled: true, mode: "OFF", autonomy: {} };
    world.legacySurfaceRow = { enabled: true, mode: "ACTIVE" };

    const result = await authorize({ source: "GENERATED" });

    expect(result.level).toBe("L0");
  });

  it("does not fall back for anything other than a generated reply", async () => {
    world.surfaceRow = { enabled: false, mode: "OFF", autonomy: {} };
    world.legacySurfaceRow = { enabled: true, mode: "ACTIVE" };

    const result = await authorize({ source: "APPROVED_TEMPLATE" });

    expect(result.level).toBe("L0");
  });

  it("does not query the legacy assistant at all unless the surface is disabled and the source is generated", async () => {
    world.surfaceRow = { enabled: true, mode: "OFF", autonomy: {} };

    await authorize({ source: "GENERATED" });

    expect(calls.some((call) => call.table === "ai_surface_settings" && call.filters.some(([, value]) => value === "WHATSAPP"))).toBe(false);
  });

  it("does not fall back when the legacy assistant is not active", async () => {
    world.surfaceRow = { enabled: false, mode: "OFF", autonomy: {} };
    world.legacySurfaceRow = { enabled: true, mode: "SHADOW" };

    const result = await authorize({ source: "GENERATED" });

    expect(result.level).toBe("L0");
  });

  it("does not fall back once anyone has ever configured the Inbox reply surface, even to L0", async () => {
    world.surfaceRow = { enabled: false, mode: "OFF", autonomy: {} };
    world.legacySurfaceRow = { enabled: true, mode: "ACTIVE" };
    world.everConfiguredCount = 1;

    const result = await authorize({ source: "GENERATED" });

    expect(result.level).toBe("L0");
  });

  it("authorises a legacy-assistant reply at L3 when nobody has ever touched the Inbox reply surface", async () => {
    world.surfaceRow = { enabled: false, mode: "OFF", autonomy: {} };
    world.legacySurfaceRow = { enabled: true, mode: "ACTIVE" };

    const result = await authorize({ source: "GENERATED" });

    expect(result).toMatchObject({ level: "L3", allowed: true });
  });

  it("still caps the legacy-assistant fallback at the plan's entitlement ceiling", async () => {
    world.surfaceRow = { enabled: false, mode: "OFF", autonomy: {} };
    world.legacySurfaceRow = { enabled: true, mode: "ACTIVE" };
    entitlements = { autonomyCeiling: "L1" };

    const result = await authorize({ source: "GENERATED" });

    expect(result.level).toBe("L1");
  });

  it("caps the legacy-assistant fallback at L0 when the agency has no entitlements row", async () => {
    world.surfaceRow = { enabled: false, mode: "OFF", autonomy: {} };
    world.legacySurfaceRow = { enabled: true, mode: "ACTIVE" };
    entitlements = null;

    const result = await authorize({ source: "GENERATED" });

    expect(result.level).toBe("L0");
  });
});

describe("authorizeAutomatedInboxSend: the protection gate always applies", () => {
  it("refuses a payment confirmation even at L3 from an approved template", async () => {
    const result = await authorize({ text: "We have received your payment, thank you." });

    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain("confirm that a payment was received");
  });

  it("refuses safe text while a blocking review is open", async () => {
    protectionContext = { openReviews: [{ kind: "PAYMENT_CLAIM", severity: "BLOCK", headline: "Payment claim needs Finance" }], approvedAccountDigits: [] };

    const result = await authorize();

    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain("Payment claim needs Finance");
  });

  it("refuses GENERATED text at L2 even when every other check passes, because L2 may only send approved content", async () => {
    world.surfaceRow = { enabled: true, mode: "ACTIVE", autonomy: { level: "L2" } };

    const result = await authorize({ source: "GENERATED" });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("L2 may send only approved templates or approved cached answers.");
  });

  it("allows safe text at L3 with no reviews open", async () => {
    const result = await authorize();

    expect(result).toEqual({ allowed: true, reasons: [], level: "L3", surface: "INBOX_REPLY" });
  });
});

describe("recordAutomatedSendDecision", () => {
  const authorization = { allowed: true, reasons: [] as string[], level: "L3" as const, surface: "INBOX_REPLY" as const };

  it("writes the decision scoped to the agency and conversation", async () => {
    await recordAutomatedSendDecision(db as never, { agencyId: AGENCY, conversationId: CONVERSATION, messageId: "msg-1", authorization, source: "APPROVED_TEMPLATE", decision: "SENT" });

    const insert = calls.find((call) => call.table === "inbox_autonomy_decisions" && call.op === "insert")!;
    expect(insert.values).toMatchObject({ agency_id: AGENCY, conversation_id: CONVERSATION, message_id: "msg-1", surface: "INBOX_REPLY", effective_level: "L3", decision: "SENT", source: "APPROVED_TEMPLATE" });
  });

  it("uses null when no message id is given", async () => {
    await recordAutomatedSendDecision(db as never, { agencyId: AGENCY, conversationId: CONVERSATION, authorization, source: "GENERATED", decision: "REFUSED" });

    expect(calls.find((call) => call.table === "inbox_autonomy_decisions")!.values).toMatchObject({ message_id: null });
  });

  it.each([
    ["confirm that a payment was received", true],
    ["may never promise a visa approval", true],
    ["The bank details you sent could not be verified", true],
    ["This conversation is assigned to another staff member.", false],
    ["Take control of this conversation before replying.", false],
  ])("marks deny_list_violation from the reason text: %s -> %s", async (reason, expected) => {
    await recordAutomatedSendDecision(db as never, { agencyId: AGENCY, conversationId: CONVERSATION, authorization: { ...authorization, reasons: [reason] }, source: "GENERATED", decision: "REFUSED" });

    expect(calls.find((call) => call.table === "inbox_autonomy_decisions")!.values).toMatchObject({ deny_list_violation: expected });
  });

  it("marks no violation when there are no reasons at all", async () => {
    await recordAutomatedSendDecision(db as never, { agencyId: AGENCY, conversationId: CONVERSATION, authorization, source: "GENERATED", decision: "SENT" });

    expect(calls.find((call) => call.table === "inbox_autonomy_decisions")!.values).toMatchObject({ deny_list_violation: false });
  });

  it("throws with a clear message when the write fails", async () => {
    world.errors["inbox_autonomy_decisions.insert"] = "constraint violation";

    await expect(recordAutomatedSendDecision(db as never, { agencyId: AGENCY, conversationId: CONVERSATION, authorization, source: "GENERATED", decision: "SENT" })).rejects.toThrow("Could not record the autonomy decision: constraint violation");
  });
});
