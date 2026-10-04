/**
 * Supabase persistence for Leads.
 *
 * Same shape as `lib/data/departure-groups-repository.ts`: the module's rules
 * live in the pure `*InStore` mutators in `lib/data/leads.ts`, which take a
 * `LeadStore` — plain arrays of rows — and mutate it in memory. This file is
 * the only place that talks to Postgres:
 *
 *   1. `loadLeadStore()` hydrates the store.
 *   2. The mutator runs unchanged against it.
 *   3. `persistLeadStore()` diffs against a pre-mutation snapshot and writes
 *      only what changed.
 *
 * `packages` and `sources` are reference data the leads module reads but does
 * not own — they are always loaded fresh and never appear in the diff.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  LeadActivityRow,
  LeadCommunicationDraftRow,
  LeadCopilotContextRow,
  LeadCopilotDismissalRow,
  LeadNoteRow,
  LeadPackageRow,
  LeadQuoteRow,
  LeadRow,
  LeadSourceRow,
  StaffRow,
} from "@/lib/types/leads";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
type Row = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class LeadPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update" | "delete",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Leads: ${operation} on ${table} failed — ${detail}`);
    this.name = "LeadPersistenceError";
  }
}

export interface LeadStore {
  leads: LeadRow[];
  activity: LeadActivityRow[];
  notes: LeadNoteRow[];
  quotes: LeadQuoteRow[];
  /** Manasik Sales Intelligence — approved intent + selected offer per lead. */
  copilotContexts: LeadCopilotContextRow[];
  copilotDismissals: LeadCopilotDismissalRow[];
  communicationDrafts: LeadCommunicationDraftRow[];
  /** Reference data — not diffed or written by this module. */
  packages: LeadPackageRow[];
  sources: LeadSourceRow[];
}

export function emptyLeadStore(): LeadStore {
  return {
    leads: [],
    activity: [],
    notes: [],
    quotes: [],
    copilotContexts: [],
    copilotDismissals: [],
    communicationDrafts: [],
    packages: [],
    sources: [],
  };
}

async function selectAll(db: Db, table: string, order?: string): Promise<Row[]> {
  let query = db.from(table).select("*");
  if (order) query = query.order(order, { ascending: false });
  const { data, error } = await query;
  if (error) throw new LeadPersistenceError(table, "select", error);
  return (data ?? []) as Row[];
}

/**
 * Like `selectAll`, but a table that does not exist yet (its migration has
 * not been applied — Postgres 42P01, or PostgREST PGRST205 when the schema
 * cache has not caught up) reads as empty instead of taking the whole Leads
 * page down. Writes to it still fail loudly.
 */
async function selectOptional(db: Db, table: string, order?: string): Promise<Row[]> {
  let query = db.from(table).select("*");
  if (order) query = query.order(order, { ascending: false });
  const { data, error } = await query;
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw new LeadPersistenceError(table, "select", error);
  }
  return (data ?? []) as Row[];
}

/** Keeps the lower of two prices, treating `null` ("no departure has quoted this room type yet") as "no opinion" rather than as zero. */
function cheaperOf(current: number | null, next: number | null): number | null {
  if (next === null) return current;
  if (current === null) return next;
  return Math.min(current, next);
}

/**
 * Sellable packages, priced per room type. Falls back to the journey-type
 * baseline (`BASELINE_PRICE_LKR`) only where every room price is null — the
 * same rule `pricePerPerson()` in `lib/data/leads.ts` already encodes.
 *
 * Room-occupancy prices moved off the package template onto each departure
 * group (`departure_group_pricing`) when pricing became a per-departure
 * fact — see docs/architecture/package-departure-architecture-master-plan.md. This used
 * to read `packages.quad_price` / `triple_price` / `double_price` /
 * `single_price` directly, which has been null for every package created
 * since that move, so every quote silently fell back to the flat
 * `BASELINE_PRICE_LKR` baseline regardless of what any real departure
 * actually charges — see docs/modules/packages-production-readiness-plan.md,
 * finding D1. The cheapest LIVE, sellable departure's price for each room
 * type is used instead, per package — the same "cheapest room wins" rule
 * this function already applied across room types on the old columns.
 */
