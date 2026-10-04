import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ENV_SPECS, FORBIDDEN_IN_DEPLOYED_ENV, environmentNameOf, evaluateEnvironment, fingerprintEnvValue } from "./required-env";

const always = ENV_SPECS.filter((spec) => spec.requirement === "always").map((spec) => spec.name);
const deployed = ENV_SPECS.filter((spec) => spec.requirement === "deployed").map((spec) => spec.name);

/** Every required variable set to a distinctive value, as a complete deployment would have. */
function completeEnvironment(environment: "production" | "staging" = "production"): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of [...always, ...deployed]) env[name] = `value-of-${name}`;
  env.SENTRY_ENVIRONMENT = environment;
  return env;
}

describe("the variable list", () => {
  it("has no duplicate names", () => {
    const names = ENV_SPECS.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("is documented: every listed variable appears in .env.example", () => {
    const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    for (const spec of ENV_SPECS) expect(example, `${spec.name} is missing from .env.example`).toMatch(new RegExp(`^#?\\s*${spec.name}=`, "m"));
  });

  it("never lists a test-only setting as required", () => {
    const required = new Set(ENV_SPECS.map((spec) => spec.name));
    for (const name of FORBIDDEN_IN_DEPLOYED_ENV) expect(required.has(name)).toBe(false);
  });

  it("treats the cron secret and the service key as needed everywhere, because every route and the worker use them", () => {
    expect(always).toEqual(expect.arrayContaining(["CRON_SECRET", "SUPABASE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_URL"]));
  });
});

describe("environmentNameOf", () => {
  it.each([
    ["production", "production"],
    [" Production ", "production"],
    ["staging", "staging"],
    ["preview", "other"],
    ["", "unset"],
    [undefined, "unset"],
  ])("%j is %s", (value, expected) => {
    expect(environmentNameOf({ SENTRY_ENVIRONMENT: value })).toBe(expected);
  });
});

describe("evaluateEnvironment", () => {
  it("is ready for a complete production environment", () => {
    const report = evaluateEnvironment(completeEnvironment("production"));
    expect(report.problems).toEqual([]);
    expect(report.ready).toBe(true);
    expect(report.environment).toBe("production");
  });

  it("is ready for a complete staging environment", () => {
    expect(evaluateEnvironment(completeEnvironment("staging")).ready).toBe(true);
  });

  it("names each missing required variable, and a blank value counts as missing", () => {
    const env = completeEnvironment();
    delete env.CRON_SECRET;
    env.META_APP_SECRET = "   ";
    const report = evaluateEnvironment(env);
    expect(report.ready).toBe(false);
    expect(report.problems).toEqual(expect.arrayContaining(["CRON_SECRET is not set.", "META_APP_SECRET is not set."]));
  });

  it("does not require deployment-only variables outside a deployed environment, but always requires the basics", () => {
    const report = evaluateEnvironment({ SENTRY_ENVIRONMENT: "development", CRON_SECRET: "x" });
    expect(report.problems).toContain("SUPABASE_SECRET_KEY is not set.");
    expect(report.problems).not.toContain("META_APP_SECRET is not set.");
  });

  it("flags an unset or unrecognised environment name", () => {
    const unset = evaluateEnvironment({});
    expect(unset.environment).toBe("unset");
    expect(unset.problems.join(" ")).toMatch(/cannot be told apart/);
    expect(evaluateEnvironment({ ...completeEnvironment(), SENTRY_ENVIRONMENT: "preview" }).problems.join(" ")).toMatch(/neither staging nor production/);
  });

  it("flags a test-only setting that is set in a deployed environment, by name only", () => {
    const env = { ...completeEnvironment(), INBOX_E2E_A1_PASSWORD: "super-secret-test-password", LOAD_TEST_PROJECT_REF: "abc" };
    const report = evaluateEnvironment(env);
    expect(report.ready).toBe(false);
    expect(report.forbiddenPresent).toEqual(["LOAD_TEST_PROJECT_REF", "INBOX_E2E_A1_PASSWORD"].sort((a, b) => FORBIDDEN_IN_DEPLOYED_ENV.indexOf(a) - FORBIDDEN_IN_DEPLOYED_ENV.indexOf(b)));
    expect(JSON.stringify(report)).not.toContain("super-secret-test-password");
  });

  it("does not flag test-only settings outside a deployed environment, where they belong", () => {
    const report = evaluateEnvironment({ SENTRY_ENVIRONMENT: "development", INBOX_E2E_A1_PASSWORD: "x" });
    expect(report.forbiddenPresent).toEqual([]);
  });

  it("never puts a secret or identifier value in the report, only a fingerprint; config values are shown", () => {
    const env = completeEnvironment();
    env.SUPABASE_SECRET_KEY = "service-role-key-VALUE-1234567890";
    env.NEXT_PUBLIC_SUPABASE_URL = "https://projectref123.supabase.co";
    env.META_GRAPH_VERSION = "v25.0";
    const report = evaluateEnvironment(env);
    const text = JSON.stringify(report);

    expect(text).not.toContain("service-role-key-VALUE-1234567890");
    expect(text).not.toContain("projectref123");
    expect(report.variables.find((v) => v.name === "SUPABASE_SECRET_KEY")).toMatchObject({ present: true, fingerprint: fingerprintEnvValue("service-role-key-VALUE-1234567890") });
    expect(report.variables.find((v) => v.name === "SUPABASE_SECRET_KEY")?.value).toBeUndefined();
    expect(report.variables.find((v) => v.name === "META_GRAPH_VERSION")).toMatchObject({ present: true, value: "v25.0" });
    expect(report.variables.find((v) => v.name === "META_GRAPH_VERSION")?.fingerprint).toBeUndefined();
  });

  it("reports an absent variable as absent, with neither value nor fingerprint", () => {
    const entry = evaluateEnvironment({}).variables.find((v) => v.name === "CRON_SECRET");
    expect(entry).toEqual({ name: "CRON_SECRET", kind: "secret", requirement: "always", present: false });
  });
});

describe("the outbound allow-list setting", () => {
  it("is reported by fingerprint only, never by value, because it holds phone numbers", () => {
    const report = evaluateEnvironment({ ...completeEnvironment("staging"), INBOX_OUTBOUND_ALLOWLIST: "94771234567,secret@example.com" });
    const entry = report.variables.find((v) => v.name === "INBOX_OUTBOUND_ALLOWLIST");
    expect(entry).toMatchObject({ kind: "secret", present: true, fingerprint: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(entry?.value).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain("94771234567");
    expect(JSON.stringify(report)).not.toContain("secret@example.com");
  });

  it("is allowed in staging", () => {
    expect(evaluateEnvironment({ ...completeEnvironment("staging"), INBOX_OUTBOUND_ALLOWLIST: "94771234567" }).ready).toBe(true);
  });

  it("is a problem in production, where the code ignores it, and is named without its value", () => {
    const report = evaluateEnvironment({ ...completeEnvironment("production"), INBOX_OUTBOUND_ALLOWLIST: "94771234567" });
    expect(report.ready).toBe(false);
    expect(report.forbiddenPresent).toContain("INBOX_OUTBOUND_ALLOWLIST");
    expect(report.problems).toContain("INBOX_OUTBOUND_ALLOWLIST is ignored in production and must not be set there.");
    expect(JSON.stringify(report)).not.toContain("94771234567");
  });
});

describe("fingerprintEnvValue", () => {
  it("is 8 hex characters, the same for the same value and different for another", () => {
    expect(fingerprintEnvValue("abc")).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprintEnvValue("abc")).toBe(fingerprintEnvValue("abc"));
    expect(fingerprintEnvValue("abc")).not.toBe(fingerprintEnvValue("abd"));
  });

  it("lets two environments be compared: identical secrets give identical fingerprints", () => {
    expect(evaluateEnvironment(completeEnvironment("staging")).variables.find((v) => v.name === "CRON_SECRET")?.fingerprint).toBe(
      evaluateEnvironment(completeEnvironment("production")).variables.find((v) => v.name === "CRON_SECRET")?.fingerprint,
    );
  });
});
