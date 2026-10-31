import { describe, expect, it } from "vitest";

import { checkDisposableAgency, DISPOSABLE_AGENCY_SLUG_PREFIX, STALE_AGENCY_MS, type DisposableAgencyPort, type InboundCounts } from "./disposable-agency";
import { runGate } from "./run-gate";
import type { GateContext } from "./types";

const NOW = new Date("2027-02-16T10:00:00Z");

interface Fake {
  port: DisposableAgencyPort;
  calls: string[];
  removed: string[];
}

function fakePort(overrides: Partial<DisposableAgencyPort> & { counts?: InboundCounts } = {}): Fake {
  const calls: string[] = [];
  const removed: string[] = [];
  const port: DisposableAgencyPort = {
    create: async (input) => {
      calls.push(`create:${input.slug}:${input.phoneNumberId}`);
      return { agencyId: "agency-1" };
    },
    countInbound: async () => overrides.counts ?? { events: 1, conversations: 1, customerMessages: 1 },
    remove: async (agencyId) => {
      calls.push(`remove:${agencyId}`);
      removed.push(agencyId);
    },
    leftovers: async () => [],
    findStale: async () => [],
    ...overrides,
  };
  return { port, calls, removed };
}

/** A webhook endpoint that behaves like the app: it refuses a forged signature, and answers a repeated body "duplicate". */
function fakeApp(options: { rejectValid?: boolean; storeDuplicates?: boolean } = {}) {
  const seen = new Set<string>();
  const sent: Array<{ signature: string | null; body: string }> = [];
  const fetchImpl = (async (_url: URL | string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    const signature = headers["X-Hub-Signature-256"] ?? null;
    const body = String(init?.body);
    sent.push({ signature, body });
    if (signature === `sha256=${"0".repeat(64)}` || signature === null) return new Response("Unauthorized", { status: 401 });
    if (options.rejectValid) return new Response("Unauthorized", { status: 401 });
    if (seen.has(body) && !options.storeDuplicates) return new Response(JSON.stringify({ status: "duplicate" }), { status: 200 });
    seen.add(body);
    return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, sent };
}

function context(port: DisposableAgencyPort | undefined, fetchImpl: typeof fetch, extra: Partial<GateContext> = {}): GateContext {
  return {
    baseUrl: "https://crm.example.test",
    expectedEnvironment: "staging",
    readSnapshot: async () => {
      throw new Error("not used");
    },
    repoMigrationFiles: [],
    verifyTokens: {},
    metaAppSecret: "gate-test-secret",
    disposableAgency: port,
    fetchImpl,
    now: NOW,
    ...extra,
  };
}

describe("G9 disposable-agency acceptance", () => {
  it("passes when a signed event is kept once, a duplicate adds nothing, a forged event is refused, and nothing is left behind", async () => {
    const fake = fakePort();
    const app = fakeApp();
    const outcome = await checkDisposableAgency(context(fake.port, app.fetchImpl));
    expect(outcome).toMatchObject({ id: "G9", status: "PASS" });
    expect(fake.removed).toEqual(["agency-1"]);
    expect(app.sent).toHaveLength(3);
  });

  it("creates a gate agency whose slug and phone number can only be simulator ones", async () => {
    const fake = fakePort();
    await checkDisposableAgency(context(fake.port, fakeApp().fetchImpl));
    const created = fake.calls.find((call) => call.startsWith("create:"));
    expect(created).toMatch(new RegExp(`^create:${DISPOSABLE_AGENCY_SLUG_PREFIX}[0-9a-z]+:sim-gate-[0-9a-z]+$`));
  });

  it("is pending, not a pass, when there is no database access or no app secret to sign with", async () => {
    const app = fakeApp();
    expect((await checkDisposableAgency(context(undefined, app.fetchImpl))).status).toBe("PENDING");
    const fake = fakePort();
    const noSecret = await checkDisposableAgency(context(fake.port, app.fetchImpl, { metaAppSecret: undefined }));
    expect(noSecret.status).toBe("PENDING");
    expect(noSecret.detail).toContain("GATE_META_APP_SECRET");
    expect(fake.calls).toEqual([]);
    expect(app.sent).toHaveLength(0);
  });

  it("fails, and still removes the agency, when a correctly signed event is refused", async () => {
    const fake = fakePort();
    const outcome = await checkDisposableAgency(context(fake.port, fakeApp({ rejectValid: true }).fetchImpl));
    expect(outcome.status).toBe("FAIL");
    expect(outcome.items?.join(" ")).toContain("correctly signed event was answered 401");
    expect(fake.removed).toEqual(["agency-1"]);
  });

  it("fails when the duplicate was stored a second time", async () => {
    const outcome = await checkDisposableAgency(
      context(fakePort({ counts: { events: 2, conversations: 1, customerMessages: 2 } }).port, fakeApp({ storeDuplicates: true }).fetchImpl),
    );
    expect(outcome.status).toBe("FAIL");
    expect(outcome.items?.join(" ")).toContain("not recognised as a duplicate");
    expect(outcome.items?.join(" ")).toContain("2 webhook events");
    expect(outcome.items?.join(" ")).toContain("2 customer messages");
  });

  it("fails when the event reached no conversation", async () => {
    const outcome = await checkDisposableAgency(context(fakePort({ counts: { events: 1, conversations: 0, customerMessages: 0 } }).port, fakeApp().fetchImpl));
    expect(outcome.status).toBe("FAIL");
    expect(outcome.items?.join(" ")).toContain("0 conversations");
  });

  it("fails, naming each table, when rows are left behind after removal", async () => {
    const fake = fakePort({ leftovers: async () => [{ table: "channel_jobs", rows: 2 }, { table: "storage.objects", rows: 1 }] });
    const outcome = await checkDisposableAgency(context(fake.port, fakeApp().fetchImpl));
    expect(outcome.status).toBe("FAIL");
    expect(outcome.items).toEqual(expect.arrayContaining(["after removal, channel_jobs still holds 2 row(s) for the test agency", "after removal, storage.objects still holds 1 row(s) for the test agency"]));
  });

  it("fails and says which agency to remove by hand when the removal itself fails", async () => {
    const fake = fakePort({ remove: async () => { throw new Error("update or delete on table violates foreign key constraint"); } });
    const outcome = await checkDisposableAgency(context(fake.port, fakeApp().fetchImpl));
    expect(outcome.status).toBe("FAIL");
    expect(outcome.items?.join(" ")).toContain("agency-1 could not be removed");
  });

  it("fails without sending anything when the test agency cannot be created", async () => {
    const app = fakeApp();
    const outcome = await checkDisposableAgency(context(fakePort({ create: async () => { throw new Error("permission denied"); } }).port, app.fetchImpl));
    expect(outcome.status).toBe("FAIL");
    expect(outcome.detail).toContain("could not be created");
    expect(app.sent).toHaveLength(0);
  });

  it("removes agencies left by an earlier crashed run, looking only at ones older than an hour", async () => {
    const olderThanSeen: Date[] = [];
    const fake = fakePort({ findStale: async (olderThan) => { olderThanSeen.push(olderThan); return ["stale-1", "stale-2"]; } });
    const outcome = await checkDisposableAgency(context(fake.port, fakeApp().fetchImpl));
    expect(outcome.status).toBe("PASS");
    expect(fake.removed).toEqual(["stale-1", "stale-2", "agency-1"]);
    expect(olderThanSeen[0].getTime()).toBe(NOW.getTime() - STALE_AGENCY_MS);
  });

  it("fails when an older test agency cannot be cleared, instead of ignoring it", async () => {
    let first = true;
    const fake = fakePort({
      findStale: async () => ["stale-1"],
      remove: async (agencyId) => {
        if (first) { first = false; throw new Error("blocked"); }
        fake.removed.push(agencyId);
      },
    });
    const outcome = await checkDisposableAgency(context(fake.port, fakeApp().fetchImpl));
    expect(outcome.status).toBe("FAIL");
    expect(outcome.items?.join(" ")).toContain("could not remove an older test agency (stale-1)");
  });

  it("never puts the app secret in the report", async () => {
    const outcome = await checkDisposableAgency(context(fakePort({ leftovers: async () => [{ table: "x", rows: 1 }] }).port, fakeApp().fetchImpl));
    expect(JSON.stringify(outcome)).not.toContain("gate-test-secret");
  });
});

describe("G9 in the whole gate", () => {
  it("is part of runGate and is no longer a placeholder", async () => {
    const results = await runGate(context(fakePort().port, fakeApp().fetchImpl, { readSnapshot: async () => { throw new Error("skip"); } }));
    const g9 = results.find((entry) => entry.id === "G9");
    expect(g9?.status).toBe("PASS");
  });
});
