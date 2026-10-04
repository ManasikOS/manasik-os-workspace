import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const recordSignals = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => 1);
const supersedeSignals = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => 0);
const openIntervention = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ intervention: {}, created: true }));
const findOpenInterventions = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => [] as unknown[]);
vi.mock("@/lib/data/conversation-intelligence-repository", () => ({
  recordSignals: (...args: unknown[]) => recordSignals(...args),
  supersedeSignals: (...args: unknown[]) => supersedeSignals(...args),
  openIntervention: (...args: unknown[]) => openIntervention(...args),
  findOpenInterventions: (...args: unknown[]) => findOpenInterventions(...args),
}));
const notifyConversationWaiting = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: true, notified: 2 }));
const listActiveStaffIdsByRole = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ["f1", "f2"]);
vi.mock("@/lib/data/staff-notifications", () => ({
  notifyConversationWaiting: (...args: unknown[]) => notifyConversationWaiting(...args),
  listActiveStaffIdsByRole: (...args: unknown[]) => listActiveStaffIdsByRole(...args),
}));
const classifyRisk = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ readings: [], source: "NONE", note: null, modelCalls: 0, aiRunId: null, unread: false }));
vi.mock("@/lib/ai/surfaces/inbox/risk-classify", () => ({ classifyRisk: (...args: unknown[]) => classifyRisk(...args) }));
const checkStoredOffer =vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => "FRESH" as const);
vi.mock("@/lib/data/inbox-offer-repository", () => ({ checkStoredOffer: (...args: unknown[]) => checkStoredOffer(...args) }));

const { loadProtectionContext, loadRiskFacts, openInterventionsForSignals, runRiskForConversation, STATE_SIGNAL_CODES } = await import("./inbox-risk-repository");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-09-21T10:00:00Z");
const M1 = "3f1d2c4e-5a6b-4c7d-8e9f-000000000001";

type Row = Record<string, unknown>;

function fakeDb(seed: Record<string, Row[]>, failing?: string) {
  const filters: Array<[string, string, unknown]> = [];
  const db = {
    from(table: string) {
      const where: Array<[string, unknown]> = [];
      const rows = seed[table] ?? [];
      const matching = () => rows.filter((row) => where.every(([column, value]) => (Array.isArray(value) ? value.includes(row[column]) : row[column] === value)));
      const answer = (single: boolean) => (table === failing ? { data: null, error: { message: "exploded" } } : { data: single ? (matching()[0] ?? null) : matching(), error: null });
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (column: string, value: unknown) => (filters.push([table, column, value]), where.push([column, value]), chain),
        in: (column: string, value: unknown[]) => (where.push([column, value]), chain),
        maybeSingle: () => Promise.resolve(answer(true)),
        then: (resolve: (value: unknown) => unknown) => resolve(answer(false)),
      };
      return chain;
    },
  };
  return { db: db as never, filters };
}

const message = (id: string, actor: "CUSTOMER" | "STAFF" | "AI", text: string, minutesAgo: number) => ({ id, actor, text, type: "TEXT", createdAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString() });

const seed = (over: Record<string, Row[]> = {}): Record<string, Row[]> => ({
  conversations: [{ id: "c1", agency_id: AGENCY, lead_id: "lead-1", service_window_expires_at: null, composing_by: null, composing_at: null }],
  leads: [{ id: "lead-1", agency_id: AGENCY, booking_id: "bk-1", selected_departure_group_id: null }],
  departure_group_bookings: [{ id: "bk-1", agency_id: AGENCY, departure_group_id: "g1", booking_reference: "UMR-BK012" }],
  payments: [],
  departure_group_pilgrims: [],
  departure_groups: [{ id: "g1", agency_id: AGENCY, group_name: "Nov", available_seats: 9, group_status: "OPEN", sales_status: "SELLING", archived: false, departure_date: "2026-11-12" }],
  agency_settings: [{ agency_id: AGENCY, passport_validity_months: 9 }],
  ...over,
});

const input = (over: Partial<Parameters<typeof loadRiskFacts>[1]> = {}): Parameters<typeof loadRiskFacts>[1] => ({
  agencyId: AGENCY,
  conversationId: "c1",
  now: NOW,
  messages: [message(M1, "CUSTOMER", "I have paid LKR 250,000", 1)],
  intentConfidence: 0.9,
  matchedOffer: null,
  travelIntent: null,
  approvedAccounts: [],
  ...over,
});

