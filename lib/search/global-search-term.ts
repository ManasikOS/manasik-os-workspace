/**
 * Turns what the person typed into a value that is safe to put inside a
 * PostgREST `.or()` filter with `ilike`. Commas, parentheses and dots are
 * filter syntax, and `%` / `_` / `\` are LIKE wildcards — typed literally,
 * any of them could change what the filter means.
 */
export function buildGlobalSearchPattern(rawQuery: string): string {
  const cleaned = rawQuery
    .trim()
    .replace(/[,().*"'\\%_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `%${cleaned}%`;
}

/** True when nothing searchable is left after cleaning (e.g. the query was only punctuation). */
export function isGlobalSearchPatternEmpty(pattern: string): boolean {
  return pattern.replace(/%/g, "").trim().length === 0;
}
