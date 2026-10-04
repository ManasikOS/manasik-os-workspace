import { describe, expect, it } from "vitest";

import {
  assertInboxLoadTestStagingTarget,
  disposableDatabaseConfirmation,
  parseInboxLoadTestOptions,
} from "./inbox-multitenant-config";

const stagingEnvironment = {
  LOAD_TEST_ENVIRONMENT: "staging",
  LOAD_TEST_PROJECT_REF: "staging-project",
  LOAD_TEST_PRODUCTION_PROJECT_REF: "production-project",
  NEXT_PUBLIC_SUPABASE_URL: "https://staging-project.supabase.co",
};

describe("Inbox multitenant load-test safety", () => {
  it("keeps dry runs write-free", () => {
    expect(parseInboxLoadTestOptions([])).toEqual({ execute: false, seedFixtures: false, profile: "baseline" });
  });

  it("makes fixture creation explicit", () => {
    expect(parseInboxLoadTestOptions(["--execute", "--seed-fixtures"])).toMatchObject({ execute: true, seedFixtures: true });
  });

  it("rejects malformed profiles before traffic can be generated", () => {
    expect(() => parseInboxLoadTestOptions(["--execute", "--profile", "nonsense"])).toThrow("Unsupported load-test profile");
    expect(() => parseInboxLoadTestOptions(["--execute", "--profile"])).toThrow("Unsupported load-test profile");
  });

  it("accepts every profile the plan defines", () => {
    for (const profile of ["baseline", "sustained", "burst", "noisy-tenant"]) {
      expect(parseInboxLoadTestOptions(["--profile", profile]).profile).toBe(profile);
    }
  });

  it("reads a duration and a report path, and rejects a malformed duration or a missing path before any traffic", () => {
    expect(parseInboxLoadTestOptions(["--profile", "sustained", "--minutes", "5", "--report", "out.json"])).toMatchObject({ minutes: 5, reportPath: "out.json" });
    expect(() => parseInboxLoadTestOptions(["--minutes", "abc"])).toThrow("--minutes");
    expect(() => parseInboxLoadTestOptions(["--minutes", "2.5"])).toThrow("--minutes");
    expect(() => parseInboxLoadTestOptions(["--report"])).toThrow("--report");
    expect(() => parseInboxLoadTestOptions(["--report", "--execute"])).toThrow("--report");
  });

  it("rejects undeclared, missing, and mismatched targets before a write", () => {
    expect(() => assertInboxLoadTestStagingTarget({ ...stagingEnvironment, LOAD_TEST_ENVIRONMENT: "production" })).toThrow("LOAD_TEST_ENVIRONMENT");
    expect(() => assertInboxLoadTestStagingTarget({ ...stagingEnvironment, LOAD_TEST_PROJECT_REF: "production-project" })).toThrow("project refs must differ");
    expect(() => assertInboxLoadTestStagingTarget({ ...stagingEnvironment, NEXT_PUBLIC_SUPABASE_URL: "https://other-project.supabase.co" })).toThrow("does not match");
  });

  it("permits only a declared isolated staging target", () => {
    expect(() => assertInboxLoadTestStagingTarget(stagingEnvironment)).not.toThrow();
  });

  it("permits the current project only with the explicit disposable-data confirmation", () => {
    const disposableEnvironment = {
      ...stagingEnvironment,
      LOAD_TEST_ENVIRONMENT: "disposable",
      LOAD_TEST_PROJECT_REF: "production-project",
      NEXT_PUBLIC_SUPABASE_URL: "https://production-project.supabase.co",
    };
    expect(() => assertInboxLoadTestStagingTarget(disposableEnvironment)).toThrow("disposable-data confirmation");
    expect(() => assertInboxLoadTestStagingTarget({ ...disposableEnvironment, LOAD_TEST_DISPOSABLE_CONFIRMATION: disposableDatabaseConfirmation })).not.toThrow();
  });
});
