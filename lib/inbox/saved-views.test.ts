import { describe, expect, it } from "vitest";

import { parseSavedViewInput, SAVED_VIEW_NAME_MAX, savedViewsFromRows } from "./saved-views";

describe("parseSavedViewInput", () => {
  it("accepts a name, a real queue and an optional search", () => {
    expect(parseSavedViewInput({ name: "  Payments   today ", view: "payments", search: " Afraz " })).toEqual({ ok: true, name: "Payments today", view: "payments", search: "Afraz" });
    expect(parseSavedViewInput({ name: "Mine", view: "assigned-to-me" })).toEqual({ ok: true, name: "Mine", view: "assigned-to-me", search: null });
  });

  it("refuses a missing name or a queue that does not exist", () => {
    expect(parseSavedViewInput({ name: "  ", view: "all" }).ok).toBe(false);
    expect(parseSavedViewInput({ name: "x", view: "everything" }).ok).toBe(false);
  });

  it("makes the search safe the same way the search box does, and refuses one that is too short", () => {
    expect(parseSavedViewInput({ name: "x", view: "all", search: "a,b)or(c" })).toMatchObject({ ok: true, search: "a b or c" });
    expect(parseSavedViewInput({ name: "x", view: "all", search: "%" }).ok).toBe(false);
  });

  it("caps the name", () => {
    const parsed = parseSavedViewInput({ name: "n".repeat(200), view: "all" });
    expect(parsed.ok && parsed.name.length).toBe(SAVED_VIEW_NAME_MAX);
  });
});

describe("savedViewsFromRows", () => {
  it("drops a saved view whose queue this build no longer knows", () => {
    expect(
      savedViewsFromRows([
        { id: "1", name: "Old", view: "retired-queue", search: null },
        { id: "2", name: "Payments", view: "payments", search: "x" },
      ]),
    ).toEqual([{ id: "2", name: "Payments", view: "payments", search: "x" }]);
  });
});
