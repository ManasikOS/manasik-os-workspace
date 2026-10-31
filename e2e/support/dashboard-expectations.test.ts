import { describe, expect, it } from "vitest";

import { DASHBOARD_PANEL_IDS } from "@/lib/data/dashboard-layout";
import { STAFF_ROLES } from "@/lib/access/departure-groups-access";

import {
  ENTITLEMENT_DEPENDENT_BLOCKS,
  expectedBlocksFor,
  forbiddenBlocksFor,
  mustBePresentBlocksFor,
} from "./dashboard-expectations";

describe("expected blocks per role", () => {
  it.each(STAFF_ROLES)("%s: expected and forbidden partition every block", (role) => {
    const expected = expectedBlocksFor(role);
    const forbidden = forbiddenBlocksFor(role);
    expect([...expected, ...forbidden].sort()).toEqual([...DASHBOARD_PANEL_IDS].sort());
    for (const id of expected) expect(forbidden).not.toContain(id);
  });

  it.each(STAFF_ROLES)("%s: always opens with the briefing and KPI row", (role) => {
    expect(mustBePresentBlocksFor(role)).toEqual(expect.arrayContaining(["ai-briefing", "kpis"]));
  });

  it("does not require the entitlement-dependent owner panel to be present, but still forbids it where the role never gets it", () => {
    expect(ENTITLEMENT_DEPENDENT_BLOCKS).toContain("inbox-owner");
    expect(mustBePresentBlocksFor("ADMIN")).not.toContain("inbox-owner");
    expect(expectedBlocksFor("ADMIN")).toContain("inbox-owner");
    expect(forbiddenBlocksFor("GUIDE")).toContain("inbox-owner");
  });

  // Independent of the registry: if someone edits the presets and the gates
  // together, these still say what must never be on a page.
  it("never puts money, sales, team or approvals on a GUIDE's page", () => {
    const forbidden = forbiddenBlocksFor("GUIDE");
    for (const id of [
      "collections",
      "revenue-trend",
      "supplier-payables",
      "pipeline",
      "team-performance",
      "quotes-pending",
      "campaign-pulse",
      "approvals",
      "inbox-sla",
      "visa-queue",
      "document-review",
    ] as const) {
      expect(forbidden).toContain(id);
    }
  });

  it("never gives supplier payables to a role without supplier payment access", () => {
    for (const role of ["OPERATIONS", "MARKETING", "VISA", "GUIDE"] as const) {
      expect(forbiddenBlocksFor(role)).toContain("supplier-payables");
    }
  });

  it("puts the visa queue and document review on VISA's page", () => {
    expect(expectedBlocksFor("VISA")).toEqual(expect.arrayContaining(["visa-queue", "document-review"]));
  });
});
