import { describe, expect, it } from "vitest";

import { canOpenPackageEditorStep, decidePackageSaveRoute } from "./decide-package-save-route";

describe("decidePackageSaveRoute", () => {
  it("saves a package that is not on sale as a draft, whatever changed", () => {
    expect(decidePackageSaveRoute({ isLive: false, sensitiveChangeCount: 0 })).toBe("save-draft");
    expect(decidePackageSaveRoute({ isLive: false, sensitiveChangeCount: 3 })).toBe("save-draft");
  });

  it("asks for a review when a package on sale has payment, contract or booking changes", () => {
    expect(decidePackageSaveRoute({ isLive: true, sensitiveChangeCount: 1 })).toBe("review-first");
  });

  it("saves a package on sale at once when only display text changed", () => {
    expect(decidePackageSaveRoute({ isLive: true, sensitiveChangeCount: 0 })).toBe("save-directly");
  });
});

describe("canOpenPackageEditorStep", () => {
  const validity = { 1: true, 2: true, 3: false, 4: true };

  it("always allows the current step and earlier ones", () => {
    expect(canOpenPackageEditorStep({ targetIndex: 2, activeStep: 2, stepValidity: validity })).toBe(true);
    expect(canOpenPackageEditorStep({ targetIndex: 0, activeStep: 2, stepValidity: validity })).toBe(true);
  });

  it("opens a step when every step before it is valid", () => {
    // Step 3 (index 2) only needs steps 1 and 2.
    expect(canOpenPackageEditorStep({ targetIndex: 2, activeStep: 0, stepValidity: validity })).toBe(true);
  });

  it("locks a step when any step before it is invalid", () => {
    // Step 4 (index 3) needs step 3, which is invalid.
    expect(canOpenPackageEditorStep({ targetIndex: 3, activeStep: 0, stepValidity: validity })).toBe(false);
  });
});
