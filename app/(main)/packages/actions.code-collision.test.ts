import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TASK-041: a package code that another package in the agency already uses.
 *
 * Reproduces the "duplicate key value violates unique constraint
 * packages_internal_code_agency_unique" failure seen when a second package was created.
 * The database is replaced by a stub that raises exactly what Postgres raised on staging;
 * the actions, the Zod schema and the step validation are the real ones.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const OWNER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: OWNER }) }));
vi.mock("@/lib/data/departure-groups", () => ({
  getCurrentStaffRole: async () => ({ role: "ADMIN", roleId: null }),
}));
vi.mock("@/lib/access/dynamic-capabilities", () => ({
  loadDynamicCapabilities: async (_db: unknown, _roleId: unknown, _module: unknown, defaults: unknown) => defaults,
}));

const CODE_COLLISION = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "packages_internal_code_agency_unique"',
};
const insertCalls: Array<Record<string, unknown>> = [];
let takenRows: Array<{ id: string; internal_code: string }> = [];
vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        insertCalls.push(row);
        return { select: () => ({ single: async () => ({ data: null, error: CODE_COLLISION }) }) };
      },
      select: () => ({ ilike: () => ({ limit: async () => ({ data: takenRows, error: null }) }) }),
    }),
    rpc: async () => ({ data: null, error: null }),
  }),
}));

import { checkPackageCodeAction, publishPackageAction, saveDraftAction } from "./actions";
import { INITIAL_PACKAGE_FORM_DATA } from "./create-package/types";

const FORM_WITH_TAKEN_CODE = { ...INITIAL_PACKAGE_FORM_DATA, internalCode: "RF-PKG-2026-UM01" };

beforeEach(() => {
  insertCalls.length = 0;
  takenRows = [];
});

describe("the wizard's starting form", () => {
  it("does not pre-fill a real-looking internal code that every new package would share", () => {
    expect(INITIAL_PACKAGE_FORM_DATA.internalCode).toBe("");
  });
});

describe("a package code that another package in the agency already uses", () => {
  it("saveDraftAction explains the problem instead of echoing the constraint name", async () => {
    const result = await saveDraftAction({ packageId: null, form: FORM_WITH_TAKEN_CODE });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toContain("packages_internal_code_agency_unique");
    expect(result.error).toContain("RF-PKG-2026-UM01");
    expect(result.step).toBe(1);
  });

  it("publishPackageAction explains the problem and points at step 1 (Commercial Identity)", async () => {
    const result = await publishPackageAction({ packageId: null, form: FORM_WITH_TAKEN_CODE });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toContain("packages_internal_code_agency_unique");
    expect(result.step).toBe(1);
  });

  it("publishPackageAction never reaches the database with a blank code", async () => {
    const result = await publishPackageAction({ packageId: null, form: INITIAL_PACKAGE_FORM_DATA });
    expect(result).toMatchObject({ ok: false, step: 1 });
    expect(insertCalls).toHaveLength(0);
  });

  it("trims the code before writing, so 'UM01 ' and 'UM01' cannot both be saved", async () => {
    await saveDraftAction({ packageId: null, form: { ...INITIAL_PACKAGE_FORM_DATA, internalCode: "  UM01  " } });
    expect(insertCalls[0]?.internal_code).toBe("UM01");
  });
});

describe("checkPackageCodeAction", () => {
  it("reports a free code as available", async () => {
    expect(await checkPackageCodeAction({ code: "UM01" })).toEqual({ ok: true, available: true });
  });

  it("matches case-insensitively and suggests the next free suffix", async () => {
    takenRows = [
      { id: "a", internal_code: "um01" },
      { id: "b", internal_code: "UM01-2" },
    ];
    expect(await checkPackageCodeAction({ code: "UM01" })).toEqual({ ok: true, available: false, suggestion: "UM01-3" });
  });

  it("does not report the package's own saved code as taken", async () => {
    const own = "11111111-1111-4111-8111-111111111111";
    takenRows = [{ id: own, internal_code: "UM01" }];
    expect(await checkPackageCodeAction({ code: "UM01", packageId: own })).toEqual({ ok: true, available: true });
  });

  it("rejects an empty code", async () => {
    expect(await checkPackageCodeAction({ code: "   " })).toMatchObject({ ok: false });
  });
});
