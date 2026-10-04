import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QueueCode } from "@/lib/inbox/intelligence/contracts";

vi.mock("server-only", () => ({}));

const recordSignals = vi.fn<(...args: unknown[]) => Promise<number>>(async () => 1);
const supersedeSignals = vi.fn<(...args: unknown[]) => Promise<number>>(async () => 1);
const openIntervention = vi.fn<(...args: unknown[]) => Promise<{ intervention: object; created: boolean }>>(async () => ({ intervention: {}, created: true }));
vi.mock("@/lib/data/conversation-intelligence-repository", () => ({
  recordSignals: (...args: unknown[]) => recordSignals(...args),
  supersedeSignals: (...args: unknown[]) => supersedeSignals(...args),
  openIntervention: (...args: unknown[]) => openIntervention(...args),
}));

const { DEFAULT_SLA_POLICIES } = await import("./policies");
const { parseWorkingHours } = await import("./business-hours");
const loadSlaSettings = vi.fn();
vi.mock("@/lib/data/inbox-sla-repository", () => ({ loadSlaSettings: (...args: unknown[]) => loadSlaSettings(...args) }));

const { planSlaSweep, runSlaSweepForAgency } = await import("./sweep");
import type { SweepConversation } from "./sweep";

const TZ = "Asia/Colombo";
const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const colombo = (text: string) => new Date(`${text}+05:30`);
const calendar = parseWorkingHours({ weekly: { mon: ["09:00-17:00"], tue: ["09:00-17:00"], wed: ["09:00-17:00"], thu: ["09:00-17:00"], fri: ["09:00-17:00"], sat: ["09:00-13:00"] } });
const policies = new Map(DEFAULT_SLA_POLICIES.map((policy) => [policy.queueCode, policy]));
const MONDAY_10 = colombo("2026-09-21T10:00:00");

const conversation = (id: string, queues: QueueCode[], overrides: Partial<SweepConversation> = {}): SweepConversation => ({
  id,
  lastInboundAt: MONDAY_10,
  lastOutboundAt: null,
  serviceWindowExpiresAt: null,
  slaDueAt: null,
  memberships: queues.map((queueCode) => ({ queueCode, enteredAt: MONDAY_10 })),
  ...overrides,
});

const plan = (conversations: SweepConversation[], now: Date) => planSlaSweep({ conversations, policies, calendar, timezone: TZ, now });

