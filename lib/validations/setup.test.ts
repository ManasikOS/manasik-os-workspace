import { describe, expect, it } from "vitest";

import { setupStepSkipSchema, setupStepViewSchema } from "./setup";

describe("setupStepSkipSchema", () => {
  it("accepts each known step", () => {
    for (const stepId of ["account", "agency", "team", "channels", "payments", "package"]) {
      expect(setupStepSkipSchema.safeParse({ stepId }).success).toBe(true);
    }
  });

  it("rejects an unknown step", () => {
    expect(setupStepSkipSchema.safeParse({ stepId: "billing" }).success).toBe(false);
    expect(setupStepSkipSchema.safeParse({}).success).toBe(false);
  });
});

describe("setupStepViewSchema", () => {
  it("falls back to no step when the query value is unknown", () => {
    expect(setupStepViewSchema.parse("nonsense")).toBeUndefined();
    expect(setupStepViewSchema.parse(undefined)).toBeUndefined();
    expect(setupStepViewSchema.parse("team")).toBe("team");
  });

  it("allows the finish screen", () => {
    expect(setupStepViewSchema.parse("finish")).toBe("finish");
  });
});
