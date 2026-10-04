/**
 * Who the agent is, everywhere it is named.
 *
 * Every surface that writes an actor name, and every surface that renders
 * one, goes through this module — so the product's AI has one name in the
 * activity trail, one name on the approval card, and one name in the
 * sidebar, and renaming it again is one edit rather than forty.
 *
 * Deliberately client-safe: no `server-only`, no Supabase, no Next runtime.
 * The write side (`lib/agent/**`) and the read side (Client Components
 * rendering an activity feed) import the same constants, which is the
 * whole point — a name that only the writer knows is a name the UI will
 * eventually get wrong.
 *
 * ## Why `displayActorName()` exists
 *
 * Rows written before this rename still carry the old actor names in
 * `actor_name_snapshot` / `actor_name` / `author_name`. Those columns are
 * an audit trail, so they are NOT rewritten by a migration — an audit log
 * that gets edited to match a marketing decision is no longer an audit
 * log. Instead the legacy names are mapped to the current one at render
 * time, which keeps history intact on disk and coherent on screen.
 *
 * That mapping is also why `isCopilotActor()` must be used for styling
 * rather than a `name === COPILOT_NAME` check: a two-year-old activity row
 * is still the Copilot's work, and should still look like it.
 */

/** The product name of the agency's AI. The one string this rename turns on. */
export const COPILOT_NAME = "Manasik Copilot";

/** For tight spaces — a table cell, a chip, a toast title. */
export const COPILOT_SHORT_NAME = "Copilot";

/**
 * What the Copilot is called when a specific capability needs naming
 * rather than the product as a whole. All one identity — these are roles
 * it plays, not separate agents, which is exactly what the UI should
 * convey.
 */
export const COPILOT_SURFACE_NAMES = {
  /** Reviews departure groups, raises findings, files proposals. */
  departureOps: `${COPILOT_NAME} — Departure Operations`,
  /** Answers pilgrims on WhatsApp, captures leads, holds seats. */
  whatsapp: `${COPILOT_NAME} — WhatsApp Assistant`,
  /** Reads uploaded documents and drafts the chase message. */
  documents: `${COPILOT_NAME} — Document Review`,
  /** Reads issued tickets and visas and compares them to the record. */
  ticketVisa: `${COPILOT_NAME} — Ticket & Visa Review`,
} as const;

/**
 * Actor names persisted before the rename. Matched case-insensitively on
 * read so an old activity row still renders — and still styles — as the
 * Copilot.
 *
 * Never remove an entry from this list: the rows it matches are permanent.
 */
const LEGACY_ACTOR_NAMES: readonly string[] = [
  "departure operations agent",
  "ai agent",
  "ai sales agent",
  "ai document agent",
  "whatsapp ai agent",
];

/**
 * The Seat Hold Sweeper is a plain scheduled job, not the Copilot — it
 * runs no model and makes no judgement. It is listed here only so nobody
 * later mistakes it for an agent actor and folds it in; it should keep
 * reading as system automation.
 */
export const SYSTEM_ACTOR_NAMES: readonly string[] = ["Seat Hold Sweeper"];

function normalise(name: string): string {
  return name.trim().toLowerCase();
}

/** Whether an actor name — current or legacy — is the Copilot. */
export function isCopilotActor(name: string | null | undefined): boolean {
  if (!name) return false;
  const key = normalise(name);
  if (key === normalise(COPILOT_NAME)) return true;
  if (key.startsWith(`${normalise(COPILOT_NAME)} —`)) return true;
  return LEGACY_ACTOR_NAMES.includes(key);
}

/** Whether an actor name is an unattended system job rather than a person or the Copilot. */
export function isSystemActor(name: string | null | undefined): boolean {
  if (!name) return false;
  return SYSTEM_ACTOR_NAMES.some((n) => normalise(n) === normalise(name));
}

/**
 * The name to actually put on screen. Folds every legacy agent name onto
 * the current one and leaves human names untouched.
 *
 * Use this anywhere an actor name is rendered, searched or used to build a
 * filter option list — otherwise a group with both pre- and post-rename
 * rows shows the same actor twice in a "filter by staff" dropdown.
 */
export function displayActorName(name: string | null | undefined): string {
  if (!name) return "";
  return isCopilotActor(name) ? COPILOT_NAME : name;
}
