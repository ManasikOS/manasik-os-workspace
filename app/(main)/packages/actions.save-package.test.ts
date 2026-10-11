import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TASK-043: the explicit Save action. Nothing saves on its own any more; this is the one write the wizard's Save draft / Save changes buttons make.
 * The database is replaced by a stub; the action, the Zod schema, the mappers and the change-diff code are the real ones.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: USER }) }));
vi.mock("@/lib/data/departure-groups", () => ({
  getCurrentStaffRole: async () => ({ role: "ADMIN", roleId: null, agencyId: null }),
}));
vi.mock("@/lib/access/dynamic-capabilities", () => ({
  loadDynamicCapabilities: async (_db: unknown, _roleId: unknown, _module: unknown, defaults: unknown) => defaults,
}));
vi.mock("@/lib/data/packages-repository", () => ({ listPendingPackageChanges: async () => [] }));

const PACKAGE_ID = "11111111-1111-4111-8111-111111111111";
type Row = Record<string, unknown>;

const insertCalls: Row[] = [];
const updateCalls: Row[] = [];
const rpcCalls: Array<{ name: string; args: Row }> = [];
let currentRow: Row | null = null;
let rpcResult: { data: unknown; error: { code: string; message: string } | null } = { data: null, error: null };

vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: () => ({
      insert: (row: Row) => {
        insertCalls.push(row);
        return { select: () => ({ single: async () => ({ data: { id: PACKAGE_ID, updated_at: "2026-10-09T10:00:00.000000+00:00" }, error: null }) }) };
      },
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: currentRow, error: null }) }),
      }),
      update: (content: Row) => {
        updateCalls.push(content);
        return {
          eq: () => ({
            eq: () => ({
              select: () => ({ maybeSingle: async () => ({ data: { id: PACKAGE_ID, updated_at: "2026-10-09T11:00:00.000000+00:00" }, error: null }) }),
            }),
          }),
        };
      },
    }),
    rpc: async (name: string, args: Row) => {
      rpcCalls.push({ name, args });
      return rpcResult;
    },
  }),
}));

import { savePackageAction } from "./actions";
import { formDataToRow } from "./create-package/mappers";
import { INITIAL_PACKAGE_FORM_DATA, type PackageFormData } from "./create-package/types";

const BASE_FORM: PackageFormData = {
  ...INITIAL_PACKAGE_FORM_DATA,
  title: "Ramadan Umrah",
  internalCode: "RF-1",
  paymentTerms: "Pay in full 30 days before departure.",
};
const UPDATED_AT = "2026-10-09T09:00:00.000000+00:00";

function rowFor(status: string): Row {
  return { ...formDataToRow(BASE_FORM), id: PACKAGE_ID, status, featured: false, owner_id: USER, updated_at: UPDATED_AT };
}

beforeEach(() => {
  insertCalls.length = 0;
  updateCalls.length = 0;
  rpcCalls.length = 0;
  currentRow = rowFor("Draft");
  rpcResult = { data: null, error: null };
});

describe("savePackageAction: a new package", () => {
  it("creates a Draft owned by the caller and never takes status or featured from the form", async () => {
    const result = await savePackageAction({ packageId: null, form: { ...BASE_FORM, status: "Open for Sale", featured: true } });
    expect(result).toMatchObject({ ok: true, kind: "SAVED", packageId: PACKAGE_ID });
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({ status: "Draft", featured: false, owner_id: USER, internal_code: "RF-1" });
  });
});

