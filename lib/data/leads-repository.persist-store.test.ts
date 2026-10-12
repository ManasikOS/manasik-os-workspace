import { describe, expect, it } from "vitest";

import type { LeadRow } from "@/lib/types/leads";

import { emptyLeadStore, LeadConflictError, persistLeadStore, snapshotLeadStore, type Db } from "./leads-repository";

/**
 * Phase 2 (LD-06): `persistLeadStore` used to upsert whole lead rows, so a page that was open while a colleague edited the lead put every column
 * back. It now inserts new leads, patches only the changed columns of existing ones under a version check, and inserts (never upserts) history rows.
 */

type Row = Record<string, unknown>;

function fakeDb(options: { updateMatches?: boolean } = {}) {
  const log: Array<{ table: string; op: string; payload?: unknown; filters?: Record<string, unknown> }> = [];
  const db = {
    from: (table: string) => ({
      insert: async (payload: unknown) => {
        log.push({ table, op: "insert", payload });
        return { error: null };
      },
      upsert: async (payload: unknown) => {
        log.push({ table, op: "upsert", payload });
        return { error: null };
      },
      update: (payload: Row) => {
        const filters: Record<string, unknown> = {};
        const query: Record<string, unknown> = {};
        query.eq = (column: string, value: unknown) => {
          filters[column] = value;
          return query;
        };
        query.select = async () => {
          log.push({ table, op: "update", payload, filters });
          return { data: options.updateMatches === false ? [] : [{ id: filters.id }], error: null };
        };
        return query;
      },
      delete: () => ({ in: async () => ({ error: null }) }),
    }),
  } as unknown as Db;
  return { db, log };
}

function lead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "lead-1",
    reference: "LD-2027-0001",
    full_name: "Test",
    mobile: "771234567",
    stage: "NEW_LEAD",
    assigned_to_id: "s1",
    assigned_to_name: "Amina",
    consent_status: "UNKNOWN",
    do_not_contact: false,
    booking_id: null,
    created_at: "2027-01-01T00:00:00.000000+00:00",
    updated_at: "2027-01-01T00:00:00.000000+00:00",
    ...overrides,
  } as LeadRow;
}

describe("persistLeadStore", () => {
  it("patches only the changed columns, version-checked, for an existing lead", async () => {
    const before = emptyLeadStore();
    before.leads = [lead()];
    const after = snapshotLeadStore(before);
    after.leads[0].stage = "CONTACTED";
    after.leads[0].updated_at = "2027-01-02T00:00:00.000Z"; // set by the mutator; the database stamps the real one

    const { db, log } = fakeDb();
    await persistLeadStore(db, before, after);

    expect(log).toEqual([
      {
        table: "leads",
        op: "update",
        payload: { stage: "CONTACTED" },
        filters: { id: "lead-1", updated_at: "2027-01-01T00:00:00.000000+00:00" },
      },
    ]);
  });

  it("throws a conflict, and writes nothing more, when the lead changed since it was read", async () => {
    const before = emptyLeadStore();
    before.leads = [lead()];
    const after = snapshotLeadStore(before);
    after.leads[0].stage = "LOST";
    after.activity.push({ id: "a1", lead_id: "lead-1", type: "STAGE_CHANGED", message: "x", actor_name: "Amina", created_at: "now" } as never);

    const { db, log } = fakeDb({ updateMatches: false });
    await expect(persistLeadStore(db, before, after)).rejects.toBeInstanceOf(LeadConflictError);
    expect(log.some((entry) => entry.table === "lead_activity")).toBe(false);
  });

  it("inserts a new lead, and inserts (not upserts) its history", async () => {
    const before = emptyLeadStore();
    const after = emptyLeadStore();
    after.leads = [lead({ id: "lead-new" })];
    after.activity = [{ id: "a1", lead_id: "lead-new", type: "CREATED", message: "x", actor_name: "Amina", created_at: "now" } as never];
    after.notes = [{ id: "n1", lead_id: "lead-new", body: "hi", author_name: "Amina", created_at: "now" } as never];

    const { db, log } = fakeDb();
    await persistLeadStore(db, before, after);

    const byTable = Object.fromEntries(log.map((entry) => [entry.table, entry.op]));
    expect(byTable).toEqual({ leads: "insert", lead_activity: "insert", lead_notes: "insert" });
    expect(log.some((entry) => entry.op === "upsert")).toBe(false);
  });

  it("writes nothing when nothing changed", async () => {
    const before = emptyLeadStore();
    before.leads = [lead()];
    const { db, log } = fakeDb();
    await persistLeadStore(db, before, snapshotLeadStore(before));
    expect(log).toEqual([]);
  });
});
