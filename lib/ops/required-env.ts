import "server-only";

import { createHmac } from "node:crypto";

/**
 * The environment variables a deployment must (and must not) have, and a check of them that never reveals a value (TASK-032 S2). The go-live
 * gate reads the result through `GET /api/health/config`; the same list is the single source for "what does production need".
 *
 * How a variable is reported:
 *  - `secret` and `identifier`: only whether it is set, plus a short fingerprint. The fingerprint lets two environments be compared (production
 *    must NOT share a secret, a Supabase project or a Meta app with staging) without either value leaving the process.
 *  - `config`: a non-secret setting (an environment name, a version, a flag). The value itself is reported, because "is this production?" has
 *    to be answered with the actual word.
 */

export type EnvKind = "secret" | "identifier" | "config";

/** `always`: needed everywhere. `deployed`: needed in staging and production. `optional`: reported, never required. */
export type EnvRequirement = "always" | "deployed" | "optional";

export interface EnvSpec {
  name: string;
  kind: EnvKind;
  requirement: EnvRequirement;
  /** Why it matters, in a few words. Shown nowhere user-facing; keeps the list honest. */
  note: string;
}

export const ENV_SPECS: readonly EnvSpec[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", kind: "identifier", requirement: "always", note: "the Supabase project the app talks to" },
  { name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", kind: "identifier", requirement: "always", note: "the browser key for that project" },
  { name: "SUPABASE_SECRET_KEY", kind: "secret", requirement: "always", note: "the service-role key; webhooks, cron routes and the worker use it" },
  { name: "CRON_SECRET", kind: "secret", requirement: "always", note: "bearer secret every cron and gate route requires" },
  { name: "NEXT_PUBLIC_SITE_URL", kind: "identifier", requirement: "deployed", note: "origin used in auth emails and links" },
  { name: "SENTRY_DSN", kind: "identifier", requirement: "deployed", note: "where server errors are sent" },
  { name: "NEXT_PUBLIC_SENTRY_DSN", kind: "identifier", requirement: "deployed", note: "where browser errors are sent" },
  { name: "SENTRY_ENVIRONMENT", kind: "config", requirement: "deployed", note: "names the environment: staging or production" },
  { name: "META_APP_ID", kind: "identifier", requirement: "deployed", note: "our Meta app" },
  { name: "META_APP_SECRET", kind: "secret", requirement: "deployed", note: "verifies Meta webhook signatures" },
  { name: "META_GRAPH_VERSION", kind: "config", requirement: "deployed", note: "the Graph API version every Meta call uses" },
  { name: "WHATSAPP_VERIFY_TOKEN", kind: "secret", requirement: "deployed", note: "WhatsApp webhook subscription handshake" },
  { name: "MESSENGER_VERIFY_TOKEN", kind: "secret", requirement: "deployed", note: "Messenger webhook subscription handshake" },
  { name: "OPENROUTER_API_KEY", kind: "secret", requirement: "deployed", note: "all AI features; needs its own spend cap per environment" },
  { name: "INSTAGRAM_APP_ID", kind: "identifier", requirement: "optional", note: "Instagram Login app" },
  { name: "INSTAGRAM_APP_SECRET", kind: "secret", requirement: "optional", note: "Instagram Login app secret" },
  { name: "INSTAGRAM_VERIFY_TOKEN", kind: "secret", requirement: "optional", note: "falls back to the Messenger token" },
  { name: "INBOX_WORKER_ACTIVE", kind: "config", requirement: "optional", note: "1 once an always-on worker is running" },
  { name: "SIGNUP_MODE", kind: "config", requirement: "optional", note: "invite_only (default) or open" },
  { name: "INBOX_OUTBOUND_ALLOWLIST", kind: "secret", requirement: "optional", note: "outside production, the only contacts the app may message; empty means nobody, * means everyone; contains phone numbers, so it is fingerprinted, never shown" },
  { name: "SENTRY_TRACES_SAMPLE_RATE", kind: "config", requirement: "optional", note: "trace sampling, 0 to 1" },
];

/** Test-only settings. Their presence in a deployed environment means a test credential or a test target is live there. */
export const FORBIDDEN_IN_DEPLOYED_ENV: readonly string[] = [
  "LOAD_TEST_ENVIRONMENT",
  "LOAD_TEST_PROJECT_REF",
  "LOAD_TEST_PRODUCTION_PROJECT_REF",
  "LOAD_TEST_DISPOSABLE_CONFIRMATION",
  "INBOX_E2E_ENVIRONMENT",
  "INBOX_E2E_BASE_URL",
  "INBOX_E2E_PROJECT_REF",
  "INBOX_E2E_PRODUCTION_PROJECT_REF",
  "INBOX_E2E_A1_PASSWORD",
  "INBOX_E2E_A2_PASSWORD",
  "INBOX_E2E_A_READONLY_PASSWORD",
  "INBOX_E2E_B1_PASSWORD",
];

/** Settings that only make sense outside production. Present in production they are a mistake, because the code ignores them there. */
export const FORBIDDEN_IN_PRODUCTION_ENV: readonly string[] = ["INBOX_OUTBOUND_ALLOWLIST"];

export type EnvironmentName = "production" | "staging" | "other" | "unset";

export interface EnvReportVariable {
  name: string;
  kind: EnvKind;
  requirement: EnvRequirement;
  present: boolean;
  /** First 8 hex characters of a keyed hash of the value. Secrets and identifiers only; never the value. */
  fingerprint?: string;
  /** Config settings only. */
  value?: string;
}

export interface EnvReport {
  environment: EnvironmentName;
  ready: boolean;
  problems: string[];
  variables: EnvReportVariable[];
  /** Names (never values) of test-only settings that are set. */
  forbiddenPresent: string[];
}

const FINGERPRINT_KEY = "inbox-env-fingerprint-v1";

/** Same input, same answer, in every environment, so two environments can be compared; short enough to be useless for guessing a strong secret. */
export function fingerprintEnvValue(value: string): string {
  return createHmac("sha256", FINGERPRINT_KEY).update(value, "utf8").digest("hex").slice(0, 8);
}

function readValue(env: Record<string, string | undefined>, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

export function environmentNameOf(env: Record<string, string | undefined>): EnvironmentName {
  const raw = readValue(env, "SENTRY_ENVIRONMENT")?.toLowerCase();
  if (!raw) return "unset";
  return raw === "production" || raw === "staging" ? raw : "other";
}

export function evaluateEnvironment(env: Record<string, string | undefined>): EnvReport {
  const environment = environmentNameOf(env);
  const deployed = environment === "production" || environment === "staging";
  const problems: string[] = [];

  const variables = ENV_SPECS.map((spec): EnvReportVariable => {
    const value = readValue(env, spec.name);
    const base = { name: spec.name, kind: spec.kind, requirement: spec.requirement, present: value !== null };
    if (value === null) return base;
    return spec.kind === "config" ? { ...base, value } : { ...base, fingerprint: fingerprintEnvValue(value) };
  });

  for (const variable of variables) {
    if (variable.present) continue;
    if (variable.requirement === "always" || (variable.requirement === "deployed" && deployed)) problems.push(`${variable.name} is not set.`);
  }
  if (environment === "unset") problems.push("SENTRY_ENVIRONMENT is not set, so this environment cannot be told apart from another.");
  if (environment === "other") problems.push("SENTRY_ENVIRONMENT is neither staging nor production.");

  const forbiddenPresent = deployed ? FORBIDDEN_IN_DEPLOYED_ENV.filter((name) => readValue(env, name) !== null) : [];
  for (const name of forbiddenPresent) problems.push(`${name} is a test-only setting and must not be set in a deployed environment.`);
  if (environment === "production") {
    for (const name of FORBIDDEN_IN_PRODUCTION_ENV.filter((forbidden) => readValue(env, forbidden) !== null)) {
      forbiddenPresent.push(name);
      problems.push(`${name} is ignored in production and must not be set there.`);
    }
  }

  return { environment, ready: problems.length === 0, problems, variables, forbiddenPresent };
}
