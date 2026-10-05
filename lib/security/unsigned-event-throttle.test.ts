import { beforeEach, describe, expect, it, vi } from "vitest";

import { mayRecordUnsignedEvent, resetUnsignedEventThrottle, UNSIGNED_EVENT_STUBS_PER_MINUTE } from "./unsigned-event-throttle";

/**
 * SEC-7 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): a webhook request with a bad signature may store a small "rejected" stub, but
 * only a limited number a minute, so a flood cannot grow the table or cost a database write per request.
 */

const MINUTE = 60_000;
const T0 = Date.parse("2026-10-05T10:00:10.000Z");

let storedThisMinute = 0;
let countError: { message: string } | null = null;
const queries: Array<{ table: string; select: unknown[]; filters: Record<string, unknown> }> = [];

const db = {
  from: (table: string) => {
    const call = { table, select: [] as unknown[], filters: {} as Record<string, unknown> };
    queries.push(call);
    const query: Record<string, unknown> = {};
    query.select = (...args: unknown[]) => ((call.select = args), query);
    query.eq = (column: string, value: unknown) => ((call.filters[column] = value), query);
    query.gte = (column: string, value: unknown) => ((call.filters[`${column}>=`] = value), query);
    query.then = (resolve: (value: unknown) => unknown) => resolve(countError ? { count: null, error: countError } : { count: storedThisMinute, error: null });
    return query;
  },
} as never;

beforeEach(() => {
  resetUnsignedEventThrottle();
  storedThisMinute = 0;
  countError = null;
  queries.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("mayRecordUnsignedEvent", () => {
  it("allows a stub while the minute has room", async () => {
    storedThisMinute = UNSIGNED_EVENT_STUBS_PER_MINUTE - 1;
    expect(await mayRecordUnsignedEvent(db, "whatsapp_webhook_events", T0)).toBe(true);
  });

  it("refuses once the minute's stubs are used up", async () => {
    storedThisMinute = UNSIGNED_EVENT_STUBS_PER_MINUTE;
    expect(await mayRecordUnsignedEvent(db, "whatsapp_webhook_events", T0)).toBe(false);
  });

  it("counts only rejected rows from this clock minute, in the table it was asked about", async () => {
    await mayRecordUnsignedEvent(db, "channel_webhook_events", T0);
    expect(queries[0]).toEqual({
      table: "channel_webhook_events",
      select: ["id", { count: "exact", head: true }],
      filters: { signature_valid: false, "received_at>=": "2026-10-05T10:00:00.000Z" },
    });
  });

  it("stops asking the database for the rest of a minute that is already used up, so a flood costs one count, not one per request", async () => {
    storedThisMinute = UNSIGNED_EVENT_STUBS_PER_MINUTE;
    for (let request = 0; request < 50; request += 1) expect(await mayRecordUnsignedEvent(db, "whatsapp_webhook_events", T0 + request)).toBe(false);
    expect(queries).toHaveLength(1);
  });

  it("starts again in the next minute", async () => {
    storedThisMinute = UNSIGNED_EVENT_STUBS_PER_MINUTE;
    expect(await mayRecordUnsignedEvent(db, "whatsapp_webhook_events", T0)).toBe(false);
    storedThisMinute = 0;
    expect(await mayRecordUnsignedEvent(db, "whatsapp_webhook_events", T0 + MINUTE)).toBe(true);
  });

  it("keeps a separate budget for each table", async () => {
    storedThisMinute = UNSIGNED_EVENT_STUBS_PER_MINUTE;
    expect(await mayRecordUnsignedEvent(db, "whatsapp_webhook_events", T0)).toBe(false);
    storedThisMinute = 0;
    expect(await mayRecordUnsignedEvent(db, "channel_webhook_events", T0)).toBe(true);
  });

  it("warns once a minute, not once per refused request", async () => {
    storedThisMinute = UNSIGNED_EVENT_STUBS_PER_MINUTE;
    for (let request = 0; request < 10; request += 1) await mayRecordUnsignedEvent(db, "whatsapp_webhook_events", T0 + request);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("refuses, and logs, when the count cannot be read, instead of writing anyway", async () => {
    countError = { message: "boom" };
    expect(await mayRecordUnsignedEvent(db, "whatsapp_webhook_events", T0)).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it("asks again after a failed read, rather than treating the minute as used up", async () => {
    countError = { message: "boom" };
    await mayRecordUnsignedEvent(db, "whatsapp_webhook_events", T0);
    countError = null;
    expect(await mayRecordUnsignedEvent(db, "whatsapp_webhook_events", T0 + 1)).toBe(true);
  });
});
