import { INBOX_VIEWS, type InboxView } from "@/lib/inbox/views";
import { normaliseSearchQuery, SEARCH_MAX_LENGTH } from "@/lib/inbox/search-query";

/**
 * A saved Inbox view is a person's own shortcut: a queue and, optionally, a search. These are the rules for what may be
 * saved. The queue must be a real one, the name is short plain text, the search goes through the same safe normalising as
 * the search box, and each person keeps a small number so the list stays scannable.
 */

export const SAVED_VIEW_LIMIT = 20;
export const SAVED_VIEW_NAME_MAX = 40;

export interface SavedView {
  id: string;
  name: string;
  view: InboxView;
  search: string | null;
}

export type ParsedSavedView = { ok: true; name: string; view: InboxView; search: string | null } | { ok: false; error: string };

export function parseSavedViewInput(input: { name: string; view: string; search?: string | null }): ParsedSavedView {
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, SAVED_VIEW_NAME_MAX).trim();
  if (!name) return { ok: false, error: "Give this view a name." };
  if (!(INBOX_VIEWS as readonly string[]).includes(input.view)) return { ok: false, error: "That queue does not exist." };
  const rawSearch = (input.search ?? "").trim();
  const search = rawSearch ? normaliseSearchQuery(rawSearch.slice(0, SEARCH_MAX_LENGTH * 2)) : null;
  if (rawSearch && !search) return { ok: false, error: "That search is too short to save." };
  return { ok: true, name, view: input.view as InboxView, search };
}

/** Rows read from the database, keeping only those this build still knows how to open. */
export function savedViewsFromRows(rows: ReadonlyArray<{ id: string; name: string; view: string; search: string | null }>): SavedView[] {
  return rows.flatMap((row) =>
    (INBOX_VIEWS as readonly string[]).includes(row.view) ? [{ id: row.id, name: row.name, view: row.view as InboxView, search: row.search }] : [],
  );
}
