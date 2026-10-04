import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaimsMock = vi.fn();
const rpcMock = vi.fn().mockResolvedValue({ error: null });
const fromMock = vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ error: null }) }));

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({ auth: { getClaims: getClaimsMock }, rpc: rpcMock, from: fromMock }),
}));

import { getSessionUser, touchSessionActivity } from "@/lib/dal";

describe("getSessionUser", () => {
  beforeEach(() => getClaimsMock.mockReset());

  it("maps verified claims to an id and email", async () => {
    getClaimsMock.mockResolvedValue({
      data: { claims: { sub: "user-1", email: "a@b.com" } },
      error: null,
    });
    await expect(getSessionUser()).resolves.toEqual({ id: "user-1", email: "a@b.com" });
  });

  it("returns null when the token cannot be verified", async () => {
    getClaimsMock.mockResolvedValue({ data: null, error: new Error("invalid jwt") });
    await expect(getSessionUser()).resolves.toBeNull();
  });

  it("returns null when the claims carry no subject", async () => {
    getClaimsMock.mockResolvedValue({ data: { claims: {} }, error: null });
    await expect(getSessionUser()).resolves.toBeNull();
  });

  it("treats a missing email claim as null rather than undefined", async () => {
    getClaimsMock.mockResolvedValue({ data: { claims: { sub: "user-2" } }, error: null });
    await expect(getSessionUser()).resolves.toEqual({ id: "user-2", email: null });
  });
});

describe("touchSessionActivity", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  beforeEach(() => {
    rpcMock.mockClear();
    fromMock.mockClear();
  });

  it("does nothing when the account has no profile row", async () => {
    await touchSessionActivity("u1", null);
    await flush();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("activates an invited account without re-reading the profile", async () => {
    await touchSessionActivity("u2", { status: "INVITED", lastActiveAt: null });
    await flush();
    expect(rpcMock).toHaveBeenCalledWith("touch_own_activity");
    expect(rpcMock).toHaveBeenCalledWith("accept_own_invitation");
    expect(fromMock).toHaveBeenCalledWith("staff_activity_logs");
    expect(fromMock).not.toHaveBeenCalledWith("staff_profiles");
  });

  it("stamps last-active when the previous stamp is older than the throttle", async () => {
    const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await touchSessionActivity("u3", { status: "ACTIVE", lastActiveAt: stale });
    await flush();
    expect(rpcMock).toHaveBeenCalledWith("touch_own_activity");
  });

  it("skips the write when the stamp is recent", async () => {
    const recent = new Date(Date.now() - 60 * 1000).toISOString();
    await touchSessionActivity("u4", { status: "ACTIVE", lastActiveAt: recent });
    await flush();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
