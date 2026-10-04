/**
 * Phase 8 — a burst across tenants and channels. Two agencies, each with a Messenger Page and an Instagram
 * account, receive 100 distinct customer messages, every one delivered three times at once (Meta redelivers,
 * and a burst overlaps). The shared store enforces uniqueness the way the real unique index does, with the
 * check-and-write atomic and a delay before every read so all three deliveries of a message see "not stored".
 *
 * What must hold: exactly one reply job per message (no duplicate replies), every message lands under the
 * agency that owns the account it was addressed to and no other, and an event addressed to one agency's
 * account is never processed through another agency's connection.
 *
 * WhatsApp has its own handler (lib/whatsapp/webhook-handler.ts) and is not in this simulation; its
 * idempotency is the same unique index and is pinned by lib/inbox/ingest.test.ts.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => undefined, NextResponse: class {} }));
vi.mock("@/lib/agent/whatsapp/drain", () => ({ processDueJobs: async () => ({ processed: 0, failed: 0 }) }));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import type { ChannelConnectionRecord } from "@/lib/data/channel-connection-repository";
import type { ParsedMessengerEvent } from "@/lib/channels/messenger/webhook";

const { processMessengerEvents } = await import("@/lib/channels/messenger/webhook-handler");
const { reconcileEcho } = await import("@/lib/channels/messenger/echo");

const db = {} as never;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function connection(id: string, agency: string, provider: "MESSENGER" | "INSTAGRAM", account: string): ChannelConnectionRecord {
  return { id, agency_id: agency, provider, provider_account_id: account, display_name: account, status: "CONNECTED", credential_ref: "r", ai_enabled: true, credential_expires_at: null };
}

const A_MS = connection("cc-a-ms", "agency-a", "MESSENGER", "page-a");
const A_IG = connection("cc-a-ig", "agency-a", "INSTAGRAM", "ig-a");
const B_MS = connection("cc-b-ms", "agency-b", "MESSENGER", "page-b");
const B_IG = connection("cc-b-ig", "agency-b", "INSTAGRAM", "ig-b");
const CONNECTIONS = [A_MS, A_IG, B_MS, B_IG];

/** The shared "database": messages unique per agency and external id, plus the reply jobs that were queued. */
function makeWorld() {
  const stored = new Set<string>();
  const jobs: Array<{ agency: string; provider: string; connectionId: string; mid: string }> = [];
  const ingestInputs: Array<{ agencyId: string; provider: string; connectionId: string }> = [];
  const deps = {
    // A delay before the answer is what makes concurrent deliveries all see "not stored yet".
    messageExists: vi.fn(async (_db: unknown, agency: string, mid: string) => {
      await tick();
      return stored.has(`${agency}|${mid}`);
    }),
    getContactName: vi.fn(async () => null),
    ingest: vi.fn(async (_db: unknown, input: { agencyId: string; provider: string; connectionId: string; externalMessageId: string }) => {
      await tick();
      ingestInputs.push({ agencyId: input.agencyId, provider: input.provider, connectionId: input.connectionId });
      const key = `${input.agencyId}|${input.externalMessageId}`;
      // Atomic check-and-write: the unique index.
      if (stored.has(key)) return { status: "duplicate" as const, conversation: {} as never };
      stored.add(key);
      jobs.push({ agency: input.agencyId, provider: input.provider, connectionId: input.connectionId, mid: input.externalMessageId });
      return { status: "stored" as const, conversation: {} as never, message: {} as never, jobId: `job-${jobs.length}` };
    }),
    enqueueJob: vi.fn(async () => "j"),
    patchDelivery: vi.fn(async () => undefined),
    markRead: vi.fn(async () => undefined),
  };
  return { deps, stored, jobs, ingestInputs };
}

const message = (account: string, mid: string): ParsedMessengerEvent => ({
  kind: "message",
  viaPostback: false,
  pageId: account,
  psid: `customer-of-${account}`,
  mid,
  text: "Umrah in March?",
  contentKind: "text",
  attachments: [],
  timestampMs: 1,
});

const deliver = (conn: ChannelConnectionRecord, events: ParsedMessengerEvent[], deps: ReturnType<typeof makeWorld>["deps"]) =>
  processMessengerEvents(db, conn, events, { agentAllowed: true, channel: conn.provider as "MESSENGER" | "INSTAGRAM" }, deps as never);

