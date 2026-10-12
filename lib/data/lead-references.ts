/**
 * Lead (`LD-YYYY-NNNN`) and quote (`QT-YYYY-NNNN`) reference numbers.
 *
 * They used to be `max + 1` over whatever rows the caller had just read, in three separate places. Two people creating at once, or a person and
 * the WhatsApp agent, computed the same number and the second insert died on the unique constraint — and a scoped read (one lead's quotes) cannot
 * see the agency's highest number at all. The database now hands them out from a per-agency, per-year counter
 * (`allocate_references`, 20270201090000_leads_integrity.sql), atomically and in blocks, so an import of 200 rows is one call.
 *
 * Until that migration is applied the RPC does not exist; the fallback below keeps the old behaviour for that window rather than taking lead
 * creation down. It is the same race as before, not a new one. Remove it once the migration is live everywhere.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type ReferenceKind = "LEAD" | "QUOTE";

const PREFIX: Record<ReferenceKind, string> = { LEAD: "LD", QUOTE: "QT" };
const TABLE: Record<ReferenceKind, string> = { LEAD: "leads", QUOTE: "lead_quotes" };

function colomboYear(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric" }).format(now);
}

/** Highest number already used for `kind` in `year`, from a list of references. Revision suffixes (`-R1`) are ignored. */
export function highestReferenceNumber(references: string[], kind: ReferenceKind, year: string): number {
  const pattern = new RegExp(`^${PREFIX[kind]}-${year}-(\\d+)$`);
  return references.reduce((highest, reference) => {
    const match = pattern.exec(reference);
    return match ? Math.max(highest, Number.parseInt(match[1], 10)) : highest;
  }, 0);
}

export function formatReference(kind: ReferenceKind, year: string, value: number): string {
  return `${PREFIX[kind]}-${year}-${String(value).padStart(4, "0")}`;
}

function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "");
}

/**
 * `agencyId` is for service-role callers (the WhatsApp agent, cron) that have no signed-in user; a staff session always uses its own agency and the
 * database ignores the argument for it.
 */
export async function allocateReferences(
  db: Db,
  kind: ReferenceKind,
  count = 1,
  options: { agencyId?: string; now?: Date } = {},
): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1) return [];

  const { data, error } = await db.rpc("allocate_references", {
    p_kind: kind,
    p_count: count,
    p_agency_id: options.agencyId ?? null,
  });

  if (!error && Array.isArray(data) && data.length === count) return data as string[];
  if (error && !isMissingFunction(error)) {
    throw Object.assign(new Error(`Could not allocate ${kind} references: ${error.message}`), { code: error.code });
  }

  // Fallback (migration not applied yet).
  const year = colomboYear(options.now ?? new Date());
  let query = db.from(TABLE[kind]).select("reference").like("reference", `${PREFIX[kind]}-${year}-%`);
  if (options.agencyId) query = query.eq("agency_id", options.agencyId);
  const { data: rows, error: readError } = await query;
  if (readError) throw new Error(`Could not read ${kind} references: ${readError.message}`);

  const highest = highestReferenceNumber(((rows ?? []) as { reference: string }[]).map((row) => row.reference), kind, year);
  return Array.from({ length: count }, (_, index) => formatReference(kind, year, highest + index + 1));
}
