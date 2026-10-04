import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { revokeConnectionsForMetaUser, type RevocableConnection } from "@/lib/channels/meta-user-revocation";

import { readDeletionConfirmationCode } from "./signed-request";
import { processDataDeletion, processDeauthorize, type UserCallbackDeps } from "./user-callbacks";

const SECRET = "app-secret-1";
const NOW = new Date("2026-09-19T12:00:00.000Z");
const b64url = (value: Buffer | string) => Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function signed(userId: string, secret = SECRET) {
  const payload = b64url(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: userId, issued_at: 1 }));
  return `${b64url(createHmac("sha256", secret).update(payload).digest())}.${payload}`;
}

function deps(over: Partial<UserCallbackDeps> = {}): UserCallbackDeps & { revoke: ReturnType<typeof vi.fn> } {
  return { appSecrets: [SECRET], revoke: vi.fn(async () => ({ disconnected: 1, failed: 0 })), siteUrl: "https://crm.example.com/", now: () => NOW, ...over } as never;
}

describe("processDeauthorize", () => {
  it("revokes what that Meta user connected and answers 200", async () => {
    const d = deps();
    await expect(processDeauthorize(signed("u-1"), d)).resolves.toEqual({ status: 200, body: {} });
    expect(d.revoke).toHaveBeenCalledWith("u-1");
  });

  it("refuses a forged or missing request with 400 and changes nothing", async () => {
    const d = deps();
    for (const bad of [signed("u-1", "wrong-secret"), null, "garbage"]) {
      await expect(processDeauthorize(bad, d)).resolves.toMatchObject({ status: 400 });
    }
    expect(d.revoke).not.toHaveBeenCalled();
  });
});

describe("processDataDeletion", () => {
  it("revokes, then returns the status URL and a confirmation code the status page can verify", async () => {
    const deleteData = vi.fn(async () => ({ disconnected: 1, failed: 0 }));
    const d = deps({ deleteData });
    const result = await processDataDeletion(signed("u-1"), d);
    expect(deleteData).toHaveBeenCalledWith("u-1");
    expect(d.revoke).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
    const body = result.body as { url: string; confirmation_code: string };
    expect(body.url).toBe(`https://crm.example.com/legal/data-deletion/status?code=${encodeURIComponent(body.confirmation_code)}`);
    expect(readDeletionConfirmationCode(body.confirmation_code, SECRET)?.toISOString()).toBe(NOW.toISOString());
  });

  it("refuses a forged request without revoking or issuing a code", async () => {
    const d = deps();
    await expect(processDataDeletion(signed("u-1", "wrong"), d)).resolves.toMatchObject({ status: 400 });
    expect(d.revoke).not.toHaveBeenCalled();
  });

  it("does not put the Facebook user id anywhere in the response", async () => {
    const result = await processDataDeletion(signed("u-secret-777"), deps());
    expect(JSON.stringify(result)).not.toContain("u-secret-777");
  });
});

describe("revokeConnectionsForMetaUser", () => {
  const connection = (id: string, over: Partial<RevocableConnection> = {}): RevocableConnection => ({ id, agency_id: `agency-${id}`, provider: "MESSENGER", credential_ref: `ref-${id}`, ...over });

  it("deletes each token and disconnects each connection, across agencies", async () => {
    const deleteToken = vi.fn(async () => undefined);
    const markDisconnected = vi.fn(async () => undefined);
    const result = await revokeConnectionsForMetaUser("u-1", { findConnections: async () => [connection("a"), connection("b", { provider: "INSTAGRAM" })], deleteToken, markDisconnected });
    expect(result).toEqual({ disconnected: 2, failed: 0 });
    expect(deleteToken).toHaveBeenCalledWith("ref-a");
    expect(deleteToken).toHaveBeenCalledWith("ref-b");
    expect(markDisconnected).toHaveBeenCalledWith("a", "agency-a");
    expect(markDisconnected).toHaveBeenCalledWith("b", "agency-b");
  });

  it("is a quiet no-op for a user who connected nothing", async () => {
    const deleteToken = vi.fn();
    await expect(revokeConnectionsForMetaUser("nobody", { findConnections: async () => [], deleteToken, markDisconnected: vi.fn() })).resolves.toEqual({ disconnected: 0, failed: 0 });
    expect(deleteToken).not.toHaveBeenCalled();
  });

  it("deletes the token before disconnecting, so a failed disconnect never leaves a live credential", async () => {
    const order: string[] = [];
    await revokeConnectionsForMetaUser("u", {
      findConnections: async () => [connection("a")],
      deleteToken: async () => void order.push("token"),
      markDisconnected: async () => void order.push("disconnect"),
    });
    expect(order).toEqual(["token", "disconnect"]);
  });

  it("still disconnects when the token is already gone, and keeps going when one connection fails", async () => {
    const markDisconnected = vi.fn(async (id: string) => {
      if (id === "a") throw new Error("db down");
    });
    const result = await revokeConnectionsForMetaUser("u", {
      findConnections: async () => [connection("a"), connection("b")],
      deleteToken: async () => Promise.reject(new Error("already deleted")),
      markDisconnected,
    });
    expect(result).toEqual({ disconnected: 1, failed: 1 });
    expect(markDisconnected).toHaveBeenCalledWith("b", "agency-b");
  });

  it("skips the token step for a connection that has no credential", async () => {
    const deleteToken = vi.fn();
    await revokeConnectionsForMetaUser("u", { findConnections: async () => [connection("a", { credential_ref: null })], deleteToken, markDisconnected: vi.fn() });
    expect(deleteToken).not.toHaveBeenCalled();
  });
});
