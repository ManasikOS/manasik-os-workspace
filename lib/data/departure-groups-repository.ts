/**
 * Supabase persistence for Departure Groups.
 *
 * The module's business rules live in the pure `*InStore` mutators, which take
 * a `DepartureGroupStore` — plain arrays of rows — and mutate it. Rather than
 * rewrite ~4,000 lines of tested logic into query calls, this file makes that
 * store the unit of work:
 *
 *   1. `loadStore()` hydrates exactly the slice of the database a mutation
 *      needs, in the same row shapes the mutators already expect.
 *   2. The mutator runs unchanged against that slice.
 *   3. `persistStore()` diffs the slice against a snapshot taken before the
 *      mutation and writes only what actually changed.
 *
 * That keeps one implementation of every rule — capacity gates, seat
 * reconciliation, rooming release, refund liability — instead of one in
 * TypeScript and a second, subtly different one in SQL.
 *
 * Two columns are deliberately never written:
 *   * `departure_groups.available_seats` is a generated column; Postgres
 *     derives it from capacity and the seat counts, so writing it is an error.
 *   * The activity trail is append-only — a diff must never delete history, so
 *     that collection is flagged `appendOnly` and its removals are ignored.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  BookingTravellerRelationshipRow,
  DepartureGroupAccommodationRow,
  DepartureGroupActivityLogRow,
  DepartureGroupBookingRow,
  DepartureGroupFlightLegRow,
  DepartureGroupFlightRow,
  DepartureGroupPackageSnapshotRow,
  DepartureGroupPricingRow,
  DepartureGroupCostEstimateRow,
  DepartureGroupPilgrimChargeRow,
  DepartureGroupPilgrimDeviationRow,
  DepartureGroupPilgrimDocumentRow,
  DepartureGroupPilgrimRow,
  DepartureGroupReadinessItemRow,
  DepartureGroupRoomAssignmentRow,
  DepartureGroupRoomRow,
  DepartureGroupRow,
  DepartureGroupTaskRow,
  DepartureGroupTransportRow,
  DepartureGroupStore,
} from "@/lib/types/departure-groups";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
type Row = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class DepartureGroupPersistenceError extends Error {
  /** The raw Postgres SQLSTATE (e.g. `23505` unique_violation, `23514` check_violation), when the cause carries one. */
  readonly code: string | null;

  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update" | "delete",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Departure groups: ${operation} on ${table} failed — ${detail}`);
    this.name = "DepartureGroupPersistenceError";
    this.code =
      cause && typeof cause === "object" && "code" in cause && typeof (cause as { code: unknown }).code === "string"
        ? (cause as { code: string }).code
        : null;
  }
}

/**
 * Named backstop constraints two concurrent writers can legitimately both
 * pass in the application before either write lands — the seat-capacity
 * check (`20260810090000_departure_groups_supabase_fixes.sql`), the
 * room-capacity check and the one-flight-per-direction / one-reference /
 * one-code uniqueness constraints. A violation of one of these is not a bug;
 * it is the constraint doing its job. `mutate()` translates it into a
 * friendly, retryable outcome instead of letting it surface as a raw,
 * unhandled persistence error — anything NOT in this map is a genuine
 * problem and still throws.
 */
const CONCURRENCY_CONSTRAINT_MESSAGES: Record<string, string> = {
  departure_groups_seats_within_capacity:
    "Someone else just booked the remaining seats on this group. Refresh and try again.",
  departure_group_rooms_occupancy_within_capacity:
    "Someone else just assigned the remaining space in this room. Refresh and try again.",
  departure_group_flights_direction_unique:
    "This sector was just added by someone else. Refresh to see it.",
  departure_group_bookings_reference_unique:
    "That booking reference was just taken by another booking. Refresh and try again.",
  departure_groups_code_agency_unique:
    "That group code was just taken by another departure group. Choose a different code and try again.",
};

/**
 * True when a thrown error is a known, expected concurrency backstop firing
 * — two writers racing a capacity or uniqueness gate — rather than a genuine
 * failure. `mutate()` uses this to decide whether to surface a friendly,
 * retryable message or let the error propagate as a bug.
 */
