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
    return { error: message || "You do not have permission to do that." };
  }

  // `raise exception '...'` with no errcode: written for people on purpose.
  if (error.code === "P0001" && message) {
    return { error: message };
  }

  console.error(`[packages] unexpected database error (${error.code ?? "no code"}): ${message}`);
  return { error: GENERIC_FAILURE };
}
