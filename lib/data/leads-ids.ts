/**
 * Row identifiers for Leads. Mirrors `lib/data/departure-groups-ids.ts` and
 * `lib/data/pilgrims-ids.ts`: every primary key in the schema (`leads`,
 * `lead_activity`, `lead_notes`, `lead_quotes` — see
 * `supabase/migrations/20260812100000_create_leads.sql`) is a `uuid`, so a
 * hand-built descriptive id (`lead-${Date.now().toString(36)}-${n}`) is
 * rejected by Postgres with "invalid input syntax for type uuid". Generating
 * a real uuid in the application rather than letting Postgres default it
 * keeps the store diffable: a freshly created row already carries the key
 * its children reference, so a lead and its activity/notes can be written in
 * one flush without a round trip in between.
 */
export function newId(): string {
  return crypto.randomUUID();
}