describe("a 100-message burst across two agencies and two Page channels", () => {
  const perConnection = 25;
  const events = CONNECTIONS.flatMap((conn) => Array.from({ length: perConnection }, (_, i) => ({ conn, event: message(conn.provider_account_id!, `${conn.id}-m${i}`) })));

  it("queues exactly one reply job per message even when every message is delivered three times at once", async () => {
    const world = makeWorld();
    const deliveries = events.flatMap(({ conn, event }) => [0, 1, 2].map(() => deliver(conn, [event], world.deps)));
    const results = await Promise.all(deliveries);

    expect(events).toHaveLength(100);
    expect(world.stored.size).toBe(100);
    expect(world.jobs).toHaveLength(100);
    // The jobs the handlers reported are exactly the ones that were created — a redelivery reports none.
    expect(results.flatMap((result) => result.jobIds)).toHaveLength(100);
    expect(new Set(world.jobs.map((job) => job.mid)).size).toBe(100);
  });

  it("puts every message under the agency and channel that owns the account it was addressed to, and no other", async () => {
    const world = makeWorld();
    await Promise.all(events.flatMap(({ conn, event }) => [0, 1, 2].map(() => deliver(conn, [event], world.deps))));

    for (const job of world.jobs) {
      const owner = CONNECTIONS.find((conn) => job.mid.startsWith(`${conn.id}-`))!;
      expect(job.agency).toBe(owner.agency_id);
      expect(job.provider).toBe(owner.provider);
      expect(job.connectionId).toBe(owner.id);
    }
    // 50 per agency, split evenly across its two channels.
    expect(world.jobs.filter((job) => job.agency === "agency-a")).toHaveLength(50);
    expect(world.jobs.filter((job) => job.agency === "agency-b")).toHaveLength(50);
    expect(world.jobs.filter((job) => job.provider === "INSTAGRAM")).toHaveLength(50);
  });

  it("gives two agencies the same external message id without either seeing the other's message", async () => {
    const world = makeWorld();
    // Meta's ids are unique per platform, but the store must never let one agency's row shadow another's.
    await Promise.all([deliver(A_MS, [message("page-a", "shared-mid")], world.deps), deliver(B_MS, [message("page-b", "shared-mid")], world.deps)]);
    expect(world.jobs.map((job) => job.agency).sort()).toEqual(["agency-a", "agency-b"]);
  });
});

describe("cross-tenant isolation", () => {
  it("never processes an event addressed to another agency's account through this agency's connection", async () => {
    const world = makeWorld();
    const result = await deliver(A_MS, [message("page-b", "spoof-1"), message("ig-a", "spoof-2"), message("ig-b", "spoof-3")], world.deps);
    expect(world.deps.ingest).not.toHaveBeenCalled();
    expect(result.jobIds).toEqual([]);
  });

  it("processes only this connection's events from a payload that mixes accounts", async () => {
    const world = makeWorld();
    await deliver(A_MS, [message("page-a", "mine"), message("page-b", "theirs"), message("page-a", "mine-2")], world.deps);
    expect(world.jobs.map((job) => job.mid).sort()).toEqual(["mine", "mine-2"]);
    expect(world.ingestInputs.every((input) => input.agencyId === "agency-a")).toBe(true);
  });

  it("records a delivery receipt and a read only for the agency whose account it names", async () => {
    const world = makeWorld();
    await deliver(A_MS, [{ kind: "read", pageId: "page-b", psid: "customer", watermarkMs: 5 }, { kind: "delivery", pageId: "page-b", psid: "customer", mids: ["x"], watermarkMs: 5 }], world.deps);
    expect(world.deps.markRead).not.toHaveBeenCalled();
    expect(world.deps.patchDelivery).not.toHaveBeenCalled();
  });

  it("does not let the assistant reply when the connection is off, however many messages arrive", async () => {
    const world = makeWorld();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        processMessengerEvents(db, A_MS, [message("page-a", `m${i}`)], { agentAllowed: false, channel: "MESSENGER" }, {
          ...world.deps,
          ingest: vi.fn(async (_d: unknown, input: { agentAllowed: boolean }) => (input.agentAllowed ? world.deps.ingest(_d, input as never) : { status: "stored" as const, conversation: {} as never, message: {} as never, jobId: null })),
        } as never),
      ),
    );
    expect(results.flatMap((result) => result.jobIds)).toEqual([]);
  });
});

describe("echo reconciliation under a burst", () => {
  it("records a colleague's reply exactly once even when its echo is reconciled three times at once", async () => {
    const recorded = new Set<string>();
    const markHandled = vi.fn(async () => ({ id: "conv-1" }) as never);
    const insertMessage = vi.fn(async (_db: unknown, input: { externalMessageId: string }) => {
      await tick();
      // The unique index: a second insert of the same external id fails.
      if (recorded.has(input.externalMessageId)) throw new Error("duplicate key value violates unique constraint");
      recorded.add(input.externalMessageId);
      return {} as never;
    });
    const messageExists = vi.fn(async (_db: unknown, _agency: string, mid: string) => {
      await tick();
      return recorded.has(mid);
    });
    const payload = { channel: "MESSENGER" as const, connectionId: "cc-a-ms", pageId: "page-a", psid: "c1", mid: "echo-1", text: "We can help", messageType: "TEXT" as const, contactName: "Fatima" };

    const results = await Promise.allSettled([0, 1, 2].map(() => reconcileEcho(db, "agency-a", payload, { messageExists, markHandled, insertMessage } as never)).flat());
    expect(recorded.size).toBe(1);
    // The losers fail loudly (and the job retries into "already known"); nothing is recorded twice.
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);

    const retry = await reconcileEcho(db, "agency-a", payload, { messageExists, markHandled, insertMessage } as never);
    expect(retry).toBe("ALREADY_KNOWN");
  });
});
