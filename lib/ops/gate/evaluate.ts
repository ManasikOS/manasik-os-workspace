import type { GateCheckResult, GateConfigReport, GateEnvironment, GateSnapshot, SchemaBaseline, SchemaFingerprint } from "./types";

/**
 * Buckets every environment must have, all private: the ones the migrations create and the application uses (proved by a clean rebuild from the
 * repository, TASK-032 S5). `whatsapp-media` is deliberately not listed: no migration creates it and no code uses it; staging has an empty one.
 */
export const REQUIRED_BUCKETS = [
  "agency-assets",
  "content-vault",
  "inbox-attachments",
  "knowledge-base",
  "payment-proofs",
  "pilgrim-documents",
  "supplier-evidence",
] as const;

/** How recently the Inbox health check must have succeeded. It runs every five minutes, so ten is two missed runs. */
export const INBOX_HEALTH_MAX_AGE_MINUTES = 10;

/** Shared across staging and production on purpose: one Sentry project, told apart by its environment tag. */
const MAY_MATCH_REFERENCE = new Set(["SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN"]);

const SHOW_AT_MOST = 15;

function names(list: string[]): string[] {
  const shown = list.slice(0, SHOW_AT_MOST);
  return list.length > SHOW_AT_MOST ? [...shown, `…and ${list.length - SHOW_AT_MOST} more`] : shown;
}

/** `20270102090000_agencies_is_test.sql` becomes `agencies_is_test`: the gate compares migrations by NAME, because version stamps differ between environments. */
export function migrationNamesFromFiles(files: string[]): string[] {
  return [...new Set(files.filter((file) => file.endsWith(".sql")).map((file) => file.replace(/\.sql$/, "").replace(/^\d+_/, "")))].sort();
}

export function checkMigrations(repoFiles: string[], snapshot: GateSnapshot): GateCheckResult {
  const repo = new Set(migrationNamesFromFiles(repoFiles));
  const applied = new Set(snapshot.migrations);
  const missing = [...repo].filter((name) => !applied.has(name)).sort();
  const extra = [...applied].filter((name) => !repo.has(name)).sort();
  if (missing.length === 0 && extra.length === 0) {
    return { id: "G2", title: "Migrations", status: "PASS", detail: `All ${repo.size} migrations in the repository are applied, and nothing else is.` };
  }
  return {
    id: "G2",
    title: "Migrations",
    status: "FAIL",
    detail: `${missing.length} in the repository but not applied; ${extra.length} applied but not in the repository.`,
    items: [...names(missing).map((name) => `not applied: ${name}`), ...names(extra).map((name) => `not in repository: ${name}`)],
  };
}

/**
 * G15. The database must BE what the repository's migrations build, not merely list their names (G2 cannot tell the difference: staging passed it
 * while missing two protections and fifteen tables' tenant-uniqueness). Each public-schema object's hash is compared with the committed baseline
 * (the fingerprint of a clean rebuild). Anything missing, extra or different fails, and is named.
 */
export function checkSchemaFingerprint(baseline: SchemaBaseline, live: SchemaFingerprint, repoFiles: string[]): GateCheckResult {
  const sqlFiles = repoFiles.filter((file) => file.endsWith(".sql")).sort();
  const latest = sqlFiles.length > 0 ? sqlFiles[sqlFiles.length - 1].replace(/\.sql$/, "") : "";
  if (baseline.migrationCount !== sqlFiles.length || baseline.lastMigration !== latest) {
    return {
      id: "G15",
      title: "Schema matches the repository",
      status: "FAIL",
      detail: "The baseline does not describe the current migrations, so nothing can be judged against it.",
      items: [`baseline: ${baseline.migrationCount} migrations, last ${baseline.lastMigration}`, `repository: ${sqlFiles.length} migrations, last ${latest}`, "regenerate it: bash scripts/local/write-schema-fingerprint.sh"],
    };
  }

  const missing: string[] = [];
  const different: string[] = [];
  const extra: string[] = [];
  for (const [key, hash] of Object.entries(baseline.objects)) {
    if (!(key in live.objects)) missing.push(key);
    else if (live.objects[key] !== hash) different.push(key);
  }
  for (const key of Object.keys(live.objects)) if (!(key in baseline.objects)) extra.push(key);

  const total = Object.keys(baseline.objects).length;
  if (missing.length + different.length + extra.length === 0) {
    return { id: "G15", title: "Schema matches the repository", status: "PASS", detail: `All ${total} schema objects (columns, constraints, indexes, triggers, policies, grants, functions, views) match a clean build of the repository.` };
  }
  return {
    id: "G15",
    title: "Schema matches the repository",
    status: "FAIL",
    detail: `${different.length} differ, ${missing.length} missing, ${extra.length} not in the repository, of ${total} objects.`,
    items: [
      ...names(different.sort().map((key) => `differs: ${key}`)),
      ...names(missing.sort().map((key) => `missing: ${key}`)),
      ...names(extra.sort().map((key) => `not in the repository: ${key}`)),
    ],
  };
}

