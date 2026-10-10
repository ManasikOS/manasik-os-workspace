import { beforeEach, describe, expect, it, vi } from "vitest";

/** TASK-043 Phase 3: the export gate action. The database function enforces the limit and writes the audit row; these tests cover what the action checks first. */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let role = "FINANCE";
vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }) }));
vi.mock("@/lib/data/departure-groups", () => ({
  getCurrentStaffRole: async () => ({ role, roleId: null, agencyId: null }),
}));
vi.mock("@/lib/access/dynamic-capabilities", () => ({
  loadDynamicCapabilities: async (_db: unknown, _roleId: unknown, _module: unknown, defaults: unknown) => defaults,
}));
vi.mock("@/lib/data/packages-repository", () => ({ listPendingPackageChanges: async () => [] }));

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let rpcResult: { data: unknown; error: { code: string; message: string } | null } = { data: { allowed: true, remaining: 9 }, error: null };

vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return rpcResult;
    },
  }),
}));

import { authorisePackageExportAction } from "./actions";

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResult = { data: { allowed: true, remaining: 9 }, error: null };
  role = "FINANCE";
});

const valid = { format: "csv", rowCount: 12, filters: { view: "All Packages" } };

describe("authorisePackageExportAction", () => {
  it("refuses a role without the export capability before touching the database", async () => {
    role = "MARKETING";
    expect(await authorisePackageExportAction(valid)).toEqual({ ok: false, error: "You do not have permission to do that." });
    expect(rpcCalls).toHaveLength(0);
  });

  it("refuses an empty or malformed request", async () => {
    for (const bad of [{ ...valid, rowCount: 0 }, { ...valid, rowCount: 100001 }, { ...valid, format: "pdf" }, { ...valid, filters: "x" }, null]) {
      expect(await authorisePackageExportAction(bad)).toMatchObject({ ok: false });
    }
    expect(rpcCalls).toHaveLength(0);
  });

  it("sends exactly what the database function needs and returns how many exports are left", async () => {
    expect(await authorisePackageExportAction(valid)).toEqual({ ok: true, remaining: 9 });
    expect(rpcCalls).toEqual([
      { name: "authorise_package_export", args: { p_format: "csv", p_row_count: 12, p_filters: { view: "All Packages" } } },
    ]);
  });

  it("shows the hourly limit message in plain words", async () => {
    rpcResult = { data: null, error: { code: "P0001", message: "You have reached the limit of 10 exports an hour. Try again in 7 minute(s)." } };
    expect(await authorisePackageExportAction(valid)).toEqual({
      ok: false,
      error: "You have reached the limit of 10 exports an hour. Try again in 7 minute(s).",
    });
  });
});
