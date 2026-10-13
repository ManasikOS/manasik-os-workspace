import { describe, expect, it } from "vitest";

import type { AdminKpi } from "@/lib/types/dashboard";

import { selectKpis } from "./dashboard";

function kpi(id: string): AdminKpi {
  return { id, title: id, value: "1", destination: `/${id}` };
}

function built(...ids: string[]): Record<string, AdminKpi> {
  return Object.fromEntries(ids.map((id) => [id, kpi(id)]));
}

describe("selectKpis", () => {
  it("returns the tiles in the role's order, not the order they were built in", () => {
    const result = selectKpis(["b", "a", "c"], built("a", "b", "c"), 6);
    expect(result.map((k) => k.id)).toEqual(["b", "a", "c"]);
  });

  it("drops a tile that was not built and lets the next one fill the slot", () => {
    const result = selectKpis(["a", "missing", "b", "c"], built("a", "b", "c"), 2);
    expect(result.map((k) => k.id)).toEqual(["a", "b"]);
  });

  it("never returns more than the cap", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(selectKpis(ids, built(...ids), 6)).toHaveLength(6);
  });

  it("ignores a built tile the role did not ask for", () => {
    expect(selectKpis(["a"], built("a", "z"), 6).map((k) => k.id)).toEqual(["a"]);
  });

  it("returns nothing when nothing the role asked for could be built", () => {
    expect(selectKpis(["a", "b"], {}, 6)).toEqual([]);
  });
});
