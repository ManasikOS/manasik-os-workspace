import { describe, expect, it } from "vitest";

import { buildGlobalSearchPattern, isGlobalSearchPatternEmpty } from "./global-search-term";

describe("buildGlobalSearchPattern", () => {
  it("wraps a plain term for a contains-match", () => {
    expect(buildGlobalSearchPattern("  Umrah  ")).toBe("%Umrah%");
  });

  it("strips filter syntax and LIKE wildcards so they cannot change the query", () => {
    expect(buildGlobalSearchPattern("a,b).eq.id.x%_")).toBe("%a b eq id x%");
  });

  it("collapses repeated whitespace", () => {
    expect(buildGlobalSearchPattern("Al   Noor")).toBe("%Al Noor%");
  });

  it("flags a query that was only punctuation", () => {
    expect(isGlobalSearchPatternEmpty(buildGlobalSearchPattern("%%,,"))).toBe(true);
    expect(isGlobalSearchPatternEmpty(buildGlobalSearchPattern("LD-2026"))).toBe(false);
  });
});