describe("planSlaSweep", () => {
  it("a complaint 20 minutes past its 15-minute target: writes the deadline, refreshes the queues, records the signal and opens the review", () => {
    const [item] = plan([conversation("c1", ["NEEDS_REPLY", "COMPLAINTS"])], colombo("2026-09-21T10:35:00"));
    expect(item.newDueAt?.toISOString()).toBe(colombo("2026-09-21T10:15:00").toISOString());
    expect(item).toMatchObject({ writeDueAt: true, band: "BREACHED", refreshQueues: true });
    expect(item.breach.recordSignal).toBe(true);
    expect(item.breach.intervention).not.toBeNull();
  });

  it("an ordinary unanswered message breaches with a signal only, no intervention", () => {
    const [item] = plan([conversation("c1", ["NEEDS_REPLY"])], colombo("2026-09-21T11:05:00"));
    expect(item.band).toBe("BREACHED");
    expect(item.breach).toMatchObject({ recordSignal: true, intervention: null });
  });

  it("a conversation parked on the customer never breaches, even with an old stored deadline: it is cleared and its signal superseded", () => {
    const parked = conversation("c1", ["WAITING_CUSTOMER", "SLA_BREACHED"], {
      lastOutboundAt: colombo("2026-09-21T10:05:00"),
      slaDueAt: colombo("2026-09-21T10:15:00"),
    });
    const [item] = plan([parked], colombo("2026-09-25T10:00:00"));
    expect(item).toMatchObject({ newDueAt: null, writeDueAt: true, band: "NONE", refreshQueues: true });
    expect(item.breach).toEqual({ recordSignal: false, supersedeSignal: true, intervention: null });
  });

  it("exit criterion: not one of fifty paused conversations breaches, a week on", () => {
    const paused = Array.from({ length: 50 }, (_, index) =>
      conversation(`p${index}`, ["WAITING_CUSTOMER"], { lastOutboundAt: colombo("2026-09-21T10:05:00") }),
    );
    const items = plan(paused, colombo("2026-09-28T10:00:00"));
    expect(items.filter((item) => item.band !== "NONE" || item.breach.recordSignal || item.breach.intervention)).toEqual([]);
    expect(items.every((item) => !item.writeDueAt && !item.refreshQueues)).toBe(true);
  });

  it("leaves a conversation alone when nothing changed: same stored deadline, membership already matches", () => {
    const steady = conversation("c1", ["NEEDS_REPLY"], { slaDueAt: colombo("2026-09-21T11:00:00") });
    const [item] = plan([steady], colombo("2026-09-21T10:10:00"));
    expect(item).toMatchObject({ writeDueAt: false, band: "NONE", refreshQueues: false });
    expect(item.breach).toEqual({ recordSignal: false, supersedeSignal: false, intervention: null });
  });

  it("puts a conversation into NEARING_DEADLINE 30 minutes out, and refreshes when its membership lags the clock", () => {
    const stored = { slaDueAt: colombo("2026-09-21T11:00:00") };
    const [near] = plan([conversation("c1", ["NEEDS_REPLY"], stored)], colombo("2026-09-21T10:40:00"));
    expect(near).toMatchObject({ band: "NEARING", writeDueAt: false, refreshQueues: true });
    const [alreadyNear] = plan([conversation("c1", ["NEEDS_REPLY", "NEARING_DEADLINE"], stored)], colombo("2026-09-21T10:40:00"));
    expect(alreadyNear.refreshQueues).toBe(false);
    const [nowBreached] = plan([conversation("c1", ["NEEDS_REPLY", "NEARING_DEADLINE"], stored)], colombo("2026-09-21T11:01:00"));
    expect(nowBreached).toMatchObject({ band: "BREACHED", writeDueAt: false, refreshQueues: true });
  });

  it("does not treat the deadline queues as inputs: SLA_BREACHED membership alone gives a conversation no target", () => {
    const [item] = plan([conversation("c1", ["SLA_BREACHED"], { slaDueAt: colombo("2026-09-21T10:15:00") })], colombo("2026-09-21T12:00:00"));
    expect(item.newDueAt).toBeNull();
    expect(item.band).toBe("NONE");
  });

  it("the channel window brings the deadline forward and breaches on it", () => {
    const window = { serviceWindowExpiresAt: colombo("2026-09-21T12:00:00") };
    const [item] = plan([conversation("c1", ["NEEDS_REPLY", "COMPLAINTS"], window)], colombo("2026-09-21T10:00:00"));
    expect(item.newDueAt?.toISOString()).toBe(colombo("2026-09-21T10:00:00").toISOString());
    expect(item.band).toBe("BREACHED");
    expect(item.breach.intervention?.headline).toBe("This customer's messaging window is about to close");
  });
});

/* ── The run: load, apply, and be idempotent ──────────────────────────────── */

type Row = Record<string, unknown>;

