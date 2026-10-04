"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";

import {
  ALL_FILTER_VALUE,
  type FilterOption,
} from "@/components/data-table/filter-select";

/**
 * The filtering engine behind every list screen's data table.
 *
 * Each module used to hand-roll the same six concerns — search state, a
 * filter record, sort state, derived dropdown options, an active-filter
 * count, and the token that sends the table back to page one. They drifted:
 * Leads had non-blocking search via `useDeferredValue`, Departure Groups
 * re-filtered synchronously on every keystroke, and Reports round-tripped to
 * the server and flashed its `loading.tsx` skeleton on every filter change.
 *
 * This is the one implementation, and it is deliberately shaped to drop
 * straight into `components/data-table/data-table.tsx` — everything that
 * component's props ask for comes back off this hook.
 *
 * ## Why filtering here never shows a loading state
 *
 * Two rules, both of which callers get for free:
 *
 *   1. **Filter in memory, never over the network.** The rows are already on
 *      the client; re-querying the server to narrow a list the browser
 *      already holds is a round trip that can only ever be slower. A list
 *      big enough that this stops being true needs server-side pagination,
 *      which is a different design — not a filter that fetches.
 *
 *   2. **Deferred, not debounced.** `search` echoes into the input on the
 *      very next frame so typing never feels laggy, while `useDeferredValue`
 *      lets React re-run the filter pass at a lower priority and keep the
 *      previous rows on screen until it finishes. A debounce would do the
 *      opposite — hold the input hostage for a fixed delay whether or not
 *      the work was slow. `isStale` exposes the in-between moment so a
 *      caller can dim the table rather than unmount it; nothing here ever
 *      swaps rows for a spinner.
 *
 * ## The purity contract
 *
 * `searchFields`, `matches` and `compare` are almost always written as inline
 * arrows, so their identity changes on every render. Depending on that
 * identity would rebuild every memo on every render and defeat the point, so
 * the memos below deliberately key on the *data* — rows, filters, sort — and
 * not on the callbacks.
 *
 * That is only sound because of one rule: **these three must be pure
 * functions of their arguments.** A `matches` that reads a `savedView` from
 * the enclosing scope instead of taking it through `filters` will go stale
 * and silently stop re-filtering. Anything that narrows the list has to
 * arrive either in `rows` (already scoped) or in `filters`.
 *
 * ## Adopting it for a new feature
 *
 * ```ts
 * const list = useFilteredRows({
 *   rows: invoices,
 *   emptyFilters: EMPTY_INVOICE_FILTERS,   // module-level constant
 *   initialSort: DEFAULT_INVOICE_SORT,
 *   searchFields: (i) => [i.number, i.partyName],
 *   matches: (i, f) =>
 *     (f.status === ALL_FILTER || i.status === f.status) &&
 *     (f.branch === ALL_FILTER || i.branch === f.branch),
 *   compare: compareInvoices,
 * });
 * ```
 *
 * Then spread what the table needs: `list.rows`, `list.search`,
 * `list.setSearch`, `list.resetPageToken`, `list.sort`.
 */

/**
 * The sentinel a filter carries when it is not narrowing anything.
 *
 * Re-exported from `components/data-table/filter-select` rather than
 * redeclared: that module's `FilterSelect` chip already compares against it
 * to decide whether a filter reads as active, and two constants that must
 * always agree are one constant with extra steps.
 */
export const ALL_FILTER = ALL_FILTER_VALUE;

export type { FilterOption };

/**
 * A filter record: every value is either a real selection or `ALL_FILTER`.
 *
 * Only a convenience for modules that want to spell the shape out — the hook
 * itself constrains `TFilters` to `object`, not to this. An `interface` does
 * not get an implicit index signature in TypeScript, so requiring
 * `Record<string, string>` would have rejected `VisaFilters`,
 * `LeadFilters` and every other module's existing filter interface.
 */
export type FilterRecord = Record<string, string>;

export interface UseFilteredRowsOptions<
  TRow,
  TFilters extends object,
  TSort,
> {
  /**
   * The rows this screen should consider — already narrowed by any "saved
   * view" the module has (My Groups, Needs Attention…).
   *
   * Saved views are applied by the caller rather than passed in as a
   * callback on purpose: a view closure reads state this hook cannot see
   * (`savedView`, `currentUserName`), and keying a memo on a closure that
   * captures invisible state is exactly how a filter silently stops
   * updating. Scope first, then hand the result here.
   */
  rows: TRow[];
  /** The all-`ALL_FILTER` baseline. Also defines which filter keys exist. */
  emptyFilters: TFilters;
  initialSort: TSort;
  /**
   * The strings a free-text search should look through for one row. Nullish
   * entries are skipped, so `row.guideName ?? ""` is unnecessary — just pass
   * the field. Must be pure; see the purity contract above.
   *
   * Mutually exclusive with `searchPredicate` — pass whichever suits.
   */
  searchFields?: (row: TRow) => (string | null | undefined)[];
  /**
   * Full control over matching, for a module that already has a tested
   * `matchesXSearch(row, query)` helper worth keeping (Visa weights by
   * batch reference, Pilgrims searches passport numbers). Receives the
   * raw trimmed query, *not* lowercased — the predicate owns casing.
   *
   * The hook still owns *when* search runs, which is the part that matters:
   * a predicate here is just as deferred, and just as non-blocking, as
   * `searchFields`.
   */
  searchPredicate?: (row: TRow, query: string) => boolean;
  /** `false` excludes the row. Must be pure over `(row, filters)`. */
  matches?: (row: TRow, filters: TFilters) => boolean;
  /**
   * Standard comparator, plus the current sort descriptor. Must be pure.
   * Preferred over `sortRows`: a comparator cannot accidentally change the
   * size of the result set.
   */
  compare?: (a: TRow, b: TRow, sort: TSort) => number;
  /**
   * Whole-array sorter, for the five modules that already export
   * `sortLeads` / `sortVisaApplications` / … in this shape. Adapting them
   * here is cheaper and far less risky than rewriting five tested sorters
   * — each encodes its own tie-breaking — into comparators.
   *
   * Ignored when `compare` is given. Must return the same rows it was
   * handed, reordered; it is a sorter, not a second filter.
   */
  sortRows?: (rows: TRow[], sort: TSort) => TRow[];
}

