import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BUG-11 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): the SLA, retention and email-poll routes now stop starting agencies when
 * their time budget is spent, start each run at a different agency, and (retention) no longer let one failing agency end the whole run.
 */

vi.mock("server-only", () => ({}));

const SECRET = "test-secret";
const SLA_SLICE_MS = 2 * 60_000;

const work = vi.hoisted(() => ({
  runSlaSweepForAgency: vi.fn(),
  repairMissingEnrichJobs: vi.fn(),
  repairMissingMediaJobs: vi.fn(),
  runRetentionSweepForAgency: vi.fn(),
  runInboxHousekeeping: vi.fn(),
  pollAgencyMailbox: vi.fn(),
}));
vi.mock("@/lib/inbox/sla/sweep", () => ({ runSlaSweepForAgency: work.runSlaSweepForAgency }));
vi.mock("@/lib/inbox/jobs/repair", () => ({ repairMissingEnrichJobs: work.repairMissingEnrichJobs, repairMissingMediaJobs: work.repairMissingMediaJobs }));
vi.mock("@/lib/inbox/retention/sweep", () => ({ runRetentionSweepForAgency: work.runRetentionSweepForAgency }));
vi.mock("@/lib/inbox/retention/housekeeping", () => ({ runInboxHousekeeping: work.runInboxHousekeeping }));
vi.mock("@/lib/channels/email/imap-poll", () => ({ pollAgencyMailbox: work.pollAgencyMailbox }));

const agencyIds = ["a", "b", "c", "d"];
vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = { select: () => builder, eq: () => builder, order: () => builder };
      builder.then = (resolve: (value: unknown) => unknown) =>
        resolve({ data: table === "agencies" ? agencyIds.map((id) => ({ id })) : agencyIds.map((id) => ({ agency_id: id })), error: null });
      return builder;
    },
    rpc: async () => ({ data: 0, error: null }),
  }),
}));

const request = { headers: new Headers({ authorization: `Bearer ${SECRET}` }), nextUrl: new URL("https://example.test/") } as never;

/** The time a run's work takes is spent on the (fake) clock, so "slow agencies" need no real waiting. */
const spend = (ms: number) => vi.setSystemTime(Date.now() + ms);

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  for (const mock of Object.values(work)) mock.mockReset();
  work.repairMissingEnrichJobs.mockResolvedValue(0);
  work.repairMissingMediaJobs.mockResolvedValue(0);
  work.runInboxHousekeeping.mockResolvedValue({ failures: 0, orphanUploadsRemoved: 0 });
  work.runSlaSweepForAgency.mockResolvedValue({ examined: 1, deadlinesWritten: 0, queuesRefreshed: 0, breached: 0, interventionsOpened: 0, failed: 0 });
  work.runRetentionSweepForAgency.mockResolvedValue([{ rowsDeleted: 1, error: null }]);
  work.pollAgencyMailbox.mockImplementation(async (_db: unknown, agencyId: string) => ({ agencyId, status: "ok", processed: 1, skipped: 0 }));
  process.env.CRON_SECRET = SECRET;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const visitedBy = (mock: { mock: { calls: unknown[][] } }, argument: number) => mock.mock.calls.map((call) => call[argument] as string);

describe("inbox-sla", () => {
  it("BUG-11: stops starting agencies when the budget is spent, reports how many wait, and still answers 200", async () => {
    vi.setSystemTime(0);
    work.runSlaSweepForAgency.mockImplementation(async () => { spend(20_000); return { examined: 1, deadlinesWritten: 0, queuesRefreshed: 0, breached: 0, interventionsOpened: 0, failed: 0 }; });
    const { GET } = await import("@/app/api/cron/inbox-sla/route");
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ agencies: 3, notReached: 1, failedAgencies: 0 });
    expect(visitedBy(work.runSlaSweepForAgency, 1)).toEqual(["a", "b", "c"]);
  });

  it("BUG-11: the next run starts one agency further along, so the one left out goes earlier", async () => {
    vi.setSystemTime(SLA_SLICE_MS);
    work.runSlaSweepForAgency.mockImplementation(async () => { spend(20_000); return { examined: 1, deadlinesWritten: 0, queuesRefreshed: 0, breached: 0, interventionsOpened: 0, failed: 0 }; });
    const { GET } = await import("@/app/api/cron/inbox-sla/route");
    await GET(request);
    expect(visitedBy(work.runSlaSweepForAgency, 1)).toEqual(["b", "c", "d"]);
  });

  it("visits every agency when there is time, and one agency failing still gives a 500 without stopping the rest", async () => {
    vi.setSystemTime(0);
    work.runSlaSweepForAgency.mockImplementation(async (_db: unknown, agencyId: string) => {
      if (agencyId === "b") throw new Error("boom");
      return { examined: 1, deadlinesWritten: 0, queuesRefreshed: 0, breached: 0, interventionsOpened: 0, failed: 0 };
    });
    const { GET } = await import("@/app/api/cron/inbox-sla/route");
    const response = await GET(request);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ agencies: 3, failedAgencies: 1, notReached: 0 });
    expect(visitedBy(work.runSlaSweepForAgency, 1)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("inbox-retention", () => {
  it("BUG-11: stops starting agencies when its (shorter) budget is spent, and still runs the purge and housekeeping", async () => {
    vi.setSystemTime(0);
    work.runRetentionSweepForAgency.mockImplementation(async () => { spend(20_000); return [{ rowsDeleted: 1, error: null }]; });
    const { GET } = await import("@/app/api/cron/inbox-retention/route");
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ agencies: 2, notReached: 2, rowsDeleted: 2 });
    expect(work.runInboxHousekeeping).toHaveBeenCalledTimes(1);
  });

  it("BUG-11: an agency that throws is counted as a failure and the remaining agencies still run", async () => {
    vi.setSystemTime(0);
    work.runRetentionSweepForAgency.mockImplementation(async (_db: unknown, agencyId: string) => {
      if (agencyId === "a") throw new Error("boom");
      return [{ rowsDeleted: 1, error: null }];
    });
    const { GET } = await import("@/app/api/cron/inbox-retention/route");
    const response = await GET(request);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ agencies: 3, failures: 1, rowsDeleted: 3 });
    expect(visitedBy(work.runRetentionSweepForAgency, 1)).toEqual(["a", "b", "c", "d"]);
    expect(work.runInboxHousekeeping).toHaveBeenCalledTimes(1);
  });
});

describe("inbox-email-poll", () => {
  it("BUG-11: rotates its starting mailbox, as well as stopping at its deadline", async () => {
    vi.setSystemTime(2 * SLA_SLICE_MS);
    work.pollAgencyMailbox.mockImplementation(async (_db: unknown, agencyId: string) => { spend(20_000); return { agencyId, status: "ok", processed: 1, skipped: 0 }; });
    const { GET } = await import("@/app/api/cron/inbox-email-poll/route");
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mailboxes: 4, polled: 3 });
    expect(visitedBy(work.pollAgencyMailbox, 1)).toEqual(["c", "d", "a"]);
  });
});
