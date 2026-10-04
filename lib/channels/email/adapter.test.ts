import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sendMail = vi.fn();
const close = vi.fn();
const createTransport = vi.fn(() => ({ sendMail, close }));
vi.mock("nodemailer", () => ({ default: { createTransport } }));

const { gmailChannelAdapter: adapter } = await import("./adapter");
const { getChannelAdapter, hasChannelAdapter } = await import("@/lib/channels/registry");

import type { ResolvedChannelConnection } from "@/lib/channels/adapter";

const smtpConfig: NonNullable<ResolvedChannelConnection["smtpConfig"]> = {
  host: "smtp.example.com", port: 587, security: "STARTTLS", username: "agency@example.com",
  fromName: "Royal Al-Fathima Travels", fromEmail: "agency@example.com", replyTo: "support@example.com",
};

const connection = (overrides: Partial<ResolvedChannelConnection> = {}): ResolvedChannelConnection => ({
  provider: "GMAIL", id: "conn-1", status: "CONNECTED", credentialRef: "ref-1",
  displayAddress: "agency@example.com", fundingStatus: null, accountId: "agency@example.com",
  smtpConfig, ...overrides,
});

/** A chainable stand-in for the Supabase client, matching the shape resolveConnection/resolveConnectionForChannelConnection use. */
function fakeDb(row: Record<string, unknown> | null, rpcResult: { data?: unknown; error?: unknown } = { data: "s3cr3t" }) {
  const updates: Array<{ table: string; patch: Record<string, unknown>; id: unknown }> = [];
  const db = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
            maybeSingle: async () => ({ data: row, error: null }),
          }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async (_column: string, id: unknown) => {
          updates.push({ table, patch, id });
          return { error: null };
        },
      }),
    }),
    rpc: async () => rpcResult,
  };
  return { db: db as never, updates };
}

describe("channel registry", () => {
  it("registers Email alongside the Meta channels", () => {
    expect(hasChannelAdapter("GMAIL")).toBe(true);
    expect(getChannelAdapter("GMAIL")).toBe(adapter);
  });
});

describe("gmailChannelAdapter.resolveConnection", () => {
  it("shapes a connection from channel_connections' provider_metadata", async () => {
    const { db } = fakeDb({
      id: "conn-1", status: "CONNECTED", credential_ref: "ref-1",
      provider_metadata: { host: "smtp.example.com", port: 587, security: "STARTTLS", username: "agency@example.com", fromName: "Agency", fromEmail: "agency@example.com", replyTo: "" },
    });
    const resolved = await adapter.resolveConnection(db, "agency-1");
    expect(resolved).toMatchObject({ provider: "GMAIL", accountId: "agency@example.com", credentialRef: "ref-1" });
    expect(resolved?.smtpConfig?.host).toBe("smtp.example.com");
  });

  it("returns null rather than guessing when a saved connection has incomplete SMTP configuration", async () => {
    const { db } = fakeDb({ id: "conn-1", status: "NOT_CONNECTED", credential_ref: null, provider_metadata: { host: "smtp.example.com" } });
    expect(await adapter.resolveConnection(db, "agency-1")).toBeNull();
  });

  it("returns null when no connection exists", async () => {
    const { db } = fakeDb(null);
    expect(await adapter.resolveConnection(db, "agency-1")).toBeNull();
  });
});

describe("gmailChannelAdapter.readToken", () => {
  it("reads the password through the shared Vault RPC", async () => {
    const { db } = fakeDb(null, { data: "the-password" });
    expect(await adapter.readToken(db, connection())).toBe("the-password");
  });

  it("returns null without a credential reference", async () => {
    const { db } = fakeDb(null);
    expect(await adapter.readToken(db, connection({ credentialRef: null }))).toBeNull();
  });
});

describe("gmailChannelAdapter.sendReply", () => {
  it("sends through nodemailer using the connection's SMTP config, and closes the transport", async () => {
    sendMail.mockResolvedValueOnce({ messageId: "<abc@example.com>" });
    const result = await adapter.sendReply(connection(), "the-password", {
      to: "customer@example.com", text: "Hello", subject: "Re: your trip", cc: ["cc@example.com"], inReplyTo: "<orig@example.com>",
    });
    expect(result).toEqual({ externalMessageId: "<abc@example.com>" });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.example.com", port: 587, secure: false, requireTLS: true }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: [{ address: "customer@example.com", name: "" }],
      cc: ["cc@example.com"],
      subject: "Re: your trip",
      text: "Hello",
      inReplyTo: "<orig@example.com>",
      replyTo: { address: "support@example.com", name: "" },
    }));
    expect(close).toHaveBeenCalled();
  });

  it("refuses to send without an SMTP configuration", async () => {
    await expect(adapter.sendReply(connection({ smtpConfig: null }), "t", { to: "x@example.com", text: "hi" })).rejects.toThrow(
      "Email connection is missing its SMTP configuration.",
    );
  });
});

describe("gmailChannelAdapter.sendMedia", () => {
  it("attaches the signed URL as a file", async () => {
    sendMail.mockResolvedValueOnce({ messageId: "<file@example.com>" });
    const result = await adapter.sendMedia!(connection(), "the-password", {
      to: "customer@example.com", kind: "document", url: "https://signed.example/file.pdf", filename: "brochure.pdf", caption: "Here it is",
    });
    expect(result).toEqual({ externalMessageId: "<file@example.com>" });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [{ filename: "brochure.pdf", path: "https://signed.example/file.pdf" }],
      text: "Here it is",
    }));
  });
});

describe("gmailChannelAdapter.classifyError", () => {
  it("treats an SMTP authentication failure as a dead token", () => {
    expect(adapter.classifyError({ code: "EAUTH" })).toBe("TOKEN_DEAD");
  });

  it("classifies anything else as unknown rather than guessing a specific reason", () => {
    expect(adapter.classifyError({ code: "ETIMEDOUT" })).toBe("UNKNOWN");
    expect(adapter.classifyError(new Error("boom"))).toBe("UNKNOWN");
  });
});

describe("gmailChannelAdapter.reflectSendFailure", () => {
  it("marks the connection ERROR only for a dead token", async () => {
    const { db, updates } = fakeDb(null);
    await adapter.reflectSendFailure(db, connection(), "agency-1", "TOKEN_DEAD", new Error("auth failed"));
    expect(updates).toEqual([{ table: "channel_connections", patch: { status: "ERROR", last_error: "The mail server rejected the stored password — save the SMTP settings again." }, id: "conn-1" }]);
  });

  it("touches nothing for a failure a password change would not fix", async () => {
    const { db, updates } = fakeDb(null);
    await adapter.reflectSendFailure(db, connection(), "agency-1", "UNKNOWN", new Error("timed out"));
    expect(updates).toEqual([]);
  });
});