describe("loadRiskFacts", () => {
  it("counts only COMPLETED payments as confirmed: a pending one does not clear a claim", async () => {
    const { db } = fakeDb(seed({ payments: [{ agency_id: AGENCY, booking_id: "bk-1", amount: "100000.00", status: "COMPLETED" }, { agency_id: AGENCY, booking_id: "bk-1", amount: 150000, status: "PENDING_VERIFICATION" }, { agency_id: AGENCY, booking_id: "bk-1", amount: 5, status: "FAILED" }] }));
    expect((await loadRiskFacts(db, input())).payments).toEqual({ confirmedTotal: 100000, confirmedCount: 1, pendingCount: 1 });
  });

  it("a conversation with no booking has no payments (null, not zero)", async () => {
    const { db } = fakeDb(seed({ leads: [{ id: "lead-1", agency_id: AGENCY, booking_id: null, selected_departure_group_id: null }] }));
    expect((await loadRiskFacts(db, input())).payments).toBeNull();
  });

  it("reads travellers, the departure date, the agency's passport rule, the window and the composer", async () => {
    const { db } = fakeDb(
      seed({
        departure_group_pilgrims: [{ agency_id: AGENCY, booking_id: "bk-1", full_name_snapshot: "Aisha", passport_expiry: "2027-01-01", date_of_birth: "2012-03-04" }],
        conversations: [{ id: "c1", agency_id: AGENCY, lead_id: "lead-1", service_window_expires_at: "2026-09-21T11:00:00Z", composing_by: "s1", composing_at: "2026-09-21T09:59:00Z" }],
      }),
    );
    const facts = await loadRiskFacts(db, input());
    expect(facts).toMatchObject({
      passengers: [{ name: "Aisha", passportExpiry: "2027-01-01", dateOfBirth: "2012-03-04" }],
      departureDate: "2026-11-12",
      passportValidityMonths: 9,
      serviceWindowExpiresAt: "2026-09-21T11:00:00Z",
      composing: { staffId: "s1", at: "2026-09-21T09:59:00Z" },
      awaitingReply: true,
    });
  });

  it("looks up a quoted booking reference, and says whether the agency has it", async () => {
    const { db } = fakeDb(seed());
    const facts = await loadRiskFacts(db, input({ messages: [message(M1, "CUSTOMER", "My booking UMR-BK012 and X-BK099", 1)] }));
    expect(facts.claimedReferences).toEqual([{ reference: "UMR-BK012", exists: true }, { reference: "X-BK099", exists: false }]);
  });

  it("reads the requested departure live: seats and whether it is still open for sale", async () => {
    const { db } = fakeDb(seed({ leads: [{ id: "lead-1", agency_id: AGENCY, booking_id: null, selected_departure_group_id: "g1" }], departure_groups: [{ id: "g1", agency_id: AGENCY, group_name: "Nov", available_seats: 2, group_status: "OPEN", sales_status: "WAITLIST", archived: false, departure_date: "2026-11-12" }] }));
    expect((await loadRiskFacts(db, input())).requestedGroup).toEqual({ name: "Nov", availableSeats: 2, sellable: false });
  });

  it("we have answered when our message is newer than the customer's", async () => {
    const { db } = fakeDb(seed());
    const facts = await loadRiskFacts(db, input({ messages: [message(M1, "CUSTOMER", "hi", 5), message("s", "STAFF", "hello", 2)] }));
    expect(facts.awaitingReply).toBe(false);
    expect(facts.outbound.map((entry) => entry.id)).toEqual(["s"]);
  });

  it("names the agency on every read", async () => {
    const { db, filters } = fakeDb(seed({ payments: [{ agency_id: AGENCY, booking_id: "bk-1", amount: 1, status: "COMPLETED" }] }));
    await loadRiskFacts(db, input());
    for (const table of ["conversations", "leads", "payments", "departure_group_pilgrims", "departure_groups", "agency_settings"]) expect(filters, table).toContainEqual([table, "agency_id", AGENCY]);
  });

  it("is strict: if any read fails the whole run throws, so 'could not read payments' never becomes 'no payments'", async () => {
    for (const failing of ["payments", "conversations", "departure_groups", "agency_settings"]) {
      await expect(loadRiskFacts(fakeDb(seed(), failing).db, input()), failing).rejects.toThrow("exploded");
    }
  });
});

