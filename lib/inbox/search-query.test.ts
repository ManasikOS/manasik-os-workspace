import { describe, expect, it } from "vitest";

import { normaliseSearchQuery, SEARCH_MAX_LENGTH } from "./search-query";

describe("normaliseSearchQuery", () => {
  it("keeps names, phone numbers and lead references as typed", () => {
    expect(normaliseSearchQuery("Afraz")).toBe("Afraz");
    expect(normaliseSearchQuery("+94 77 123")).toBe("+94 77 123");
    expect(normaliseSearchQuery("LD-1042")).toBe("LD-1042");
  });

  it("keeps names in other scripts", () => {
    expect(normaliseSearchQuery("අෆ්රාස්")).toBe("අෆ්රාස්");
    expect(normaliseSearchQuery("محمد")).toBe("محمد");
  });

  it("removes characters that would change the meaning of the database filter", () => {
    expect(normaliseSearchQuery("a,b)or(c")).toBe("a b or c");
    expect(normaliseSearchQuery("100%_done*")).toBe("100 done");
    expect(normaliseSearchQuery(String.raw`x\y`)).toBe("x y");
  });

  it("collapses spaces and trims", () => {
    expect(normaliseSearchQuery("  ali    khan ")).toBe("ali khan");
  });

  it("does not search for something too short", () => {
    for (const raw of ["", " ", "a", "%%", "  z "]) expect(normaliseSearchQuery(raw)).toBeNull();
  });

  it("caps the length", () => {
    expect(normaliseSearchQuery("a".repeat(500))?.length).toBe(SEARCH_MAX_LENGTH);
  });
});
