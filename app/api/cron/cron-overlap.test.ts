import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T5 (tasks/plan.md): pg_cron fires a job on a clock, so a run that takes longer than its interval overlaps the next one.
 * For every cron route this starts TWO authorised requests at the same moment, holds the underlying work open until both have
 * started, then lets them finish. It proves the routes themselves are safe to overlap: neither request blocks, shares state with,
 * or alters the answer of the other, and a missing or wrong secret never reaches any work.
 *
 * What it cannot prove is that the database stops a double effect when two requests do reach the same row. That guarantee lives in
 * SQL and in the ledger, and is checked in lib/inbox/cron-dedupe-guarantees.test.ts.
 */

vi.mock("server-only", () => ({}));

const SECRET = "test-secret";

const work = vi.hoisted(() => ({
  gate: null as Promise<void> | null,
  processDueJobs: vi.fn(),
  processDueInboxOutbox: vi.fn(),
  processAllLanes: vi.fn(),
  processLane: vi.fn(),
  depthByLane: vi.fn(),
  drainDeliveryEvents: vi.fn(),
  reconcileRawEvents: vi.fn(),
  runSlaSweepForAgency: vi.fn(),
  repairMissingEnrichJobs: vi.fn(),
  repairMissingMediaJobs: vi.fn(),
  runRetentionSweepForAgency: vi.fn(),
  runInboxHousekeeping: vi.fn(),
  pollAgencyMailbox: vi.fn(),
  listGroupIdsWithExpiredSeatHolds: vi.fn(),
  releaseGroupExpiredSeatHolds: vi.fn(),
  runHandoffAlertSweep: vi.fn(),
  runQuietLeadSweep: vi.fn(),
  runWindowReminderSweepForAgency: vi.fn(),
}));

vi.mock("@/lib/agent/whatsapp/drain", () => ({ processDueJobs: work.processDueJobs }));
vi.mock("@/lib/inbox/intelligence/register-handlers", () => ({}));
vi.mock("@/lib/inbox/outbox/drain", () => ({ processDueInboxOutbox: work.processDueInboxOutbox }));
vi.mock("@/lib/inbox/jobs/drain", () => ({
  processAllLanes: work.processAllLanes,
  processLane: work.processLane,
  CRON_LANE_BUDGETS_MS: { REALTIME: 45_000, BULK: 45_000 },
}));
vi.mock("@/lib/inbox/jobs/queue", () => ({ depthByLane: work.depthByLane }));
vi.mock("@/lib/inbox/delivery/delivery-updates", () => ({ drainDeliveryEvents: work.drainDeliveryEvents }));
vi.mock("@/lib/inbox/reconcile/raw-events", () => ({ reconcileRawEvents: work.reconcileRawEvents }));
vi.mock("@/lib/inbox/sla/sweep", () => ({ runSlaSweepForAgency: work.runSlaSweepForAgency }));
vi.mock("@/lib/inbox/jobs/repair", () => ({
  repairMissingEnrichJobs: work.repairMissingEnrichJobs,
  repairMissingMediaJobs: work.repairMissingMediaJobs,
}));
vi.mock("@/lib/inbox/retention/sweep", () => ({ runRetentionSweepForAgency: work.runRetentionSweepForAgency }));
vi.mock("@/lib/inbox/retention/housekeeping", () => ({ runInboxHousekeeping: work.runInboxHousekeeping }));
vi.mock("@/lib/channels/email/imap-poll", () => ({ pollAgencyMailbox: work.pollAgencyMailbox }));
vi.mock("@/lib/data/departure-groups", () => ({
  listGroupIdsWithExpiredSeatHolds: work.listGroupIdsWithExpiredSeatHolds,
  releaseGroupExpiredSeatHolds: work.releaseGroupExpiredSeatHolds,
}));
vi.mock("@/lib/followups/handoff-alert-sweep", () => ({ runHandoffAlertSweep: work.runHandoffAlertSweep }));
vi.mock("@/lib/followups/quiet-lead-sweep", () => ({ runQuietLeadSweep: work.runQuietLeadSweep }));
vi.mock("@/lib/inbox/window-sweep", () => ({ runWindowReminderSweepForAgency: work.runWindowReminderSweepForAgency }));

const tables: Record<string, unknown[]> = {
  agencies: [{ id: "agency-a" }, { id: "agency-b" }],
  channel_connections: [{ agency_id: "agency-a" }],
};

vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: () => {
    const query = (table: string) => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => resolve({ data: tables[table] ?? [], error: null }),
      };
      return builder;
    };
    return { from: query, rpc: async () => ({ data: 0, error: null }) };
  },
}));

/** Every piece of work waits on the shared gate, so a test decides when both overlapping requests may finish. */
const waitForGate = <T>(value: T) => async () => {
  await work.gate;
  return value;
};

