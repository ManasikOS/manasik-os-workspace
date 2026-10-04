import { describe, expect, it } from "vitest";

import { summariseAgencySetup, type OperatorSetupSources } from "./operator-setup-progress";

const empty = (): OperatorSetupSources => ({
  activeStaffByAgency: new Map(),
  whatsappConnected: new Set(),
  pageChannelConnected: new Set(),
  smtpSaved: new Set(),
  agenciesWithPaymentAccount: new Set(),
  agenciesWithPackage: new Set(),
  stateByAgency: new Map(),
});

describe("summariseAgencySetup", () => {
  it("shows a brand-new agency as 0 of 6", () => {
    expect(summariseAgencySetup("a", empty())).toEqual({ doneCount: 0, total: 6 });
  });

  it("counts the same live facts the owner's own guide counts", () => {
    const sources = empty();
    sources.activeStaffByAgency.set("a", 3);
    sources.whatsappConnected.add("a");
    sources.agenciesWithPackage.add("a");
    sources.agenciesWithPaymentAccount.add("a");
    expect(summariseAgencySetup("a", sources)).toEqual({ doneCount: 4, total: 6 });
  });

  it("counts any live channel: WhatsApp, a Meta page channel or saved email", () => {
    for (const key of ["whatsappConnected", "pageChannelConnected", "smtpSaved"] as const) {
      const sources = empty();
      sources[key].add("a");
      expect(summariseAgencySetup("a", sources).doneCount).toBe(1);
    }
  });

  it("uses the stored confirmations for the password and basics steps", () => {
    const sources = empty();
    sources.stateByAgency.set("a", {
      steps: {},
      basicsConfirmedAt: "2026-09-26T00:00:00Z",
      passwordSetAt: "2026-09-26T00:00:00Z",
      guideDismissedAt: null,
      lastStep: null,
    });
    expect(summariseAgencySetup("a", sources).doneCount).toBe(2);
  });

  it("does not leak one agency's facts into another", () => {
    const sources = empty();
    sources.agenciesWithPackage.add("a");
    expect(summariseAgencySetup("b", sources).doneCount).toBe(0);
  });
});
