import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let agencyIsTest = false;
let flagReadFails = false;
const sendTemplate = vi.fn();
const readWhatsAppToken = vi.fn();

vi.mock("@/lib/whatsapp/client", () => ({ sendTemplate: (...args: unknown[]) => sendTemplate(...args), classifyWhatsAppError: () => "UNKNOWN" }));
vi.mock("@/lib/whatsapp/vault", () => ({ readWhatsAppToken: (...args: unknown[]) => readWhatsAppToken(...args) }));
vi.mock("@/lib/data/whatsapp-billing-repository", () => ({ checkMarketingSendAllowed: async () => ({ allowed: true }) }));
vi.mock("@/lib/inbox/outbound/test-agency-send-guard", () => ({
  loadAgencyIsTest: async () => {
    if (flagReadFails) throw new Error("boom");
    return agencyIsTest;
  },
}));

import type { Db } from "@/lib/data/whatsapp-repository";
import { sendApprovedTemplate } from "./send-template-message";

const template = { id: "t-1", name: "welcome", language: "en", category: "UTILITY", components: [{ type: "BODY", text: "Welcome to our agency" }] };

function fakeDb(options: { integration: { id: string; phone_number_id: string; credential_ref: string; status: string } | null }): Db {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) chain[method] = () => chain;
      chain.maybeSingle = async () => ({ data: table === "whatsapp_templates" ? template : options.integration, error: null });
      chain.update = () => chain;
      return chain;
    },
  } as unknown as Db;
}

const connected = { id: "i-1", phone_number_id: "phone-1", credential_ref: "ref", status: "CONNECTED" };

beforeEach(() => {
  vi.stubEnv("SENTRY_ENVIRONMENT", "production");
  delete process.env.INBOX_OUTBOUND_ALLOWLIST;
  agencyIsTest = false;
  flagReadFails = false;
  sendTemplate.mockReset().mockResolvedValue({ externalMessageId: "wamid.REAL" });
  readWhatsAppToken.mockReset().mockResolvedValue("real-token");
});

afterEach(() => vi.unstubAllEnvs());

describe("sendApprovedTemplate and the outbound allow-list", () => {
  it("refuses a recipient who is not approved outside production, before touching the template, token or Meta", async () => {
    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    vi.stubEnv("INBOX_OUTBOUND_ALLOWLIST", "94770000000");
    const result = await sendApprovedTemplate({ db: fakeDb({ integration: connected }), agencyId: "a-1", to: "94771234567", templateId: "t-1", values: [] });

    expect(result).toMatchObject({ ok: false, reason: "SEND_FAILED", error: expect.stringContaining("not one of them") });
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(readWhatsAppToken).not.toHaveBeenCalled();
  });

  it("sends to an approved recipient outside production", async () => {
    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    vi.stubEnv("INBOX_OUTBOUND_ALLOWLIST", "+94 77 123 4567");
    const result = await sendApprovedTemplate({ db: fakeDb({ integration: connected }), agencyId: "a-1", to: "94771234567", templateId: "t-1", values: [] });

    expect(result.ok).toBe(true);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it("sends nothing outside production when no contacts are approved", async () => {
    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    const result = await sendApprovedTemplate({ db: fakeDb({ integration: connected }), agencyId: "a-1", to: "94771234567", templateId: "t-1", values: [] });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("no test contacts are approved") });
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("does not restrict a test agency, whose template is answered locally", async () => {
    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    agencyIsTest = true;
    const result = await sendApprovedTemplate({ db: fakeDb({ integration: null }), agencyId: "a-1", to: "94771234567", templateId: "t-1", values: [] });

    expect(result).toMatchObject({ ok: true, externalMessageId: expect.stringMatching(/^sim\.template\./) });
  });

  it("does not restrict production", async () => {
    vi.stubEnv("INBOX_OUTBOUND_ALLOWLIST", "94770000000");
    const result = await sendApprovedTemplate({ db: fakeDb({ integration: connected }), agencyId: "a-1", to: "94771234567", templateId: "t-1", values: [] });

    expect(result.ok).toBe(true);
  });
});

describe("sendApprovedTemplate and test agencies", () => {
  it("answers a test agency locally after the usual checks: no integration, token or Meta call is needed", async () => {
    agencyIsTest = true;
    const result = await sendApprovedTemplate({ db: fakeDb({ integration: null }), agencyId: "a-1", to: "94771234567", templateId: "t-1", values: [] });

    expect(result).toMatchObject({ ok: true, externalMessageId: expect.stringMatching(/^sim\.template\./), renderedText: "Welcome to our agency" });
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(readWhatsAppToken).not.toHaveBeenCalled();
  });

  it("still sends a normal agency's template through Meta", async () => {
    const result = await sendApprovedTemplate({ db: fakeDb({ integration: connected }), agencyId: "a-1", to: "94771234567", templateId: "t-1", values: [] });

    expect(result).toMatchObject({ ok: true, externalMessageId: "wamid.REAL" });
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the test flag cannot be read", async () => {
    flagReadFails = true;
    const result = await sendApprovedTemplate({ db: fakeDb({ integration: connected }), agencyId: "a-1", to: "94771234567", templateId: "t-1", values: [] });

    expect(result).toMatchObject({ ok: false, reason: "SEND_FAILED", error: expect.stringContaining("nothing was sent") });
    expect(sendTemplate).not.toHaveBeenCalled();
  });
});
