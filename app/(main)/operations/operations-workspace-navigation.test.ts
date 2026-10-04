import { describe, expect, it } from "vitest";

import {
  legacyOperationsRedirectHref,
  operationsWorkspaceHref,
  resolveOperationsWorkspaceTab,
  resolveOperationsWorkspaceView,
} from "./operations-workspace-navigation";

describe("resolveOperationsWorkspaceTab", () => {
  it("keeps a recognised Operations tab from a single query value", () => {
    expect(resolveOperationsWorkspaceTab({ tab: "flights" })).toBe("flights");
    expect(resolveOperationsWorkspaceTab({ tab: "readiness" })).toBe("readiness");
  });

  it("falls back to Overview when the tab is absent, unknown, or repeated", () => {
    expect(resolveOperationsWorkspaceTab({})).toBe("overview");
    expect(resolveOperationsWorkspaceTab({ tab: "not-an-operations-tab" })).toBe("overview");
    expect(resolveOperationsWorkspaceTab({ tab: ["tasks", "transport"] })).toBe("overview");
  });
});

describe("resolveOperationsWorkspaceView", () => {
  it("keeps a view only when it belongs to the selected tab", () => {
    expect(
      resolveOperationsWorkspaceView("accommodation", { view: "rooming-board" }),
    ).toBe("rooming-board");
  });

  it("drops a view that the selected tab does not offer", () => {
    expect(resolveOperationsWorkspaceView("transport", { view: "rooming-board" })).toBeNull();
    expect(resolveOperationsWorkspaceView("accommodation", { view: "made-up" })).toBeNull();
    expect(resolveOperationsWorkspaceView("accommodation", {})).toBeNull();
    expect(
      resolveOperationsWorkspaceView("accommodation", { view: ["rooming-board", "x"] }),
    ).toBeNull();
  });
});

describe("operationsWorkspaceHref", () => {
  it("creates a canonical URL for the overview and each subqueue", () => {
    expect(operationsWorkspaceHref("overview")).toBe("/operations");
    expect(operationsWorkspaceHref("tasks")).toBe("/operations?tab=tasks");
    expect(operationsWorkspaceHref("accommodation")).toBe("/operations?tab=accommodation");
  });

  it("adds the view only when the tab offers it", () => {
    expect(operationsWorkspaceHref("accommodation", "rooming-board")).toBe(
      "/operations?tab=accommodation&view=rooming-board",
    );
    expect(operationsWorkspaceHref("transport", "rooming-board")).toBe(
      "/operations?tab=transport",
    );
  });
});

describe("legacyOperationsRedirectHref", () => {
  it("maps each retired top-level list to its Operations queue", () => {
    expect(legacyOperationsRedirectHref("/flights-tickets")).toBe("/operations?tab=flights");
    expect(legacyOperationsRedirectHref("/transport-movements")).toBe(
      "/operations?tab=transport",
    );
    expect(legacyOperationsRedirectHref("/hotels-rooming")).toBe(
      "/operations?tab=accommodation",
    );
    expect(legacyOperationsRedirectHref("/hotels-rooming/rooming-board")).toBe(
      "/operations?tab=accommodation&view=rooming-board",
    );
  });

  it("returns null for routes that are not retired", () => {
    expect(legacyOperationsRedirectHref("/documents")).toBeNull();
    expect(legacyOperationsRedirectHref("/flights-tickets/abc")).toBeNull();
  });
});

describe("legacyOperationsRedirectHref — support", () => {
  it("maps the retired Support & Incidents list to the Support Cases tab", () => {
    expect(legacyOperationsRedirectHref("/support-incidents")).toBe("/operations?tab=support");
  });
});
