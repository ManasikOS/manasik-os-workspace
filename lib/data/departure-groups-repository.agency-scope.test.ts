import { describe, expect, it } from "vitest";

import { loadStore, type Db } from "./departure-groups-repository";

type Row = Record<string, unknown>;
type Filter = ["eq" | "in", string, unknown];

/**
 * A stand-in for the service-role client: it applies exactly the filters the query
 * carries and nothing else, as the real one does (row-level security is off for it).
 */
function fakeServiceClient(tables: Record<string, Row[]>) {
  const queries: { table: string; columns: string; filters: Filter[] }[] = [];

  const db = {
    from(table: string) {
      const record = { table, columns: "*", filters: [] as Filter[] };
      queries.push(record);
      const builder: Record<string, unknown> = {
        select(columns: string) {
          record.columns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          record.filters.push(["eq", column, value]);
          return builder;
        },
        in(column: string, values: unknown[]) {
          record.filters.push(["in", column, values]);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        then(resolve: (value: { data: Row[]; error: null }) => unknown) {
          const rows = (tables[table] ?? []).filter((row) =>
            record.filters.every(([kind, column, value]) =>
              kind === "eq" ? row[column] === value : (value as unknown[]).includes(row[column]),
            ),
          );
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };

  return { db: db as unknown as Db, queries };
}

const MINE = "11111111-1111-4111-8111-111111111111";
const THEIRS = "22222222-2222-4222-8222-222222222222";
const AGENCY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENCY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const tables = () => ({
  departure_groups: [
    { id: MINE, agency_id: AGENCY_A, archived: false },
    { id: THEIRS, agency_id: AGENCY_B, archived: false },
  ],
  departure_group_bookings: [
    { id: "b-mine", departure_group_id: MINE },
    { id: "b-theirs", departure_group_id: THEIRS },
  ],
});

describe("loadStore with an agency", () => {
  it("does not load a group that belongs to another agency, even when its id is named", async () => {
    const { db } = fakeServiceClient(tables());
    const store = await loadStore(db, {
      groupIds: [THEIRS],
      only: ["groups", "bookings"],
      includeArchived: true,
      agencyId: AGENCY_A,
    });
    expect(store.groups).toEqual([]);
    expect(store.bookings).toEqual([]);
  });

  it("loads only the caller's groups when both are named", async () => {
    const { db } = fakeServiceClient(tables());
    const store = await loadStore(db, {
      groupIds: [MINE, THEIRS],
      only: ["groups", "bookings"],
      includeArchived: true,
      agencyId: AGENCY_A,
    });
    expect(store.groups.map((g) => g.id)).toEqual([MINE]);
    expect(store.bookings.map((b) => b.id)).toEqual(["b-mine"]);
  });

  it("checks ownership with an id-only query, not by reading every group the agency owns", async () => {
    const { db, queries } = fakeServiceClient(tables());
    await loadStore(db, { groupIds: [MINE], only: ["groups"], includeArchived: true, agencyId: AGENCY_A });
    const ownership = queries[0];
    expect(ownership.table).toBe("departure_groups");
    expect(ownership.columns).toBe("id");
    expect(ownership.filters).toContainEqual(["in", "id", [MINE]]);
    expect(ownership.filters).toContainEqual(["eq", "agency_id", AGENCY_A]);
  });

  it("returns an empty store for an empty id list without querying", async () => {
    const { db, queries } = fakeServiceClient(tables());
    const store = await loadStore(db, { groupIds: [], agencyId: AGENCY_A });
    expect(store.groups).toEqual([]);
    expect(queries).toHaveLength(0);
  });

  it("without an agency (the seat-hold sweeper) loads the groups it was given", async () => {
    const { db } = fakeServiceClient(tables());
    const store = await loadStore(db, { groupIds: [THEIRS], only: ["groups"], includeArchived: true });
    expect(store.groups.map((g) => g.id)).toEqual([THEIRS]);
  });
});
