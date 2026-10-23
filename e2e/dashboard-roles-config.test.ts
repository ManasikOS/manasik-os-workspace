import { describe, expect, it } from "vitest";

import { KNOWN_PRODUCTION_PROJECT_REFS as PACKAGES_KNOWN_PRODUCTION_REFS } from "../scripts/e2e/packages-p0-fixtures-config";

import {
  DASHBOARD_E2E_ROLES,
  KNOWN_PRODUCTION_PROJECT_REFS,
  parseDashboardE2eEnvironment,
} from "./dashboard-roles-config";

const roleVars = Object.fromEntries(
  DASHBOARD_E2E_ROLES.flatMap((role) => [
    [`DASHBOARD_E2E_${role}_EMAIL`, `${role.toLowerCase()}@example.test`],
    [`DASHBOARD_E2E_${role}_PASSWORD`, `pw-${role}`],
  ]),
);

const valid = {
  DASHBOARD_E2E_ENVIRONMENT: "staging",
  DASHBOARD_E2E_BASE_URL: "https://staging.example.test/some/path",
  DASHBOARD_E2E_PROJECT_REF: "stagingref123",
  DASHBOARD_E2E_PRODUCTION_PROJECT_REF: "prodref456",
  ...roleVars,
};

describe("parseDashboardE2eEnvironment", () => {
  it("reads a complete staging environment, keeping only the origin of the base URL", () => {
    const env = parseDashboardE2eEnvironment(valid);
    expect(env.baseUrl).toBe("https://staging.example.test");
    expect(env.environment).toBe("staging");
    expect(Object.keys(env.staff).sort()).toEqual([...DASHBOARD_E2E_ROLES].sort());
    expect(env.staff.GUIDE).toEqual({ email: "guide@example.test", password: "pw-GUIDE" });
  });

  it("accepts a disposable environment", () => {
    expect(parseDashboardE2eEnvironment({ ...valid, DASHBOARD_E2E_ENVIRONMENT: "disposable" }).environment).toBe("disposable");
  });

  it("names every missing variable at once", () => {
    const rest: Record<string, string | undefined> = { ...valid };
    delete rest.DASHBOARD_E2E_GUIDE_EMAIL;
    delete rest.DASHBOARD_E2E_VISA_PASSWORD;
    expect(() => parseDashboardE2eEnvironment(rest)).toThrow(/DASHBOARD_E2E_GUIDE_EMAIL.*DASHBOARD_E2E_VISA_PASSWORD|DASHBOARD_E2E_VISA_PASSWORD.*DASHBOARD_E2E_GUIDE_EMAIL/);
  });

  it("refuses production as a target, however it is spelled", () => {
    expect(() => parseDashboardE2eEnvironment({ ...valid, DASHBOARD_E2E_ENVIRONMENT: "production" })).toThrow(/staging or disposable/);
  });

  it("refuses a project ref that is the production ref", () => {
    expect(() =>
      parseDashboardE2eEnvironment({ ...valid, DASHBOARD_E2E_PROJECT_REF: "prodref456" }),
    ).toThrow(/must not match/);
  });

  it("refuses a known production project ref even if the production variable is wrong", () => {
    expect(() =>
      parseDashboardE2eEnvironment({ ...valid, DASHBOARD_E2E_PROJECT_REF: "bidmihfsljrurlnraqmf" }),
    ).toThrow(/known production/);
  });

  it("refuses a base URL that is not http(s)", () => {
    expect(() => parseDashboardE2eEnvironment({ ...valid, DASHBOARD_E2E_BASE_URL: "ftp://x.test" })).toThrow(/http/);
    expect(() => parseDashboardE2eEnvironment({ ...valid, DASHBOARD_E2E_BASE_URL: "not a url" })).toThrow(/absolute/);
  });
});

describe("known production refs", () => {
  it("match the list the Packages P0 seeder refuses, so the two guards cannot drift apart", () => {
    expect([...KNOWN_PRODUCTION_PROJECT_REFS]).toEqual([...PACKAGES_KNOWN_PRODUCTION_REFS]);
  });
});