async function loadLeadPackages(db: Db): Promise<LeadPackageRow[]> {
  const { data: packageRows, error: packageError } = await db
    .from("packages")
    .select("id, title, journey_type")
    .eq("status", "Open for Sale")
    .order("title", { ascending: true });

  if (packageError) throw new LeadPersistenceError("packages", "select", packageError);

  const packages = (packageRows ?? []) as { id: string; title: string; journey_type: string }[];
  if (packages.length === 0) return [];

  const packageIds = packages.map((row) => row.id);
  const { data: groupRows, error: groupError } = await db
    .from("departure_groups")
    .select(
      "package_template_id, departure_group_pricing(quad_price, triple_price, double_price, single_price, currency)",
    )
    .in("package_template_id", packageIds)
    .eq("archived", false)
    .not("group_status", "in", "(CANCELLED,COMPLETED,CLOSED)")
    .in("sales_status", ["SELLING", "LIMITED_AVAILABILITY", "WAITLIST"]);

  if (groupError) throw new LeadPersistenceError("departure_groups", "select", groupError);

  interface PackagePriceAgg {
    currency: string;
    quad: number | null;
    triple: number | null;
    double: number | null;
    single: number | null;
  }
  const byPackage = new Map<string, PackagePriceAgg>();

  for (const row of (groupRows ?? []) as Row[]) {
    const packageId = row.package_template_id as string | null;
    if (!packageId) continue;

    // The embedded one-to-one relation comes back as an object; some
    // PostgREST versions return a one-element array instead — accept both.
    const pricing = (Array.isArray(row.departure_group_pricing)
      ? row.departure_group_pricing[0]
      : row.departure_group_pricing) as Row | null | undefined;
    if (!pricing) continue;

    const agg: PackagePriceAgg = byPackage.get(packageId) ?? {
      currency: pricing.currency ?? "LKR",
      quad: null,
      triple: null,
      double: null,
      single: null,
    };
    const toNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));
    agg.quad = cheaperOf(agg.quad, toNumber(pricing.quad_price));
    agg.triple = cheaperOf(agg.triple, toNumber(pricing.triple_price));
    agg.double = cheaperOf(agg.double, toNumber(pricing.double_price));
    agg.single = cheaperOf(agg.single, toNumber(pricing.single_price));
    byPackage.set(packageId, agg);
  }

  return packages.map((row): LeadPackageRow => {
    const agg = byPackage.get(row.id);
    const roomPrices = [agg?.quad, agg?.triple, agg?.double, agg?.single].filter(
      (value): value is number => typeof value === "number",
    );

    return {
      id: row.id,
      name: row.title,
      journey_type: (row.journey_type === "Hajj"
        ? "HAJJ"
        : row.journey_type === "Early Registration"
          ? "EARLY_REGISTRATION"
          : "UMRAH") as LeadPackageRow["journey_type"],
      currency: agg?.currency ?? "LKR",
      quad_price: agg?.quad ?? null,
      triple_price: agg?.triple ?? null,
      double_price: agg?.double ?? null,
      single_price: agg?.single ?? null,
      price_per_person_lkr: roomPrices.length > 0 ? Math.min(...roomPrices) : 0,
    };
  });
}

export interface LoadLeadStoreOptions {
  /** Collections to hydrate. Omitted means everything — used by the list page. */
  only?: readonly (keyof LeadStore)[];
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/**
 * Owner / follow-up-owner picker options — every active `staff_profiles` row
 * with a create/assign capability in this module (`ADMIN`, `MARKETING`; see
 * `lib/access/leads-access.ts`). Replaces the old hardcoded `LEAD_STAFF`
 * roster, which could assign a lead to a name that no longer has an account.
 */
export async function loadAssignableStaff(db: Db): Promise<StaffRow[]> {
  const { data, error } = await db
    .from("staff_profiles")
    .select("id, full_name")
    .in("role", ["ADMIN", "MARKETING"])
    .eq("status", "ACTIVE")
    .order("full_name", { ascending: true });
  if (error) throw new LeadPersistenceError("staff_profiles", "select", error);

  return ((data ?? []) as { id: string; full_name: string }[]).map((row) => ({
    id: row.id,
    name: row.full_name,
    initials: initialsFor(row.full_name),
  }));
}

export async function loadLeadStore(
  db: Db,
  options: LoadLeadStoreOptions = {},
): Promise<LeadStore> {
  const wanted = new Set<keyof LeadStore>(
    options.only ?? [
      "leads",
      "activity",
      "notes",
      "quotes",
      "copilotContexts",
      "copilotDismissals",
      "communicationDrafts",
      "packages",
      "sources",
    ],
  );

  const [leads, activity, notes, quotes, copilotContexts, copilotDismissals, communicationDrafts, packages, sources] =
    await Promise.all([
      wanted.has("leads") ? selectAll(db, "leads", "created_at") : Promise.resolve([]),
      wanted.has("activity") ? selectAll(db, "lead_activity") : Promise.resolve([]),
      wanted.has("notes") ? selectAll(db, "lead_notes") : Promise.resolve([]),
      wanted.has("quotes") ? selectAll(db, "lead_quotes") : Promise.resolve([]),
      wanted.has("copilotContexts") ? selectOptional(db, "lead_copilot_context") : Promise.resolve([]),
      wanted.has("copilotDismissals") ? selectOptional(db, "lead_copilot_dismissals") : Promise.resolve([]),
      wanted.has("communicationDrafts")
        ? selectOptional(db, "lead_communication_drafts", "created_at")
        : Promise.resolve([]),
      wanted.has("packages") ? loadLeadPackages(db) : Promise.resolve([]),
      wanted.has("sources") ? selectAll(db, "lead_sources", undefined) : Promise.resolve([]),
    ]);

  return {
    leads: leads as LeadRow[],
    activity: activity as LeadActivityRow[],
    notes: notes as LeadNoteRow[],
    quotes: quotes as LeadQuoteRow[],
    copilotContexts: copilotContexts as LeadCopilotContextRow[],
    copilotDismissals: copilotDismissals as LeadCopilotDismissalRow[],
    communicationDrafts: communicationDrafts as LeadCommunicationDraftRow[],
    packages,
    sources: (sources as LeadSourceRow[]).sort((a, b) => a.sort_order - b.sort_order),
  };
}

/** The four lead columns the dashboard's counts and attention items read. */
export type DashboardLeadFacts = Pick<LeadRow, "id" | "stage" | "assigned_to_id" | "last_contacted_at" | "created_at">;

/**
 * Narrow read for the dashboard, which only counts leads and flags unassigned
 * or uncontacted ones. `loadLeadStore` selects every column of every lead
 * (including notes-sized text fields) and the dashboard was paying for all of
 * it on every visit just to read these.
 */
export async function loadLeadDashboardFacts(db: Db): Promise<DashboardLeadFacts[]> {
  const { data, error } = await db
    .from("leads")
    .select("id, stage, assigned_to_id, last_contacted_at, created_at");
  if (error) throw new LeadPersistenceError("leads", "select", error);
  return (data ?? []) as DashboardLeadFacts[];
}

/** A point-in-time copy to diff against once the mutator has run. */
export function snapshotLeadStore(store: LeadStore): LeadStore {
  return structuredClone(store);
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/;

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a === "string" && typeof b === "string") {
    if (TIMESTAMP.test(a) && TIMESTAMP.test(b)) return Date.parse(a) === Date.parse(b);
    return false;
  }
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  if (typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function sameRow(a: Row, b: Row): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!sameValue(a[key], b[key])) return false;
  }
  return true;
}