export function checkIsolation(snapshot: GateSnapshot): GateCheckResult {
  const findings: string[] = [
    ...snapshot.tenant_tables_without_rls.map((table) => `tenant table without row-level security: ${table}`),
    ...snapshot.server_only_tables_with_client_privilege.map((table) => `server-only table with a client privilege: ${table}`),
    ...snapshot.unconditional_policies.map((policy) => `unconditional policy: ${policy}`),
    ...snapshot.storage_policies_without_agency_check.map((policy) => `storage policy without an agency check: ${policy}`),
    ...snapshot.anon_executable_definer_functions.map((fn) => `security-definer function callable by anonymous users: ${fn}`),
  ];
  return findings.length === 0
    ? { id: "G3", title: "Tenant isolation", status: "PASS", detail: "The isolation audit finds nothing: row-level security everywhere, no always-true policy, no exposed server-only table, tenant storage policies scoped, no anonymous definer function." }
    : { id: "G3", title: "Tenant isolation", status: "FAIL", detail: `${findings.length} isolation finding(s).`, items: names(findings) };
}

export function checkCron(snapshot: GateSnapshot, now: Date): GateCheckResult {
  const bad = snapshot.cron.filter((job) => job.state !== "OK" && job.state !== "PAUSED");
  const problems = bad.map((job) => `${job.jobname}: ${job.state}${job.reason ? ` (${job.reason})` : ""}`);
  const last = snapshot.inbox_health_last_success_at ? Date.parse(snapshot.inbox_health_last_success_at) : Number.NaN;
  if (!Number.isFinite(last)) problems.push("inbox-health has never succeeded");
  else if (now.getTime() - last > INBOX_HEALTH_MAX_AGE_MINUTES * 60_000) problems.push(`inbox-health last succeeded ${Math.round((now.getTime() - last) / 60_000)} minutes ago (limit ${INBOX_HEALTH_MAX_AGE_MINUTES})`);
  if (snapshot.cron.length === 0) problems.push("no scheduled jobs exist");
  return problems.length === 0
    ? { id: "G4", title: "Scheduled jobs", status: "PASS", detail: `${snapshot.cron.length} scheduled jobs, none failing or stale; inbox-health succeeded within ${INBOX_HEALTH_MAX_AGE_MINUTES} minutes.` }
    : { id: "G4", title: "Scheduled jobs", status: "FAIL", detail: `${problems.length} scheduled-job problem(s).`, items: names(problems) };
}

export function checkStorage(snapshot: GateSnapshot): GateCheckResult {
  const present = new Map(snapshot.buckets.map((bucket) => [bucket.id, bucket.public]));
  const problems = [
    ...REQUIRED_BUCKETS.filter((id) => !present.has(id)).map((id) => `missing bucket: ${id}`),
    ...snapshot.buckets.filter((bucket) => bucket.public).map((bucket) => `public bucket: ${bucket.id}`),
  ];
  return problems.length === 0
    ? { id: "G5", title: "Storage", status: "PASS", detail: `All ${REQUIRED_BUCKETS.length} required buckets exist and every bucket is private.` }
    : { id: "G5", title: "Storage", status: "FAIL", detail: `${problems.length} storage problem(s).`, items: names(problems) };
}

/**
 * G6. The deployment must say it is the environment expected, report no missing setting and no test-only setting, and (for production)
 * share no secret or identifier with the reference environment. Fingerprints are compared, never values.
 */
export function checkConfig(config: GateConfigReport, expected: GateEnvironment, reference?: GateConfigReport): GateCheckResult {
  const problems: string[] = [];
  if (config.environment !== expected) problems.push(`environment is "${config.environment}", expected "${expected}"`);
  problems.push(...config.problems);

  const shared: string[] = [];
  if (reference) {
    const referenceFingerprints = new Map(reference.variables.filter((v) => v.fingerprint).map((v) => [v.name, v.fingerprint]));
    for (const variable of config.variables) {
      if (variable.kind === "config" || !variable.fingerprint || MAY_MATCH_REFERENCE.has(variable.name)) continue;
      if (referenceFingerprints.get(variable.name) === variable.fingerprint) shared.push(variable.name);
    }
    problems.push(...shared.map((name) => `${name} has the same value as the reference environment`));
  }

  if (problems.length > 0) return { id: "G6", title: "Configuration", status: "FAIL", detail: `${problems.length} configuration problem(s).`, items: names([...new Set(problems)]) };
  if (expected === "production" && !reference) {
    return { id: "G6", title: "Configuration", status: "PENDING", detail: "Production configuration is complete, but it was not compared with staging: set GATE_REFERENCE_BASE_URL and GATE_REFERENCE_CRON_SECRET to prove no secret is shared." };
  }
  return { id: "G6", title: "Configuration", status: "PASS", detail: `Configuration is complete for ${expected}${reference ? " and shares no secret or identifier with the reference environment" : ""}.` };
}

/** Combines sub-checks: any FAIL fails, otherwise any PENDING is pending, otherwise pass. */
export function combine(id: string, title: string, parts: GateCheckResult[], passDetail: string): GateCheckResult {
  const failed = parts.filter((part) => part.status === "FAIL");
  const pending = parts.filter((part) => part.status === "PENDING");
  const lines = (list: GateCheckResult[]) => list.map((part) => `${part.title}: ${part.detail}`);
  if (failed.length > 0) return { id, title, status: "FAIL", detail: `${failed.length} of ${parts.length} part(s) failed.`, items: lines(failed) };
  if (pending.length > 0) return { id, title, status: "PENDING", detail: `${pending.length} of ${parts.length} part(s) are still pending.`, items: lines(pending) };
  return { id, title, status: "PASS", detail: passDetail };
}
