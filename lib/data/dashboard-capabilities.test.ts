import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/utils/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: vi.fn() }));

import { baseDashboardCapabilities } from "@/lib/access/dashboard-access";

import { resolveDashboardCapabilities } from "./dashboard-capabilities";

afterEach(() => vi.restoreAllMocks());

type Row = { data: unknown; error: { message: string } | null };

/** A Supabase stand-in that answers `role_permissions` reads by the `module` filter and records which modules were asked for. */
function fakeDb(rows: Record<string, Row>) {
  const requested: string[] = [];
  const db = {
    from: () => {
      let moduleName = "";
      const chain = {
        select: () => chain,
        eq: (column: string, value: string) => {
          if (column === "module") {
            moduleName = value;
            requested.push(value);
          }
          return chain;
        },
        maybeSingle: async () => rows[moduleName] ?? { data: null, error: null },
      };
      return chain;
    },
  };
  return { db: db as never, requested };
}

describe("resolveDashboardCapabilities", () => {
  it("returns the base role's built-in set without touching the database when there is no custom role", async () => {
    const { db, requested } = fakeDb({});
    expect(await resolveDashboardCapabilities(db, "FINANCE", null)).toEqual(baseDashboardCapabilities("FINANCE"));
    expect(requested).toEqual([]);
  });

  it("reads exactly the five modules the dashboard gates on", async () => {
    const { db, requested } = fakeDb({});
    await resolveDashboardCapabilities(db, "ADMIN", "role-1");
    expect([...requested].sort()).toEqual(["departure_groups", "finance", "leads", "operations", "reports"]);
  });

  it("applies a custom role's saved override over the base role, only for that module", async () => {
    const { db } = fakeDb({ finance: { data: { capabilities: { viewLedger: false } }, error: null } });
    const caps = await resolveDashboardCapabilities(db, "ADMIN", "role-1");
    const base = baseDashboardCapabilities("ADMIN");
    expect(base.finance.viewLedger).toBe(true);
    expect(caps.finance.viewLedger).toBe(false);
    expect(caps.leads).toEqual(base.leads);
    expect(caps.reports).toEqual(base.reports);
  });

  it("denies only the module that could not be read, and logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({ reports: { data: null, error: { message: "timeout" } } });
    const caps = await resolveDashboardCapabilities(db, "ADMIN", "role-1");
    expect(caps.reports.viewFinance).toBe(false);
    expect(caps.reports.viewSales).toBe(false);
    expect(caps.finance).toEqual(baseDashboardCapabilities("ADMIN").finance);
    expect(log).toHaveBeenCalledOnce();
  });
});
