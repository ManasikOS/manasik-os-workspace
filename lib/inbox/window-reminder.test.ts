import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Db } from "@/lib/data/whatsapp-repository";
import { WINDOW_REMINDER_LEAD_MS, checkAndRemind, decideWindowReminder, windowReminderTitle } from "./window-reminder";

const AGENCY = "0b8e7c3a-1f4d-4e6a-9d2b-7a1c5e3f9b10";
const CONVERSATION = "5d2f9a41-8c7e-4b3a-a6d1-2e9f0c7b4a83";
const NOW = new Date("2026-09-25T12:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const iso = (minutes: number) => at(minutes).toISOString();

const owned = { state: "HUMAN_ACTIVE", assignedToId: "staff-1", lastInboundAt: at(-90), lastOutboundAt: null as Date | null, serviceWindowExpiresAt: at(110) };

describe("decideWindowReminder", () => {
  const decide = (conversation: Parameters<typeof decideWindowReminder>[0]["conversation"], expected = at(110)) =>
    decideWindowReminder({ conversation, expectedClosesAt: expected, now: NOW });

  it("reminds for a person-owned chat whose last customer message is unanswered", () => {
    expect(decide(owned)).toEqual({ action: "REMIND" });
    expect(decide({ ...owned, state: "HUMAN_REQUESTED" })).toEqual({ action: "REMIND" });
  });

  it("does nothing when a person has already answered", () => {
    expect(decide({ ...owned, lastOutboundAt: at(-30) })).toEqual({ action: "SKIP", reason: "answered" });
  });

  it("does nothing for an assistant-owned chat, a closed chat or a missing one", () => {
    expect(decide({ ...owned, state: "AI_ACTIVE" })).toEqual({ action: "SKIP", reason: "assistant_owns" });
    expect(decide({ ...owned, state: "CLOSED" })).toEqual({ action: "SKIP", reason: "closed" });
    expect(decide(null)).toEqual({ action: "SKIP", reason: "not_found" });
  });

  it("does nothing once the window has already closed: there is nothing left to save", () => {
    expect(decide({ ...owned, serviceWindowExpiresAt: at(-5) }, at(-5))).toEqual({ action: "SKIP", reason: "expired" });
    expect(decide({ ...owned, serviceWindowExpiresAt: null })).toEqual({ action: "SKIP", reason: "expired" });
  });

  it("follows the window when the customer wrote again and it moved forward, instead of reminding early", () => {
    expect(decide({ ...owned, serviceWindowExpiresAt: at(600) }, at(110))).toEqual({ action: "EXTENDED", closesAt: at(600) });
  });

  it("treats a drift of under a minute as the same window", () => {
    expect(decide({ ...owned, serviceWindowExpiresAt: new Date(at(110).getTime() + 30_000) })).toEqual({ action: "REMIND" });
  });

  it("reminds two hours before the window closes", () => {
    expect(WINDOW_REMINDER_LEAD_MS).toBe(2 * 60 * 60_000);
  });
});

describe("windowReminderTitle", () => {
  it("names the customer, the channel and the time left, in plain words", () => {
    expect(windowReminderTitle({ contactName: "Mohamed", channel: "WHATSAPP", minutesLeft: 125 })).toBe(
      "Mohamed on WhatsApp has not had a reply and the reply window closes in 2h 5m",
    );
    expect(windowReminderTitle({ contactName: "  ", channel: "MESSENGER", minutesLeft: 40 })).toContain("A customer on Messenger");
    expect(windowReminderTitle({ contactName: "A", channel: "INSTAGRAM", minutesLeft: 40 })).toContain("closes in 40m");
  });
});

/** A fake database recording what the check writes, with the ledger's unique key behaving like the real one. */
function world(input: {
  conversation?: Record<string, unknown> | null;
  anchor?: string | null;
  ledger?: Array<{ id: string; status: string }>;
  defaultOwner?: string | null;
  admins?: string[];
}) {
  const inserts: Array<{ table: string; rows: unknown }> = [];
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const ledger = [...(input.ledger ?? [])];
  const db = {
    from: (table: string) => {
      let op: "select" | "insert" | "update" = "select";
      let payload: unknown;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        insert: (rows: unknown) => {
          op = "insert";
          payload = rows;
          return chain;
        },
        update: (values: Record<string, unknown>) => {
          op = "update";
          payload = values;
          return chain;
        },
        single: async () => {
          if (table === "conversation_followups" && op === "insert") {
            if (ledger.length > 0) return { data: null, error: { code: "23505", message: "duplicate" } };
            ledger.push({ id: "ledger-new", status: "CLAIMED" });
            inserts.push({ table, rows: payload });
            return { data: { id: "ledger-new" }, error: null };
          }
          return { data: null, error: null };
        },
        maybeSingle: async () => {
          if (table === "conversations") return { data: input.conversation ?? null, error: null };
          if (table === "conversation_messages") return { data: input.anchor ? { id: input.anchor } : null, error: null };
          if (table === "conversation_followups") return { data: ledger[0] ?? null, error: null };
          if (table === "ai_settings") return { data: { default_lead_owner_id: input.defaultOwner ?? null }, error: null };
          return { data: null, error: null };
        },
        then: (resolve: (value: { data: unknown; error: null }) => void) => {
          if (op === "insert") inserts.push({ table, rows: payload });
          if (op === "update") updates.push({ table, values: payload as Record<string, unknown> });
          if (table === "staff_profiles") return resolve({ data: (input.admins ?? []).map((id) => ({ id })), error: null });
          return resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  };
  return { db: db as unknown as Db, inserts, updates };
}

const row = { channel: "WHATSAPP", state: "HUMAN_ACTIVE", contact_name: "Mohamed", assigned_to_id: "staff-1", last_inbound_at: iso(-90), last_outbound_at: null, service_window_expires_at: iso(110) };
const run = (w: ReturnType<typeof world>) => checkAndRemind(w.db, { agencyId: AGENCY, conversationId: CONVERSATION, expectedClosesAt: at(110), now: NOW });
const notificationsIn = (w: ReturnType<typeof world>) => (w.inserts.find((entry) => entry.table === "staff_notifications")?.rows ?? []) as Array<Record<string, unknown>>;

describe("checkAndRemind", () => {
  it("claims the reminder, notifies the assignee, and completes the ledger row", async () => {
    const w = world({ conversation: row, anchor: "msg-9" });
    expect(await run(w)).toEqual({ action: "REMIND", notified: 1, alreadySent: false });
    expect(w.inserts.find((entry) => entry.table === "conversation_followups")?.rows).toMatchObject({ kind: "WINDOW_REMINDER", anchor_message_id: "msg-9", status: "CLAIMED", agency_id: AGENCY });
    expect(notificationsIn(w)[0]).toMatchObject({ kind: "REPLY_WINDOW_CLOSING", recipient_id: "staff-1", conversation_id: CONVERSATION, agency_id: AGENCY });
    expect(String(notificationsIn(w)[0].title)).toContain("Mohamed on WhatsApp");
    expect(w.updates.find((entry) => entry.table === "conversation_followups")?.values).toMatchObject({ status: "SENT" });
  });

  it("falls back to the agency's default lead owner, then to Admin and CEO, when nobody owns the chat", async () => {
    const withDefault = world({ conversation: { ...row, assigned_to_id: null }, anchor: "msg-9", defaultOwner: "owner-7" });
    await run(withDefault);
    expect(notificationsIn(withDefault)[0].recipient_id).toBe("owner-7");

    const withAdmins = world({ conversation: { ...row, assigned_to_id: null }, anchor: "msg-9", admins: ["admin-1", "ceo-1"] });
    await run(withAdmins);
    expect(notificationsIn(withAdmins).map((item) => item.recipient_id)).toEqual(["admin-1", "ceo-1"]);
  });

  it("never sends twice: a finished ledger row means nothing more to do", async () => {
    const w = world({ conversation: row, anchor: "msg-9", ledger: [{ id: "old", status: "SENT" }] });
    expect(await run(w)).toEqual({ action: "REMIND", notified: 0, alreadySent: true });
    expect(w.inserts.some((entry) => entry.table === "staff_notifications")).toBe(false);
  });

  it("finishes a claim that crashed before it was completed, instead of losing the reminder", async () => {
    const w = world({ conversation: row, anchor: "msg-9", ledger: [{ id: "stuck", status: "CLAIMED" }] });
    expect(await run(w)).toEqual({ action: "REMIND", notified: 1, alreadySent: false });
    expect(w.updates.find((entry) => entry.table === "conversation_followups")?.values).toMatchObject({ status: "SENT" });
  });

  it("does not touch the ledger or notify when the chat was answered, and reports why", async () => {
    const w = world({ conversation: { ...row, last_outbound_at: iso(-10) }, anchor: "msg-9" });
    expect(await run(w)).toEqual({ action: "SKIP", reason: "answered" });
    expect(w.inserts).toHaveLength(0);
  });

  it("tells the function to follow the window when it moved", async () => {
    const w = world({ conversation: { ...row, service_window_expires_at: iso(900) }, anchor: "msg-9" });
    expect(await run(w)).toEqual({ action: "EXTENDED", closesAt: iso(900) });
  });

  it("skips a conversation that no longer exists, and one with no customer message to anchor on", async () => {
    expect(await run(world({ conversation: null }))).toEqual({ action: "SKIP", reason: "not_found" });
    expect(await run(world({ conversation: row, anchor: null }))).toEqual({ action: "SKIP", reason: "no_customer_message" });
  });
});
