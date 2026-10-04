import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Db } from "@/lib/ai/db";
import { deliveryStateRank, drainDeliveryEvents, recordMessageDelivery } from "@/lib/inbox/delivery/delivery-updates";

interface FakeOptions {
  rpc?: (name: string, args: Record<string, unknown>) => { data?: unknown; error?: { message: string; code?: string } | null };
  insertError?: { message: string } | null;
  legacyError?: { message: string } | null;
}

function fakeDb(options: FakeOptions = {}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const legacyUpdates: Array<Record<string, unknown>> = [];
  const db = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: null, error: null, ...(options.rpc?.(name, args) ?? {}) };
    }),
    from: vi.fn((table: string) => {
      if (table === "message_delivery_status_buffer") {
        return { insert: async (row: Record<string, unknown>) => (inserts.push(row), { error: options.insertError ?? null }) };
      }
      return {
        update: (values: Record<string, unknown>) => {
          legacyUpdates.push(values);
          const chain = { eq: () => chain, then: (resolve: (value: unknown) => void) => resolve({ error: options.legacyError ?? null }) };
          return chain;
        },
      };
    }),
  };
  return { db: db as unknown as Db, rpcCalls, inserts, legacyUpdates };
}

describe("recordMessageDelivery", () => {
  it("buffers the tick when the worker is running, without touching the message row", async () => {
    const world = fakeDb();
    await recordMessageDelivery(world.db, "wamid.1", "agency-1", { deliveryStatus: "DELIVERED" }, { buffer: true });
    expect(world.inserts).toEqual([
      { agency_id: "agency-1", external_message_id: "wamid.1", delivery_status: "DELIVERED", delivery_error: null },
    ]);
    expect(world.rpcCalls).toHaveLength(0);
  });

  it("applies it through the batch function, in the same shape, when there is no worker", async () => {
    const world = fakeDb();
    await recordMessageDelivery(world.db, "wamid.1", "agency-1", { deliveryStatus: "FAILED", deliveryError: "Undeliverable" }, { buffer: false });
    expect(world.rpcCalls).toEqual([
      {
        name: "apply_message_delivery_updates",
        args: { p_agency_ids: ["agency-1"], p_external_message_ids: ["wamid.1"], p_statuses: ["FAILED"], p_errors: ["Undeliverable"] },
      },
    ]);
    expect(world.inserts).toHaveLength(0);
  });

  it("falls back to applying it now when the buffer cannot be written, so the tick is not dropped", async () => {
    const world = fakeDb({ insertError: { message: "connection reset" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await recordMessageDelivery(world.db, "wamid.1", "agency-1", { deliveryStatus: "READ" }, { buffer: true });
    spy.mockRestore();
    expect(world.rpcCalls.map((call) => call.name)).toEqual(["apply_message_delivery_updates"]);
  });

  it("keeps working when the code is deployed before the migration (function not found)", async () => {
    const world = fakeDb({ rpc: () => ({ error: { message: "Could not find the function", code: "PGRST202" } }) });
    await recordMessageDelivery(world.db, "wamid.1", "agency-1", { deliveryStatus: "SENT" }, { buffer: false });
    expect(world.legacyUpdates).toEqual([{ delivery_status: "SENT", delivery_error: null }]);
  });

  it("raises any other database error, carrying only the database's message", async () => {
    const world = fakeDb({ rpc: () => ({ error: { message: "deadlock detected" } }) });
    await expect(recordMessageDelivery(world.db, "wamid.1", "agency-1", { deliveryStatus: "SENT" }, { buffer: false })).rejects.toThrow(
      "delivery status apply failed: deadlock detected",
    );
  });
});

describe("drainDeliveryEvents", () => {
  const takes = (counts: number[]) => {
    let call = 0;
    return (name: string) => (name === "drain_message_delivery_status_buffer" ? { data: [{ taken: counts[call++] ?? 0, changed: 1 }] } : {});
  };

  it("keeps draining full batches and stops at the first partial one", async () => {
    const world = fakeDb({ rpc: takes([500, 500, 120]) });
    const result = await drainDeliveryEvents(world.db, { budgetMs: 10_000 });
    expect(world.rpcCalls).toHaveLength(3);
    expect(result).toEqual({ processed: 1120, failed: 0, changed: 3 });
  });

  it("does one call and stops when the buffer is empty", async () => {
    const world = fakeDb({ rpc: takes([0]) });
    expect(await drainDeliveryEvents(world.db, { budgetMs: 10_000 })).toEqual({ processed: 0, failed: 0, changed: 1 });
    expect(world.rpcCalls).toHaveLength(1);
  });

  it("stops when the budget is spent, leaving the rest buffered", async () => {
    const world = fakeDb({ rpc: takes([500, 500, 500, 500]) });
    let clock = 0;
    const result = await drainDeliveryEvents(world.db, { budgetMs: 25, batchSize: 500, now: () => (clock += 10) });
    expect(world.rpcCalls.length).toBeLessThan(4);
    expect(result.processed).toBe(world.rpcCalls.length * 500);
  });

  it("raises a database error so the worker logs it and retries", async () => {
    const world = fakeDb({ rpc: () => ({ error: { message: "function does not exist" } }) });
    await expect(drainDeliveryEvents(world.db, { budgetMs: 10_000 })).rejects.toThrow("delivery status drain failed");
  });
});

describe("deliveryStateRank", () => {
  it("orders the ticks the way a customer sees them", () => {
    expect(deliveryStateRank("SENT")).toBeLessThan(deliveryStateRank("DELIVERED"));
    expect(deliveryStateRank("DELIVERED")).toBeLessThan(deliveryStateRank("READ"));
    expect(deliveryStateRank("PENDING")).toBeLessThan(deliveryStateRank("SENT"));
  });
});

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261204090200_q4_delivery_status_batching.sql"), "utf8");

/** Pins the rules Q4's SQL must keep. Behaviour is proven against a database by scripts/sql/verify-q4-delivery-status.sql. */
describe("Q4 migration content", () => {
  it("never moves a message backwards and skips rows that would not change", () => {
    expect(sql).toContain("public.delivery_status_rank(b.delivery_status) >= public.delivery_status_rank(m.delivery_status)");
    expect(sql).toContain("is distinct from");
  });

  it("collapses several ticks for one message to the furthest one", () => {
    expect(sql).toContain("distinct on (i.agency_id, i.external_message_id)");
    expect(sql).toContain("public.delivery_status_rank(i.delivery_status) desc, i.ord desc");
  });

  it("takes buffered rows with skip locked and deletes them in the statement that applies them", () => {
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("delete from public.message_delivery_status_buffer e");
  });

  it("keeps the buffer and both functions service-role only", () => {
    expect(sql).toContain("alter table public.message_delivery_status_buffer enable row level security;");
    expect(sql).toContain("revoke all on table public.message_delivery_status_buffer from anon, authenticated;");
    expect(sql.match(/security definer/g)).toHaveLength(2);
    expect(sql.match(/set search_path = ''/g)).toHaveLength(3);
    expect(sql).not.toMatch(/grant execute[^;]*to (public|anon|authenticated)/);
    expect(sql).not.toMatch(/create policy/);
  });
});
