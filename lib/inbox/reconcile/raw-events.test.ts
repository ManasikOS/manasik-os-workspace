import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Db } from "@/lib/ai/db";
import { everyMs, reconcileRawEvents, type ReconcileDeps } from "@/lib/inbox/reconcile/raw-events";

const AGENCY = "0b8e7c3a-1f4d-4e6a-9d2b-7a1c5e3f9b10";
const OTHER_AGENCY = "9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";

function whatsappDelivery(ids: string[], phoneNumberId = "PN1") {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [{ field: "messages", value: { metadata: { phone_number_id: phoneNumberId }, messages: ids.map((id) => ({ id, from: "94771234567", type: "text", text: { body: "hi" } })) } }],
      },
    ],
  };
}

function messengerDelivery(events: Array<{ mid: string; video?: boolean }>) {
  return {
    object: "page",
    entry: [
      {
        id: "PAGE1",
        messaging: events.map((event) => ({
          sender: { id: "PSID1" },
          recipient: { id: "PAGE1" },
          timestamp: 1,
          message: event.video ? { mid: event.mid, attachments: [{ type: "video", payload: { url: "https://x" } }] } : { mid: event.mid, text: "hello" },
        })),
      },
    ],
  };
}

function world(input: { whatsapp?: Array<{ id: string; payload: unknown; error?: string | null; agency?: string }>; channel?: Array<{ id: string; payload: unknown; provider?: string }>; stored?: string[] }) {
  const marks: Array<{ source: string; ids: string[]; error: string | null }> = [];
  const finds: Array<Record<string, unknown>> = [];
  const db = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "find_unreconciled_raw_events") {
        finds.push(args);
        const rows = args.p_source === "WHATSAPP" ? input.whatsapp ?? [] : input.channel ?? [];
        return {
          data: rows.map((row) => ({
            id: row.id,
            provider: args.p_source === "WHATSAPP" ? "WHATSAPP" : (row as { provider?: string }).provider ?? "MESSENGER",
            agency_id: (row as { agency?: string }).agency ?? AGENCY,
            payload: row.payload,
            error: (row as { error?: string | null }).error ?? null,
          })),
          error: null,
        };
      }
      if (name === "mark_raw_events_reconciled") {
        marks.push({ source: args.p_source as string, ids: args.p_ids as string[], error: args.p_error as string | null });
        return { data: (args.p_ids as string[]).length, error: null };
      }
      return { data: null, error: null };
    }),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          in: async (_column: string, ids: string[]) => ({
            data: ids.filter((id) => (input.stored ?? []).includes(id)).map((id) => ({ external_message_id: id })),
            error: null,
          }),
        }),
      }),
    })),
  };
  return { db: db as unknown as Db, marks, finds };
}

function deps(overrides: Partial<ReconcileDeps> = {}): ReconcileDeps & { ingestWhatsApp: ReturnType<typeof vi.fn>; processMessenger: ReturnType<typeof vi.fn> } {
  return {
    ingestWhatsApp: vi.fn(async () => ({ enqueuedJobIds: [], enrichQueued: false, unsupportedNoticeRecipients: [] })),
    processMessenger: vi.fn(async () => ({ jobIds: [], enrichQueued: false, echoDeferred: false, profilePsids: [] })),
    resolveIntegration: vi.fn(async () => ({ agency_id: AGENCY })) as unknown as ReconcileDeps["resolveIntegration"],
    resolveConnection: vi.fn(async () => ({ agency_id: AGENCY, provider_account_id: "PAGE1", ai_enabled: true })) as unknown as ReconcileDeps["resolveConnection"],
    isAssistantOn: vi.fn(async () => true),
    ...overrides,
  } as never;
}

