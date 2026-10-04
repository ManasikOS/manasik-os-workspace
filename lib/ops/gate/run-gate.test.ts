import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REQUIRED_BUCKETS } from "./evaluate";
import { renderMarkdown, summarize } from "./report";
import { NOT_BUILT_YET, runGate } from "./run-gate";
import type { GateCheckResult, GateConfigReport, GateContext, GateSnapshot } from "./types";

const NOW = new Date("2026-10-02T12:00:00.000Z");

const cleanSnapshot: GateSnapshot = {
  generated_at: NOW.toISOString(),
  migrations: ["alpha"],
  tenant_tables_without_rls: [],
  server_only_tables_with_client_privilege: [],
  unconditional_policies: [],
  buckets: REQUIRED_BUCKETS.map((id) => ({ id, public: false })),
  storage_policies_without_agency_check: [],
  anon_executable_definer_functions: [],
  cron: [{ jobname: "inbox-health", state: "OK", reason: null, last_success_at: NOW.toISOString() }],
  inbox_health_last_success_at: new Date(NOW.getTime() - 60_000).toISOString(),
};

const stagingConfig: GateConfigReport = { environment: "staging", ready: true, problems: [], forbiddenPresent: [], variables: [] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const webhookRoutes = (url: URL, method: string) =>
  url.pathname.startsWith("/api/webhooks/") ? (method === "POST" ? new Response("Unauthorized", { status: 401 }) : new Response("Forbidden", { status: 403 })) : null;

const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  const method = init?.method ?? "GET";
  if (url.pathname === "/api/health") return json({ status: "ok", build: "abc1234" });
  if (url.pathname === "/api/health/ready") return json({ status: "ready" });
  if (url.pathname === "/api/health/config") return json(stagingConfig);
  return webhookRoutes(url, method) ?? new Response("nope", { status: 404 });
}) as typeof fetch;

function context(overrides: Partial<GateContext> = {}): GateContext {
  return {
    baseUrl: "https://app.example.test",
    expectedEnvironment: "staging",
    expectedCommit: "abc1234",
    cronSecret: "secret",
    readSnapshot: async () => cleanSnapshot,
    repoMigrationFiles: ["1_alpha.sql"],
    verifyTokens: {},
    fetchImpl,
    now: NOW,
    ...overrides,
  };
}

const byId = (results: GateCheckResult[], id: string) => results.find((result) => result.id === id)!;

describe("runGate", () => {
  it("returns every check in order, with the unbuilt ones pending, so the gate cannot pass while any is missing", async () => {
    const results = await runGate(context());
    expect(results.map((result) => result.id)).toEqual(["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12", "G13", "G14", "G15"]);
    for (const placeholder of NOT_BUILT_YET) expect(byId(results, placeholder.id).status).toBe("PENDING");
    expect(summarize(results).verdict).not.toBe("PASS");
  });

  it("passes the checks that can be judged on a healthy staging deployment", async () => {
    const results = await runGate(context());
    for (const id of ["G1", "G2", "G3", "G4", "G5", "G6"]) expect(byId(results, id).status, id).toBe("PASS");
    expect(byId(results, "G7").status).toBe("PENDING");
    expect(byId(results, "G8").status).toBe("PENDING");
    expect(byId(results, "G13").status).toBe("PENDING");
  });

  it("judges the schema against the baseline when both are supplied, and reports the objects that differ", async () => {
    const baseline = { lastMigration: "20270102090000_b", migrationCount: 2, objects: { "table:a": "1111111111" } };
    const same = await runGate(context({ repoMigrationFiles: ["20270101090000_a.sql", "20270102090000_b.sql"], schemaBaseline: baseline, readSchemaFingerprint: async () => ({ objects: { "table:a": "1111111111" } }) }));
    expect(byId(same, "G15").status).toBe("PASS");
    const drifted = await runGate(context({ repoMigrationFiles: ["20270101090000_a.sql", "20270102090000_b.sql"], schemaBaseline: baseline, readSchemaFingerprint: async () => ({ objects: { "table:a": "2222222222" } }) }));
    expect(byId(drifted, "G15").status).toBe("FAIL");
    expect(byId(drifted, "G15").items).toEqual(["differs: table:a"]);
  });

  it("fails G15 with the way to fix it when the schema fingerprint function is not applied", async () => {
    const baseline = { lastMigration: "20270102090000_b", migrationCount: 2, objects: { "table:a": "1111111111" } };
    const results = await runGate(context({ schemaBaseline: baseline, readSchemaFingerprint: async () => { throw new Error("function gate_schema_fingerprint() does not exist"); } }));
    expect(byId(results, "G15").status).toBe("FAIL");
    expect(byId(results, "G15").detail).toContain("20270109090000_gate_schema_fingerprint.sql");
  });

  it("fails the four database checks, with the reason, when the snapshot cannot be read, and still runs the rest", async () => {
    const results = await runGate(context({ readSnapshot: async () => { throw new Error("function gate_snapshot() does not exist"); } }));
    for (const id of ["G2", "G3", "G4", "G5"]) {
      expect(byId(results, id).status).toBe("FAIL");
      expect(byId(results, id).detail).toMatch(/snapshot could not be read: function gate_snapshot\(\) does not exist/);
    }
    expect(byId(results, "G1").status).toBe("PASS");
  });

  it("never throws: a check that blows up becomes a FAIL for that check only", async () => {
    const results = await runGate(context({ fetchImpl: (async () => { throw new Error("network down"); }) as unknown as typeof fetch }));
    expect(byId(results, "G1").status).toBe("FAIL");
    expect(byId(results, "G2").status).toBe("PASS");
  });

  it("reports a migration drift as a failure naming the migration", async () => {
    const results = await runGate(context({ repoMigrationFiles: ["1_alpha.sql", "2_new_one.sql"] }));
    expect(byId(results, "G2").status).toBe("FAIL");
    expect(byId(results, "G2").items).toContain("not applied: new_one");
  });
});

