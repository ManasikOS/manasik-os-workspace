import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadDynamicCapabilities } from "./dynamic-capabilities";

afterEach(() => vi.restoreAllMocks());

const FALLBACK = { viewModule: true, editPackage: true, deletePackage: true, label: "x" };

function dbReturning(result: { data: unknown; error: { message: string } | null }) {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => result };
  return { from: () => chain } as never;
}

describe("loadDynamicCapabilities", () => {
  it("uses the base role's defaults when the person has no custom role", async () => {
    expect(await loadDynamicCapabilities(dbReturning({ data: null, error: null }), null, "packages", FALLBACK)).toEqual(FALLBACK);
  });

  it("uses the defaults when the role has no row for this module", async () => {
    expect(await loadDynamicCapabilities(dbReturning({ data: null, error: null }), "role-1", "packages", FALLBACK)).toEqual(FALLBACK);
  });

  it("applies what the role saved over the defaults, keeping defaults for keys it never saved", async () => {
    const db = dbReturning({ data: { capabilities: { deletePackage: false } }, error: null });
    expect(await loadDynamicCapabilities(db, "role-1", "packages", FALLBACK)).toEqual({ ...FALLBACK, deletePackage: false });
  });

  it("denies everything for the request when the permissions cannot be read, instead of granting the defaults", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await loadDynamicCapabilities(dbReturning({ data: null, error: { message: "timeout" } }), "role-1", "packages", FALLBACK);
    expect(result).toEqual({ viewModule: false, editPackage: false, deletePackage: false, label: "x" });
    expect(log).toHaveBeenCalledOnce();
  });

  it("reads anything that is not boolean true as not granted, and ignores keys the module does not know", async () => {
    const db = dbReturning({ data: { capabilities: { editPackage: "yes", deletePackage: 1, viewModule: null, madeUp: true } }, error: null });
    const result = (await loadDynamicCapabilities(db, "role-1", "packages", FALLBACK)) as Record<string, unknown>;
    expect(result).toEqual({ viewModule: false, editPackage: false, deletePackage: false, label: "x" });
    expect(result).not.toHaveProperty("madeUp");
  });

  it("falls back to the defaults when the stored JSON is not an object", async () => {
    expect(await loadDynamicCapabilities(dbReturning({ data: { capabilities: ["x"] }, error: null }), "role-1", "packages", FALLBACK)).toEqual(FALLBACK);
  });
});