export function concurrencyConflictMessage(error: unknown): string | null {
  if (!(error instanceof DepartureGroupPersistenceError)) return null;

  // `40001` (serialization_failure) is raised by `persistStore()` itself,
  // not Postgres — a `versionColumn`-guarded update matched zero rows
  // because another write changed the row first. See the `bookings`
  // collection spec and the guarded-update loop below.
  if (error.code === "40001") {
    return "This booking was just updated elsewhere. Refresh and try again.";
  }

  if (error.code !== "23505" && error.code !== "23514") return null;
  for (const [constraint, message] of Object.entries(CONCURRENCY_CONSTRAINT_MESSAGES)) {
    if (error.message.includes(constraint)) return message;
  }
  return null;
}

/* ── Collection metadata ──────────────────────────────────────────────────── */

type CollectionName = keyof DepartureGroupStore;

interface CollectionSpec {
  table: string;
  /** Single-column primary key. */
  pk: string;
  /**
   * Column holding the owning group id, when the table has one. Tables scoped
   * through a parent (legs → flights, rooms → accommodations) are loaded by
   * parent id instead and declare `null` here.
   */
  groupColumn: string | null;
  /** Generated or otherwise database-owned columns, stripped before writing. */
  omitOnWrite?: readonly string[];
  /** History tables: rows are inserted, never updated or deleted by a diff. */
  appendOnly?: boolean;
  /**
   * Optimistic-concurrency guard column, trigger-maintained (see
   * `20260904090000_departure_group_bookings_row_version.sql`). When set, an
   * UPDATE to an existing row is only ever written conditioned on the
   * `row_version` this process loaded — never blind-upserted — so a second
   * writer's mutation of the same row between this process's load and write
   * is detected instead of silently overwritten. A fresh INSERT still goes
   * through the ordinary batch path below; there is no prior state for it to
   * race against.
   */
  versionColumn?: string;
}

/**
 * Declaration order is write order, so a child is never inserted before the row
 * it references. Deletes run in reverse for the same reason.
 */
const COLLECTIONS: Record<CollectionName, CollectionSpec> = {
  groups: {
    table: "departure_groups",
    pk: "id",
    groupColumn: "id",
    omitOnWrite: ["available_seats"],
  },
  snapshots: {
    table: "departure_group_package_snapshots",
    pk: "departure_group_id",
    groupColumn: "departure_group_id",
  },
  pricing: {
    table: "departure_group_pricing",
    pk: "departure_group_id",
    groupColumn: "departure_group_id",
  },
  costEstimates: {
    table: "departure_group_cost_estimates",
    pk: "departure_group_id",
    groupColumn: "departure_group_id",
  },
  flights: {
    table: "departure_group_flights",
    pk: "id",
    groupColumn: "departure_group_id",
  },
  flightLegs: {
    table: "departure_group_flight_legs",
    pk: "id",
    groupColumn: null,
  },
  accommodations: {
    table: "departure_group_accommodations",
    pk: "id",
    groupColumn: "departure_group_id",
  },
  rooms: {
    table: "departure_group_rooms",
    pk: "id",
    groupColumn: null,
  },
  transports: {
    table: "departure_group_transports",
    pk: "id",
    groupColumn: "departure_group_id",
  },
  bookings: {
    table: "departure_group_bookings",
    pk: "id",
    groupColumn: "departure_group_id",
    // Trigger-maintained (`departure_group_bookings_bump_row_version`) —
    // never written by the application. The money columns this table carries
    // (`amount_paid`, `outstanding_balance`) are the sharpest lost-update
    // risk in the whole store: two payments recorded against the same
    // booking close enough together must not let one silently overwrite the
    // other's contribution.
    omitOnWrite: ["row_version"],
    versionColumn: "row_version",
  },
  pilgrims: {
    table: "departure_group_pilgrims",
    pk: "id",
    groupColumn: "departure_group_id",
  },
  // Declared after pilgrims so a document is never inserted before the traveller
  // it belongs to.
  pilgrimDocuments: {
    table: "departure_group_pilgrim_documents",
    pk: "id",
    groupColumn: "departure_group_id",
  },
  // Declared after pilgrims (charge lines reference the traveller) and before
  // deviations (a deviation may reference a charge it was paired with).
  pilgrimCharges: {
    table: "departure_group_pilgrim_charges",
    pk: "id",
    groupColumn: "departure_group_id",
  },
  pilgrimDeviations: {
    table: "departure_group_pilgrim_deviations",
    pk: "id",
    groupColumn: "departure_group_id",
  },
  // Declared after pilgrims (both endpoints reference a departure_group_pilgrims row).
  travellerRelationships: {
    table: "booking_traveller_relationships",
    pk: "id",
    groupColumn: "departure_group_id",
  },
  roomAssignments: {
    table: "departure_group_room_assignments",
    pk: "id",
    groupColumn: null,
  },
  readinessItems: {
    table: "departure_group_readiness_items",
    pk: "id",
    groupColumn: "departure_group_id",
  },
  tasks: {
    table: "departure_group_tasks",
    pk: "id",
    groupColumn: "departure_group_id",
  },
  activity: {
    table: "departure_group_activity_logs",
    pk: "id",
    groupColumn: "departure_group_id",
    appendOnly: true,
  },
};

