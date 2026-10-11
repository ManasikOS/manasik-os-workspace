import { describe, expect, it } from "vitest";

import { completenessPercent, crossFieldIssues, isPackageComplete, missingSteps } from "@/lib/validations/packages";

import {
  PACKAGES_FIXTURE_BULK_MAX,
  PACKAGES_FIXTURE_CODE_PREFIX,
  assertPackagesFixtureTarget,
  buildFixtureForm,
  buildFixtureRow,
  bulkFixtureCode,
  packagesFixtureOtherAgencyPlan,
  packagesFixturePlans,
  parseBulkCount,
  planNeedsVersion,
} from "./packages-p0-fixtures-config";

const NOW = new Date("2026-10-11T12:00:00.000Z");
const validEnv = {
  PACKAGES_E2E_ENVIRONMENT: "staging",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co",
  PACKAGES_E2E_PROJECT_REF: "abcdefgh",
  PACKAGES_E2E_PRODUCTION_PROJECT_REF: "zzzzzzzz",
};

describe("Packages P0 fixture plans", () => {
  it("builds every 'complete' fixture as a package the publish gate accepts", () => {
    for (const plan of [...packagesFixturePlans, packagesFixtureOtherAgencyPlan].filter((entry) => entry.complete)) {
      const form = buildFixtureForm(plan);
      expect(crossFieldIssues(form), `${plan.id} cross-field issues`).toEqual([]);
      expect(missingSteps(form), `${plan.id} missing steps`).toEqual([]);
      expect(isPackageComplete(form), plan.id).toBe(true);
    }
  });

  it("builds P2 so only step 1 is complete (the plan's ~17%)", () => {
    const plan = packagesFixturePlans.find((entry) => entry.id === "P2")!;
    const form = buildFixtureForm(plan);
    expect(missingSteps(form)).toEqual([2, 3, 4, 5, 6]);
    expect(completenessPercent(form)).toBe(17);
  });

  it("builds P3 with no code, no title and step 1 incomplete, and keeps a marker to find it again", () => {
    const plan = packagesFixturePlans.find((entry) => entry.id === "P3")!;
    const form = buildFixtureForm(plan);
    expect(form.title).toBe("");
    expect(form.internalCode).toBe("");
    expect(missingSteps(form)).toContain(1);
    expect(plan.marker).toBeTruthy();
    expect(form.description).toBe(plan.marker);
  });

  it("gives every coded fixture a unique, ZZTEST- prefixed code (the unique index is case-insensitive)", () => {
    const codes = [...packagesFixturePlans, packagesFixtureOtherAgencyPlan].map((plan) => plan.code).filter((code) => code !== "");
    for (const code of codes) expect(code.startsWith(PACKAGES_FIXTURE_CODE_PREFIX), code).toBe(true);
    expect(new Set(codes.map((code) => code.toLowerCase())).size).toBe(codes.length);
  });

  it("keeps the 200-character and formula-injection titles the export tests need", () => {
    const long = packagesFixturePlans.find((entry) => entry.id === "P12b")!;
    expect(long.title).toHaveLength(200);
    const formula = packagesFixturePlans.find((entry) => entry.id === "P12a")!;
    expect(formula.title.startsWith("=")).toBe(true);
  });

  it("writes lifecycle columns the database CHECK accepts (archived_at is set exactly when status is Archived)", () => {
    for (const plan of packagesFixturePlans) {
      const row = buildFixtureRow(plan, NOW);
      expect(row.status).toBe(plan.status);
      expect(row.archived_at !== null, plan.id).toBe(plan.status === "Archived");
      if (plan.status === "Archived") expect(row.previous_status).toBe("Open for Sale");
      if (plan.status === "Draft") expect(row.published_at).toBeNull();
    }
  });

  it("matches the plan's Marketing visibility: on sale, or owned by Marketing", () => {
    const visible = packagesFixturePlans
      .filter((plan) => plan.status === "Open for Sale" || plan.owner === "MARKETING")
      .map((plan) => plan.planId);
    expect([...new Set(visible)].sort()).toEqual(["P11", "P13", "P4", "P5", "P8", "P9"].sort());
  });

  it("gives P5 two live groups and P11 none, as the archive guard and delete tests assume", () => {
    const live = (id: string) =>
      (packagesFixturePlans.find((plan) => plan.id === id)?.groups ?? []).filter((group) => !group.archived && group.groupStatus !== "CANCELLED");
    expect(live("P5")).toHaveLength(2);
    expect(live("P11")).toHaveLength(0);
  });

  it("flags which packages need a published version row", () => {
    const need = packagesFixturePlans.filter(planNeedsVersion).map((plan) => plan.id);
    expect(need).toEqual(["P4", "P5", "P6", "P7", "P8", "P11", "P13"]);
  });

  it("zero-pads bulk codes so they sort and never collide with a fixture code", () => {
    expect(bulkFixtureCode(7)).toBe("ZZTEST-BULK-00007");
    expect(bulkFixtureCode(600)).toBe("ZZTEST-BULK-00600");
  });
});

describe("assertPackagesFixtureTarget", () => {
  it("accepts a named staging project", () => {
    expect(assertPackagesFixtureTarget(validEnv).projectRef).toBe("abcdefgh");
  });

  it("refuses when the environment is not staging or disposable", () => {
    expect(() => assertPackagesFixtureTarget({ ...validEnv, PACKAGES_E2E_ENVIRONMENT: "production" })).toThrow(/staging or disposable/);
    expect(() => assertPackagesFixtureTarget({ ...validEnv, PACKAGES_E2E_ENVIRONMENT: undefined })).toThrow(/staging or disposable/);
  });

  it("refuses when the project is the declared production project", () => {
    expect(() => assertPackagesFixtureTarget({ ...validEnv, PACKAGES_E2E_PRODUCTION_PROJECT_REF: "abcdefgh" })).toThrow(/must not match/);
  });

  it("refuses a known production project even if it is not declared", () => {
    expect(() =>
      assertPackagesFixtureTarget({
        ...validEnv,
        NEXT_PUBLIC_SUPABASE_URL: "https://bidmihfsljrurlnraqmf.supabase.co",
        PACKAGES_E2E_PROJECT_REF: "bidmihfsljrurlnraqmf",
      }),
    ).toThrow(/known production/);
  });

  it("refuses when the URL points somewhere other than the named project", () => {
    expect(() => assertPackagesFixtureTarget({ ...validEnv, NEXT_PUBLIC_SUPABASE_URL: "https://otherproj.supabase.co" })).toThrow(/does not point at/);
  });

  it("refuses when a required variable is missing", () => {
    expect(() => assertPackagesFixtureTarget({ ...validEnv, PACKAGES_E2E_PROJECT_REF: undefined })).toThrow(/required/);
  });
});

describe("parseBulkCount", () => {
  it("returns 0 when --bulk is absent", () => {
    expect(parseBulkCount(["--execute"])).toBe(0);
  });

  it("reads both --bulk 600 and --bulk=600", () => {
    expect(parseBulkCount(["--execute", "--bulk", "600"])).toBe(600);
    expect(parseBulkCount(["--bulk=250"])).toBe(250);
  });

  it("rejects zero, negatives, fractions, text and anything above the cap", () => {
    for (const bad of ["0", "-5", "1.5", "lots", String(PACKAGES_FIXTURE_BULK_MAX + 1)]) {
      expect(() => parseBulkCount(["--bulk", bad]), bad).toThrow(/whole number/);
    }
  });
});
