/**
 * The production go-live gate (TASK-032 S7). Every check answers PASS, FAIL or PENDING:
 *  - PASS: the thing was checked and is as it should be.
 *  - FAIL: the thing was checked and is wrong, or could not be checked because something that should work did not.
 *  - PENDING: the thing cannot be judged yet because something outside the code has not happened (a worker not deployed, a Meta approval,
 *    a credential not supplied). It is never a pass: the gate only reports success when nothing is PENDING.
 *
 * Details carry names, counts and states only. No secret, no customer data and no configuration value other than the environment name.
 */

export type GateStatus = "PASS" | "FAIL" | "PENDING";

export interface GateCheckResult {
  id: string;
  title: string;
  status: GateStatus;
  detail: string;
  /** Short lines naming exactly what was found (table names, migration names, job names). */
  items?: string[];
}

/** What `public.gate_snapshot()` returns: facts read from the database catalogues. Names and counts only. */
export interface GateSnapshot {
  generated_at: string;
  migrations: string[];
  tenant_tables_without_rls: string[];
  server_only_tables_with_client_privilege: string[];
  unconditional_policies: string[];
  buckets: Array<{ id: string; public: boolean }>;
  storage_policies_without_agency_check: string[];
  anon_executable_definer_functions: string[];
  cron: Array<{ jobname: string; state: string; reason: string | null; last_success_at: string | null }>;
  inbox_health_last_success_at: string | null;
}

/** What `GET /api/health/config` returns (see lib/ops/required-env.ts). */
export interface GateConfigReport {
  build?: string;
  environment: "production" | "staging" | "other" | "unset";
  ready: boolean;
  problems: string[];
  forbiddenPresent: string[];
  variables: Array<{ name: string; kind: "secret" | "identifier" | "config"; requirement: string; present: boolean; fingerprint?: string; value?: string }>;
}

/** What `public.gate_schema_fingerprint()` returns: one short hash per public-schema object. Names and hashes only. */
export interface SchemaFingerprint {
  objects: Record<string, string>;
}

/** supabase/schema-fingerprint.json: the fingerprint of a database built from the repository's migrations. */
export interface SchemaBaseline extends SchemaFingerprint {
  lastMigration: string;
  migrationCount: number;
}

export type GateEnvironment = "production" | "staging";

export type VerifyTokenChannel = "WHATSAPP" | "MESSENGER" | "INSTAGRAM";

export interface GateContext {
  /** The deployment being judged, for example https://workspace.example.com. */
  baseUrl: string;
  expectedEnvironment: GateEnvironment;
  /** The commit that should be live. Without it the build id is reported but not compared. */
  expectedCommit?: string;
  cronSecret?: string;
  readSnapshot: () => Promise<GateSnapshot>;
  /** The live schema fingerprint and the repository baseline it is judged against (G15). Without both, G15 stays pending. */
  readSchemaFingerprint?: () => Promise<SchemaFingerprint>;
  schemaBaseline?: SchemaBaseline;
  /** File names from supabase/migrations. */
  repoMigrationFiles: string[];
  /** Another environment to compare secrets against (production against staging). */
  reference?: { baseUrl: string; cronSecret: string };
  workerUrl?: string;
  verifyTokens: Partial<Record<VerifyTokenChannel, string>>;
  vercel?: { token: string; projectId: string; teamId?: string };
  fetchImpl?: typeof fetch;
  now?: Date;
}
