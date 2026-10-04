import { describe, expect, it } from "vitest";

import {
  INBOX_HEALTH_MAX_AGE_MINUTES,
  REQUIRED_BUCKETS,
  checkConfig,
  checkCron,
  checkIsolation,
  checkMigrations,
  checkSchemaFingerprint,
  checkStorage,
  combine,
  migrationNamesFromFiles,
} from "./evaluate";
import type { GateConfigReport, GateSnapshot, SchemaBaseline } from "./types";

const NOW = new Date("2026-10-02T12:00:00.000Z");

function snapshot(overrides: Partial<GateSnapshot> = {}): GateSnapshot {
  return {
    generated_at: NOW.toISOString(),
    migrations: ["alpha", "beta"],
    tenant_tables_without_rls: [],
    server_only_tables_with_client_privilege: [],
    unconditional_policies: [],
    buckets: REQUIRED_BUCKETS.map((id) => ({ id, public: false })),
    storage_policies_without_agency_check: [],
    anon_executable_definer_functions: [],
    cron: [{ jobname: "inbox-health", state: "OK", reason: null, last_success_at: NOW.toISOString() }],
    inbox_health_last_success_at: new Date(NOW.getTime() - 3 * 60_000).toISOString(),
    ...overrides,
  };
}

describe("migrationNamesFromFiles", () => {
  it("drops the version prefix and the extension, ignores other files, and removes duplicates", () => {
    expect(migrationNamesFromFiles(["20270102090000_agencies_is_test.sql", "20260824090000_tenancy.sql", "20260824090000_tenancy_repair.sql", "README.md", "20260824090001_tenancy.sql"])).toEqual([
      "agencies_is_test",
      "tenancy",
      "tenancy_repair",
    ]);
  });
});

describe("checkMigrations (G2)", () => {
  it("passes when the repository and the database name the same migrations, whatever their version stamps", () => {
    expect(checkMigrations(["1_alpha.sql", "2_beta.sql"], snapshot()).status).toBe("PASS");
  });

  it("fails and names a migration that is in the repository but not applied", () => {
    const result = checkMigrations(["1_alpha.sql", "2_beta.sql", "3_gamma.sql"], snapshot());
    expect(result.status).toBe("FAIL");
    expect(result.items).toContain("not applied: gamma");
  });

  it("fails and names a migration that is applied but not in the repository", () => {
    const result = checkMigrations(["1_alpha.sql"], snapshot());
    expect(result.status).toBe("FAIL");
    expect(result.items).toContain("not in repository: beta");
  });

  it("caps a long list so the report stays readable, and says how many were left out", () => {
    const files = Array.from({ length: 40 }, (_, i) => `${i}_m${String(i).padStart(2, "0")}.sql`);
    const result = checkMigrations(files, snapshot({ migrations: [] }));
    expect(result.items?.length).toBe(16);
    expect(result.items?.at(-1)).toMatch(/and 25 more/);
  });
});

describe("checkIsolation (G3)", () => {
  it("passes on a clean snapshot", () => {
    expect(checkIsolation(snapshot()).status).toBe("PASS");
  });

  it.each([
    ["tenant_tables_without_rls", ["quotes"], "tenant table without row-level security: quotes"],
    ["server_only_tables_with_client_privilege", ["outbox_messages"], "server-only table with a client privilege: outbox_messages"],
    ["unconditional_policies", ["x.open"], "unconditional policy: x.open"],
    ["storage_policies_without_agency_check", ["read all"], "storage policy without an agency check: read all"],
    ["anon_executable_definer_functions", ["do_it"], "security-definer function callable by anonymous users: do_it"],
  ] as const)("fails on %s", (key, value, expected) => {
    const result = checkIsolation(snapshot({ [key]: [...value] } as Partial<GateSnapshot>));
    expect(result.status).toBe("FAIL");
    expect(result.items).toContain(expected);
  });
});

