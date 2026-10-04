import { describe, expect, it } from "vitest";

import { capabilitiesForSetup } from "./setup-access";

describe("capabilitiesForSetup", () => {
  it("lets only an administrator view and edit the setup guide", () => {
    expect(capabilitiesForSetup("ADMIN")).toEqual({ viewSetup: true, editSetup: true });
  });

  it.each(["CEO", "FINANCE", "MARKETING", "OPERATIONS", "VISA", "GUIDE"] as const)("denies %s", (role) => {
    expect(capabilitiesForSetup(role)).toEqual({ viewSetup: false, editSetup: false });
  });
});
