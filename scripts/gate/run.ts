import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { renderMarkdown, summarize } from "../../lib/ops/gate/report";
import { runGate } from "../../lib/ops/gate/run-gate";
import type { GateContext, GateEnvironment, GateSnapshot, SchemaBaseline, SchemaFingerprint } from "../../lib/ops/gate/types";

/**
 * `npm run verify:production`: the production go-live gate (TASK-032 S7). Judges one deployment and prints PASS, FAIL or PENDING for each check.
 * Exit code 0 means everything passed, 2 means nothing is broken but something is still pending, 1 means a check failed.
 *
 * It reads only GATE_* variables (never the app's own NEXT_PUBLIC_* ones), so it cannot silently judge whichever environment `.env.local`
 * happens to point at. Put them in `.env.gate` (ignored by git) or the environment; see `.env.gate.example`. It changes nothing: the only
 * write is the optional report file.
 */

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is required. See .env.gate.example.`);
    process.exit(3);
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

const expectedEnvironment = required("GATE_EXPECTED_ENVIRONMENT");
if (expectedEnvironment !== "production" && expectedEnvironment !== "staging") {
  console.error('GATE_EXPECTED_ENVIRONMENT must be "production" or "staging".');
  process.exit(3);
}

const baseUrl = required("GATE_BASE_URL");
const supabase = createClient(required("GATE_SUPABASE_URL"), required("GATE_SUPABASE_SECRET_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });

const referenceBaseUrl = optional("GATE_REFERENCE_BASE_URL");
const referenceCronSecret = optional("GATE_REFERENCE_CRON_SECRET");
const vercelToken = optional("GATE_VERCEL_TOKEN");
const vercelProject = optional("GATE_VERCEL_PROJECT");

const context: GateContext = {
  baseUrl,
  expectedEnvironment: expectedEnvironment as GateEnvironment,
  expectedCommit: optional("GATE_EXPECTED_COMMIT"),
  cronSecret: optional("GATE_CRON_SECRET"),
  readSnapshot: async () => {
    const { data, error } = await supabase.rpc("gate_snapshot");
    if (error) throw new Error(error.message);
    return data as GateSnapshot;
  },
  readSchemaFingerprint: async () => {
    const { data, error } = await supabase.rpc("gate_schema_fingerprint");
    if (error) throw new Error(error.message);
    return data as SchemaFingerprint;
  },
  schemaBaseline: JSON.parse(readFileSync(join(process.cwd(), "supabase", "schema-fingerprint.json"), "utf8")) as SchemaBaseline,
  repoMigrationFiles: readdirSync(join(process.cwd(), "supabase", "migrations")),
  reference: referenceBaseUrl && referenceCronSecret ? { baseUrl: referenceBaseUrl, cronSecret: referenceCronSecret } : undefined,
  workerUrl: optional("GATE_WORKER_URL"),
  verifyTokens: {
    WHATSAPP: optional("GATE_VERIFY_TOKEN_WHATSAPP"),
    MESSENGER: optional("GATE_VERIFY_TOKEN_MESSENGER"),
    INSTAGRAM: optional("GATE_VERIFY_TOKEN_INSTAGRAM"),
  },
  vercel: vercelToken && vercelProject ? { token: vercelToken, projectId: vercelProject, teamId: optional("GATE_VERCEL_TEAM") } : undefined,
};

async function main() {
  const at = new Date();
  const results = await runGate(context);
  const report = renderMarkdown(results, { target: baseUrl, environment: expectedEnvironment as string, at });
  console.log(report);
  const reportPath = optional("GATE_REPORT_PATH");
  if (reportPath) writeFileSync(reportPath, report, "utf8");
  process.exit(summarize(results).exitCode);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