describe("checkCron (G4)", () => {
  it("passes when every job is OK or paused and inbox-health is recent", () => {
    const result = checkCron(snapshot({ cron: [{ jobname: "a", state: "OK", reason: null, last_success_at: null }, { jobname: "b", state: "PAUSED", reason: "paused", last_success_at: null }] }), NOW);
    expect(result.status).toBe("PASS");
  });

  it.each(["FAILING", "STALE", "NEVER_RUN"])("fails on a job that is %s", (state) => {
    const result = checkCron(snapshot({ cron: [{ jobname: "inbox-lanes", state, reason: "why", last_success_at: null }] }), NOW);
    expect(result.status).toBe("FAIL");
    expect(result.items?.[0]).toContain(`inbox-lanes: ${state}`);
  });

  it("fails when inbox-health has not succeeded recently, or ever", () => {
    const stale = checkCron(snapshot({ inbox_health_last_success_at: new Date(NOW.getTime() - (INBOX_HEALTH_MAX_AGE_MINUTES + 5) * 60_000).toISOString() }), NOW);
    expect(stale.status).toBe("FAIL");
    expect(stale.items?.join(" ")).toMatch(/last succeeded 15 minutes ago/);
    expect(checkCron(snapshot({ inbox_health_last_success_at: null }), NOW).items?.join(" ")).toMatch(/never succeeded/);
  });

  it("fails when there are no scheduled jobs at all", () => {
    expect(checkCron(snapshot({ cron: [] }), NOW).status).toBe("FAIL");
  });
});

describe("checkStorage (G5)", () => {
  it("passes when every required bucket exists and all are private", () => {
    expect(checkStorage(snapshot()).status).toBe("PASS");
  });

  it("fails on a missing required bucket and on any public bucket", () => {
    const buckets = REQUIRED_BUCKETS.filter((id) => id !== "payment-proofs").map((id) => ({ id, public: id === "content-vault" }));
    const result = checkStorage(snapshot({ buckets }));
    expect(result.status).toBe("FAIL");
    expect(result.items).toEqual(expect.arrayContaining(["missing bucket: payment-proofs", "public bucket: content-vault"]));
  });
});

function config(overrides: Partial<GateConfigReport> = {}): GateConfigReport {
  return {
    environment: "production",
    ready: true,
    problems: [],
    forbiddenPresent: [],
    variables: [
      { name: "CRON_SECRET", kind: "secret", requirement: "always", present: true, fingerprint: "aaaaaaaa" },
      { name: "META_APP_SECRET", kind: "secret", requirement: "deployed", present: true, fingerprint: "bbbbbbbb" },
      { name: "SENTRY_DSN", kind: "identifier", requirement: "deployed", present: true, fingerprint: "cccccccc" },
      { name: "SENTRY_ENVIRONMENT", kind: "config", requirement: "deployed", present: true, value: "production" },
    ],
    ...overrides,
  };
}

describe("checkConfig (G6)", () => {
  it("is pending, not passed, for production that has not been compared with another environment", () => {
    const result = checkConfig(config(), "production");
    expect(result.status).toBe("PENDING");
    expect(result.detail).toMatch(/GATE_REFERENCE_BASE_URL/);
  });

  it("passes for staging without a reference", () => {
    expect(checkConfig(config({ environment: "staging" }), "staging").status).toBe("PASS");
  });

  it("passes for production that shares nothing with the reference, even when the Sentry DSN is shared on purpose", () => {
    const reference = config({
      environment: "staging",
      variables: [
        { name: "CRON_SECRET", kind: "secret", requirement: "always", present: true, fingerprint: "11111111" },
        { name: "META_APP_SECRET", kind: "secret", requirement: "deployed", present: true, fingerprint: "22222222" },
        { name: "SENTRY_DSN", kind: "identifier", requirement: "deployed", present: true, fingerprint: "cccccccc" },
      ],
    });
    expect(checkConfig(config(), "production", reference).status).toBe("PASS");
  });

  it("fails, naming the variable, when production shares a secret with the reference", () => {
    const reference = config({ environment: "staging", variables: [{ name: "META_APP_SECRET", kind: "secret", requirement: "deployed", present: true, fingerprint: "bbbbbbbb" }] });
    const result = checkConfig(config(), "production", reference);
    expect(result.status).toBe("FAIL");
    expect(result.items).toContain("META_APP_SECRET has the same value as the reference environment");
  });

  it("fails on the wrong environment name, and carries the deployment's own problems through", () => {
    const result = checkConfig(config({ environment: "staging", problems: ["OPENROUTER_API_KEY is not set."], forbiddenPresent: ["LOAD_TEST_PROJECT_REF"] }), "production");
    expect(result.status).toBe("FAIL");
    expect(result.items).toEqual(expect.arrayContaining(['environment is "staging", expected "production"', "OPENROUTER_API_KEY is not set."]));
  });

  it("never compares plain config values, which legitimately match", () => {
    const reference = config({ environment: "staging", variables: [{ name: "SENTRY_ENVIRONMENT", kind: "config", requirement: "deployed", present: true, value: "production", fingerprint: "dddddddd" }] });
    expect(checkConfig(config({ environment: "staging" }), "staging", reference).status).toBe("PASS");
  });
});