function fakeDb(initial: { conversations: Row[]; membership: Row[] }) {
  const state = { conversations: initial.conversations.map((row) => ({ ...row })), membership: initial.membership.map((row) => ({ ...row })) };
  const calls = { updates: [] as Array<{ id: string; sla_due_at: unknown }>, refreshed: [] as string[] };
  const builder = (table: "conversations" | "conversation_queue_membership") => {
    const filters: Array<(row: Row) => boolean> = [];
    let order: { column: string } | null = null;
    let max = Infinity;
    let patch: Row | null = null;
    const rows = () => state[table === "conversations" ? "conversations" : "membership"];
    const run = () => {
      let out = rows().filter((row) => filters.every((filter) => filter(row)));
      if (order) out = [...out].sort((a, b) => (String(a[order!.column]) < String(b[order!.column]) ? -1 : 1));
      return out.slice(0, max);
    };
    const api: Record<string, unknown> = {
      select: () => api,
      update: (values: Row) => {
        patch = values;
        return api;
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return api;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return api;
      },
      not: (column: string, _operator: string, value: unknown) => {
        filters.push((row) => (row[column] ?? null) !== value);
        return api;
      },
      order: (column: string) => {
        order = { column };
        return api;
      },
      limit: (count: number) => {
        max = count;
        return api;
      },
      then: (resolve: (value: unknown) => unknown) => {
        if (patch) {
          for (const row of run()) {
            Object.assign(row, patch);
            calls.updates.push({ id: String(row.id), sla_due_at: patch.sla_due_at });
          }
          return Promise.resolve({ data: null, error: null }).then(resolve);
        }
        return Promise.resolve({ data: run(), error: null }).then(resolve);
      },
    };
    return api;
  };
  const db = {
    from: (table: string) => builder(table as "conversations"),
    // The database recomputes membership from sla_due_at; the fake mirrors just the two deadline queues.
    rpc: async (_name: string, args: { p_conversation_id: string }) => {
      calls.refreshed.push(args.p_conversation_id);
      const row = state.conversations.find((candidate) => candidate.id === args.p_conversation_id);
      state.membership = state.membership.filter((member) => !(member.conversation_id === args.p_conversation_id && (member.queue_code === "SLA_BREACHED" || member.queue_code === "NEARING_DEADLINE")));
      const due = row?.sla_due_at ? new Date(String(row.sla_due_at)).getTime() : null;
      const now = NOW.getTime();
      if (due !== null && due <= now) state.membership.push({ agency_id: AGENCY, conversation_id: args.p_conversation_id, queue_code: "SLA_BREACHED", entered_at: NOW.toISOString() });
      else if (due !== null && due - now < 30 * 60_000) state.membership.push({ agency_id: AGENCY, conversation_id: args.p_conversation_id, queue_code: "NEARING_DEADLINE", entered_at: NOW.toISOString() });
      return { error: null };
    },
  };
  return { db: db as never, state, calls };
}

const NOW = colombo("2026-09-21T10:40:00");
const member = (conversationId: string, queueCode: string) => ({ agency_id: AGENCY, conversation_id: conversationId, queue_code: queueCode, entered_at: MONDAY_10.toISOString() });
const convRow = (id: string, extra: Row = {}): Row => ({
  id,
  agency_id: AGENCY,
  last_inbound_at: MONDAY_10.toISOString(),
  last_outbound_at: null,
  service_window_expires_at: null,
  sla_due_at: null,
  ...extra,
});

