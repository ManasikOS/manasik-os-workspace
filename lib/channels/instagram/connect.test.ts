import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { connectInstagramAccount } = await import("./connect");

import type { InstagramConnectDeps } from "./connect";

const account = { id: "ig-1784", username: "royalalfathima", name: "Royal Al-Fathima", pageId: "page-1", pageName: "Royal Al-Fathima", pageToken: "page-token" };
const APP = "app-1";

function harness(overrides: Partial<InstagramConnectDeps> = {}) {
  const calls: string[] = [];
  const track = <T>(name: string, value: T) => async () => {
    calls.push(name);
    return value;
  };
  const deps: InstagramConnectDeps = {
    ownedByAnotherAgency: vi.fn(track("owned", false)),
    activeConnectionAccountId: vi.fn(track("active", null as string | null)),
    subscribePage: vi.fn(track("subscribe", undefined)),
    listSubscriptions: vi.fn(track("readback", [{ appId: APP, fields: ["messages"] }])),
    storeToken: vi.fn(track("store", "vault-ref-new")),
    deleteToken: vi.fn(track("delete", undefined)),
    saveConnection: vi.fn(track("save", { ok: true as const, id: "cc-ig", previousCredentialRef: null as string | null })),
    ...overrides,
  };
  return { deps, calls };
}

describe("connectInstagramAccount", () => {
  it("subscribes the linked Page, reads it back, then stores the token and saves — in that order", async () => {
    const { deps, calls } = harness();
    const result = await connectInstagramAccount(account, APP, deps);

    expect(result).toEqual({ ok: true, accountLabel: "@royalalfathima", connectionId: "cc-ig" });
    expect(calls).toEqual(["owned", "active", "subscribe", "readback", "store", "save"]);
    expect(deps.subscribePage).toHaveBeenCalledWith("page-1", "page-token");
    expect(deps.saveConnection).toHaveBeenCalledWith({
      accountId: "ig-1784",
      displayName: "@royalalfathima",
      credentialRef: "vault-ref-new",
      credentialExpiresAt: null,
      metadata: { instagram_account_id: "ig-1784", username: "royalalfathima", page_id: "page-1", page_name: "Royal Al-Fathima" },
    });
  });

  it("refuses an account another agency already has, before calling Meta", async () => {
    const { deps } = harness({ ownedByAnotherAgency: vi.fn(async () => true) });
    await expect(connectInstagramAccount(account, APP, deps)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("another agency") });
    expect(deps.subscribePage).not.toHaveBeenCalled();
  });

  it("asks the agency to disconnect its current Instagram account before connecting a different one", async () => {
    const { deps } = harness({ activeConnectionAccountId: vi.fn(async () => "ig-other") });
    await expect(connectInstagramAccount(account, APP, deps)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("Disconnect it first") });
    expect(deps.subscribePage).not.toHaveBeenCalled();
  });

  it("allows reconnecting the same account", async () => {
    const { deps } = harness({ activeConnectionAccountId: vi.fn(async () => "ig-1784") });
    await expect(connectInstagramAccount(account, APP, deps)).resolves.toMatchObject({ ok: true });
  });

  it("does not report success, or store a token, when Meta is not delivering messages", async () => {
    const { deps } = harness({ listSubscriptions: vi.fn(async () => [{ appId: "someone-else", fields: ["messages"] }]) });
    await expect(connectInstagramAccount(account, APP, deps)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("not sending") });
    expect(deps.storeToken).not.toHaveBeenCalled();
    expect(deps.saveConnection).not.toHaveBeenCalled();
  });

  it("returns Meta's own message when subscribing fails, storing nothing", async () => {
    const { deps } = harness({ subscribePage: vi.fn(async () => Promise.reject(new Error("(#200) Requires pages_manage_metadata permission"))) });
    await expect(connectInstagramAccount(account, APP, deps)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("pages_manage_metadata") });
    expect(deps.storeToken).not.toHaveBeenCalled();
  });

  it("deletes the just-written secret when saving fails, so none is orphaned", async () => {
    const { deps } = harness({ saveConnection: vi.fn(async () => ({ ok: false as const, reason: "DATABASE" as const, message: "boom" })) });
    await expect(connectInstagramAccount(account, APP, deps)).resolves.toMatchObject({ ok: false });
    expect(deps.deleteToken).toHaveBeenCalledWith("vault-ref-new");
  });

  it("deletes the previous token of a reconnect only after the new one is saved", async () => {
    const { deps } = harness({ saveConnection: vi.fn(async () => ({ ok: true as const, id: "cc-ig", previousCredentialRef: "vault-ref-old" })) });
    await connectInstagramAccount(account, APP, deps);
    expect(deps.deleteToken).toHaveBeenCalledWith("vault-ref-old");
    expect(deps.deleteToken).toHaveBeenCalledTimes(1);
  });

  it("names an account that has no username by its name, then by its id", async () => {
    const { deps } = harness();
    await expect(connectInstagramAccount({ ...account, username: null }, APP, deps)).resolves.toMatchObject({ accountLabel: "Royal Al-Fathima" });
    await expect(connectInstagramAccount({ ...account, username: null, name: null }, APP, deps)).resolves.toMatchObject({ accountLabel: "Instagram account ig-1784" });
  });
});