const WRITE_ORDER = Object.keys(COLLECTIONS) as CollectionName[];

/** PostgREST caps a single request; chunk anything that could exceed it. */
const CHUNK = 500;

function chunked<T>(rows: T[]): T[][] {
  if (rows.length <= CHUNK) return [rows];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

export function emptyStore(): DepartureGroupStore {
  return {
    groups: [],
    snapshots: [],
    pricing: [],
    costEstimates: [],
    flights: [],
    flightLegs: [],
    accommodations: [],
    rooms: [],
    roomAssignments: [],
    transports: [],
    bookings: [],
    pilgrims: [],
    pilgrimDocuments: [],
    pilgrimCharges: [],
    pilgrimDeviations: [],
    travellerRelationships: [],
    readinessItems: [],
    tasks: [],
    activity: [],
  };
}

/* ── Reads ────────────────────────────────────────────────────────────────── */

export interface LoadStoreOptions {
  /**
   * Restrict to these groups. Omitted means every group — used by the list
   * screen and by group-code uniqueness checks.
   */
  groupIds?: string[];
  /**
   * Collections to hydrate. Omitted means all of them. The list screen asks for
   * a narrow set so it does not drag every activity row across the wire.
   */
  only?: readonly CollectionName[];
  /** Newest-first cap on the activity trail. */
  activityLimit?: number;
  /** Include groups whose `archived` flag is set. */
  includeArchived?: boolean;
  /**
   * Restrict to one agency's groups IN THE QUERY. A session client is already scoped by RLS; a service-role caller (the
   * Inbox pipeline) would otherwise hydrate every agency's groups and filter afterwards.
   */
  agencyId?: string;
}

async function selectRows(
  db: Db,
  table: string,
  build: (query: any) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<Row[]> {
  const { data, error } = await build(db.from(table).select("*"));
  if (error) throw new DepartureGroupPersistenceError(table, "select", error);
  return (data ?? []) as Row[];
}

/**
 * Hydrates a slice of the store.
 *
 * Child tables without a group column (flight legs, rooms, room assignments)
 * are fetched by their parents' ids, which is why the parent collections are
 * always loaded first and their ids reused rather than re-queried.
 */
export async function loadStore(
  db: Db,
  options: LoadStoreOptions = {},
): Promise<DepartureGroupStore> {
  const store = emptyStore();
  const wanted = new Set<CollectionName>(options.only ?? WRITE_ORDER);
  let scoped = options.groupIds;

  if (options.agencyId) {
    // Resolve the agency's own group ids first, then reuse the id scoping every other collection already honours.
    const agencyGroups = await selectRows(db, COLLECTIONS.groups.table, (query) => {
      const q = query.eq("agency_id", options.agencyId);
      return options.includeArchived ? q : q.eq("archived", false);
    });
    const agencyIds = agencyGroups.map((row) => String((row as { id: unknown }).id));
    scoped = scoped ? scoped.filter((id) => agencyIds.includes(id)) : agencyIds;
  }

  // An explicitly empty id list can only ever select nothing.
  if (scoped && scoped.length === 0) return store;

  const scopeTo = (query: any, column: string) => // eslint-disable-line @typescript-eslint/no-explicit-any
    scoped ? query.in(column, scoped) : query;

  const groupScoped = WRITE_ORDER.filter(
    (name) =>
      wanted.has(name) &&
      COLLECTIONS[name].groupColumn !== null &&
      name !== "activity",
  );

  const results = await Promise.all(
    groupScoped.map((name) => {
      const spec = COLLECTIONS[name];
      return selectRows(db, spec.table, (query) => {
        const q = scopeTo(query, spec.groupColumn!);
        return name === "groups" && !options.includeArchived
          ? q.eq("archived", false)
          : q;
      });
    }),
  );

  groupScoped.forEach((name, index) => {
    assignCollection(store, name, results[index]);
  });

  if (wanted.has("activity")) {
    const rows = await selectRows(db, COLLECTIONS.activity.table, (query) => {
      const q = scopeTo(query, "departure_group_id").order("created_at", {
        ascending: false,
      });
      return options.activityLimit ? q.limit(options.activityLimit) : q;
    });
    assignCollection(store, "activity", rows);
  }

  // Children keyed on a parent rather than the group.
  const flightIds = store.flights.map((f) => f.id);
  const accommodationIds = store.accommodations.map((a) => a.id);

  if (wanted.has("flightLegs") && flightIds.length > 0) {
    const rows = await selectRows(db, COLLECTIONS.flightLegs.table, (query) =>
      query.in("flight_id", flightIds),
    );
    assignCollection(store, "flightLegs", rows);
  }

  if (wanted.has("rooms") && accommodationIds.length > 0) {
    const rows = await selectRows(db, COLLECTIONS.rooms.table, (query) =>
      query.in("accommodation_id", accommodationIds),
    );
    assignCollection(store, "rooms", rows);
  }

  const roomIds = store.rooms.map((r) => r.id);
  if (wanted.has("roomAssignments") && roomIds.length > 0) {
    const rows = await selectRows(
      db,
      COLLECTIONS.roomAssignments.table,
      (query) => query.in("room_id", roomIds),
    );
    assignCollection(store, "roomAssignments", rows);
  }

  return store;
}

/**
 * PostgREST returns `numeric` as a JSON number already, but a driver or a
 * future column change returning it as a string would silently turn money
 * arithmetic into string concatenation, so the money columns are coerced on the
 * way in. Everything else passes through as the row shape declares it.
 */
function assignCollection(
  store: DepartureGroupStore,
  name: CollectionName,
  rows: Row[],
): void {
  switch (name) {
    case "groups":
      store.groups = rows as DepartureGroupRow[];
      break;
    case "snapshots":
      store.snapshots = rows as DepartureGroupPackageSnapshotRow[];
      break;
    case "pricing":
      store.pricing = rows.map((row) => ({
        ...row,
        quad_price: numberOrNull(row.quad_price),
        triple_price: numberOrNull(row.triple_price),
        double_price: numberOrNull(row.double_price),
        single_price: numberOrNull(row.single_price),
        child_price: numberOrNull(row.child_price),
        infant_price: numberOrNull(row.infant_price),
        early_bird_price: numberOrNull(row.early_bird_price),
        advance_deposit: numberOrNull(row.advance_deposit),
      })) as DepartureGroupPricingRow[];
      break;
    case "costEstimates":
      store.costEstimates = rows.map((row) => ({
        ...row,
        flight_cost_per_pilgrim: numberOrNull(row.flight_cost_per_pilgrim),
        accommodation_cost_per_pilgrim: numberOrNull(
          row.accommodation_cost_per_pilgrim,
        ),
        transport_cost_per_pilgrim: numberOrNull(row.transport_cost_per_pilgrim),
        visa_insurance_cost_per_pilgrim: numberOrNull(
          row.visa_insurance_cost_per_pilgrim,
        ),
        catering_cost_per_pilgrim: numberOrNull(row.catering_cost_per_pilgrim),
        guide_operations_cost_per_pilgrim: numberOrNull(
          row.guide_operations_cost_per_pilgrim,
        ),
        contingency_cost_per_pilgrim: numberOrNull(
          row.contingency_cost_per_pilgrim,
        ),
        fixed_cost_per_departure: Number(row.fixed_cost_per_departure ?? 0),
      })) as DepartureGroupCostEstimateRow[];
      break;
    case "flights":
      store.flights = rows as DepartureGroupFlightRow[];
      break;
    case "flightLegs":
      store.flightLegs = rows as DepartureGroupFlightLegRow[];
      break;
    case "accommodations":
      store.accommodations = rows.map((row) => ({
        ...row,
        internal_cost: numberOrNull(row.internal_cost),
      })) as DepartureGroupAccommodationRow[];
      break;
    case "rooms":
      store.rooms = rows as DepartureGroupRoomRow[];
      break;
    case "roomAssignments":
      store.roomAssignments = rows as DepartureGroupRoomAssignmentRow[];
      break;
    case "transports":
      store.transports = rows.map((row) => ({
        ...row,
        internal_cost: numberOrNull(row.internal_cost),
      })) as DepartureGroupTransportRow[];
      break;
    case "bookings":
      store.bookings = rows.map((row) => ({
        ...row,
        package_price_per_person: Number(row.package_price_per_person ?? 0),
        total_booking_value: Number(row.total_booking_value ?? 0),
        amount_paid: Number(row.amount_paid ?? 0),
        outstanding_balance: Number(row.outstanding_balance ?? 0),
      })) as DepartureGroupBookingRow[];
      break;
    case "pilgrims":
      store.pilgrims = rows as DepartureGroupPilgrimRow[];
      break;
    case "pilgrimDocuments":
      store.pilgrimDocuments = rows as DepartureGroupPilgrimDocumentRow[];
      break;
    case "pilgrimCharges":
      store.pilgrimCharges = rows.map((row) => ({
        ...row,
        amount: Number(row.amount ?? 0),
        quantity: Number(row.quantity ?? 1),
      })) as DepartureGroupPilgrimChargeRow[];
      break;
    case "pilgrimDeviations":
      store.pilgrimDeviations = rows as DepartureGroupPilgrimDeviationRow[];
      break;
    case "travellerRelationships":
      store.travellerRelationships = rows as BookingTravellerRelationshipRow[];
      break;
    case "readinessItems":
      store.readinessItems = rows as DepartureGroupReadinessItemRow[];
      break;
    case "tasks":
      store.tasks = rows as DepartureGroupTaskRow[];
      break;
    case "activity":
      store.activity = rows as DepartureGroupActivityLogRow[];
      break;
  }
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/* ── Writes ───────────────────────────────────────────────────────────────── */

/** A point-in-time copy to diff against once the mutator has run. */
export function snapshotStore(store: DepartureGroupStore): DepartureGroupStore {
  return structuredClone(store);
}

function collectionRows(
  store: DepartureGroupStore,
  name: CollectionName,
): Row[] {
  return store[name] as unknown as Row[];
}

function stripped(row: Row, omit: readonly string[] | undefined): Row {
  if (!omit || omit.length === 0) return row;
  const copy: Row = { ...row };
  for (const key of omit) delete copy[key];
  return copy;
}

/**
 * Raised when `persistStore()` fails partway through `WRITE_ORDER` — some
 * collections are now durably written, the rest are not, and the mutation as
 * a whole is neither fully applied nor cleanly rolled back.
 *
 * This is the gap a real database transaction would close and this schema
 * does not have one: every write here is an independent PostgREST call, not
 * a single statement Postgres can commit or abort as a unit. `WRITE_ORDER`
 * already writes parents before children, so a failure here can never leave
 * an orphaned child referencing a parent that was never written — the worst
 * shape this can produce is a logically incomplete but foreign-key-valid
 * group (a booking row with no pilgrim rows yet, say). That is still real
 * inconsistency a person has to reconcile, so this error carries exactly
 * which collections are known-good and which one failed, rather than
 * surfacing as an ordinary, retryable persistence error — retrying the
 * mutation from a fresh load does not repair a partially written prior
 * attempt, and a caller must not treat it as if it does.
 *
 * The real fix is moving this unit of work into a single Postgres function
 * called through `.rpc()`, so the whole mutation commits or aborts as one
 * statement — a larger change than this class, and one that needs a live
 * database to build and verify against, not a blind rewrite.
 */
export class DeparturePartialWriteError extends Error {
  constructor(
    readonly writtenCollections: readonly CollectionName[],
    readonly failedCollection: CollectionName,
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(
      `Departure groups: mutation partially applied — ${writtenCollections.join(", ") || "(nothing)"} ` +
        `committed before "${failedCollection}" failed: ${detail}`,
    );
    this.name = "DeparturePartialWriteError";
  }
}

/**
 * Applies one store diff through Postgres. This is used by booking creation,
 * whose booking, traveller, charge, readiness, and activity rows must land
 * together with the seat projection. The ordinary path below remains for
 * legacy mutations until they are migrated to the same RPC boundary.
 */
export async function persistStoreAtomic(
  db: Db,
  before: DepartureGroupStore,
  after: DepartureGroupStore,
  agencyId: string | null,
): Promise<void> {
  if (!agencyId) {
    throw new DepartureGroupPersistenceError("departure_store", "insert", {
      message: "Atomic departure mutation requires a resolved agency.",
    });
  }

  const changes: Record<string, Row[]> = {};
  const deletes: Record<string, string[]> = {};
  const newBookingIds: string[] = [];
  for (const name of WRITE_ORDER) {
    const spec = COLLECTIONS[name];
    const previous = new Map(
      collectionRows(before, name).map((row) => [String(row[spec.pk]), row]),
    );
    for (const row of collectionRows(after, name)) {
      const key = String(row[spec.pk]);
      const old = previous.get(key);
      if (spec.appendOnly && old) continue;
      if (old && sameRow(old, row)) continue;
      const isInsert = !old;
      if (name === "bookings" && isInsert) newBookingIds.push(key);
      const stampAgency = isInsert && row.agency_id == null;
      const written = stripped(
        stampAgency ? { ...row, agency_id: agencyId } : row,
        spec.omitOnWrite,
      );
      (changes[spec.table] ??= []).push(written);
    }
    if (spec.appendOnly) continue;
    const surviving = new Set(
      collectionRows(after, name).map((row) => String(row[spec.pk])),
    );
    const removed = collectionRows(before, name)
      .map((row) => String(row[spec.pk]))
      .filter((key) => !surviving.has(key));
    if (removed.length > 0) deletes[spec.table] = removed;
  }

  const { error } = await db.rpc("apply_departure_store_changes_atomic", {
    p_changes: changes,
    p_deletes: deletes,
    p_agency_id: agencyId,
    p_new_booking_ids: newBookingIds,
  });
  if (error) {
    throw new DepartureGroupPersistenceError(
      "apply_departure_store_changes_atomic",
      "insert",
      error,
    );
  }
}

/**
 * Writes everything the mutation changed, and nothing it did not.
 *
 * Rows are compared by primary key against the pre-mutation snapshot: absent
 * before means insert, present and different means update, present before and
 * gone after means delete. Inserts and updates go out together as an upsert —
 * the mutators generate their own uuids, so a new row already carries its key.
 */
export async function persistStore(
  db: Db,
  before: DepartureGroupStore,
  after: DepartureGroupStore,
  /**
   * Stamped onto every row this call inserts (never onto a row it merely
   * updates — an existing row's tenant is not this function's business to
   * change). `null` for a caller with no resolvable tenant, in which case an
   * inserted row falls back to whatever the database's own
   * `agency_id default current_agency_id()` resolves for the connection —
   * correct for the ordinary session client, a not-null violation for the
   * service-role client, which has no session for that default to read.
   *
   * Centralising this here, rather than in each of the ~20 mutators across
   * `departure-groups-*.ts` that construct a new row, is deliberate: every
   * table this store touches gained an `agency_id` column in
   * `20260824090000_tenancy.sql`, but the hand-maintained row types in
   * `lib/types/departure-groups.ts` were never updated to declare it, so no
   * mutator has ever set it. One choke point that always gets it right beats
   * twenty call sites that have to remember to.
   */
  agencyId: string | null,
): Promise<void> {
  // Tracks which collections' writes are already durably committed, so a
  // later collection's failure can be reported as the partial-write
  // emergency it is rather than an ordinary persistence error — see
  // `DeparturePartialWriteError`.
  const writtenCollections: CollectionName[] = [];

  // Inserts and updates first, parents before children.
  for (const name of WRITE_ORDER) {
    try {
      const spec = COLLECTIONS[name];
      const previous = new Map(
        collectionRows(before, name).map((row) => [String(row[spec.pk]), row]),
      );

      const pending: Row[] = [];
      // Updates on a `versionColumn` collection bypass the batch upsert below
      // — each needs its own conditional write. Keyed by pk so the version
      // this process loaded travels alongside the row to write.
      const guardedUpdates: { row: Row; expectedVersion: unknown }[] = [];

      for (const row of collectionRows(after, name)) {
        const key = String(row[spec.pk]);
        const old = previous.get(key);
        if (spec.appendOnly && old) continue;
        if (old && sameRow(old, row)) continue;

        const isInsert = !old;
        const stampAgency = isInsert && agencyId !== null && row.agency_id == null;
        const written = stripped(stampAgency ? { ...row, agency_id: agencyId } : row, spec.omitOnWrite);

        if (!isInsert && spec.versionColumn) {
          guardedUpdates.push({ row: written, expectedVersion: old![spec.versionColumn] });
        } else {
          pending.push(written);
        }
      }

      if (pending.length > 0) {
        for (const batch of chunked(pending)) {
          const { error } = await db
            .from(spec.table)
            .upsert(batch, { onConflict: spec.pk });
          if (error) {
            throw new DepartureGroupPersistenceError(spec.table, "insert", error);
          }
        }
      }

      for (const { row, expectedVersion } of guardedUpdates) {
        const payload = { ...row };
        delete payload[spec.pk];
        const { data, error } = await db
          .from(spec.table)
          .update(payload)
          .eq(spec.pk, row[spec.pk])
          .eq(spec.versionColumn!, expectedVersion)
          .select(spec.pk);
        if (error) {
          throw new DepartureGroupPersistenceError(spec.table, "update", error);
        }
        if (!data || data.length === 0) {
          // Zero rows matched the guard: another writer changed this exact
          // row (and so its `row_version`) after this process loaded it. Not
          // a genuine failure — the concurrency conflict the guard exists to
          // catch. Signalled the same way a Postgres constraint violation is,
          // so `mutate()`'s single catch handles both.
          throw new DepartureGroupPersistenceError(spec.table, "update", {
            code: "40001",
            message: `${spec.table}.${row[spec.pk]}: row_version ${String(expectedVersion)} no longer matches — modified by another write since it was loaded.`,
          });
        }
      }
    } catch (error) {
      // Nothing committed yet — this is just an ordinary single-collection
      // failure (which may still be a legitimate, retryable concurrency
      // conflict; `mutate()`'s existing classifier handles that), not a
      // partial write across several tables.
      if (writtenCollections.length === 0) throw error;
      throw new DeparturePartialWriteError(writtenCollections, name, error);
    }
    writtenCollections.push(name);
  }

  // Deletes last and children first, so nothing is removed while still referenced.
  // Every collection's inserts/updates already committed by this point (the
  // loop above would have thrown otherwise), so any failure here is by
  // definition a partial write too.
  for (const name of [...WRITE_ORDER].reverse()) {
    const spec = COLLECTIONS[name];
    if (spec.appendOnly) continue;

    const surviving = new Set(
      collectionRows(after, name).map((row) => String(row[spec.pk])),
    );
    const removed = collectionRows(before, name)
      .map((row) => String(row[spec.pk]))
      .filter((key) => !surviving.has(key));

    if (removed.length === 0) continue;

    for (const batch of chunked(removed)) {
      const { error } = await db.from(spec.table).delete().in(spec.pk, batch);
      if (error) {
        throw new DeparturePartialWriteError(writtenCollections, name, error);
      }
    }
  }
}

/**
 * Value equality over the row's own columns.
 *
 * Timestamps are the awkward case: the mutators write
 * `2026-08-10T17:00:00.000Z` while PostgREST reads back
 * `2026-08-10T17:00:00+00:00`. Comparing those as strings would mark every
 * untouched row dirty on every save, so anything that parses as a date is
 * compared by instant.
 */
function sameRow(a: Row, b: Row): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!sameValue(a[key], b[key])) return false;
  }
  return true;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/;

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;

  if (typeof a === "string" && typeof b === "string") {
    if (TIMESTAMP.test(a) && TIMESTAMP.test(b)) {
      return Date.parse(a) === Date.parse(b);
    }
    return false;
  }

  if (typeof a === "number" || typeof b === "number") {
    return Number(a) === Number(b);
  }

  if (typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  return false;
}
