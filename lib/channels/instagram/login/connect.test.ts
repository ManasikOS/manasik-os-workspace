import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { connectInstagramLoginAccount } = await import("./connect");

import type { InstagramLoginConnectDeps } from "./connect";

const account = { id: "17841429904911692", username: "manasikos", name: "ManasikOS", accessToken: "long-token", expiresInSeconds: 5184000 };
const NOW = new Date("2026-09-24T12:00:00.000Z");
const now = () => NOW;

function harness(overrides: Partial<InstagramLoginConnectDeps> = {}) {
  const calls: string[] = [];
  const track = <T>(name: string, value: T) => async () => {
    calls.push(name);
    return value;
  };
  const deps: InstagramLoginConnectDeps = {
    ownedByAnotherAgency: vi.fn(track("owned", false)),
    activeConnectionAccountId: vi.fn(track("active", null as string | null)),
    subscribeAccount: vi.fn(track("subscribe", undefined)),
    listSubscriptions: vi.fn(track("readback", [{ fields: ["messages", "messaging_seen"] }])),
    storeToken: vi.fn(track("store", "vault-ref-new")),
    deleteToken: vi.fn(track("delete", undefined)),
    saveConnection: vi.fn(track("save", { ok: true as const, id: "cc-ig", previousCredentialRef: null as string | null })),
    ...overrides,
  };
  return { deps, calls };
}

describe("connectInstagramLoginAccount", () => {
  it("subscribes the account, reads it back, then stores the token and saves, in that order", async () => {
    const { deps, calls } = harness();
    const result = await connectInstagramLoginAccount(account, deps, now);

    expect(result).toEqual({ ok: true, accountLabel: "@manasikos", connectionId: "cc-ig" });
    expect(calls).toEqual(["owned", "active", "subscribe", "readback", "store", "save"]);
    expect(deps.subscribeAccount).toHaveBeenCalledWith("long-token");
  });

  it("records the connect method, the account id and when the 60-day token was issued and expires", async () => {
    const { deps } = harness();
    await connectInstagramLoginAccount(account, deps, now);
    expect(deps.saveConnection).toHaveBeenCalledWith({
      accountId: "17841429904911692",
      displayName: "@manasikos",
      credentialRef: "vault-ref-new",
      credentialExpiresAt: "2026-11-23T12:00:00.000Z",
      metadata: { connect_method: "INSTAGRAM_LOGIN", instagram_account_id: "17841429904911692", username: "manasikos", token_issued_at: "2026-09-24T12:00:00.000Z" },
    });
  });

  it("records no expiry when Meta did not say how long the token lasts", async () => {
    const { deps } = harness();
    await connectInstagramLoginAccount({ ...account, expiresInSeconds: null }, deps, now);
    expect(deps.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ credentialExpiresAt: null }));
  });

  it("refuses an account another agency already has, before calling Meta", async () => {
    const { deps } = harness({ ownedByAnotherAgency: vi.fn(async () => true) });
    await expect(connectInstagramLoginAccount(account, deps, now)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("another agency") });
    expect(deps.subscribeAccount).not.toHaveBeenCalled();
    expect(deps.storeToken).not.toHaveBeenCalled();
  });

  it("asks the agency to disconnect its current Instagram account before connecting a different one", async () => {
    const { deps } = harness({ activeConnectionAccountId: vi.fn(async () => "another-account") });
    await expect(connectInstagramLoginAccount(account, deps, now)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("Disconnect it first") });
    expect(deps.subscribeAccount).not.toHaveBeenCalled();
  });

  it("allows reconnecting the same account, which is how a Page connection converts", async () => {
    const { deps } = harness({ activeConnectionAccountId: vi.fn(async () => "17841429904911692") });
    await expect(connectInstagramLoginAccount(account, deps, now)).resolves.toMatchObject({ ok: true });
  });

  it("does not report success, or store a token, when Meta is not delivering messages", async () => {
    const { deps } = harness({ listSubscriptions: vi.fn(async () => [{ fields: ["comments"] }]) });
    await expect(connectInstagramLoginAccount(account, deps, now)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("not sending") });
    expect(deps.storeToken).not.toHaveBeenCalled();
    expect(deps.saveConnection).not.toHaveBeenCalled();
  });

  it("returns Meta's own message when subscribing fails, storing nothing", async () => {
    const { deps } = harness({ subscribeAccount: vi.fn(async () => Promise.reject(new Error("Instagram Login API 400: Permission denied"))) });
    await expect(connectInstagramLoginAccount(account, deps, now)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("Permission denied") });
    expect(deps.storeToken).not.toHaveBeenCalled();
  });

  it("deletes the just-written secret when saving fails, so none is orphaned", async () => {
    const { deps } = harness({ saveConnection: vi.fn(async () => ({ ok: false as const, reason: "DATABASE" as const, message: "boom" })) });
    await expect(connectInstagramLoginAccount(account, deps, now)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("boom") });
    expect(deps.deleteToken).toHaveBeenCalledWith("vault-ref-new");
  });

  it("reports an account claimed by another agency in the meantime, and removes the new secret", async () => {
    const { deps } = harness({ saveConnection: vi.fn(async () => ({ ok: false as const, reason: "ALREADY_CONNECTED_ELSEWHERE" as const, message: "x" })) });
    await expect(connectInstagramLoginAccount(account, deps, now)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("another agency") });
    expect(deps.deleteToken).toHaveBeenCalledWith("vault-ref-new");
  });

  it("deletes the previous token of a reconnect only after the new one is saved", async () => {
    const { deps, calls } = harness({ saveConnection: vi.fn(async () => ({ ok: true as const, id: "cc-ig", previousCredentialRef: "vault-ref-old" })) });
    await connectInstagramLoginAccount(account, deps, now);
    expect(deps.deleteToken).toHaveBeenCalledWith("vault-ref-old");
    expect(deps.deleteToken).toHaveBeenCalledTimes(1);
    expect(calls.indexOf("store")).toBeLessThan(calls.indexOf("delete"));
  });

  it("names an account that has no username by its name, then by its id", async () => {
    const { deps } = harness();
    await expect(connectInstagramLoginAccount({ ...account, username: null }, deps, now)).resolves.toMatchObject({ accountLabel: "ManasikOS" });
    await expect(connectInstagramLoginAccount({ ...account, username: null, name: null }, deps, now)).resolves.toMatchObject({ accountLabel: "Instagram account 17841429904911692" });
  });
});