function configureWork() {
  work.processDueJobs.mockImplementation(waitForGate({ processed: 1 }));
  work.processDueInboxOutbox.mockImplementation(waitForGate({ processed: 2 }));
  work.processAllLanes.mockImplementation(waitForGate({ processed: 3 }));
  work.processLane.mockImplementation(waitForGate({ processed: 4, failed: 0 }));
  work.depthByLane.mockResolvedValue({ REALTIME: 0, BULK: 0, DELIVERY: 0 });
  work.drainDeliveryEvents.mockImplementation(waitForGate({ processed: 0, failed: 0, changed: 0 }));
  work.reconcileRawEvents.mockImplementation(waitForGate({ checked: 5, landed: 5, replayed: 0, failed: 0 }));
  work.runSlaSweepForAgency.mockImplementation(waitForGate({ examined: 6, deadlinesWritten: 0, queuesRefreshed: 0, breached: 1, interventionsOpened: 1, failed: 0 }));
  work.repairMissingEnrichJobs.mockResolvedValue(0);
  work.repairMissingMediaJobs.mockResolvedValue(0);
  work.runRetentionSweepForAgency.mockImplementation(waitForGate([{ rowsDeleted: 7, error: null }]));
  work.runInboxHousekeeping.mockResolvedValue({ failures: 0, orphanUploadsRemoved: 0 });
  work.pollAgencyMailbox.mockImplementation(waitForGate({ agencyId: "agency-a", status: "ok", processed: 8, skipped: 0 }));
  work.listGroupIdsWithExpiredSeatHolds.mockResolvedValue(["group-1"]);
  work.releaseGroupExpiredSeatHolds.mockImplementation(waitForGate({ ok: true, result: { releasedBookings: 1, releasedSeats: 2, references: [] } }));
  work.runHandoffAlertSweep.mockImplementation(waitForGate({ waiting: 0, alertsSent: 1, escalationsSent: 0, failed: 0 }));
  work.runQuietLeadSweep.mockImplementation(waitForGate({ considered: 0, sent: 0, dryRun: 0, skipped: 0, failed: 0 }));
  work.runWindowReminderSweepForAgency.mockImplementation(waitForGate({ examined: 3, reminded: 1, alreadyHandled: 1, skipped: 1, notified: 1, failed: 0 }));
}

function requestFor(path: string, authorization?: string) {
  return {
    headers: new Headers(authorization ? { authorization } : {}),
    nextUrl: new URL(`https://example.test${path}`),
  } as never;
}

interface RouteCase {
  name: string;
  path: string;
  load: () => Promise<{ GET: (request: never) => Promise<Response> }>;
  /** The first piece of work the route starts for a request; seeing it called twice proves both requests are in flight together. */
  firstWork: () => ReturnType<typeof vi.fn>;
  /** Every piece of work the route can start, to prove nothing runs for a refused request. */
  allWork: () => Array<ReturnType<typeof vi.fn>>;
}

const ROUTES: RouteCase[] = [
  {
    name: "agent-jobs",
    path: "/api/cron/agent-jobs",
    load: () => import("@/app/api/cron/agent-jobs/route"),
    firstWork: () => work.processDueJobs,
    allWork: () => [work.processDueJobs, work.processDueInboxOutbox, work.processAllLanes, work.drainDeliveryEvents, work.reconcileRawEvents],
  },
  {
    name: "inbox-lanes",
    path: "/api/cron/inbox-lanes",
    load: () => import("@/app/api/cron/inbox-lanes/route"),
    firstWork: () => work.processLane,
    allWork: () => [work.processLane],
  },
  {
    name: "inbox-sla",
    path: "/api/cron/inbox-sla",
    load: () => import("@/app/api/cron/inbox-sla/route"),
    firstWork: () => work.runSlaSweepForAgency,
    allWork: () => [work.runSlaSweepForAgency, work.repairMissingEnrichJobs, work.repairMissingMediaJobs],
  },
  {
    name: "inbox-retention",
    path: "/api/cron/inbox-retention",
    load: () => import("@/app/api/cron/inbox-retention/route"),
    firstWork: () => work.runRetentionSweepForAgency,
    allWork: () => [work.runRetentionSweepForAgency, work.runInboxHousekeeping],
  },
  {
    name: "inbox-email-poll",
    path: "/api/cron/inbox-email-poll",
    load: () => import("@/app/api/cron/inbox-email-poll/route"),
    firstWork: () => work.pollAgencyMailbox,
    allWork: () => [work.pollAgencyMailbox],
  },
  {
    name: "release-seat-holds",
    path: "/api/cron/release-seat-holds",
    load: () => import("@/app/api/cron/release-seat-holds/route"),
    firstWork: () => work.releaseGroupExpiredSeatHolds,
    allWork: () => [work.listGroupIdsWithExpiredSeatHolds, work.releaseGroupExpiredSeatHolds],
  },
  {
    name: "lead-followups",
    path: "/api/cron/lead-followups",
    load: () => import("@/app/api/cron/lead-followups/route"),
    firstWork: () => work.runHandoffAlertSweep,
    allWork: () => [work.runHandoffAlertSweep, work.runQuietLeadSweep],
  },
  {
    name: "reply-window-sweep",
    path: "/api/cron/reply-window-sweep",
    load: () => import("@/app/api/cron/reply-window-sweep/route"),
    firstWork: () => work.runWindowReminderSweepForAgency,
    allWork: () => [work.runWindowReminderSweepForAgency],
  },
];