describe("summarize", () => {
  const result = (status: GateCheckResult["status"]): GateCheckResult => ({ id: "G", title: "t", status, detail: "d" });

  it.each([
    [["PASS", "PASS"], 0, "PASS"],
    [["PASS", "PENDING"], 2, "PENDING"],
    [["PASS", "PENDING", "FAIL"], 1, "FAIL"],
    [["FAIL"], 1, "FAIL"],
  ] as const)("%j exits %i with verdict %s", (statuses, exitCode, verdict) => {
    const summary = summarize(statuses.map(result));
    expect(summary.exitCode).toBe(exitCode);
    expect(summary.verdict).toBe(verdict);
  });
});

describe("renderMarkdown", () => {
  it("shows the verdict, counts and a row per check, with findings listed under the check that has them", async () => {
    const results = await runGate(context({ repoMigrationFiles: ["1_alpha.sql", "2_new_one.sql"] }));
    const text = renderMarkdown(results, { target: "https://app.example.test", environment: "staging", at: NOW });
    expect(text).toContain("## Production gate: FAIL");
    expect(text).toContain("| G2 Migrations | FAIL |");
    expect(text).toContain("### G2 Migrations");
    expect(text).toContain("- not applied: new_one");
    expect(text).toContain("2026-10-02T12:00:00.000Z");
  });

  it("never contains the secrets it was given", async () => {
    const results = await runGate(context({ cronSecret: "super-secret-cron-value", reference: { baseUrl: "https://ref.example.test", cronSecret: "super-secret-reference" }, verifyTokens: { WHATSAPP: "super-secret-token" } }));
    const text = renderMarkdown(results, { target: "https://app.example.test", environment: "staging", at: NOW });
    for (const secret of ["super-secret-cron-value", "super-secret-reference", "super-secret-token"]) expect(text).not.toContain(secret);
  });

  it("keeps a table cell intact when a detail contains a pipe", () => {
    const text = renderMarkdown([{ id: "G1", title: "x", status: "FAIL", detail: "a | b" }], { target: "t", environment: "staging", at: NOW });
    expect(text).toContain("a / b");
  });
});

describe("the gate script and its settings", () => {
  const script = readFileSync(join(process.cwd(), "scripts/gate/run.ts"), "utf8");
  const example = readFileSync(join(process.cwd(), ".env.gate.example"), "utf8");

  it("documents every GATE_ setting the script reads", () => {
    const read = [...new Set([...script.matchAll(/\b(GATE_[A-Z_]+)\b/g)].map((match) => match[1]))];
    expect(read.length).toBeGreaterThan(8);
    for (const name of read) expect(example, `${name} is missing from .env.gate.example`).toMatch(new RegExp(`^${name}=`, "m"));
  });

  it("reads only GATE_ settings for its target, never the app's own variables", () => {
    expect(script).not.toMatch(/process\.env\.(NEXT_PUBLIC_|SUPABASE_|CRON_SECRET|META_)/);
  });

  it("is wired to an npm script, and its example and build output are handled by git", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["verify:production"]).toMatch(/scripts\/gate\/run\.ts/);
    const ignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");
    expect(ignore).toMatch(/^!\.env\.gate\.example$/m);
    expect(ignore).toMatch(/^\/dist-gate\/$/m);
  });
});
