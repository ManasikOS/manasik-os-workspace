import { describe, expect, it } from "vitest";

import { deleteBlocker, deleteSideEffects, type PackageDeleteImpact } from "./delete-impact";

const CLEAN: PackageDeleteImpact = {
  status: "Draft",
  departureGroups: 0,
  groupSnapshots: 0,
  leadQuotes: 0,
  agentSubmissions: 0,
  leadsPreferringIt: 0,
  campaigns: 0,
  agentAllocations: 0,
  websiteContent: 0,
  pendingChanges: 0,
};

describe("deleteBlocker", () => {
  it("allows a draft and an archived package with nothing attached", () => {
    expect(deleteBlocker(CLEAN)).toBeNull();
    expect(deleteBlocker({ ...CLEAN, status: "Archived" })).toBeNull();
  });

  it("blocks a package that is on sale or only closed, and says what to do", () => {
    for (const status of ["Open for Sale", "Sales Closed"]) {
      expect(deleteBlocker({ ...CLEAN, status })).toMatch(/archive it first/);
    }
  });

  it("blocks while departure groups or their snapshots use the package", () => {
    expect(deleteBlocker({ ...CLEAN, departureGroups: 1 })).toMatch(/1 departure group uses/);
    expect(deleteBlocker({ ...CLEAN, groupSnapshots: 3 })).toMatch(/3 departure groups use/);
  });

  it("blocks while lead quotes or agent submissions refer to it", () => {
    expect(deleteBlocker({ ...CLEAN, leadQuotes: 2 })).toMatch(/2 lead quotes/);
    expect(deleteBlocker({ ...CLEAN, agentSubmissions: 1 })).toMatch(/1 agent booking submission /);
    expect(deleteBlocker({ ...CLEAN, leadQuotes: 1, agentSubmissions: 4 })).toMatch(/1 lead quote and 4 agent booking submissions/);
  });

  it("reports the status problem before anything else", () => {
    expect(deleteBlocker({ ...CLEAN, status: "Open for Sale", departureGroups: 5 })).toMatch(/Open for Sale/);
  });
});

describe("deleteSideEffects", () => {
  it("is empty when nothing would be unlinked or removed", () => {
    expect(deleteSideEffects(CLEAN)).toEqual([]);
  });

  it("lists each thing that would be cleared or removed, with the right singular and plural", () => {
    const effects = deleteSideEffects({ ...CLEAN, leadsPreferringIt: 1, campaigns: 2, agentAllocations: 1, websiteContent: 4, pendingChanges: 1 });
    expect(effects).toEqual([
      "1 lead names this as the package they want; that link is cleared.",
      "2 campaigns are linked to it; the link is cleared.",
      "1 agent allocation will be removed.",
      "4 website content items will be removed.",
      "1 change waiting for approval will be discarded.",
    ]);
  });
});
