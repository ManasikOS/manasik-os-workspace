import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { DISPOSABLE_AGENCY_SLUG_PREFIX, type DisposableAgencyPort } from "../../lib/ops/gate/disposable-agency";
import { renderMarkdown, summarize } from "../../lib/ops/gate/report";
import { runGate } from "../../lib/ops/gate/run-gate";
import type { GateContext, GateEnvironment, GateSnapshot, SchemaBaseline, SchemaFingerprint } from "../../lib/ops/gate/types";

/**
 * `npm run verify:production`: the production go-live gate (TASK-032 S7). Judges one deployment and prints PASS, FAIL or PENDING for each check.
 * Exit code 0 means everything passed, 2 means nothing is broken but something is still pending, 1 means a check failed.
 *
 * It reads only GATE_* variables (never the app's own NEXT_PUBLIC_* ones), so it cannot silently judge whichever environment `.env.local`
 * happens to point at. Put them in `.env.gate` (ignored by git) or the environment; see `.env.gate.example`. It changes nothing except G9, which
 * creates one disposable test agency (`is_test`, slug `e2e-gate-…`), sends it a signed simulator webhook, removes it, and proves nothing is left;
 * and the optional report file.
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

/** G9's database access: the service-role client, limited to the disposable gate agency. The removal itself is a database function that refuses any other agency. */
const disposableAgency: DisposableAgencyPort = {
  async create({ slug, name, phoneNumberId }) {
    const agency = await supabase.from("agencies").insert({ name, slug, is_test: true }).select("id").single();
    if (agency.error) throw new Error(`agency: ${agency.error.message}`);
    const agencyId = agency.data.id as string;
    const integration = await supabase
      .from("whatsapp_integrations")
      .insert({ agency_id: agencyId, phone_number_id: phoneNumberId, display_phone_number: "15550000099", business_name: "Gate acceptance (simulated)", credential_ref: "simulator-no-secret", status: "CONNECTED", funding_status: "FUNDED" })
      .select("id")
      .single();
    if (integration.error) throw new Error(`integration: ${integration.error.message}`);
    const connection = await supabase
      .from("channel_connections")
      .insert({ agency_id: agencyId, provider: "WHATSAPP", provider_account_id: phoneNumberId, display_name: "Gate acceptance (simulated)", status: "CONNECTED", legacy_whatsapp_integration_id: integration.data.id as string });
    if (connection.error) throw new Error(`connection: ${connection.error.message}`);
    return { agencyId };
  },
  async countInbound(agencyId) {
    const count = async (table: string, narrow?: (query: ReturnType<typeof supabase.from>) => unknown) => {
      let query = supabase.from(table).select("id", { count: "exact", head: true }).eq("agency_id", agencyId);
      if (narrow) query = narrow(query as never) as typeof query;
      const { count: rows, error } = await query;
      if (error) throw new Error(`${table}: ${error.message}`);
      return rows ?? 0;
    };
    return {
      events: await count("whatsapp_webhook_events"),
      conversations: await count("conversations"),
      customerMessages: await count("conversation_messages", (query) => (query as unknown as { eq: (column: string, value: string) => unknown }).eq("role", "user")),
    };
  },
  async remove(agencyId) {
    const { error } = await supabase.rpc("gate_delete_disposable_agency", { p_agency_id: agencyId });
    if (error) throw new Error(error.message);
  },
  async leftovers(agencyId) {
    const { data, error } = await supabase.rpc("gate_disposable_agency_leftovers", { p_agency_id: agencyId });
    if (error) throw new Error(error.message);
    return (data as Array<{ table: string; rows: number }> | null) ?? [];
  },
  async findStale(olderThan) {
    const { data, error } = await supabase.from("agencies").select("id").eq("is_test", true).like("slug", `${DISPOSABLE_AGENCY_SLUG_PREFIX}%`).lt("created_at", olderThan.toISOString());
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.id as string);
  },
};

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
  metaAppSecret: optional("GATE_META_APP_SECRET"),
  disposableAgency,
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