describe("savePackageAction: an existing package", () => {
  it("refuses a save with no last-seen time", async () => {
    expect(await savePackageAction({ packageId: PACKAGE_ID, form: BASE_FORM })).toMatchObject({ ok: false, code: "STALE" });
    expect(updateCalls).toHaveLength(0);
  });

  it("refuses a stale save and writes nothing", async () => {
    const result = await savePackageAction({ packageId: PACKAGE_ID, form: { ...BASE_FORM, title: "New" }, expectedUpdatedAt: "2000-01-01T00:00:00Z" });
    expect(result).toMatchObject({ ok: false, code: "STALE" });
    expect(updateCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it("refuses an archived package", async () => {
    currentRow = rowFor("Archived");
    const result = await savePackageAction({ packageId: PACKAGE_ID, form: { ...BASE_FORM, title: "New" }, expectedUpdatedAt: UPDATED_AT });
    expect(result).toEqual({ ok: false, error: "An archived package cannot be edited. Restore it first." });
  });

  it("saves only the changed columns of a Draft", async () => {
    const result = await savePackageAction({ packageId: PACKAGE_ID, form: { ...BASE_FORM, title: "Ramadan Umrah 2027" }, expectedUpdatedAt: UPDATED_AT });
    expect(result).toMatchObject({ ok: true, kind: "SAVED", savedAt: "2026-10-09T11:00:00.000000+00:00" });
    expect(updateCalls).toEqual([{ title: "Ramadan Umrah 2027" }]);
    expect(rpcCalls).toHaveLength(0);
  });

  it("does nothing when nothing changed", async () => {
    const result = await savePackageAction({ packageId: PACKAGE_ID, form: BASE_FORM, expectedUpdatedAt: UPDATED_AT });
    expect(result).toMatchObject({ ok: true, kind: "SAVED", savedAt: UPDATED_AT });
    expect(updateCalls).toHaveLength(0);
  });
});

describe("savePackageAction: a package that is on sale", () => {
  beforeEach(() => {
    currentRow = rowFor("Open for Sale");
  });

  it("sends only the changed columns through the review function, never a direct update", async () => {
    rpcResult = { data: { status: "BASIC_APPLIED", request_id: null, applied_columns: ["title"], pending_columns: [] }, error: null };
    const result = await savePackageAction({ packageId: PACKAGE_ID, form: { ...BASE_FORM, title: "Ramadan Umrah 2027" }, expectedUpdatedAt: UPDATED_AT });
    expect(result).toMatchObject({ ok: true, kind: "SAVED" });
    expect(updateCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toEqual({
      name: "submit_package_change",
      args: { p_package_id: PACKAGE_ID, p_content: { title: "Ramadan Umrah 2027" }, p_expected_updated_at: UPDATED_AT, p_reason: null, p_supersede: false },
    });
  });

  it("passes the reason and the supersede choice and reports a change waiting for approval", async () => {
    rpcResult = { data: { status: "PENDING", request_id: "22222222-2222-4222-8222-222222222222", applied_columns: [], pending_columns: ["payment_terms"] }, error: null };
    const result = await savePackageAction({
      packageId: PACKAGE_ID,
      form: { ...BASE_FORM, paymentTerms: "Pay in full 45 days before departure." },
      expectedUpdatedAt: UPDATED_AT,
      reason: "Airline deadline moved",
      supersedePending: true,
    });
    expect(result).toMatchObject({ ok: true, kind: "PENDING", requestId: "22222222-2222-4222-8222-222222222222", pendingColumns: ["payment_terms"] });
    expect(rpcCalls[0].args).toMatchObject({ p_reason: "Airline deadline moved", p_supersede: true, p_content: { payment_terms: "Pay in full 45 days before departure." } });
  });

  it("reports a change applied at once when approval is switched off", async () => {
    rpcResult = { data: { status: "APPLIED", request_id: "x", applied_columns: ["default_capacity"], pending_columns: [] }, error: null };
    const result = await savePackageAction({ packageId: PACKAGE_ID, form: { ...BASE_FORM, defaultCapacity: 55 }, expectedUpdatedAt: UPDATED_AT, reason: "Bigger coach" });
    expect(result).toMatchObject({ ok: true, kind: "APPLIED", appliedColumns: ["default_capacity"] });
  });

  it("recognises 'another change is already waiting' so the dialog can offer to replace it", async () => {
    rpcResult = { data: null, error: { code: "22023", message: "Another change is already waiting for approval for this package." } };
    const result = await savePackageAction({ packageId: PACKAGE_ID, form: { ...BASE_FORM, paymentTerms: "Changed" }, expectedUpdatedAt: UPDATED_AT, reason: "x" });
    expect(result).toMatchObject({ ok: false, code: "PENDING_EXISTS" });
  });

  it("turns the database's stale-write error into STALE and shows its permission message", async () => {
    rpcResult = { data: null, error: { code: "40001", message: "This package changed elsewhere. Reload and try again." } };
    expect(await savePackageAction({ packageId: PACKAGE_ID, form: { ...BASE_FORM, title: "x" }, expectedUpdatedAt: UPDATED_AT })).toMatchObject({ ok: false, code: "STALE" });

    rpcResult = { data: null, error: { code: "42501", message: "Your role cannot change payment or booking terms." } };
    expect(await savePackageAction({ packageId: PACKAGE_ID, form: { ...BASE_FORM, paymentTerms: "x" }, expectedUpdatedAt: UPDATED_AT, reason: "y" })).toEqual({
      ok: false,
      error: "Your role cannot change payment or booking terms.",
    });
  });
});
