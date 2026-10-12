/**
 * What a person is told when a Leads write fails.
 *
 * Postgres and PostgREST messages name tables, columns and constraints; returning them to the browser tells an attacker the schema and tells a
 * user nothing they can act on. This maps the failures that have a useful human answer to fixed sentences, and everything else to one generic
 * sentence with a short reference that is also written to the server log — so support can find the real error without the customer ever seeing it.
 */

export interface LeadFailure {
  /** Safe to show in the UI. */
  message: string;
  /** Matches the line in the server log; present only for errors that were not recognised. */
  reference: string | null;
}

function property(cause: unknown, key: "code" | "name"): string | null {
  if (cause && typeof cause === "object" && key in cause) {
    const value = (cause as Record<string, unknown>)[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function newReference(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

const KNOWN: Record<string, string> = {
  "23505": "That already exists. Refresh the page and check before trying again.",
  "23503": "Something this refers to no longer exists. Refresh the page and try again.",
  "23514": "One of the values is not allowed. Check the form and try again.",
  "23502": "A required value is missing. Check the form and try again.",
  "22P02": "One of the values is not in the right format.",
  "22023": "One of the values is not allowed.",
  "42501": "You do not have permission to do that.",
  "40001": "Someone else changed this at the same moment. Try again.",
  "40P01": "Someone else changed this at the same moment. Try again.",
  P0002: "That record no longer exists.",
};

/**
 * `log` is injected so the unit test can observe it; the default writes one line with the real error to the server log.
 */
export function describeLeadFailure(
  cause: unknown,
  context: string,
  log: (line: string, cause: unknown) => void = (line, error) => console.error(line, error),
): LeadFailure {
  if (property(cause, "name") === "LeadConflictError") {
    return { message: "Someone else changed this lead just now. Refresh the page and try again.", reference: null };
  }

  const code = property(cause, "code");
  if (code && KNOWN[code]) return { message: KNOWN[code], reference: null };

  const reference = newReference();
  log(`[leads] ${context} failed (ref ${reference})`, cause);
  return { message: `Something went wrong and nothing was saved. Reference ${reference}.`, reference };
}
