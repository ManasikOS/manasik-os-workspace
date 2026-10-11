import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TASK-043 Phase 3: the delete actions. The database function does the real work and enforces every rule; these tests cover what the actions check first
 * and how they report the database's answer.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
let role = "ADMIN";
vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: USER }) }));
vi.mock("@/lib/data/departure-groups", () => ({
  getCurrentStaffRole: async () => ({ role, roleId: null, agencyId: null }),
}));
vi.mock("@/lib/access/dynamic-capabilities", () => ({
  loadDynamicCapabilities: async (_db: unknown, _roleId: unknown, _module: unknown, defaults: unknown) => defaults,
}));
vi.mock("@/lib/data/packages-repository", () => ({ listPendingPackageChanges: async () => [] }));

const PACKAGE_ID = "11111111-1111-4111-8111-111111111111";
const UPDATED_AT = "2026-10-09T09:00:00.000000+00:00";
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let rpcResult: { data: unknown; error: { code: string; message: string } | null } = { data: null, error: null };

vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { id: PACKAGE_ID, status: "Draft", owner_id: USER, updated_at: UPDATED_AT, internal_code: "PKG-1" }, error: null }),
        }),
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return rpcResult;
    },
  }),
}));

import { deletePackageAction, getPackageDeleteImpactAction } from "./actions";

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResult = { data: null, error: null };
  role = "ADMIN";
});

describe("deletePackageAction", () => {
  const valid = { packageId: PACKAGE_ID, expectedUpdatedAt: UPDATED_AT, confirmCode: "PKG-1", reason: "Duplicate draft" };

  it("refuses a role without the delete capability before touching the database", async () => {
    role = "OPERATIONS";
    expect(await deletePackageAction(valid)).toEqual({ ok: false, error: "You do not have permission to do that." });
    expect(rpcCalls).toHaveLength(0);
  });

  it("needs the typed code and a reason", async () => {
    expect(await deletePackageAction({ ...valid, confirmCode: "  " })).toMatchObject({ ok: false });
    expect(await deletePackageAction({ ...valid, reason: "" })).toMatchObject({ ok: false });
    expect(await deletePackageAction({ ...valid, packageId: "not-an-id" })).toMatchObject({ ok: false });
    expect(await deletePackageAction({ ...valid, reason: "x".repeat(501) })).toMatchObject({ ok: false });
    expect(rpcCalls).toHaveLength(0);
  });

  it("sends exactly what the database function needs", async () => {
    expect(await deletePackageAction(valid)).toEqual({ ok: true });
    expect(rpcCalls).toEqual([
      {
        name: "delete_package",
        args: { p_package_id: PACKAGE_ID, p_expected_updated_at: UPDATED_AT, p_confirm_code: "PKG-1", p_reason: "Duplicate draft" },
      },
    ]);
  });

  it("shows the database's own refusal in plain words", async () => {
    rpcResult = { data: null, error: { code: "22023", message: "The confirmation text does not match the package code." } };
    expect(await deletePackageAction(valid)).toEqual({ ok: false, error: "The confirmation text does not match the package code." });
  });

  it("reports a stale delete as STALE", async () => {
    rpcResult = { data: null, error: { code: "40001", message: "This package changed elsewhere. Reload and try again." } };
    expect(await deletePackageAction(valid)).toMatchObject({ ok: false, code: "STALE" });
  });
});

describe("getPackageDeleteImpactAction", () => {
  it("returns the counts, the code to type and the last-seen time", async () => {
    rpcResult = { data: { status: "Draft", departureGroups: 0 }, error: null };
    const result = await getPackageDeleteImpactAction(PACKAGE_ID);
    expect(result).toMatchObject({ ok: true, code: "PKG-1", updatedAt: UPDATED_AT, impact: { status: "Draft" } });
    expect(rpcCalls[0]).toEqual({ name: "package_delete_impact", args: { p_package_id: PACKAGE_ID } });
  });

  it("is refused for a role that cannot delete", async () => {
    role = "MARKETING";
    expect(await getPackageDeleteImpactAction(PACKAGE_ID)).toMatchObject({ ok: false });
    expect(rpcCalls).toHaveLength(0);
  });
});