describe("reconcileRawEvents: WhatsApp", () => {
  it("leaves a delivery alone when every message in it is stored, and marks it handled", async () => {
    const w = world({ whatsapp: [{ id: "e1", payload: whatsappDelivery(["wamid.1", "wamid.2"]) }], stored: ["wamid.1", "wamid.2"] });
    const d = deps();
    const result = await reconcileRawEvents(w.db, {}, d);
    expect(result).toEqual({ checked: 1, landed: 1, replayed: 0, failed: 0 });
    expect(d.ingestWhatsApp).not.toHaveBeenCalled();
    expect(w.marks).toEqual([{ source: "WHATSAPP", ids: ["e1"], error: null }]);
  });

  it("replays a delivery with a missing message into the agency it was recorded for", async () => {
    const payload = whatsappDelivery(["wamid.1", "wamid.2"]);
    const w = world({ whatsapp: [{ id: "e1", payload }], stored: ["wamid.1"] });
    const d = deps();
    const result = await reconcileRawEvents(w.db, {}, d);
    expect(result).toEqual({ checked: 1, landed: 0, replayed: 1, failed: 0 });
    expect(d.ingestWhatsApp).toHaveBeenCalledWith(w.db, AGENCY, payload);
    expect(w.marks).toContainEqual({ source: "WHATSAPP", ids: ["e1"], error: null });
  });

  it("does not replay into a different agency than the one the event was recorded for", async () => {
    const w = world({ whatsapp: [{ id: "e1", payload: whatsappDelivery(["wamid.1"]) }] });
    const d = deps({ resolveIntegration: vi.fn(async () => ({ agency_id: OTHER_AGENCY })) as never });
    const result = await reconcileRawEvents(w.db, {}, d);
    expect(result.failed).toBe(1);
    expect(d.ingestWhatsApp).not.toHaveBeenCalled();
    expect(w.marks).toEqual([{ source: "WHATSAPP", ids: ["e1"], error: "reconcile: the number is not connected to this agency" }]);
  });

  it("keeps a failed replay eligible and records only a message, never the payload", async () => {
    const w = world({ whatsapp: [{ id: "e1", payload: whatsappDelivery(["wamid.1"]) }] });
    const d = deps({ ingestWhatsApp: vi.fn(async () => { throw new Error("database is down"); }) as never });
    const result = await reconcileRawEvents(w.db, {}, d);
    expect(result).toEqual({ checked: 1, landed: 0, replayed: 0, failed: 1 });
    expect(w.marks).toEqual([{ source: "WHATSAPP", ids: ["e1"], error: "reconcile: database is down" }]);
    expect(JSON.stringify(w.marks)).not.toContain("94771234567");
  });

  it("treats a delivery with no storable messages (a status, unsupported media) as handled", async () => {
    const w = world({ whatsapp: [{ id: "e1", payload: { object: "whatsapp_business_account", entry: [{ id: "W", changes: [{ field: "messages", value: { statuses: [] } }] }] } }] });
    const d = deps();
    expect((await reconcileRawEvents(w.db, {}, d)).landed).toBe(1);
    expect(d.ingestWhatsApp).not.toHaveBeenCalled();
  });

  it("only looks at deliveries old enough not to be in flight, and not older than the window", async () => {
    const w = world({});
    await reconcileRawEvents(w.db, { minAgeMs: 120_000, maxAgeMs: 6 * 3_600_000, batchSize: 50 }, deps());
    expect(w.finds[0]).toEqual({ p_source: "WHATSAPP", p_min_age_seconds: 120, p_max_age_seconds: 21_600, p_limit: 50 });
  });
});