interface MutableCollectionSpec {
  key: keyof LeadStore;
  table: string;
  pk: string;
  /** History tables: inserted only, never updated or deleted by a diff. */
  appendOnly?: boolean;
}

/** Declaration order is write order — `leads` first so children can reference it. */
const MUTABLE_COLLECTIONS: MutableCollectionSpec[] = [
  { key: "leads", table: "leads", pk: "id" },
  { key: "activity", table: "lead_activity", pk: "id", appendOnly: true },
  { key: "notes", table: "lead_notes", pk: "id", appendOnly: true },
  { key: "quotes", table: "lead_quotes", pk: "id" },
  { key: "copilotContexts", table: "lead_copilot_context", pk: "lead_id" },
  { key: "copilotDismissals", table: "lead_copilot_dismissals", pk: "id", appendOnly: true },
  { key: "communicationDrafts", table: "lead_communication_drafts", pk: "id" },
];

/** PostgREST caps a single request; chunk anything that could exceed it. */
const CHUNK = 500;

function chunked<T>(rows: T[]): T[][] {
  if (rows.length <= CHUNK) return [rows];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

/**
 * Writes everything the mutation changed, and nothing it did not.
 *
 * Rows are compared by primary key against the pre-mutation snapshot: absent
 * before means insert, present and different means update, present before and
 * gone after means delete.
 */
export async function persistLeadStore(
  db: Db,
  before: LeadStore,
  after: LeadStore,
): Promise<void> {
  for (const spec of MUTABLE_COLLECTIONS) {
    const previous = new Map(
      (before[spec.key] as Row[]).map((row) => [String(row[spec.pk]), row]),
    );

    const pending: Row[] = [];
    for (const row of after[spec.key] as Row[]) {
      const key = String(row[spec.pk]);
      const old = previous.get(key);
      if (spec.appendOnly && old) continue;
      if (old && sameRow(old, row)) continue;
      pending.push(row);
    }

    if (pending.length === 0) continue;

    for (const batch of chunked(pending)) {
      const { error } = await db.from(spec.table).upsert(batch, { onConflict: spec.pk });
      if (error) throw new LeadPersistenceError(spec.table, "insert", error);
    }
  }

  for (const spec of [...MUTABLE_COLLECTIONS].reverse()) {
    if (spec.appendOnly) continue;

    const surviving = new Set((after[spec.key] as Row[]).map((row) => String(row[spec.pk])));
    const removed = (before[spec.key] as Row[])
      .map((row) => String(row[spec.pk]))
      .filter((key) => !surviving.has(key));

    if (removed.length === 0) continue;

    for (const batch of chunked(removed)) {
      const { error } = await db.from(spec.table).delete().in(spec.pk, batch);
      if (error) throw new LeadPersistenceError(spec.table, "delete", error);
    }
  }
}
