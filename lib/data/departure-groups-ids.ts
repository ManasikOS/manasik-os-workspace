/**
 * Row identifiers for Departure Groups.
 *
 * Every primary key in the schema is a `uuid`, so the descriptive ids the
 * mutators used to build by hand (`${groupId}-bk-${timestamp}`) cannot be
 * stored. Generating a real uuid in the application rather than letting
 * Postgres default it keeps the store diffable: a freshly created row already
 * carries the key its children reference, so a booking and its pilgrims can be
 * written in one flush without a round trip in between.
 *
 * A leaf module with no imports of its own — the store, the seed and every
 * mutator can use it without creating an initialisation cycle.
 */
export function newId(): string {
  return crypto.randomUUID();
}