export interface UseFilteredRowsResult<
  TRow,
  TFilters extends object,
  TSort,
> {
  /** Filtered and sorted. This is what the table renders. */
  rows: TRow[];

  /** Bind straight to the search input; echoes immediately. */
  search: string;
  setSearch: (value: string) => void;
  /**
   * True while the deferred filter pass is catching up with the typed text.
   * Dim the table with this — never replace it with a loading state.
   */
  isStale: boolean;

  filters: TFilters;
  setFilter: (key: keyof TFilters, value: string) => void;
  clearFilters: () => void;
  /** Filters currently narrowing the list, for the "Clear (n)" affordance. */
  activeFilterCount: number;

  sort: TSort;
  setSort: (sort: TSort) => void;

  /**
   * Unique `{ value, label }` pairs drawn from the rows in scope, so a branch
   * or guide with nothing in view never appears as a dead-end filter. Sorted
   * by label.
   */
  optionsFor: (
    select: (row: TRow) => string | null | undefined,
    label?: (value: string, row: TRow) => string,
  ) => FilterOption[];

  /** Feed to `DataTable.resetPageToken` — page 1 whenever the result set changes. */
  resetPageToken: string;
}

export function useFilteredRows<TRow, TFilters extends object, TSort>({
  rows,
  emptyFilters,
  initialSort,
  searchFields,
  searchPredicate,
  matches,
  compare,
  sortRows,
}: UseFilteredRowsOptions<TRow, TFilters, TSort>): UseFilteredRowsResult<
  TRow,
  TFilters,
  TSort
> {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<TFilters>(emptyFilters);
  const [sort, setSort] = useState<TSort>(initialSort);

  // The whole reason typing stays smooth: the input renders `search` now, the
  // expensive pass below runs against `deferredSearch` at lower priority.
  const deferredSearch = useDeferredValue(search);
  const isStale = search !== deferredSearch;

  const setFilter = useCallback((key: keyof TFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(emptyFilters);
    // A cleared filter bar that leaves stale text in the search box reads as
    // broken — "I cleared everything and still see three rows."
    setSearch("");
  }, [emptyFilters]);

  const filteredRows = useMemo(() => {
    const query = deferredSearch.trim();
    const needle = query.toLowerCase();

    return rows.filter((row) => {
      if (query) {
        const hit = searchPredicate
          ? searchPredicate(row, query)
          : (searchFields?.(row) ?? []).some(
              (field) => field != null && field.toLowerCase().includes(needle),
            );
        if (!hit) return false;
      }
      return matches ? matches(row, filters) : true;
    });
    // `searchFields` / `searchPredicate` / `matches` are excluded by contract
    // — see the purity note in this file's header. Keying on them would
    // rebuild every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, deferredSearch, filters]);

  const sortedRows = useMemo(() => {
    if (compare) {
      // `filter()` already returned a fresh array, but sorting the memoised
      // one in place would mutate a value another memo may still be holding.
      return [...filteredRows].sort((a, b) => compare(a, b, sort));
    }
    if (sortRows) return sortRows(filteredRows, sort);
    return filteredRows;
    // `compare` / `sortRows` excluded by the same contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRows, sort]);

  const optionsFor = useCallback(
    (
      select: (row: TRow) => string | null | undefined,
      label?: (value: string, row: TRow) => string,
    ): FilterOption[] => {
      const seen = new Map<string, FilterOption>();
      for (const row of rows) {
        const value = select(row);
        if (!value || seen.has(value)) continue;
        seen.set(value, { value, label: label ? label(value, row) : value });
      }
      return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
    },
    [rows],
  );

  const activeFilterCount = useMemo(
    () =>
      Object.values(filters as Record<string, unknown>).filter(
        (value) => value !== ALL_FILTER,
      ).length,
    [filters],
  );

  const resetPageToken = useMemo(
    () => `${deferredSearch}|${JSON.stringify(filters)}|${JSON.stringify(sort)}`,
    [deferredSearch, filters, sort],
  );

  return {
    rows: sortedRows,
    search,
    setSearch,
    isStale,
    filters,
    setFilter,
    clearFilters,
    activeFilterCount,
    sort,
    setSort,
    optionsFor,
    resetPageToken,
  };
}
