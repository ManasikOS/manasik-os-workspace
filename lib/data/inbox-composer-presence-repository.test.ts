import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const recordSignals = vi.fn();
const supersedeSignals = vi.fn();
vi.mock("@/lib/data/conversation-intelligence-repository", () => ({
  recordSignals: (...args: unknown[]) => recordSignals(...args),
  supersedeSignals: (...args: unknown[]) => supersedeSignals(...args),
}));

const { syncConcurrentComposerSignal } = await import("./inbox-composer-presence-repository");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONVERSATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-09-21T10:00:00.000Z");

function databaseWithComposer(row: { composing_by: string | null; composing_at: string | null }) {
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const query = { maybeSingle };
  const equals = { eq: vi.fn(() => query) };
  return {
    from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => equals) })) })),
  };
}

describe("syncConcurrentComposerSignal", () => {
  beforeEach(() => {
    recordSignals.mockReset();
    supersedeSignals.mockReset();
    recordSignals.mockResolvedValue(1);
    supersedeSignals.mockResolvedValue(1);
  });

  it("writes the transient CONCURRENT_COMPOSER signal while a lease is fresh", async () => {
    const db = databaseWithComposer({
      composing_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      composing_at: "2026-09-21T09:59:30.000Z",
    });
    await syncConcurrentComposerSignal(db as never, { agencyId: AGENCY, conversationId: CONVERSATION, now: NOW });
    expect(recordSignals).toHaveBeenCalledWith(expect.anything(), AGENCY, CONVERSATION, [
      expect.objectContaining({ signalCode: "CONCURRENT_COMPOSER", detector: "RULE" }),
    ]);
    expect(supersedeSignals).not.toHaveBeenCalled();
  });

  it("supersedes it once a stale claim no longer represents a colleague writing", async () => {
    const db = databaseWithComposer({
      composing_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      composing_at: "2026-09-21T09:57:59.999Z",
    });
    await syncConcurrentComposerSignal(db as never, { agencyId: AGENCY, conversationId: CONVERSATION, now: NOW });
    expect(recordSignals).not.toHaveBeenCalled();
    expect(supersedeSignals).toHaveBeenCalledWith(expect.anything(), AGENCY, CONVERSATION, {
      codes: ["CONCURRENT_COMPOSER"],
    });
  });
});
