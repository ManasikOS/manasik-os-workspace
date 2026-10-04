import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const NOW = new Date("2026-10-01T12:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

const checkAndRemind = vi.fn();
const listLedgerForConversations = vi.fn();

vi.mock("@/lib/inbox/window-reminder", async () => {
  const actual = await vi.importActual<typeof import("@/lib/inbox/window-reminder")>("@/lib/inbox/window-reminder");
  return { ...actual, checkAndRemind: (...args: unknown[]) => checkAndRemind(...args) };
});
vi.mock("@/lib/data/conversation-followups-repository", () => ({
  listLedgerForConversations: (...args: unknown[]) => listLedgerForConversations(...args),
}));

const { runWindowReminderSweepForAgency, WINDOW_SWEEP_CANDIDATE_LIMIT } = await import("./window-sweep");

interface ConversationFixture {
  id: string;
  state: string;
  assigned_to_id: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  service_window_expires_at: string | null;
}

const chat = (overrides: Partial<ConversationFixture> & { id: string }): ConversationFixture => ({
  state: "HUMAN_ACTIVE",
  assigned_to_id: "staff-1",
  last_inbound_at: at(-30),
  last_outbound_at: null,
  service_window_expires_at: at(60),
  ...overrides,
});

/** Records every filter the sweep applies, so a test can prove the query is agency-scoped and bounded by the lead time. */
function database(rows: ConversationFixture[], failure?: { message: string }) {
  const filters: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "gt", "lte", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      filters.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) => resolve({ data: failure ? null : rows, error: failure ?? null });
  return { filters, db: { from: (table: string) => (filters.push(["from", table]), builder) } as never };
}

beforeEach(() => {
  checkAndRemind.mockReset();
  listLedgerForConversations.mockReset();
  listLedgerForConversations.mockResolvedValue([]);
  checkAndRemind.mockResolvedValue({ action: "REMIND", notified: 1, alreadySent: false });
});

