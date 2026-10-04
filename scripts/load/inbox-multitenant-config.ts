import { INBOX_LOAD_PROFILES, type InboxLoadProfile } from "./inbox-load-profiles";

export const inboxLoadTestProfiles = INBOX_LOAD_PROFILES;
export const disposableDatabaseConfirmation = "I_CONFIRM_THIS_DATABASE_CONTAINS_ONLY_DISPOSABLE_TEST_DATA";

export type InboxLoadTestProfile = InboxLoadProfile;

export type InboxLoadTestOptions = {
  execute: boolean;
  seedFixtures: boolean;
  profile: InboxLoadTestProfile;
  /** How long a rate-based profile runs (whole minutes). Unset uses the profile's default. */
  minutes?: number;
  /** Where to write the machine-readable JSON report; unset writes nothing. */
  reportPath?: string;
};

export function parseInboxLoadTestOptions(args: string[]): InboxLoadTestOptions {
  const profileIndex = args.indexOf("--profile");
  const requestedProfile = profileIndex === -1 ? "baseline" : args[profileIndex + 1];

  if (!inboxLoadTestProfiles.includes(requestedProfile as InboxLoadTestProfile)) {
    throw new Error(`Unsupported load-test profile: ${requestedProfile ?? "(missing)"}. Supported: ${inboxLoadTestProfiles.join(", ")}.`);
  }

  const minutesIndex = args.indexOf("--minutes");
  const reportIndex = args.indexOf("--report");
  const minutes = minutesIndex === -1 ? undefined : Number(args[minutesIndex + 1]);
  if (minutesIndex !== -1 && !Number.isInteger(minutes)) throw new Error("--minutes must be a whole number.");
  const reportPath = reportIndex === -1 ? undefined : args[reportIndex + 1];
  if (reportIndex !== -1 && (!reportPath || reportPath.startsWith("--"))) throw new Error("--report needs a file path.");

  return {
    execute: args.includes("--execute"),
    seedFixtures: args.includes("--seed-fixtures"),
    profile: requestedProfile as InboxLoadTestProfile,
    ...(minutes === undefined ? {} : { minutes }),
    ...(reportPath === undefined ? {} : { reportPath }),
  };
}

/** Refuse to write unless the target is isolated staging or explicitly attested as disposable test data. */
export function assertInboxLoadTestStagingTarget(environment: Record<string, string | undefined>): void {
  const projectRef = environment.LOAD_TEST_PROJECT_REF;
  const productionProjectRef = environment.LOAD_TEST_PRODUCTION_PROJECT_REF;
  const environmentKind = environment.LOAD_TEST_ENVIRONMENT;
  if (!projectRef || !productionProjectRef) {
    throw new Error("Refusing load-test execution: target and production project refs must both be set.");
  }
  if (environmentKind === "staging" && projectRef === productionProjectRef) {
    throw new Error("Refusing load-test execution: staging and production project refs must differ.");
  }
  if (environmentKind === "disposable" && environment.LOAD_TEST_DISPOSABLE_CONFIRMATION !== disposableDatabaseConfirmation) {
    throw new Error("Refusing load-test execution: disposable targets require the exact disposable-data confirmation.");
  }
  if (environmentKind !== "staging" && environmentKind !== "disposable") {
    throw new Error("Refusing load-test execution: set LOAD_TEST_ENVIRONMENT=staging or disposable.");
  }

  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !new URL(url).hostname.startsWith(`${projectRef}.`)) {
    throw new Error("Refusing load-test execution: NEXT_PUBLIC_SUPABASE_URL does not match LOAD_TEST_PROJECT_REF.");
  }
}
