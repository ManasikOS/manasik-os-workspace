import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { resolveOrCreatePilgrimPerson } = await import("./pilgrims-repository");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_AGENCY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Row = Record<string, unknown>;

/** Tables with eq / ilike filters, head-count and insert — enough for person resolution. */
function fakeDb(rows: Row[]) {
  const inserts: Row[] = [];
  const db = {
    from() {
      const filters: Array<(row: Row) => boolean> = [];
      let mode: "select" | "insert" = "select";
      let head = false;
      let payload: Row = {};
      const builder: Record<string, unknown> = {
        select: (_columns?: string, options?: { head?: boolean }) => { if (options?.head) head = true; return builder; },
        insert: (value: Row) => { mode = "insert"; payload = value; return builder; },
        eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
        ilike: (column: string, value: string) => { filters.push((row) => String(row[column] ?? "").toLowerCase() === value.toLowerCase()); return builder; },
        limit: () => builder,
        maybeSingle: async () => ({ data: rows.filter((row) => filters.every((filter) => filter(row)))[0] ?? null, error: null }),
        single: async () => {
          if (mode === "insert") {
            inserts.push(payload);
            return { data: { id: "new-person" }, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(head ? { count: rows.length, error: null } : { data: [], error: null }).then(resolve),
      };
      return builder;
    },
  };
  return { db: db as never, inserts };
}

const theirs: Row = { id: "their-person", agency_id: OTHER_AGENCY, whatsapp_number: "94771111111", passport_number: "N1234567" };

describe("resolveOrCreatePilgrimPerson — agency scoping", () => {
  it("never matches ANOTHER agency's traveller by phone when told which agency it is working for", async () => {
    const { db, inserts } = fakeDb([theirs]);
    const id = await resolveOrCreatePilgrimPerson(db, { fullName: "Amina", whatsappNumber: "94771111111", agencyId: AGENCY });
    expect(id).toBe("new-person");
    expect(inserts[0]).toMatchObject({ agency_id: AGENCY, whatsapp_number: "94771111111" });
  });

  it("never matches another agency's traveller by passport either", async () => {
    const { db } = fakeDb([theirs]);
    expect(await resolveOrCreatePilgrimPerson(db, { fullName: "Amina", passportNumber: "n1234567", agencyId: AGENCY })).toBe("new-person");
  });

  it("still reuses this agency's own traveller", async () => {
    const own: Row = { id: "own-person", agency_id: AGENCY, whatsapp_number: "94771111111" };
    const { db, inserts } = fakeDb([theirs, own]);
    expect(await resolveOrCreatePilgrimPerson(db, { fullName: "Amina", whatsappNumber: "94771111111", agencyId: AGENCY })).toBe("own-person");
    expect(inserts).toHaveLength(0);
  });

  it("keeps the session path exactly as it was: no agency named, no agency written (RLS scopes it)", async () => {
    const { db, inserts } = fakeDb([]);
    await resolveOrCreatePilgrimPerson(db, { fullName: "Amina", whatsappNumber: "94770000000" });
    expect(inserts[0]).not.toHaveProperty("agency_id");
  });

  it("is passed the booking's agency by createGroupBooking", () => {
    const source = readFileSync(path.resolve(process.cwd(), "lib/data/departure-groups.ts"), "utf8");
    expect(source).toMatch(/agencyId: options\?\.agencyId \?\? null,\s*\}\);\s*resolvedTravellers\.push/);
  });
});

describe("MI4.6b migration", () => {
  const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261202092100_mi4_6b_more_source_links.sql"), "utf8");

  it("adds the source link to the three new tables, with the same tenant-safe keys", () => {
    for (const table of ["pilgrims", "booking_traveller_relationships", "lead_notes"]) expect(sql).toContain(`'${table}'`);
    expect(sql).toMatch(/foreign key \(source_conversation_id, agency_id\) references public\.conversations \(id, agency_id\) on delete set null \(source_conversation_id\)/);
    expect(sql).toMatch(/foreign key \(source_message_id, agency_id\) references public\.conversation_messages \(id, agency_id\) on delete set null \(source_message_id\)/);
    expect(sql).toMatch(/source_message_id is null or source_conversation_id is not null/);
  });
});
