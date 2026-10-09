import { beforeEach, describe, expect, it, vi } from "vitest";

/** TASK-043 Phase 3 (PKG-13): the busy package actions ask the database to count their use first, and stop when it says no. */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }) }));
vi.mock("@/lib/data/departure-groups", () => ({
  getCurrentStaffRole: async () => ({ role: "ADMIN", roleId: null, agencyId: null }),
}));
vi.mock("@/lib/access/dynamic-capabilities", () => ({
  loadDynamicCapabilities: async (_db: unknown, _roleId: unknown, _module: unknown, defaults: unknown) => defaults,
}));
vi.mock("@/lib/data/packages-repository", () => ({ listPendingPackageChanges: async () => [] }));

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const tableCalls: string[] = [];
let rpcError: { code: string; message: string } | null = null;

vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: null, error: rpcError };
    },
    from: (table: string) => {
      tableCalls.push(table);
      const result = { data: { id: SOURCE_ID, status: "Draft", owner_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", updated_at: "2026-10-09T09:00:00Z" }, error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        ilike: () => chain,
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => result,
        insert: () => chain,
        single: async () => result,
      };
      return chain;
    },
  }),
}));

import { checkPackageCodeAction, duplicatePackageAction, getNextPackageCodeAction } from "./actions";

beforeEach(() => {
  rpcCalls.length = 0;
  tableCalls.length = 0;
  rpcError = null;
});

const LIMIT_MESSAGE = "You can only copy a package 20 times an hour and you have reached that limit. Try again in 12 minute(s).";

describe("package action rate limits", () => {
  it("counts a code check and a next-code lookup under code_lookup", async () => {
    await checkPackageCodeAction({ code: "PKG-1" });
    await getNextPackageCodeAction();
    expect(rpcCalls).toEqual([
      { name: "consume_package_rate_limit", args: { p_action: "code_lookup" } },
      { name: "consume_package_rate_limit", args: { p_action: "code_lookup" } },
    ]);
  });

  it("stops before reading anything when the limit is reached, and shows the database's wording", async () => {
    rpcError = { code: "P0001", message: LIMIT_MESSAGE };
    expect(await checkPackageCodeAction({ code: "PKG-1" })).toEqual({ ok: false, error: LIMIT_MESSAGE });
    expect(await getNextPackageCodeAction()).toEqual({ ok: false, error: LIMIT_MESSAGE });
    expect(tableCalls).toHaveLength(0);
  });

  it("stops a copy when the limit is reached, before inserting", async () => {
    rpcError = { code: "P0001", message: LIMIT_MESSAGE };
    expect(await duplicatePackageAction(SOURCE_ID)).toEqual({ ok: false, error: LIMIT_MESSAGE });
    expect(rpcCalls).toEqual([{ name: "consume_package_rate_limit", args: { p_action: "duplicate" } }]);
    expect(tableCalls).toEqual(["packages"]); // only the read of the source
  });

  it("refuses, rather than carries on, when the limit check itself fails", async () => {
    rpcError = { code: "XX000", message: "connection reset" };
    expect(await checkPackageCodeAction({ code: "PKG-1" })).toEqual({
      ok: false,
      error: "Could not check how often this was used. Please try again.",
    });
    expect(tableCalls).toHaveLength(0);
  });
});