describe("runRiskForConversation", () => {
  it("records what fired as RULE signals, and retires state signals that stopped being true", async () => {
    recordSignals.mockClear();
    supersedeSignals.mockClear();
    const { db } = fakeDb(seed());
    const outcome = await runRiskForConversation(db, input());
    expect(outcome.fired).toContain("PAYMENT_CLAIM_UNVERIFIED");
    expect(recordSignals).toHaveBeenCalledWith(db, AGENCY, "c1", [expect.objectContaining({ signalCode: "PAYMENT_CLAIM_UNVERIFIED", detector: "RULE", messageId: M1 })]);
    const retired = (supersedeSignals.mock.calls[0]?.[3] as { codes: string[] }).codes;
    expect([...retired].sort()).toEqual([...STATE_SIGNAL_CODES].sort());
  });

  it("does not retire a state signal that is still true", async () => {
    supersedeSignals.mockClear();
    const { db } = fakeDb(seed());
    await runRiskForConversation(db, input({ intentConfidence: 0.2 }));
    expect((supersedeSignals.mock.calls[0]?.[3] as { codes: string[] }).codes).not.toContain("LOW_CONFIDENCE_DRAFT");
  });

  it("message-based signals are never superseded by a later quiet run", () => {
    for (const code of ["PAYMENT_CLAIM_UNVERIFIED", "BANK_DETAIL_MISMATCH", "SENSITIVE_DOC_RECEIVED", "UNRECORDED_BOOKING_CLAIM", "MINOR_OR_ASSISTANCE_NEEDED"]) expect(STATE_SIGNAL_CODES).not.toContain(code);
  });
});

describe("openInterventionsForSignals — signals become review cards", () => {
  const CONVERSATION = "3f1d2c4e-5a6b-4c7d-8e9f-000000000001";
  const beforeEach_ = () => {
    openIntervention.mockClear();
    notifyConversationWaiting.mockClear();
    listActiveStaffIdsByRole.mockClear();
    openIntervention.mockResolvedValue({ intervention: {}, created: true });
  };

  it("opens a card for each signal that has one, with the owning role, and skips the rest", async () => {
    beforeEach_();
    const outcome = await openInterventionsForSignals({} as never, { agencyId: AGENCY, conversationId: CONVERSATION, codes: ["PAYMENT_CLAIM_UNVERIFIED", "LOW_CONFIDENCE_DRAFT", "GROUP_FULL_REQUESTED"] });
    expect(outcome.opened).toBe(2);
    expect(openIntervention).toHaveBeenCalledTimes(2);
    expect(openIntervention).toHaveBeenCalledWith(expect.anything(), AGENCY, expect.objectContaining({ conversationId: CONVERSATION, kind: "PAYMENT_CLAIM", severity: "BLOCK", assignedRole: "FINANCE", requiredActionCode: "VERIFY_PAYMENT" }));
  });

  it("tells the owning role once, when the card is new: a Finance review for the payment claim", async () => {
    beforeEach_();
    const outcome = await openInterventionsForSignals({} as never, { agencyId: AGENCY, conversationId: CONVERSATION, codes: ["PAYMENT_CLAIM_UNVERIFIED"] });
    expect(listActiveStaffIdsByRole).toHaveBeenCalledWith(expect.anything(), AGENCY, ["FINANCE"]);
    expect(notifyConversationWaiting).toHaveBeenCalledWith(expect.objectContaining({ agencyId: AGENCY, conversationId: CONVERSATION, recipientIds: ["f1", "f2"], title: expect.stringContaining("Review needed") }), expect.anything());
    expect(outcome.notified).toBe(2);
  });

  it("does not notify again for a card that was already open", async () => {
    beforeEach_();
    openIntervention.mockResolvedValue({ intervention: {}, created: false });
    const outcome = await openInterventionsForSignals({} as never, { agencyId: AGENCY, conversationId: CONVERSATION, codes: ["PAYMENT_CLAIM_UNVERIFIED"] });
    expect(outcome).toEqual({ opened: 0, notified: 0 });
    expect(notifyConversationWaiting).not.toHaveBeenCalled();
  });

  it("the same signal twice opens one card", async () => {
    beforeEach_();
    await openInterventionsForSignals({} as never, { agencyId: AGENCY, conversationId: CONVERSATION, codes: ["PAYMENT_CLAIM_UNVERIFIED", "PAYMENT_CLAIM_UNVERIFIED"] });
    expect(openIntervention).toHaveBeenCalledTimes(1);
  });

  it("a failed notification never undoes the card", async () => {
    beforeEach_();
    vi.spyOn(console, "error").mockImplementation(() => {});
    listActiveStaffIdsByRole.mockRejectedValueOnce(new Error("staff table unreadable"));
    expect(await openInterventionsForSignals({} as never, { agencyId: AGENCY, conversationId: CONVERSATION, codes: ["REFUND_REQUEST"] })).toEqual({ opened: 1, notified: 0 });
  });

  it("S0 red flags become cards too: refund and distress block, the bank flag blocks", async () => {
    beforeEach_();
    await openInterventionsForSignals({} as never, { agencyId: AGENCY, conversationId: CONVERSATION, codes: ["REFUND_REQUEST", "DISTRESS_LANGUAGE", "BANK_DETAIL_MISMATCH"] });
    expect(openIntervention.mock.calls.map((call) => (call[2] as { kind: string; severity: string }).kind)).toEqual(["REFUND_REQUEST", "DISTRESSED_CUSTOMER", "BANK_DETAIL_MISMATCH"]);
    expect(openIntervention.mock.calls.every((call) => (call[2] as { severity: string }).severity === "BLOCK")).toBe(true);
  });
});

