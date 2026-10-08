import { describe, expect, it } from "vitest";

import { decidePublishAfterDraftSave } from "./publish-guard";

describe("decidePublishAfterDraftSave", () => {
  it("lets publish continue with the saved row's id and updated_at", () => {
    expect(decidePublishAfterDraftSave({ ok: true, packageId: "p1", updatedAt: "2026-10-08T00:00:00Z" })).toEqual({
      proceed: true,
      packageId: "p1",
      updatedAt: "2026-10-08T00:00:00Z",
    });
  });

  it("refuses to publish when the first save failed, instead of publishing with a null id", () => {
    const decision = decidePublishAfterDraftSave({
      ok: false,
      packageId: null,
      updatedAt: null,
      error: 'The package code "UM01" is already used by another package.',
      step: 1,
    });
    expect(decision).toEqual({
      proceed: false,
      step: 1,
      message: 'The package code "UM01" is already used by another package.',
    });
  });

  it("refuses to publish a stale draft and says to reload", () => {
    const decision = decidePublishAfterDraftSave({ ok: false, packageId: "p1", updatedAt: "x", code: "STALE" });
    expect(decision.proceed).toBe(false);
    if (!decision.proceed) expect(decision.message).toMatch(/reload/i);
  });

  it("gives a plain message when the failed save has no reason", () => {
    const decision = decidePublishAfterDraftSave({ ok: false, packageId: null, updatedAt: null });
    expect(decision.proceed).toBe(false);
    if (!decision.proceed) expect(decision.message).toMatch(/could not be saved/i);
  });
});
