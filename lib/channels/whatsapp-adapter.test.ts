import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { whatsappChannelAdapter: adapter } = await import("./whatsapp-adapter");
const { WhatsAppSendError } = await import("@/lib/whatsapp/client");
const { getChannelAdapter, hasChannelAdapter } = await import("./registry");

import type { ResolvedChannelConnection } from "./adapter";

const connection = (overrides: Partial<ResolvedChannelConnection> = {}): ResolvedChannelConnection => ({
  provider: "WHATSAPP",
  id: "int-1",
  status: "CONNECTED",
  credentialRef: "ref",
  displayAddress: "+94 11 222 3344",
  fundingStatus: "FUNDED",
  accountId: "phone-1",
  ...overrides,
});

/** A chainable stand-in for the Supabase client that records every update against a table. */
function fakeDb() {
  const updates: Array<{ table: string; patch: Record<string, unknown>; id: unknown }> = [];
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const db = {
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async (_column: string, id: unknown) => {
          updates.push({ table, patch, id });
          return { error: null };
        },
      }),
      insert: async (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return { error: null };
      },
    }),
  };
  return { db: db as never, updates, inserts };
}

describe("whatsappChannelAdapter.decorateReplyText", () => {
  it("appends the Call us line only on a Book Now turn", () => {
    const withBookNow = adapter.decorateReplyText("Here is the trip.", [{ id: "action_book_now", title: "Book Now 📅" }], connection());
    expect(withBookNow).toBe("Here is the trip.\n\n📞 Call us: +94112223344");
    expect(adapter.decorateReplyText("Here is the trip.", [], connection())).toBe("Here is the trip.");
    expect(
      adapter.decorateReplyText("Confirm?", [{ id: "action_confirm_booking", title: "Confirm booking" }], connection()),
    ).toBe("Confirm?");
  });

  it("adds nothing when the connection has no public number", () => {
    expect(adapter.decorateReplyText("Hi", [{ id: "action_book_now", title: "x" }], connection({ displayAddress: null }))).toBe("Hi");
  });
});

describe("whatsappChannelAdapter.reflectSendFailure", () => {
  it("marks a dead token as ERROR with the reconnect message", async () => {
    const { db, updates } = fakeDb();
    await adapter.reflectSendFailure(db, connection(), "agency-1", "TOKEN_DEAD", new Error("expired"));
    expect(updates).toContainEqual({
      table: "whatsapp_integrations",
      patch: { status: "ERROR", last_error: "WhatsApp rejected the stored access token — reconnect required." },
      id: "int-1",
    });
  });

  it("marks an unfunded account UNFUNDED on both status and funding", async () => {
    const { db, updates } = fakeDb();
    await adapter.reflectSendFailure(db, connection(), "agency-1", "UNFUNDED", new Error("payment"));
    expect(updates).toContainEqual({
      table: "whatsapp_integrations",
      patch: {
        status: "UNFUNDED",
        funding_status: "UNFUNDED",
        last_error: "Meta rejected this send — no valid payment method is attached to this WhatsApp Business Account.",
      },
      id: "int-1",
    });
  });

  it("touches nothing for failures a person cannot fix by reconnecting", async () => {
    const { db, updates } = fakeDb();
    for (const errorClass of ["RATE_LIMITED", "OUTSIDE_SERVICE_WINDOW", "NOT_REGISTERED", "UNKNOWN"] as const) {
      await adapter.reflectSendFailure(db, connection(), "agency-1", errorClass, new Error("x"));
    }
    expect(updates).toEqual([]);
  });
});

describe("whatsappChannelAdapter.reflectSendSuccess", () => {
  it("clears an earlier funding problem", async () => {
    const { db, updates } = fakeDb();
    await adapter.reflectSendSuccess(db, connection({ fundingStatus: "UNFUNDED" }));
    expect(updates).toEqual([{ table: "whatsapp_integrations", patch: { funding_status: "FUNDED" }, id: "int-1" }]);
  });

  it("does nothing when there was no funding problem", async () => {
    const { db, updates } = fakeDb();
    await adapter.reflectSendSuccess(db, connection({ fundingStatus: "FUNDED" }));
    expect(updates).toEqual([]);
  });
});

describe("whatsappChannelAdapter.classifyError", () => {
  const metaError = (code: number, status = 400) => new WhatsAppSendError("x", status, { error: { code } });

  it("keeps Meta's WhatsApp error taxonomy", () => {
    expect(adapter.classifyError(metaError(190))).toBe("TOKEN_DEAD");
    expect(adapter.classifyError(metaError(131047))).toBe("OUTSIDE_SERVICE_WINDOW");
    expect(adapter.classifyError(metaError(133010))).toBe("NOT_REGISTERED");
    expect(adapter.classifyError(metaError(131042))).toBe("UNFUNDED");
    expect(adapter.classifyError(metaError(4))).toBe("RATE_LIMITED");
    expect(adapter.classifyError(new WhatsAppSendError("x", 429, null))).toBe("RATE_LIMITED");
    expect(adapter.classifyError(new Error("network"))).toBe("UNKNOWN");
  });
});

describe("whatsappChannelAdapter.sendReply", () => {
  it("refuses to send without a phone number id", async () => {
    await expect(adapter.sendReply(connection({ accountId: null }), "t", { to: "9477", text: "hi" })).rejects.toThrow(
      "WhatsApp connection has no phone number id.",
    );
  });
});

describe("channel registry", () => {
  it("returns the WhatsApp adapter", () => {
    expect(hasChannelAdapter("WHATSAPP")).toBe(true);
    expect(getChannelAdapter("WHATSAPP")).toBe(adapter);
  });

  it("registers Email alongside the Meta channels", () => {
    expect(hasChannelAdapter("GMAIL")).toBe(true);
  });

  it("refuses a provider with no adapter instead of pretending to send", () => {
    expect(() => getChannelAdapter("WEB_CHAT")).toThrow("No adapter is installed for WEB_CHAT.");
  });
});