describe("combine", () => {
  const part = (status: "PASS" | "FAIL" | "PENDING", title = "p") => ({ id: "x", title, status, detail: `${title} is ${status}` });

  it("fails if any part fails, even when others are pending or pass", () => {
    expect(combine("G8", "t", [part("PASS"), part("PENDING", "q"), part("FAIL", "r")], "ok").status).toBe("FAIL");
  });

  it("is pending when nothing failed but something is pending", () => {
    const result = combine("G8", "t", [part("PASS"), part("PENDING", "q")], "ok");
    expect(result.status).toBe("PENDING");
    expect(result.items).toEqual(["q: q is PENDING"]);
  });

  it("passes only when every part passes", () => {
    const result = combine("G8", "t", [part("PASS"), part("PASS")], "all good");
    expect(result).toMatchObject({ status: "PASS", detail: "all good" });
  });
});

describe("checkSchemaFingerprint (G15)", () => {
  const files = ["20270101090000_one.sql", "20270102090000_two.sql"];
  const baseline: SchemaBaseline = {
    lastMigration: "20270102090000_two",
    migrationCount: 2,
    objects: { "table:a": "1111111111", "constraint:a": "2222222222", "function:f()": "3333333333" },
  };

  it("passes when every object matches the clean-build baseline", () => {
    const result = checkSchemaFingerprint(baseline, { objects: { ...baseline.objects } }, files);
    expect(result.status).toBe("PASS");
    expect(result.detail).toContain("3 schema objects");
  });

  it("fails and names an object whose definition differs (the case a migration-name match cannot see)", () => {
    const result = checkSchemaFingerprint(baseline, { objects: { ...baseline.objects, "constraint:a": "9999999999" } }, files);
    expect(result.status).toBe("FAIL");
    expect(result.items).toEqual(["differs: constraint:a"]);
  });

  it("fails and names an object that is missing, and one that is not in the repository", () => {
    const rest = Object.fromEntries(Object.entries(baseline.objects).filter(([key]) => key !== "function:f()"));
    const result = checkSchemaFingerprint(baseline, { objects: { ...rest, "table:leftover": "4444444444" } }, files);
    expect(result.status).toBe("FAIL");
    expect(result.items).toEqual(["missing: function:f()", "not in the repository: table:leftover"]);
    expect(result.detail).toBe("0 differ, 1 missing, 1 not in the repository, of 3 objects.");
  });

  it("refuses to judge against a baseline that does not describe the current migrations, and says how to regenerate it", () => {
    const stale = checkSchemaFingerprint({ ...baseline, migrationCount: 1 }, { objects: { ...baseline.objects } }, files);
    expect(stale.status).toBe("FAIL");
    expect(stale.items?.join(" ")).toContain("scripts/local/write-schema-fingerprint.sh");
    const wrongLast = checkSchemaFingerprint({ ...baseline, lastMigration: "20270101090000_one" }, { objects: { ...baseline.objects } }, files);
    expect(wrongLast.status).toBe("FAIL");
  });

  it("shows at most fifteen names and counts the rest", () => {
    const many: Record<string, string> = {};
    for (let index = 0; index < 20; index += 1) many[`table:t${index}`] = "5555555555";
    const result = checkSchemaFingerprint({ ...baseline, objects: many }, { objects: {} }, files);
    expect(result.items).toHaveLength(16);
    expect(result.items?.[15]).toBe("…and 5 more");
  });
});