describe("reconcileRawEvents: Messenger and Instagram", () => {
  it("replays only the messages that are missing, through the connection of the same agency", async () => {
    const w = world({ channel: [{ id: "c1", payload: messengerDelivery([{ mid: "m.1" }, { mid: "m.2" }]) }], stored: ["m.1"] });
    const d = deps();
    const result = await reconcileRawEvents(w.db, {}, d);
    expect(result).toEqual({ checked: 1, landed: 0, replayed: 1, failed: 0 });
    const [, connection, events, options] = d.processMessenger.mock.calls[0] as unknown as [Db, { agency_id: string }, Array<{ mid: string; kind: string }>, { channel: string; agentAllowed: boolean }];
    expect(connection.agency_id).toBe(AGENCY);
    expect(events.map((event) => event.mid)).toEqual(["m.2"]);
    expect(options.channel).toBe("MESSENGER");
    expect(options.agentAllowed).toBe(true);
    expect(w.marks).toContainEqual({ source: "CHANNEL", ids: ["c1"], error: null });
  });

  it("never replays into an assistant that is off: the live path's fail-closed rule holds", async () => {
    const w = world({ channel: [{ id: "c1", payload: messengerDelivery([{ mid: "m.1" }]) }] });
    const d = deps({ isAssistantOn: vi.fn(async () => false) });
    await reconcileRawEvents(w.db, {}, d);
    expect((d.processMessenger.mock.calls[0] as unknown as [unknown, unknown, unknown, { agentAllowed: boolean }])[3].agentAllowed).toBe(false);
  });

  it("does not count a video as missing: it is refused, never stored", async () => {
    const w = world({ channel: [{ id: "c1", payload: messengerDelivery([{ mid: "m.v", video: true }]) }] });
    const d = deps();
    expect((await reconcileRawEvents(w.db, {}, d)).landed).toBe(1);
    expect(d.processMessenger).not.toHaveBeenCalled();
  });

  it("refuses a page connected to a different agency", async () => {
    const w = world({ channel: [{ id: "c1", payload: messengerDelivery([{ mid: "m.1" }]) }] });
    const d = deps({ resolveConnection: vi.fn(async () => ({ agency_id: OTHER_AGENCY, provider_account_id: "PAGE1", ai_enabled: true })) as never });
    const result = await reconcileRawEvents(w.db, {}, d);
    expect(result.failed).toBe(1);
    expect(d.processMessenger).not.toHaveBeenCalled();
  });

  it("uses the Instagram channel for an Instagram event", async () => {
    const payload = { ...messengerDelivery([{ mid: "m.1" }]), object: "instagram" };
    const w = world({ channel: [{ id: "c1", payload, provider: "INSTAGRAM" }] });
    const d = deps();
    await reconcileRawEvents(w.db, {}, d);
    expect((d.processMessenger.mock.calls[0] as unknown as [unknown, unknown, unknown, { channel: string }])[3].channel).toBe("INSTAGRAM");
  });
});

describe("everyMs", () => {
  it("runs at most once per interval and reports nothing processed in between", async () => {
    let clock = 1_000;
    const run = vi.fn(async () => ({ processed: 2, failed: 1 }));
    const throttled = everyMs(60_000, run, () => clock);
    expect(await throttled()).toEqual({ processed: 2, failed: 1 });
    clock += 1_000;
    expect(await throttled()).toEqual({ processed: 0, failed: 0 });
    clock += 60_000;
    expect(await throttled()).toEqual({ processed: 2, failed: 1 });
    expect(run).toHaveBeenCalledTimes(2);
  });
});

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261204090400_i2_raw_event_reconcile.sql"), "utf8");

describe("I2 migration content", () => {
  it("only reads candidates and stamps handled/error: it never touches conversations or messages", () => {
    const code = sql.replace(/--.*$/gm, "");
    expect(code).not.toMatch(/conversation_messages|public\.conversations|insert into|delete from/);
  });

  it("is service-role only with a pinned search_path", () => {
    expect(sql.match(/security definer/g)).toHaveLength(2);
    expect(sql.match(/set search_path = ''/g)).toHaveLength(2);
    expect(sql).not.toMatch(/grant execute[^;]*to (public|anon|authenticated)/);
  });

  it("scans only signed, tenant-resolved, unhandled deliveries that hold messages, through a partial index", () => {
    expect(sql).toContain("where processed_at is null and agency_id is not null and signature_valid");
    expect(sql).toContain("payload @? '$.entry[*].changes[*].value.messages'");
    expect(sql).toContain("payload @? '$.entry[*].messaging'");
    expect(sql).toContain("order by (e.error is not null), e.received_at");
  });
});