describe("runRiskForConversation — cards only past SHADOW", () => {
  it("in SHADOW it records signals and opens NO card", async () => {
    openIntervention.mockClear();
    const { db } = fakeDb(seed());
    await runRiskForConversation(db, input());
    expect(openIntervention).not.toHaveBeenCalled();
  });

  it("past SHADOW the same finding opens the payment review", async () => {
    openIntervention.mockClear();
    const { db } = fakeDb(seed());
    const outcome = await runRiskForConversation(db, input({ openInterventions: true }));
    expect(outcome.fired).toContain("PAYMENT_CLAIM_UNVERIFIED");
    expect(openIntervention).toHaveBeenCalledWith(db, AGENCY, expect.objectContaining({ kind: "PAYMENT_CLAIM" }));
  });
});

describe("loadProtectionContext — the gate's inputs", () => {
  it("reads the open reviews and the approved accounts fresh", async () => {
    findOpenInterventions.mockResolvedValueOnce([{ kind: "PAYMENT_CLAIM", severity: "BLOCK", headline: "Says they paid", status: "OPEN" }]);
    const { db } = fakeDb({ agency_payment_accounts: [{ agency_id: AGENCY, account_digits: "123456789012", active: true }] });
    expect(await loadProtectionContext(db, AGENCY, "c1")).toEqual({ openReviews: [{ kind: "PAYMENT_CLAIM", severity: "BLOCK", headline: "Says they paid" }], approvedAccountDigits: ["123456789012"] });
  });

  it("throws when the open reviews cannot be read: unknown is not clear", async () => {
    findOpenInterventions.mockRejectedValueOnce(new Error("exploded"));
    await expect(loadProtectionContext(fakeDb({}).db, AGENCY, "c1")).rejects.toThrow("exploded");
  });

  it("throws when the approved accounts cannot be read", async () => {
    findOpenInterventions.mockResolvedValueOnce([]);
    await expect(loadProtectionContext(fakeDb({ agency_payment_accounts: [] }, "agency_payment_accounts").db, AGENCY, "c1")).rejects.toThrow("exploded");
  });
});

