import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Db } from "@/lib/ai/db";
import { runInboxHousekeeping } from "./housekeeping";

type RpcAnswer = { data: unknown; error: unknown };

function world(input: { orphans?: RpcAnswer; remove?: { data: unknown[] | null; error: unknown }; counterDelete?: { message: string } }) {
  const removed: string[][] = [];
  const counterCutoffs: string[] = [];
  const db = {
    from: (table: string) => {
      if (table !== "inbox_rate_limit_counters") throw new Error(`unexpected table ${table}`);
      return { delete: () => ({ lt: async (_column: string, cutoff: string) => (counterCutoffs.push(cutoff), { error: input.counterDelete ?? null }) }) };
    },
    rpc: async (name: string) => {
      if (name === "find_orphan_staged_uploads") return input.orphans ?? { data: [], error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          removed.push(paths);
          return input.remove ?? { data: paths.map((name) => ({ name })), error: null };
        },
      }),
    },
  };
  return { db: db as unknown as Db, removed, counterCutoffs };
}

describe("runInboxHousekeeping", () => {
  it("SEC-6: removes rate-limit counters older than three days, and counts a failure to do so", async () => {
    const now = new Date("2026-10-10T12:00:00.000Z");
    const ok = world({});
    expect(await runInboxHousekeeping(ok.db, now)).toEqual({ orphanUploadsRemoved: 0, failures: 0 });
    expect(ok.counterCutoffs).toEqual(["2026-10-07T12:00:00.000Z"]);
    const failing = world({ counterDelete: { message: "boom" } });
    expect(await runInboxHousekeeping(failing.db, now)).toMatchObject({ failures: 1 });
  });

  it("does nothing, and reports nothing wrong, when there is nothing to clean", async () => {
    const w = world({});
    expect(await runInboxHousekeeping(w.db)).toEqual({ orphanUploadsRemoved: 0, failures: 0 });
    expect(w.removed).toHaveLength(0);
  });

  it("no longer touches the Inngest outbox: the only database function it calls is the orphan listing", async () => {
    const calls: string[] = [];
    const db = {
      from: () => ({ delete: () => ({ lt: async () => ({ error: null }) }) }),
      rpc: async (name: string) => {
        calls.push(name);
        return { data: [], error: null };
      },
      storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
    } as unknown as Db;
    await runInboxHousekeeping(db);
    expect(calls).toEqual(["find_orphan_staged_uploads"]);
  });

  it("removes exactly the orphan paths the database named, through the Storage API", async () => {
    const w = world({ orphans: { data: [{ name: "x/outbound/y/z.png" }, { name: "x/outbound/y/w.pdf" }], error: null } });
    expect((await runInboxHousekeeping(w.db)).orphanUploadsRemoved).toBe(2);
    expect(w.removed).toEqual([["x/outbound/y/z.png", "x/outbound/y/w.pdf"]]);
  });

  it("counts a failed listing or a failed removal, and removes nothing it could not list", async () => {
    const listing = world({ orphans: { data: null, error: { message: "boom" } } });
    expect(await runInboxHousekeeping(listing.db)).toMatchObject({ orphanUploadsRemoved: 0, failures: 1 });
    expect(listing.removed).toHaveLength(0);
    const removal = world({ orphans: { data: [{ name: "a/outbound/b/c.pdf" }], error: null }, remove: { data: null, error: { message: "boom" } } });
    expect(await runInboxHousekeeping(removal.db)).toMatchObject({ orphanUploadsRemoved: 0, failures: 1 });
  });
});

const code = readFileSync(join(process.cwd(), "supabase/migrations/20261204091000_e1_outbox_purge_and_orphan_uploads.sql"), "utf8").replace(/--.*$/gm, "");

/** The E1 migration is history now (its outbox purge function is dropped by a later migration), but the orphan-upload half is still live. */
describe("E1 migration content (orphan uploads)", () => {
  it("only reads storage, never deletes from it, so a file cannot be orphaned by removing just its row", () => {
    expect(code).not.toMatch(/delete\s+from\s+storage\./i);
  });

  it("keeps the orphan listing service-role only with a pinned search path", () => {
    expect(code).toContain("revoke all on function public.find_orphan_staged_uploads(integer, integer) from public, anon, authenticated;");
    expect(code).toMatch(/set search_path = ''/);
  });
});
