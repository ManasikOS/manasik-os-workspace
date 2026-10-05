import { describe, expect, it } from "vitest";

import type { Db } from "@/lib/ai/db";
import type { LeadRow } from "@/lib/types/leads";

import { changeOneLead, LeadConflictError, loadLeadStore, persistSingleLeadChange, snapshotLeadStore } from "./leads-repository";

/**
 * BUG-5 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): the Inbox's follow-up, group-select and mark-booked actions read every lead of the
 * agency to change one, and wrote the whole lead row back from that stale copy, so a colleague's edit to the same lead was silently overwritten.
 */

const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_LEAD_ID = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;

/** A tiny stand-in for the leads tables: filters, a version check on update, and a database-style `updated_at` bump. */
function createFakeLeadsDb(initial: Row[]) {
  const tables: Record<string, Row[]> = { leads: initial.map((row) => ({ ...row })), lead_activity: [] };
  const reads: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const writes: Array<{ table: string; kind: "update" | "insert"; patch: unknown }> = [];
  let tick = 0;
  let beforeNextUpdate: (() => void) | null = null;

  const db = {
    from: (table: string) => ({
      select: () => {
        const filters: Record<string, unknown> = {};
        const query: Record<string, unknown> = {};
        query.eq = (column: string, value: unknown) => { filters[column] = value; return query; };
        query.order = () => query;
        query.then = (resolve: (value: unknown) => unknown) => {
          reads.push({ table, filters });
          const rows = (tables[table] ?? []).filter((row) => Object.entries(filters).every(([column, value]) => row[column] === value));
          return resolve({ data: rows.map((row) => ({ ...row })), error: null });
        };
        return query;
      },
      update: (patch: Row) => {
        const filters: Record<string, unknown> = {};
        const query: Record<string, unknown> = {};
        query.eq = (column: string, value: unknown) => { filters[column] = value; return query; };
        query.select = async () => {
          if (beforeNextUpdate) { const run = beforeNextUpdate; beforeNextUpdate = null; run(); }
          const rows = (tables[table] ?? []).filter((row) => Object.entries(filters).every(([column, value]) => row[column] === value));
          for (const row of rows) { Object.assign(row, patch); row.updated_at = `2026-10-05T10:00:0${++tick}.000000+00:00`; }
          if (rows.length > 0) writes.push({ table, kind: "update", patch });
          return { data: rows.map((row) => ({ id: row.id })), error: null };
        };
        return query;
      },
      insert: async (batch: Row[]) => {
        tables[table] = [...(tables[table] ?? []), ...batch];
        writes.push({ table, kind: "insert", patch: batch });
        return { error: null };
      },
    }),
  } as unknown as Db;

  return {
    db,
    tables,
    reads,
    writes,
    /** A colleague changes a column of the lead right before the next update lands. */
    colleagueEditsBeforeNextUpdate: (patch: Row) => { beforeNextUpdate = () => { const row = tables.leads.find((lead) => lead.id === LEAD_ID)!; Object.assign(row, patch); row.updated_at = `2026-10-05T09:59:5${++tick}.000000+00:00`; }; },
  };
}

const lead = (id: string, extra: Row = {}): Row => ({ id, reference: "LD-1", full_name: "Nimal", stage: "NEW", next_follow_up_at: null, follow_up_type: null, selected_departure_group_id: null, updated_at: "2026-10-05T08:00:00.000000+00:00", ...extra });

describe("loadLeadStore with a leadId", () => {
  it("reads only that lead, and only its own rows in the per-lead tables", async () => {
    const fake = createFakeLeadsDb([lead(LEAD_ID), lead(OTHER_LEAD_ID)]);
    const store = await loadLeadStore(fake.db, { only: ["leads", "activity", "notes", "quotes"], leadId: LEAD_ID });
    expect(store.leads.map((row) => row.id)).toEqual([LEAD_ID]);
    expect(fake.reads.find((read) => read.table === "leads")?.filters).toEqual({ id: LEAD_ID });
    for (const table of ["lead_activity", "lead_notes", "lead_quotes"]) expect(fake.reads.find((read) => read.table === table)?.filters, table).toEqual({ lead_id: LEAD_ID });
  });

  it("still reads everything when no lead is named", async () => {
    const fake = createFakeLeadsDb([lead(LEAD_ID), lead(OTHER_LEAD_ID)]);
    const store = await loadLeadStore(fake.db, { only: ["leads"] });
    expect(store.leads).toHaveLength(2);
  });
});

