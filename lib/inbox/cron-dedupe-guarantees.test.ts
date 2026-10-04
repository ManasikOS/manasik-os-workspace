import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * T5 (tasks/plan.md), the other half of app/api/cron/cron-overlap.test.ts. That file proves the cron routes are safe to run at the
 * same moment. This one proves the guarantees that stop two overlapping runs from doing the same thing twice once they reach the
 * same row: the ledger's unique key, the unique indexes, the skip-locked claims, and the seat-hold release being a pure function of
 * what it loaded. Where the guarantee lives in SQL, the test reads the migrations and fails if the latest definition loses it.
 * A real two-session race against Postgres is not reproduced here.
 */

const migrationsDirectory = join(process.cwd(), "supabase/migrations");
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const readMigration = (name: string) => readFileSync(join(migrationsDirectory, name), "utf8");
const allSql = migrationFiles.map((name) => ({ name, sql: readMigration(name) }));

/** The text of a function's latest definition across all migrations, from `create or replace function` to its closing `$$;`. */
function latestFunctionBody(functionName: string): string {
  const header = new RegExp(`create or replace function public\\.${functionName}\\(`, "i");
  for (const { sql } of [...allSql].reverse()) {
    const start = sql.search(header);
    if (start === -1) continue;
    const rest = sql.slice(start);
    const end = rest.search(/\$\$\s*;|\$[a-z_]*\$\s*;/i);
    const firstDollar = rest.search(/\$[a-z_]*\$/i);
    return end > firstDollar ? rest.slice(0, end) : rest;
  }
  throw new Error(`No migration defines public.${functionName}`);
}

describe("claims never hand the same row to two runs", () => {
  it.each(["claim_agent_jobs", "claim_channel_jobs", "claim_outbox_messages"])("%s locks the rows it takes and skips rows another run holds", (name) => {
    const body = latestFunctionBody(name);
    expect(body).toMatch(/for update (of \w+ )?skip locked/i);
  });
});

describe("unique constraints that make a repeated effect a no-op", () => {
  it("follow-up ledger: one row per conversation, kind, sequence and anchor message", () => {
    const ledger = allSql.find(({ sql }) => /create table if not exists public\.conversation_followups/i.test(sql));
    expect(ledger?.sql).toMatch(/unique \(conversation_id, kind, sequence, anchor_message_id\)/i);
  });

  it("inbound messages: one row per agency and provider message id, so a replayed webhook or mailbox poll cannot duplicate", () => {
    const found = allSql.some(({ sql }) => /create unique index[^;]*conversation_messages_external_id_unique[^;]*\(agency_id, external_message_id\)/i.test(sql));
    expect(found).toBe(true);
  });

  it("SLA interventions: at most one open or acknowledged intervention per conversation and kind", () => {
    const found = allSql.some(({ sql }) => /create unique index[^;]*conversation_interventions_open_uidx[^;]*\(conversation_id, kind\)[^;]*status in \('OPEN', 'ACKNOWLEDGED'\)/i.test(sql));
    expect(found).toBe(true);
  });
});

describe("the follow-up ledger claim under a race", () => {
  /** A table that enforces the ledger's unique key the way Postgres does: the check and the insert are one atomic step. */
  function ledgerDatabase() {
    const keys = new Set<string>();
    let nextId = 1;
    return {
      from: () => ({
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              await Promise.resolve(); // another run gets to act between a caller's decision and its insert
              const key = [row.conversation_id, row.kind, row.sequence, row.anchor_message_id].join("|");
              if (keys.has(key)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
              keys.add(key);
              return { data: { id: `row-${nextId++}` }, error: null };
            },
          }),
        }),
      }),
    };
  }

  const claim = (database: ReturnType<typeof ledgerDatabase>, overrides: Record<string, unknown> = {}) =>
    import("@/lib/data/conversation-followups-repository").then(({ claimFollowup }) =>
      claimFollowup(database as never, {
        agencyId: "agency-a",
        conversationId: "conversation-1",
        leadId: null,
        kind: "QUIET_NUDGE",
        sequence: 1,
        anchorMessageId: "message-1",
        channel: "WHATSAPP",
        status: "CLAIMED",
        ...overrides,
      } as never),
    );

  it("lets exactly one of five simultaneous runs claim the same follow-up, and the other four see it as already taken", async () => {
    const database = ledgerDatabase();
    const results = await Promise.all(Array.from({ length: 5 }, () => claim(database)));
    expect(results.filter((result) => result.claimed)).toHaveLength(1);
    expect(results.filter((result) => !result.claimed)).toHaveLength(4);
  });

  it("claims different follow-ups independently, so overlap never blocks real work", async () => {
    const database = ledgerDatabase();
    const results = await Promise.all([
      claim(database, { sequence: 1 }),
      claim(database, { sequence: 2 }),
      claim(database, { anchorMessageId: "message-2" }),
      claim(database, { kind: "HANDOFF_ALERT" }),
    ]);
    expect(results.every((result) => result.claimed)).toBe(true);
  });

  it("does not hide a real database failure as 'already claimed'", async () => {
    const broken = {
      from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "08006", message: "connection failure" } }) }) }) }),
    };
    await expect(claim(broken as never)).rejects.toThrow(/conversation_followups insert failed/);
  });
});