describe("runRiskForConversation — the judgement flags (MI4.3)", () => {
  const reading = (flag: string, source: string, confidence = 0.85) => ({ flag, confidence, snippet: "we are scared", source });
  const outcomeOf = (over: Record<string, unknown>) => classifyRisk.mockResolvedValue({ readings: [], source: "NONE", note: null, modelCalls: 0, aiRunId: null, unread: false, ...over });

  it("does not run at all unless asked (callers that never classify are unchanged)", async () => {
    classifyRisk.mockClear();
    recordSignals.mockClear();
    const { db } = fakeDb(seed());
    const outcome = await runRiskForConversation(db, input());
    expect(classifyRisk).not.toHaveBeenCalled();
    expect(outcome.classification).toBeUndefined();
  });

  it("passes the newest customer message and the earlier ones, and whether the model is allowed", async () => {
    classifyRisk.mockClear();
    outcomeOf({});
    const { db } = fakeDb(seed());
    await runRiskForConversation(db, input({ classifyModel: true, messages: [message("m0", "CUSTOMER", "Salaam", 5), message("s", "STAFF", "Hello", 4), message(M1, "CUSTOMER", "We are scared", 1)] }));
    expect(classifyRisk).toHaveBeenCalledWith(expect.objectContaining({ agencyId: AGENCY, conversationId: "c1", text: "We are scared", earlier: ["Salaam"], allowModel: true, db }));
    classifyRisk.mockClear();
    await runRiskForConversation(db, input({ classifyModel: false }));
    expect(classifyRisk).toHaveBeenCalledWith(expect.objectContaining({ allowModel: false }));
  });

  it("records a model reading as a MODEL signal and a rule reading as a RULE signal, on the message that caused it", async () => {
    recordSignals.mockClear();
    outcomeOf({ source: "MODEL", modelCalls: 1, readings: [reading("DISTRESS", "MODEL"), reading("COMPLAINT", "RULE", 0.9)] });
    const { db } = fakeDb(seed());
    const outcome = await runRiskForConversation(db, input({ classifyModel: true }));
    const recorded = recordSignals.mock.calls.at(-1)?.[3] as Array<Record<string, unknown>>;
    expect(recorded.find((signal) => signal.signalCode === "DISTRESS_LANGUAGE")).toMatchObject({ detector: "MODEL", messageId: M1, confidence: 0.85, evidence: [{ messageId: M1, snippet: "we are scared" }] });
    expect(recorded.find((signal) => signal.signalCode === "COMPLAINT_ESCALATION")).toMatchObject({ detector: "RULE", confidence: 0.9 });
    expect(outcome.classification).toMatchObject({ source: "MODEL", modelCalls: 1 });
  });

  it("a fallback cue is recorded as a RULE signal at low confidence: a model outage is never 'no risk'", async () => {
    recordSignals.mockClear();
    outcomeOf({ source: "FALLBACK", note: "AI call failed", readings: [reading("MEDICAL_URGENCY", "RULE_FALLBACK", 0.5)] });
    const { db } = fakeDb(seed());
    await runRiskForConversation(db, input({ classifyModel: true }));
    const recorded = recordSignals.mock.calls.at(-1)?.[3] as Array<Record<string, unknown>>;
    expect(recorded.find((signal) => signal.signalCode === "MEDICAL_URGENCY")).toMatchObject({ detector: "RULE", confidence: 0.5 });
  });

  it("an unread message is reported with a 'could not check this message' signal", async () => {
    recordSignals.mockClear();
    outcomeOf({ source: "FALLBACK", unread: true });
    const { db } = fakeDb(seed());
    await runRiskForConversation(db, input({ classifyModel: true }));
    const recorded = recordSignals.mock.calls.at(-1)?.[3] as Array<Record<string, unknown>>;
    expect(recorded.find((signal) => signal.signalCode === "LOW_CONFIDENCE_DRAFT")).toMatchObject({ evidence: [{ messageId: M1, snippet: expect.stringContaining("Could not check this message") }] });
  });

  it("the judgement flags open review cards only past SHADOW, like every other detector", async () => {
    outcomeOf({ readings: [reading("FRAUD_CONCERN", "RULE", 0.9)] });
    const { db } = fakeDb(seed());
    openIntervention.mockClear();
    await runRiskForConversation(db, input({ classifyModel: false }));
    expect(openIntervention.mock.calls.filter((call) => (call[2] as { kind: string }).kind === "FRAUD_CONCERN")).toHaveLength(0);
    await runRiskForConversation(db, input({ classifyModel: false, openInterventions: true }));
    expect(openIntervention).toHaveBeenCalledWith(db, AGENCY, expect.objectContaining({ kind: "FRAUD_CONCERN", severity: "BLOCK", assignedRole: "FINANCE" }));
  });
});
