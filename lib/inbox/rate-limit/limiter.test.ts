import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Db } from "@/lib/ai/db";

import { consumeInboxRateLimit } from "./limiter";
import { RATE_LIMIT_UNAVAILABLE_MESSAGE } from "./policy";

/** SEC-6 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): the limiter asks the database to count, and turns its answer into allow or refuse. */

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NOW = new Date("2026-10-05T10:20:00.000Z");

let override: { per_user_hourly: number | null; per_agency_daily: number | null } | null = null;
let overrideError: { message: string } | null = null;
let verdict: { data: unknown; error: { message: string } | null } = { data: { allowed: true, blocked_by: null }, error: null };
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const overrideFilters: Record<string, unknown> = {};

const db = {
  from: (table: string) => {
    if (table !== "inbox_rate_limit_overrides") throw new Error(`unexpected table ${table}`);
    const query: Record<string, unknown> = {};
    query.select = () => query;
    query.eq = (column: string, value: unknown) => ((overrideFilters[column] = value), query);
    query.maybeSingle = async () => ({ data: override, error: overrideError });
    return query;
  },
  rpc: async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return name === "consume_inbox_rate_limit" ? verdict : { error: null };
  },
} as unknown as Db;

beforeEach(() => {
  override = null;
  overrideError = null;
  verdict = { data: { allowed: true, blocked_by: null }, error: null };
  rpcCalls.length = 0;
  for (const key of Object.keys(overrideFilters)) delete overrideFilters[key];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("consumeInboxRateLimit", () => {
  it("asks the database to count one use against the person's hour and the agency's day, with the default limits", async () => {
    const result = await consumeInboxRateLimit(db, { agencyId: AGENCY, userId: USER, action: "START_WHATSAPP_CHAT", now: NOW });
    expect(result.ok).toBe(true);
    expect(rpcCalls).toEqual([
      {
        name: "consume_inbox_rate_limit",
        args: {
          p_agency_id: AGENCY,
          p_user_id: USER,
          p_action: "START_WHATSAPP_CHAT",
          p_user_limit: 15,
          p_agency_limit: 60,
          p_hour_start: "2026-10-05T09:30:00.000Z",
          p_day_start: "2026-10-04T18:30:00.000Z",
        },
      },
    ]);
  });

  it("looks up the override for this agency and this action only", async () => {
    await consumeInboxRateLimit(db, { agencyId: AGENCY, userId: USER, action: "SEND_TEMPLATE", now: NOW });
    expect(overrideFilters).toEqual({ agency_id: AGENCY, action: "SEND_TEMPLATE" });
  });

  it("uses the agency's override where it has one", async () => {
    override = { per_user_hourly: null, per_agency_daily: 250 };
    await consumeInboxRateLimit(db, { agencyId: AGENCY, userId: USER, action: "START_WHATSAPP_CHAT", now: NOW });
    expect(rpcCalls[0].args).toMatchObject({ p_user_limit: 15, p_agency_limit: 250 });
  });

  it("falls back to the defaults, and does not refuse, when the override cannot be read", async () => {
    overrideError = { message: "boom" };
    const result = await consumeInboxRateLimit(db, { agencyId: AGENCY, userId: USER, action: "START_WHATSAPP_CHAT", now: NOW });
    expect(result.ok).toBe(true);
    expect(rpcCalls[0].args).toMatchObject({ p_user_limit: 15, p_agency_limit: 60 });
  });

  it("refuses with the person's limit and the time they can go on, when their own hour is used up", async () => {
    verdict = { data: { allowed: false, blocked_by: "USER" }, error: null };
    const result = await consumeInboxRateLimit(db, { agencyId: AGENCY, userId: USER, action: "START_WHATSAPP_CHAT", now: NOW });
    expect(result).toEqual({ ok: false, error: "You have reached the limit of 15 new WhatsApp chats per hour. You can try again after 4:00 pm." });
  });

  it("refuses with the agency's limit, using the override figure, when the agency's day is used up", async () => {
    override = { per_user_hourly: null, per_agency_daily: 250 };
    verdict = { data: { allowed: false, blocked_by: "AGENCY" }, error: null };
    const result = await consumeInboxRateLimit(db, { agencyId: AGENCY, userId: USER, action: "START_WHATSAPP_CHAT", now: NOW });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("today's limit of 250") });
  });

  it("says the action is switched off when the override is 0", async () => {
    override = { per_user_hourly: 0, per_agency_daily: 0 };
    verdict = { data: { allowed: false, blocked_by: "AGENCY" }, error: null };
    const result = await consumeInboxRateLimit(db, { agencyId: AGENCY, userId: USER, action: "SUGGEST_REPLY", now: NOW });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("switched off") });
  });

  it("refuses a send when the counter cannot be read: a broken counter is not an open door", async () => {
    verdict = { data: null, error: { message: "boom" } };
    for (const action of ["START_WHATSAPP_CHAT", "START_EMAIL_CONVERSATION", "SEND_TEMPLATE"] as const) {
      expect(await consumeInboxRateLimit(db, { agencyId: AGENCY, userId: USER, action, now: NOW }), action).toEqual({ ok: false, error: RATE_LIMIT_UNAVAILABLE_MESSAGE });
    }
  });

  it("allows an AI helper when the counter cannot be read, and logs it", async () => {
    verdict = { data: null, error: { message: "boom" } };
    for (const action of ["SUGGEST_REPLY", "TRANSLATE", "PREPARE_OFFER"] as const) {
      expect((await consumeInboxRateLimit(db, { agencyId: AGENCY, userId: USER, action, now: NOW })).ok, action).toBe(true);
    }
    expect(console.error).toHaveBeenCalled();
  });

  it("treats an answer it does not understand as unavailable, never as allowed for a send", async () => {
    verdict = { data: { allowed: "yes" }, error: null };
    expect(await consumeInboxRateLimit(db, { agencyId: AGENCY, userId: USER, action: "START_WHATSAPP_CHAT", now: NOW })).toMatchObject({ ok: false });
  });

  it("gives a use back once, for the same windows it counted in, however many times it is called", async () => {
    const result = await consumeInboxRateLimit(db, { agencyId: AGENCY, userId: USER, action: "START_WHATSAPP_CHAT", now: NOW });
    if (!result.ok) throw new Error("expected the use to be counted");
    await result.giveBack();
    await result.giveBack();
    const refunds = rpcCalls.filter((call) => call.name === "refund_inbox_rate_limit");
    expect(refunds).toEqual([
      { name: "refund_inbox_rate_limit", args: { p_agency_id: AGENCY, p_user_id: USER, p_action: "START_WHATSAPP_CHAT", p_hour_start: "2026-10-05T09:30:00.000Z", p_day_start: "2026-10-04T18:30:00.000Z" } },
    ]);
  });
});