describe("runWindowReminderSweepForAgency", () => {
  it("asks only for this agency's person-owned chats whose window closes within two hours", async () => {
    const { db, filters } = database([]);
    await runWindowReminderSweepForAgency(db, "agency-a", { now: NOW });

    expect(filters).toContainEqual(["from", "conversations"]);
    expect(filters).toContainEqual(["eq", "agency_id", "agency-a"]);
    expect(filters).toContainEqual(["in", "state", ["HUMAN_REQUESTED", "HUMAN_ACTIVE"]]);
    expect(filters).toContainEqual(["gt", "service_window_expires_at", NOW.toISOString()]);
    expect(filters).toContainEqual(["lte", "service_window_expires_at", at(120)]);
    expect(filters).toContainEqual(["limit", WINDOW_SWEEP_CANDIDATE_LIMIT]);
  });

  it("reminds a person-owned, unanswered chat once, passing the chat's own agency and window", async () => {
    const { db } = database([chat({ id: "c1", service_window_expires_at: at(45) })]);
    const summary = await runWindowReminderSweepForAgency(db, "agency-a", { now: NOW });

    expect(checkAndRemind).toHaveBeenCalledTimes(1);
    expect(checkAndRemind).toHaveBeenCalledWith(db, { agencyId: "agency-a", conversationId: "c1", expectedClosesAt: new Date(at(45)), now: NOW });
    expect(summary).toMatchObject({ examined: 1, reminded: 1, notified: 1, failed: 0 });
  });

  it("does nothing for a chat a person has already answered", async () => {
    const { db } = database([chat({ id: "answered", last_inbound_at: at(-30), last_outbound_at: at(-5) })]);
    const summary = await runWindowReminderSweepForAgency(db, "agency-a", { now: NOW });

    expect(checkAndRemind).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ examined: 1, reminded: 0, skipped: 1 });
  });

  it("does nothing for an assistant-owned or closed chat, even if one slips past the query", async () => {
    const { db } = database([chat({ id: "assistant", state: "AI_ACTIVE" }), chat({ id: "closed", state: "CLOSED" })]);
    const summary = await runWindowReminderSweepForAgency(db, "agency-a", { now: NOW });

    expect(checkAndRemind).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(2);
  });

  it("does nothing when the window has already closed, or has no closing time", async () => {
    const { db } = database([chat({ id: "expired", service_window_expires_at: at(-1) }), chat({ id: "none", service_window_expires_at: null })]);
    const summary = await runWindowReminderSweepForAgency(db, "agency-a", { now: NOW });

    expect(checkAndRemind).not.toHaveBeenCalled();
    expect(summary.reminded).toBe(0);
  });

  it("follows a window that moved: it reads the closing time fresh each run, so a chat the customer wrote to again is judged on its new window", async () => {
    const first = database([chat({ id: "c1", service_window_expires_at: at(30) })]);
    await runWindowReminderSweepForAgency(first.db, "agency-a", { now: NOW });
    const later = database([chat({ id: "c1", service_window_expires_at: at(1_400), last_inbound_at: at(5) })]);
    // The query's own bound would not return a window 23 hours away; if one slipped through, the reminder logic still treats it as due only
    // because the window is open, so the bound in the query is what keeps it out. This asserts the bound is what is passed.
    await runWindowReminderSweepForAgency(later.db, "agency-a", { now: new Date(NOW.getTime() + 10 * 60_000) });
    expect(later.filters).toContainEqual(["lte", "service_window_expires_at", new Date(NOW.getTime() + 10 * 60_000 + 120 * 60_000).toISOString()]);
  });

  describe("exactly once across repeated sweeps", () => {
    it("skips, without calling anything, a chat that already has a finished reminder made after the customer's latest message", async () => {
      listLedgerForConversations.mockResolvedValue([
        { id: "l1", conversation_id: "c1", kind: "WINDOW_REMINDER", sequence: 1, anchor_message_id: "m1", status: "SENT", created_at: at(-10) },
      ]);
      const { db } = database([chat({ id: "c1", last_inbound_at: at(-30) })]);
      const summary = await runWindowReminderSweepForAgency(db, "agency-a", { now: NOW });

      expect(checkAndRemind).not.toHaveBeenCalled();
      expect(summary).toMatchObject({ examined: 1, reminded: 0, alreadyHandled: 1 });
    });

    it("reminds again when the customer wrote after the last reminder, because that is a new unanswered message", async () => {
      listLedgerForConversations.mockResolvedValue([
        { id: "l1", conversation_id: "c1", kind: "WINDOW_REMINDER", sequence: 1, anchor_message_id: "m1", status: "SENT", created_at: at(-90) },
      ]);
      const { db } = database([chat({ id: "c1", last_inbound_at: at(-30) })]);
      await runWindowReminderSweepForAgency(db, "agency-a", { now: NOW });

      expect(checkAndRemind).toHaveBeenCalledTimes(1);
    });

    it("retries a reminder that was claimed but never finished, so a crash cannot lose it", async () => {
      listLedgerForConversations.mockResolvedValue([
        { id: "l1", conversation_id: "c1", kind: "WINDOW_REMINDER", sequence: 1, anchor_message_id: "m1", status: "CLAIMED", created_at: at(-10) },
      ]);
      const { db } = database([chat({ id: "c1", last_inbound_at: at(-30) })]);
      await runWindowReminderSweepForAgency(db, "agency-a", { now: NOW });

      expect(checkAndRemind).toHaveBeenCalledTimes(1);
    });

    it("ignores ledger rows of other kinds and other chats", async () => {
      listLedgerForConversations.mockResolvedValue([
        { id: "l1", conversation_id: "c1", kind: "QUIET_NUDGE", sequence: 1, anchor_message_id: "m1", status: "SENT", created_at: at(-10) },
        { id: "l2", conversation_id: "other", kind: "WINDOW_REMINDER", sequence: 1, anchor_message_id: "m2", status: "SENT", created_at: at(-10) },
      ]);
      const { db } = database([chat({ id: "c1" })]);
      await runWindowReminderSweepForAgency(db, "agency-a", { now: NOW });

      expect(checkAndRemind).toHaveBeenCalledTimes(1);
    });

    it("counts a reminder the ledger says was already sent as handled, not as a new notification", async () => {
      checkAndRemind.mockResolvedValue({ action: "REMIND", notified: 0, alreadySent: true });
      const { db } = database([chat({ id: "c1" })]);
      const summary = await runWindowReminderSweepForAgency(db, "agency-a", { now: NOW });

      expect(summary).toMatchObject({ reminded: 0, alreadyHandled: 1, notified: 0 });
    });

    it("sends one notification across two sweeps over the same chat, using a ledger that the first sweep fills in", async () => {
      const ledger: Array<Record<string, unknown>> = [];
      listLedgerForConversations.mockImplementation(async () => [...ledger]);
      checkAndRemind.mockImplementation(async (_db: unknown, input: { conversationId: string }) => {
        ledger.push({ id: `l${ledger.length}`, conversation_id: input.conversationId, kind: "WINDOW_REMINDER", sequence: 1, anchor_message_id: "m1", status: "SENT", created_at: NOW.toISOString() });
        return { action: "REMIND", notified: 1, alreadySent: false };
      });
      const { db } = database([chat({ id: "c1", last_inbound_at: at(-30) })]);

      const first = await runWindowReminderSweepForAgency(db, "agency-a", { now: NOW });
      const second = await runWindowReminderSweepForAgency(db, "agency-a", { now: new Date(NOW.getTime() + 5 * 60_000) });

      expect(first.notified).toBe(1);
      expect(second.notified).toBe(0);
      expect(second.alreadyHandled).toBe(1);
      expect(checkAndRemind).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps going when one chat fails, and counts it, without echoing its details", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    checkAndRemind.mockRejectedValueOnce(new Error("connection reset for customer +123456789")).mockResolvedValueOnce({ action: "REMIND", notified: 1, alreadySent: false });
    const { db } = database([chat({ id: "c1" }), chat({ id: "c2" })]);
    const summary = await runWindowReminderSweepForAgency(db, "agency-a", { now: NOW });

    expect(summary).toMatchObject({ reminded: 1, failed: 1, notified: 1 });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("123456789");
    errors.mockRestore();
  });

  it("stops at its time budget and leaves the rest for the next run", async () => {
    const { db } = database([chat({ id: "c1" }), chat({ id: "c2" })]);
    const summary = await runWindowReminderSweepForAgency(db, "agency-a", { now: NOW, deadlineMs: Date.now() - 1 });

    expect(checkAndRemind).not.toHaveBeenCalled();
    expect(summary.reminded).toBe(0);
  });

  it("fails loudly when the chats cannot be listed, so the route reports an error instead of a quiet zero", async () => {
    const { db } = database([], { message: "permission denied" });
    await expect(runWindowReminderSweepForAgency(db, "agency-a", { now: NOW })).rejects.toThrow(/Could not list chats whose reply window is closing/);
  });

  it("never reads message text: the only columns selected are ids, state, owner and times", async () => {
    const { db, filters } = database([]);
    await runWindowReminderSweepForAgency(db, "agency-a", { now: NOW });
    const selected = filters.find(([method]) => method === "select")?.[1] as string;
    expect(selected.split(",").map((column) => column.trim())).toEqual(["id", "state", "assigned_to_id", "last_inbound_at", "last_outbound_at", "service_window_expires_at"]);
  });
});