describe("runSlaSweepForAgency", () => {
  beforeEach(() => {
    recordSignals.mockClear();
    supersedeSignals.mockClear();
    openIntervention.mockClear();
    loadSlaSettings.mockReset();
    loadSlaSettings.mockResolvedValue({ policies, calendar, hasCalendar: true, timezone: TZ });
  });

  it("finds waiting and deadline-bearing conversations, writes deadlines, refreshes queues, records breaches and opens the review", async () => {
    const { db, state, calls } = fakeDb({
      conversations: [
        convRow("waiting-complaint"), // due 10:15 → breached at 10:40
        convRow("waiting-normal"), // due 11:00 → nearing at 10:40
        convRow("parked", { last_outbound_at: colombo("2026-09-21T10:05:00").toISOString(), sla_due_at: colombo("2026-09-21T10:15:00").toISOString() }),
      ],
      membership: [member("waiting-complaint", "NEEDS_REPLY"), member("waiting-complaint", "COMPLAINTS"), member("waiting-normal", "NEEDS_REPLY"), member("parked", "WAITING_CUSTOMER"), member("parked", "SLA_BREACHED")],
    });

    const summary = await runSlaSweepForAgency(db, AGENCY, { now: NOW });
    expect(summary).toMatchObject({ examined: 3, deadlinesWritten: 3, queuesRefreshed: 3, breached: 1, interventionsOpened: 1, failed: 0 });

    expect(state.conversations.find((row) => row.id === "waiting-complaint")?.sla_due_at).toBe(colombo("2026-09-21T10:15:00").toISOString());
    expect(state.conversations.find((row) => row.id === "parked")?.sla_due_at).toBeNull();
    const queuesOf = (id: string) => state.membership.filter((row) => row.conversation_id === id).map((row) => row.queue_code);
    expect(queuesOf("waiting-complaint")).toContain("SLA_BREACHED");
    expect(queuesOf("waiting-normal")).toContain("NEARING_DEADLINE");
    expect(queuesOf("parked")).not.toContain("SLA_BREACHED");
    expect(calls.refreshed.sort()).toEqual(["parked", "waiting-complaint", "waiting-normal"]);

    expect(recordSignals).toHaveBeenCalledTimes(1);
    expect(recordSignals).toHaveBeenCalledWith(expect.anything(), AGENCY, "waiting-complaint", [expect.objectContaining({ signalCode: "SLA_BREACHED", detector: "RULE" })]);
    expect(openIntervention).toHaveBeenCalledWith(expect.anything(), AGENCY, expect.objectContaining({ conversationId: "waiting-complaint", kind: "SLA_BREACH", severity: "REVIEW", requiredActionCode: "ESCALATE_TO_HUMAN" }));
    expect(supersedeSignals).toHaveBeenCalledWith(expect.anything(), AGENCY, "parked", { codes: ["SLA_BREACHED"] });
  });

  it("is idempotent: a second sweep over the result writes nothing and refreshes nothing", async () => {
    const { db, calls } = fakeDb({
      conversations: [convRow("waiting-complaint"), convRow("waiting-normal")],
      membership: [member("waiting-complaint", "NEEDS_REPLY"), member("waiting-complaint", "COMPLAINTS"), member("waiting-normal", "NEEDS_REPLY")],
    });
    await runSlaSweepForAgency(db, AGENCY, { now: NOW });
    const updatesAfterFirst = calls.updates.length;
    const refreshedAfterFirst = calls.refreshed.length;

    const second = await runSlaSweepForAgency(db, AGENCY, { now: NOW });
    expect(second).toMatchObject({ deadlinesWritten: 0, queuesRefreshed: 0, failed: 0 });
    expect(calls.updates.length).toBe(updatesAfterFirst);
    expect(calls.refreshed.length).toBe(refreshedAfterFirst);
  });

  it("scopes every load and write to the agency", async () => {
    const { db } = fakeDb({
      conversations: [convRow("mine"), { ...convRow("theirs"), agency_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
      membership: [member("mine", "NEEDS_REPLY"), { ...member("theirs", "NEEDS_REPLY"), agency_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
    });
    const summary = await runSlaSweepForAgency(db, AGENCY, { now: NOW });
    expect(summary.examined).toBe(1);
  });

  it("one conversation failing does not stop the rest, and is counted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    recordSignals.mockRejectedValueOnce(new Error("signals down"));
    const { db } = fakeDb({
      conversations: [convRow("first"), convRow("second")],
      membership: [member("first", "NEEDS_REPLY"), member("second", "NEEDS_REPLY")],
    });
    const summary = await runSlaSweepForAgency(db, AGENCY, { now: colombo("2026-09-21T12:00:00") });
    expect(summary.failed).toBe(1);
    expect(summary.examined).toBe(2);
    expect(recordSignals).toHaveBeenCalledTimes(2);
  });

  it("does nothing for an agency with no waiting conversations", async () => {
    const { db } = fakeDb({ conversations: [], membership: [] });
    expect(await runSlaSweepForAgency(db, AGENCY, { now: NOW })).toEqual({ examined: 0, deadlinesWritten: 0, queuesRefreshed: 0, breached: 0, interventionsOpened: 0, failed: 0 });
  });
});
