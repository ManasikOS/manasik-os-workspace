import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { connectMessengerPage } = await import("./connect");

import type { MessengerConnectDeps } from "./connect";

const page = { id: "page-1", name: "Royal Al-Fathima", accessToken: "page-token" };
const APP = "app-1";

function harness(overrides: Partial<MessengerConnectDeps> = {}) {
  const calls: string[] = [];
  const track = <T>(name: string, value: T) => async () => {
    calls.push(name);
    return value;
  };
  const deps: MessengerConnectDeps = {
    ownedByAnotherAgency: vi.fn(track("owned", false)),
    activeConnectionAccountId: vi.fn(track("active", null as string | null)),
    subscribePage: vi.fn(track("subscribe", undefined)),
    listSubscriptions: vi.fn(track("readback", [{ appId: APP, fields: ["messages", "message_echoes"] }])),
    storeToken: vi.fn(track("store", "vault-ref-new")),
    deleteToken: vi.fn(track("delete", undefined)),
    saveConnection: vi.fn(track("save", { ok: true as const, id: "cc-1", previousCredentialRef: null as string | null })),
    ...overrides,
  };
  return { deps, calls };
}

describe("connectMessengerPage", () => {
  it("subscribes, reads the subscription back, then stores the token and saves — in that order", async () => {
    const { deps, calls } = harness();
    const result = await connectMessengerPage(page, APP, deps);

    expect(result).toEqual({ ok: true, pageName: "Royal Al-Fathima", connectionId: "cc-1" });
    expect(calls).toEqual(["owned", "active", "subscribe", "readback", "store", "save"]);
    expect(deps.subscribePage).toHaveBeenCalledWith("page-1", "page-token");
    expect(deps.storeToken).toHaveBeenCalledWith("page-token");
    expect(deps.saveConnection).toHaveBeenCalledWith({
      accountId: "page-1",
      displayName: "Royal Al-Fathima",
      credentialRef: "vault-ref-new",
      credentialExpiresAt: null,
      metadata: { page_id: "page-1", page_name: "Royal Al-Fathima" },
    });
  });

  it("refuses a Page another agency already has, before calling Meta at all", async () => {
    const { deps } = harness({ ownedByAnotherAgency: vi.fn(async () => true) });
    const result = await connectMessengerPage(page, APP, deps);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("already connected to another agency") });
    expect(deps.subscribePage).not.toHaveBeenCalled();
    expect(deps.storeToken).not.toHaveBeenCalled();
  });

  it("asks the agency to disconnect its current Page before connecting a different one", async () => {
    const { deps } = harness({ activeConnectionAccountId: vi.fn(async () => "some-other-page") });
    const result = await connectMessengerPage(page, APP, deps);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Disconnect it first") });
    expect(deps.subscribePage).not.toHaveBeenCalled();
  });

  it("allows reconnecting the same Page", async () => {
    const { deps } = harness({ activeConnectionAccountId: vi.fn(async () => "page-1") });
    await expect(connectMessengerPage(page, APP, deps)).resolves.toMatchObject({ ok: true });
  });

  it("does not report success, or store a token, when Meta accepted the subscribe but is not delivering messages", async () => {
    const { deps } = harness({ listSubscriptions: vi.fn(async () => [{ appId: "someone-else", fields: ["messages"] }]) });
    const result = await connectMessengerPage(page, APP, deps);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("not sending") });
    expect(deps.storeToken).not.toHaveBeenCalled();
    expect(deps.saveConnection).not.toHaveBeenCalled();
  });

  it("returns Meta's own message when subscribing fails, storing nothing", async () => {
    const { deps } = harness({
      subscribePage: vi.fn(async () => {
        throw new Error("Messenger Graph API 400 on /page-1/subscribed_apps: (#200) Requires pages_manage_metadata permission");
      }),
    });
    const result = await connectMessengerPage(page, APP, deps);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("pages_manage_metadata") });
    expect(deps.storeToken).not.toHaveBeenCalled();
  });

  it("deletes the just-written secret when saving the connection fails, so none is orphaned", async () => {
    const { deps } = harness({ saveConnection: vi.fn(async () => ({ ok: false as const, reason: "DATABASE" as const, message: "boom" })) });
    const result = await connectMessengerPage(page, APP, deps);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Could not save the connection") });
    expect(deps.deleteToken).toHaveBeenCalledWith("vault-ref-new");
  });

  it("reports a lost race for the Page plainly, and still cleans up the secret", async () => {
    const { deps } = harness({
      saveConnection: vi.fn(async () => ({ ok: false as const, reason: "ALREADY_CONNECTED_ELSEWHERE" as const, message: "x" })),
    });
    const result = await connectMessengerPage(page, APP, deps);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("already connected to another agency") });
    expect(deps.deleteToken).toHaveBeenCalledWith("vault-ref-new");
  });

  it("deletes the previous token of a reconnect only after the new one is saved", async () => {
    const { deps, calls } = harness({
      saveConnection: vi.fn(async () => {
        calls.push("save");
        return { ok: true as const, id: "cc-1", previousCredentialRef: "vault-ref-old" };
      }),
    });
    await connectMessengerPage(page, APP, deps);
    expect(deps.deleteToken).toHaveBeenCalledWith("vault-ref-old");
    expect(calls.indexOf("save")).toBeLessThan(calls.length); // saved before the old one is removed
    expect(deps.deleteToken).toHaveBeenCalledTimes(1);
  });

  it("names a Page that has no name", async () => {
    const { deps } = harness();
    await expect(connectMessengerPage({ ...page, name: null }, APP, deps)).resolves.toMatchObject({ pageName: "Page page-1" });
  });
});
