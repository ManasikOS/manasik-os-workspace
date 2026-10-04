/** Row identifiers for Pilgrims. Mirrors `lib/data/departure-groups-ids.ts`. */
export function newId(): string {
  return crypto.randomUUID();
}