function openGate() {
  let release!: () => void;
  work.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return release;
}

describe.each(ROUTES)("cron route $name", (route) => {
  beforeEach(() => {
    vi.resetModules();
    for (const mock of Object.values(work)) if (typeof mock === "function") (mock as ReturnType<typeof vi.fn>).mockReset();
    configureWork();
    process.env.CRON_SECRET = SECRET;
  });

  it("lets two overlapping runs both complete with the same answer, neither blocking the other", async () => {
    const release = openGate();
    const { GET } = await route.load();

    const first = GET(requestFor(route.path, `Bearer ${SECRET}`));
    const second = GET(requestFor(route.path, `Bearer ${SECRET}`));

    // Both requests are inside the route, holding work open at the same time, before either is allowed to finish.
    await vi.waitFor(() => expect(route.firstWork().mock.calls.length).toBeGreaterThanOrEqual(2));
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await b.json()).toEqual(await a.json());
  });

  it("answers the same on a run that did not overlap, so overlap changes nothing in the result", async () => {
    const release = openGate();
    release();
    const { GET } = await route.load();

    const alone = await GET(requestFor(route.path, `Bearer ${SECRET}`));
    expect(alone.status).toBe(200);

    const releaseOverlap = openGate();
    const pair = [GET(requestFor(route.path, `Bearer ${SECRET}`)), GET(requestFor(route.path, `Bearer ${SECRET}`))];
    await vi.waitFor(() => expect(route.firstWork().mock.calls.length).toBeGreaterThanOrEqual(3));
    releaseOverlap();
    const [x, y] = await Promise.all(pair);
    const expected = await alone.json();
    expect(await x.json()).toEqual(expected);
    expect(await y.json()).toEqual(expected);
  });

  it("starts no work for a missing or wrong secret, even when a valid run is in flight", async () => {
    const release = openGate();
    const { GET } = await route.load();

    const valid = GET(requestFor(route.path, `Bearer ${SECRET}`));
    await vi.waitFor(() => expect(route.firstWork()).toHaveBeenCalled());
    const callsBefore = route.allWork().map((mock) => mock.mock.calls.length);

    expect((await GET(requestFor(route.path))).status).toBe(401);
    expect((await GET(requestFor(route.path, "Bearer wrong"))).status).toBe(401);
    expect(route.allWork().map((mock) => mock.mock.calls.length)).toEqual(callsBefore);

    release();
    expect((await valid).status).toBe(200);
  });

  it("refuses to run at all when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    const release = openGate();
    release();
    const { GET } = await route.load();
    expect((await GET(requestFor(route.path, "Bearer undefined"))).status).toBe(500);
    for (const mock of route.allWork()) expect(mock).not.toHaveBeenCalled();
  });
});

describe("agent-jobs raw-event reconciler", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const mock of Object.values(work)) if (typeof mock === "function") (mock as ReturnType<typeof vi.fn>).mockReset();
    configureWork();
    process.env.CRON_SECRET = SECRET;
  });

  it("runs the reconciler by itself on every tick, so no separate reconcile job is needed", async () => {
    openGate()();
    const { GET } = await import("@/app/api/cron/agent-jobs/route");
    const response = await GET(requestFor("/api/cron/agent-jobs", `Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(work.reconcileRawEvents).toHaveBeenCalledTimes(1);
    expect((await response.json()).reconciled).toEqual({ checked: 5, landed: 5, replayed: 0, failed: 0 });
  });

  it("answers with the drains and the reconciler only: nothing about Inngest is in the result", async () => {
    openGate()();
    const { GET } = await import("@/app/api/cron/agent-jobs/route");
    const body = await (await GET(requestFor("/api/cron/agent-jobs", `Bearer ${SECRET}`))).json();
    expect(Object.keys(body).sort()).toEqual(["agent", "deliveries", "lanes", "outbox", "reconciled"]);
  });

  it("keeps working when the reconciler fails: the other drains still answer", async () => {
    work.reconcileRawEvents.mockRejectedValue(new Error("boom"));
    openGate()();
    const { GET } = await import("@/app/api/cron/agent-jobs/route");
    const response = await GET(requestFor("/api/cron/agent-jobs", `Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect((await response.json()).reconciled).toEqual({ checked: 0, landed: 0, replayed: 0, failed: 0 });
  });
});
