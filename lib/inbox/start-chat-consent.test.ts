import { describe, expect, it } from "vitest";

import type { Db } from "@/lib/ai/db";

import { checkStartChatConsent, decideStartChatConsent } from "./start-chat-consent";

/** SEC-6 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): a chat staff start by hand honours the same opt-out the Copilot draft path does. */

describe("decideStartChatConsent", () => {
  it("allows a number nobody has a record of: consent for a walk-in is simply not recorded yet", () => {
    expect(decideStartChatConsent([])).toEqual({ allowed: true });
  });

  it("allows a lead whose consent is unknown or given", () => {
    expect(decideStartChatConsent([{ consent_status: "UNKNOWN", do_not_contact: false }, { consent_status: "OPTED_IN", do_not_contact: false }])).toEqual({ allowed: true });
  });

  it("refuses a lead who opted out", () => {
    expect(decideStartChatConsent([{ consent_status: "OPTED_OUT", do_not_contact: false }])).toMatchObject({ allowed: false, reason: "OPTED_OUT" });
  });

  it("refuses a lead marked do-not-contact, even one who once opted in", () => {
    expect(decideStartChatConsent([{ consent_status: "OPTED_IN", do_not_contact: true }])).toMatchObject({ allowed: false, reason: "OPTED_OUT" });
  });

  it("refuses when any one of several leads sharing the number has opted out", () => {
    expect(decideStartChatConsent([{ consent_status: "OPTED_IN", do_not_contact: false }, { consent_status: "OPTED_OUT", do_not_contact: false }])).toMatchObject({ allowed: false });
  });
});

describe("checkStartChatConsent", () => {
  function fakeDb(result: { data: unknown; error: { message: string } | null }) {
    const filters: Record<string, unknown> = {};
    const query: Record<string, unknown> = {};
    query.select = () => query;
    query.eq = (column: string, value: unknown) => ((filters[column] = value), query);
    query.limit = async () => result;
    return { db: { from: () => query } as unknown as Db, filters };
  }

  it("reads only this agency's leads with this number", async () => {
    const fake = fakeDb({ data: [], error: null });
    expect(await checkStartChatConsent(fake.db, { agencyId: "agency-1", mobile: "0771234567" })).toEqual({ allowed: true });
    expect(fake.filters).toEqual({ agency_id: "agency-1", mobile: "0771234567" });
  });

  it("refuses an opted-out lead found by number", async () => {
    const fake = fakeDb({ data: [{ consent_status: "OPTED_OUT", do_not_contact: false }], error: null });
    expect(await checkStartChatConsent(fake.db, { agencyId: "agency-1", mobile: "0771234567" })).toMatchObject({ allowed: false, reason: "OPTED_OUT" });
  });

  it("refuses, rather than guesses, when the leads cannot be read", async () => {
    const fake = fakeDb({ data: null, error: { message: "boom" } });
    expect(await checkStartChatConsent(fake.db, { agencyId: "agency-1", mobile: "0771234567" })).toMatchObject({ allowed: false, reason: "UNREADABLE" });
  });
});