describe("persistSingleLeadChange", () => {
  async function load(fake: ReturnType<typeof createFakeLeadsDb>) {
    return loadLeadStore(fake.db, { only: ["leads"], leadId: LEAD_ID });
  }

  it("writes only the columns the change touched, then the new history", async () => {
    const fake = createFakeLeadsDb([lead(LEAD_ID)]);
    const store = await load(fake);
    const before = snapshotLeadStore(store);
    store.leads[0].follow_up_type = "CALL";
    store.activity.push({ id: "act-1", lead_id: LEAD_ID, type: "FOLLOW_UP_SCHEDULED", message: "Scheduled.", actor_name: "Me", created_at: "2026-10-05T10:00:00.000Z" } as never);
    await persistSingleLeadChange(fake.db, before, store, LEAD_ID);
    expect(fake.writes[0]).toEqual({ table: "leads", kind: "update", patch: { follow_up_type: "CALL" } });
    expect(fake.writes[1]).toMatchObject({ table: "lead_activity", kind: "insert" });
  });

  it("refuses, and writes nothing, when the lead changed since it was read", async () => {
    const fake = createFakeLeadsDb([lead(LEAD_ID)]);
    const store = await load(fake);
    const before = snapshotLeadStore(store);
    store.leads[0].follow_up_type = "CALL";
    store.activity.push({ id: "act-1", lead_id: LEAD_ID, type: "FOLLOW_UP_SCHEDULED", message: "x", actor_name: "Me", created_at: "2026-10-05T10:00:00.000Z" } as never);
    fake.colleagueEditsBeforeNextUpdate({ stage: "CONTACTED" });
    await expect(persistSingleLeadChange(fake.db, before, store, LEAD_ID)).rejects.toBeInstanceOf(LeadConflictError);
    expect(fake.writes).toHaveLength(0);
    expect(fake.tables.lead_activity).toHaveLength(0);
  });
});

describe("changeOneLead", () => {
  const scheduleCall = (store: Awaited<ReturnType<typeof loadLeadStore>>) => {
    store.leads[0].follow_up_type = "CALL";
    return { ok: true as const };
  };

  it("keeps a colleague's edit to another column: it reads the lead again and applies the change on top", async () => {
    const fake = createFakeLeadsDb([lead(LEAD_ID)]);
    fake.colleagueEditsBeforeNextUpdate({ stage: "CONTACTED" });
    expect(await changeOneLead(fake.db, LEAD_ID, scheduleCall)).toEqual({ ok: true });
    const saved = fake.tables.leads[0];
    expect(saved).toMatchObject({ stage: "CONTACTED", follow_up_type: "CALL" });
  });

  it("writes nothing when the change is refused", async () => {
    const fake = createFakeLeadsDb([lead(LEAD_ID)]);
    expect(await changeOneLead(fake.db, LEAD_ID, () => ({ ok: false as const, error: "The next follow-up cannot be in the past." }))).toEqual({ ok: false, error: "The next follow-up cannot be in the past." });
    expect(fake.writes).toHaveLength(0);
  });

  it("gives up with a plain message, and writes nothing, if the lead keeps changing", async () => {
    const fake = createFakeLeadsDb([lead(LEAD_ID)]);
    const keepChanging = () => { fake.colleagueEditsBeforeNextUpdate({ stage: "CONTACTED" }); };
    keepChanging();
    const result = await changeOneLead(fake.db, LEAD_ID, (store) => { keepChanging(); return scheduleCall(store); }, { attempts: 2 });
    expect(result).toEqual({ ok: false, error: "Someone else changed this lead just now. Refresh and try again." });
    expect(fake.writes).toHaveLength(0);
  });

  it("reports a lead that no longer exists through the mutator", async () => {
    const fake = createFakeLeadsDb([]);
    const result = await changeOneLead(fake.db, LEAD_ID, (store) => (store.leads.length === 0 ? { ok: false as const, error: "That lead no longer exists." } : { ok: true as const }));
    expect(result).toEqual({ ok: false, error: "That lead no longer exists." });
  });
});
