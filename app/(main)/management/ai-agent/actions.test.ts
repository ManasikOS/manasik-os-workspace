import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TASK-017 (2026-09-27): `saveInboxAutonomyLevel`'s entitlement-ceiling check used `if (entitlements && ...)`,
 * so when `resolveEntitlements` returns `null` — no subscription row, or the read failed — the ceiling check was
 * skipped outright rather than failing closed. The send path (`authorizeAutomatedInboxSend` in
 * lib/inbox/autonomy/runtime.ts) already defaults a missing entitlements row to an "L0" ceiling; this setting
 * action must use the same default, so a config saved here can never claim a level the send path would refuse.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const role = { value: "ADMIN" as string };
const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STAFF = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: STAFF }) }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => ({ role: role.value, agencyId: AGENCY, staffId: STAFF }) }));

const loadInboxAutonomyEvidence = vi.fn<(...args: unknown[]) => Promise<{ evidence: unknown; decision: { eligible: boolean; blockers: string[] } }>>(async () => ({ evidence: {}, decision: { eligible: true, blockers: [] } }));
vi.mock("@/lib/inbox/autonomy/evidence", () => ({ loadInboxAutonomyEvidence: (...args: unknown[]) => loadInboxAutonomyEvidence(...args) }));

const resolveEntitlements = vi.fn<(...args: unknown[]) => Promise<{ planCode: string; autonomyCeiling: string } | null>>(async () => null);
vi.mock("@/lib/billing/entitlements", () => ({ resolveEntitlements: (...args: unknown[]) => resolveEntitlements(...args) }));

const rpc = vi.fn<(...args: unknown[]) => Promise<{ error: null }>>(async () => ({ error: null }));
let currentAutonomy: Record<string, unknown> | null = null;
vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: currentAutonomy ? { autonomy: currentAutonomy } : null, error: null }) }) }) }) }),
    rpc: (...args: unknown[]) => rpc(...args),
  }),
}));

const { saveInboxAutonomyLevel } = await import("./actions");

beforeEach(() => {
  role.value = "ADMIN";
  currentAutonomy = null;
  rpc.mockClear();
  resolveEntitlements.mockReset().mockResolvedValue(null);
  loadInboxAutonomyEvidence.mockClear();
});

describe("saveInboxAutonomyLevel — the entitlement ceiling fails closed", () => {
  it("refuses to promote past L0 when entitlements could not be resolved at all", async () => {
    resolveEntitlements.mockResolvedValue(null);

    const result = await saveInboxAutonomyLevel({ level: "L2" });

    expect(result).toEqual({ ok: false, error: "Your agency's plan entitlements could not be confirmed, so autonomy cannot be raised above L0. Try again shortly." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("still allows confirming L0 (no promotion) when entitlements could not be resolved", async () => {
    resolveEntitlements.mockResolvedValue(null);

    const result = await saveInboxAutonomyLevel({ level: "L0" });

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("keeps the plan-specific message when entitlements resolve but the requested level exceeds the plan ceiling", async () => {
    resolveEntitlements.mockResolvedValue({ planCode: "STARTER", autonomyCeiling: "L1" });

    const result = await saveInboxAutonomyLevel({ level: "L2" });

    expect(result).toEqual({ ok: false, error: "The STARTER plan allows autonomy up to L1." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("allows the promotion once entitlements resolve with a ceiling that covers it", async () => {
    resolveEntitlements.mockResolvedValue({ planCode: "GROWTH", autonomyCeiling: "L3" });

    const result = await saveInboxAutonomyLevel({ level: "L2" });

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledOnce();
  });
});
