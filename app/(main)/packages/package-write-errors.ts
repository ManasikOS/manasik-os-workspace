/**
 * Turns a database error raised while writing a package into a message a
 * person in the agency can act on (TASK-041).
 *
 * Postgres errors name constraints and tables ("duplicate key value violates
 * unique constraint ..."), which tells a sales user nothing. Constraint
 * violations (SQLSTATE class 23) and row-level-security refusals are
 * translated here; messages the database functions and triggers raise on
 * purpose (`raise exception '...'`, SQLSTATE P0001 or 42501) are already
 * written for people and pass through unchanged. Anything else is logged for
 * the developers and replaced by a generic line.
 *
 * Deliberately not part of `actions.ts`: a `"use server"` file may only
 * export async functions.
 */

export type PackageWriteError = { code?: string; message: string };

export type PackageWriteFailure = {
  error: string;
  /** 1-based wizard step the problem belongs to, so the wizard can jump to it. */
  step?: number;
};

/** Wizard step that holds the field behind each check constraint, with the label shown to the user. */
const CHECK_CONSTRAINT_FIELDS: Record<string, { label: string; step: number }> = {
  packages_category_check: { label: "Package category", step: 1 },
  packages_journey_type_check: { label: "Journey type", step: 1 },
  packages_package_category_check: { label: "Package class", step: 1 },
  packages_visibility_check: { label: "Visibility", step: 1 },
  packages_status_check: { label: "Status", step: 1 },
  packages_min_group_size_check: { label: "Minimum group size", step: 1 },
  packages_default_capacity_check: { label: "Default capacity", step: 1 },
  packages_max_pilgrims_check: { label: "Maximum pilgrims", step: 1 },
  packages_suggested_guide_ratio_check: { label: "Suggested guide ratio", step: 1 },
  packages_default_group_capacity_check: { label: "Default group capacity", step: 6 },
  packages_days_check: { label: "Number of days", step: 3 },
  packages_nights_check: { label: "Number of nights", step: 3 },
  packages_makkah_nights_check: { label: "Makkah nights", step: 3 },
  packages_madinah_nights_check: { label: "Madinah nights", step: 3 },
};

const GENERIC_FAILURE = "This package could not be saved. Please try again.";

/**
 * Messages the package functions and triggers raise on purpose, written for
 * people. Only these are shown as they are: Postgres raises the same SQLSTATEs
 * (22023, P0002, 28000, 42501) for its own internal errors, whose wording must
 * never reach the screen.
 */
const SAFE_DATABASE_MESSAGES: RegExp[] = [
  /^That package no longer exists.$/,
  /^Your session has no active agency.$/,
  /^Your role cannot [a-z ]+.$/,
  /^Only an administrator can archive a package that still has live departure groups.$/,
  /^A reason is required to archive a package that still has live departure groups.$/,
  /^This package has d+ live departure group(s)./,
  /^This package is .+ (?:— that is not a valid starting point for this action|and cannot be published from here).$/,
  /^The package content (?:is missing|has fields that cannot be published).$/,
  /^MARKETING may only change a package's featured flag, not its other fields.$/,
  /^A package is created as a Draft. Publish it through the publish action.$/,
  /^A package's status can only change through the publish, close sales, reopen, archive and restore actions.$/,
  // TASK-043 change requests and the live-terms guard.
  /^Changes to payment or booking terms on a package that is on sale must go through the review.$/,
  /^An archived package cannot be edited. Restore it first.$/,
  /^A reason is required for changes to payment or booking terms.$/,
  /^Another change is already waiting for approval for this package.$/,
  /^The time you last loaded this package is missing.$/,
  /^That change request no longer exists.$/,
  /^This change is no longer waiting for approval.$/,
  /^You cannot approve your own change.$/,
  /^This package changed since the request was made. Ask for the change to be submitted again.$/,
  /^The decision is missing.$/,
  /^The note is too long.$/,
  /^A note is required when a change is rejected.$/,
  // TASK-043 controlled delete.
  /^A reason is required to delete a package.$/,
  /^The confirmation text does not match the package code.$/,
  /^This package cannot be deleted — .+$/,
  /^This package is .+ — a package must be archived before it can be deleted.$/,
];

function isSafeDatabaseMessage(message: string): boolean {
  return SAFE_DATABASE_MESSAGES.some((pattern) => pattern.test(message));
}

/**
 * @param error the Postgres/PostgREST error object.
 * @param context.internalCode the code the user typed, so the message can name it.
 */
export function describePackageWriteFailure(
  error: PackageWriteError,
  context: { internalCode?: string } = {},
): PackageWriteFailure {
  const message = error.message ?? "";

  if (error.code === "23505") {
    if (message.includes("packages_internal_code_agency_unique")) {
      const code = context.internalCode?.trim();
      return {
        step: 1,
        error: code
          ? `The package code "${code}" is already used by another package. Choose a different code in step 1 (Commercial Identity).`
          : "That package code is already used by another package. Choose a different code in step 1 (Commercial Identity).",
      };
    }
    return { error: "A package with the same details already exists." };
  }

  if (error.code === "23514") {
    const field = Object.entries(CHECK_CONSTRAINT_FIELDS).find(([name]) => message.includes(name));
    if (field) {
      return {
        step: field[1].step,
        error: `${field[1].label} has a value that is not allowed. Check it and try again.`,
      };
    }
    return { error: "One of the values is outside what is allowed. Review the form and try again." };
  }

  if (error.code === "23502") {
    return { error: "A required field is missing. Review the form and try again." };
  }

  if (error.code === "23503") {
    return { error: "Another record still refers to this package, so the change was not made." };
  }

  if (error.code === "42501") {
    if (/row-level security/i.test(message)) {
      return { error: "You do not have permission to do that." };
    }
    return { error: isSafeDatabaseMessage(message) ? message : "You do not have permission to do that." };
  }

  // Raised on purpose by the lifecycle functions: invalid starting state,
  // missing package, no active agency, empty or unsupported content.
  if ((error.code === "22023" || error.code === "P0002" || error.code === "28000") && isSafeDatabaseMessage(message)) {
    return { error: message };
  }

  // `raise exception '...'` with no errcode: written for people on purpose.
  if (error.code === "P0001" && message) {
    return { error: message };
  }

  console.error(`[packages] unexpected database error (${error.code ?? "no code"}): ${message}`);
  return { error: GENERIC_FAILURE };
}