describe("seat-hold release under overlap", () => {
  async function storeWithOneExpiredHold() {
    const iso = (offsetMinutes: number) => new Date(Date.now() + offsetMinutes * 60_000).toISOString();
    return {
      groups: [
        {
          id: "group-1",
          capacity: 40,
          booked_seats: 10,
          held_seats: 4,
          available_seats: 26,
          updated_at: iso(-120),
        },
      ],
      bookings: [
        {
          id: "booking-1",
          departure_group_id: "group-1",
          booking_status: "HELD",
          booking_reference: "REF-1",
          primary_contact_name: "Test Customer",
          traveller_count: 4,
          amount_paid: 0,
          seat_hold_expires_at: iso(-30),
          outstanding_balance: 1000,
          next_due_at: iso(60),
        },
      ],
      pilgrims: [{ id: "pilgrim-1", booking_id: "booking-1", room_id: null, seat_status: "HELD", flight_status: "HELD", room_assignment_status: "UNASSIGNED", visa_status: "NOT_STARTED" }],
      rooms: [],
      roomAssignments: [],
      activity: [] as Array<Record<string, unknown>>,
    };
  }

  it("releases a hold once: a second run over the saved result finds nothing left to release", async () => {
    const { releaseExpiredSeatHoldsInStore } = await import("@/lib/data/departure-groups-bookings");
    const store = await storeWithOneExpiredHold();

    const first = releaseExpiredSeatHoldsInStore(store as never, "group-1");
    const second = releaseExpiredSeatHoldsInStore(store as never, "group-1");

    expect(first).toMatchObject({ releasedBookings: 1, releasedSeats: 4 });
    expect(second).toMatchObject({ releasedBookings: 0, releasedSeats: 0 });
    expect(store.groups[0].held_seats).toBe(0);
    expect(store.activity).toHaveLength(1);
  });

  it("two runs that loaded the same data both write the same absolute result, so seats are never released twice", async () => {
    const { releaseExpiredSeatHoldsInStore } = await import("@/lib/data/departure-groups-bookings");
    const snapshot = await storeWithOneExpiredHold();
    const runA = structuredClone(snapshot);
    const runB = structuredClone(snapshot);

    releaseExpiredSeatHoldsInStore(runA as never, "group-1");
    releaseExpiredSeatHoldsInStore(runB as never, "group-1");

    // The counters are set to values computed from the loaded data, not incremented: the second writer overwrites with the same numbers.
    expect(runB.groups[0].held_seats).toBe(runA.groups[0].held_seats);
    expect(runB.groups[0].available_seats).toBe(runA.groups[0].available_seats);
    expect(runA.groups[0].held_seats).toBe(0);
    expect(runB.bookings[0].booking_status).toBe(runA.bookings[0].booking_status);
    expect(runB.bookings[0].booking_status).toBe("CANCELLED");
  });

  it("never releases a hold that has money against it, or one that has not expired", async () => {
    const { releaseExpiredSeatHoldsInStore } = await import("@/lib/data/departure-groups-bookings");
    const store = await storeWithOneExpiredHold();
    store.bookings[0].amount_paid = 100;
    store.bookings.push({ ...store.bookings[0], id: "booking-2", amount_paid: 0, seat_hold_expires_at: new Date(Date.now() + 3_600_000).toISOString() });

    const result = releaseExpiredSeatHoldsInStore(store as never, "group-1");

    expect(result).toMatchObject({ releasedBookings: 0, releasedSeats: 0 });
    expect(store.bookings.map((booking) => booking.booking_status)).toEqual(["HELD", "HELD"]);
  });
});
