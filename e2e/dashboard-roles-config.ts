/**
 * Environment for the Dashboard role-matrix browser spec
 * (`e2e/dashboard-roles.spec.ts`, docs/runbooks/dashboard-roles-e2e.md).
 *
 * Same safety posture as the Inbox LR2 and Packages P0 runs: it will only
 * target a *named, non-production* project, and refuses to start otherwise.
 * It is a plain function over an env-shaped object so the guard can be unit
 * tested without a browser.
 */

export const DASHBOARD_E2E_ROLES = ["ADMIN", "CEO", "FINANCE", "MARKETING", "OPERATIONS", "VISA", "GUIDE"] as const;
export type DashboardE2eRole = (typeof DASHBOARD_E2E_ROLES)[number];

/**
 * Production project refs this run refuses, whatever the variables say.
 * Mirrors `KNOWN_PRODUCTION_PROJECT_REFS` in
 * `scripts/e2e/packages-p0-fixtures-config.ts` (a unit test pins them equal).
 */
export const KNOWN_PRODUCTION_PROJECT_REFS = ["bidmihfsljrurlnraqmf"] as const;

export interface DashboardE2eCredentials {
  email: string;
  password: string;
}

export interface DashboardE2eEnvironment {
  environment: "staging" | "disposable";
  baseUrl: string;
  projectRef: string;
  staff: Record<DashboardE2eRole, DashboardE2eCredentials>;
}

type Values = Record<string, string | undefined>;

const GLOBAL_KEYS = [
  "DASHBOARD_E2E_ENVIRONMENT",
  "DASHBOARD_E2E_BASE_URL",
  "DASHBOARD_E2E_PROJECT_REF",
  "DASHBOARD_E2E_PRODUCTION_PROJECT_REF",
] as const;

export function parseDashboardE2eEnvironment(values: Values = process.env): DashboardE2eEnvironment {
  const roleKeys = DASHBOARD_E2E_ROLES.flatMap((role) => [`DASHBOARD_E2E_${role}_EMAIL`, `DASHBOARD_E2E_${role}_PASSWORD`]);
  const missing = [...GLOBAL_KEYS, ...roleKeys].filter((key) => !values[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required dashboard e2e environment variables: ${missing.join(", ")}.`);
  }
  const need = (key: string) => (values[key] as string).trim();

  const environment = need("DASHBOARD_E2E_ENVIRONMENT");
  if (environment !== "staging" && environment !== "disposable") {
    throw new Error("DASHBOARD_E2E_ENVIRONMENT must be staging or disposable; production is never a valid dashboard e2e target.");
  }

  let parsed: URL;
  try {
    parsed = new URL(need("DASHBOARD_E2E_BASE_URL"));
  } catch {
    throw new Error("DASHBOARD_E2E_BASE_URL must be an absolute http(s) URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("DASHBOARD_E2E_BASE_URL must be an absolute http(s) URL.");
  }

  const projectRef = need("DASHBOARD_E2E_PROJECT_REF");
  if (projectRef === need("DASHBOARD_E2E_PRODUCTION_PROJECT_REF")) {
    throw new Error("DASHBOARD_E2E_PROJECT_REF must not match DASHBOARD_E2E_PRODUCTION_PROJECT_REF.");
  }
  if ((KNOWN_PRODUCTION_PROJECT_REFS as readonly string[]).includes(projectRef)) {
    throw new Error("DASHBOARD_E2E_PROJECT_REF is a known production project; refusing to run.");
  }

  const staff = Object.fromEntries(
    DASHBOARD_E2E_ROLES.map((role) => [
      role,
      { email: need(`DASHBOARD_E2E_${role}_EMAIL`), password: need(`DASHBOARD_E2E_${role}_PASSWORD`) },
    ]),
  ) as Record<DashboardE2eRole, DashboardE2eCredentials>;

  return { environment, baseUrl: parsed.origin, projectRef, staff };
}
