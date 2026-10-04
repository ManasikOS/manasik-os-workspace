import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let agencyIsTest = false;
let flagReadFails = false;
const realAdapter = { provider: "WHATSAPP", profile: { displayName: "WhatsApp" }, classifyError: () => "UNKNOWN" };
const getChannelAdapter = vi.fn();

vi.mock("@/lib/channels/registry", () => ({ getChannelAdapter: (...args: unknown[]) => getChannelAdapter(...args) }));
vi.mock("@/lib/inbox/outbound/test-agency-send-guard", () => ({
  loadAgencyIsTest: async () => {
    if (flagReadFails) throw new Error("Could not check whether the agency is a test agency: boom");
    return agencyIsTest;
  },
}));

import type { Db } from "@/lib/ai/db";
import { assertSendMatchesAdapter, getChannelAdapterForAgency } from "./adapter-for-agency";

const db = {} as Db;

beforeEach(() => {
  agencyIsTest = false;
  flagReadFails = false;
  getChannelAdapter.mockReset().mockReturnValue(realAdapter);
});

describe("getChannelAdapterForAgency", () => {
  it("returns the real adapter for a normal agency", async () => {
    expect(await getChannelAdapterForAgency(db, "agency-1", "WHATSAPP")).toBe(realAdapter);
  });

  it("returns the simulator for a test agency", async () => {
    agencyIsTest = true;
    const adapter = await getChannelAdapterForAgency(db, "agency-1", "WHATSAPP");
    expect(adapter).not.toBe(realAdapter);
    expect(adapter.simulated).toBe(true);
  });

  it("fails before reading the flag when no adapter is installed, so callers keep treating it as permanent", async () => {
    getChannelAdapter.mockImplementation(() => {
      throw new Error("No adapter is installed for TELEGRAM.");
    });
    flagReadFails = true;
    await expect(getChannelAdapterForAgency(db, "agency-1", "TELEGRAM" as never)).rejects.toThrow(/^No adapter is installed/);
  });

  it("fails closed, never returning the real adapter, when the flag cannot be read", async () => {
    flagReadFails = true;
    await expect(getChannelAdapterForAgency(db, "agency-1", "WHATSAPP")).rejects.toThrow(/boom/);
  });
});

describe("assertSendMatchesAdapter", () => {
  it("accepts a real authorization with a real adapter and a simulated one with the simulator", () => {
    expect(() => assertSendMatchesAdapter({ simulated: false }, {})).not.toThrow();
    expect(() => assertSendMatchesAdapter({ simulated: true }, { simulated: true })).not.toThrow();
  });

  it("treats a missing flag on the authorization as a real agency", () => {
    expect(() => assertSendMatchesAdapter({}, {})).not.toThrow();
  });

  it("refuses a real adapter for a test agency, and the simulator for a real agency", () => {
    expect(() => assertSendMatchesAdapter({ simulated: true }, {})).toThrow(/nothing was sent/);
    expect(() => assertSendMatchesAdapter({ simulated: false }, { simulated: true })).toThrow(/nothing was sent/);
  });
});
