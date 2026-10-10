import { afterEach, describe, expect, it, vi } from "vitest";

import { describePackageWriteFailure } from "./package-write-errors";

afterEach(() => vi.restoreAllMocks());

describe("describePackageWriteFailure", () => {
  it("explains a duplicate package code, names the code and points at step 1", () => {
    const result = describePackageWriteFailure(
      {
        code: "23505",
        message: 'duplicate key value violates unique constraint "packages_internal_code_agency_unique"',
      },
      { internalCode: "  RF-PKG-2026-UM01 " },
    );
    expect(result.step).toBe(1);
    expect(result.error).toContain('"RF-PKG-2026-UM01"');
    expect(result.error).not.toContain("packages_internal_code_agency_unique");
  });

  it("still explains a duplicate code when the code is not known", () => {
    const result = describePackageWriteFailure({
      code: "23505",
      message: 'duplicate key value violates unique constraint "packages_internal_code_agency_unique"',
    });
    expect(result.step).toBe(1);
    expect(result.error).toMatch(/code/i);
  });

  it("does not leak the name of any other unique constraint", () => {
    const result = describePackageWriteFailure({
      code: "23505",
      message: 'duplicate key value violates unique constraint "package_versions_package_id_version_number_key"',
    });
    expect(result.error).not.toContain("package_versions");
    expect(result.step).toBeUndefined();
  });

  it("names the field and wizard step behind a check constraint", () => {
    const result = describePackageWriteFailure({
      code: "23514",
      message: 'new row for relation "packages" violates check constraint "packages_makkah_nights_check"',
    });
    expect(result.error).toContain("Makkah nights");
    expect(result.error).not.toContain("packages_makkah_nights_check");
    expect(result.step).toBe(3);
  });

  it("falls back to a plain line for an unknown check constraint", () => {
    const result = describePackageWriteFailure({ code: "23514", message: 'violates check constraint "packages_future_check"' });
    expect(result.error).not.toContain("packages_future_check");
  });

  it("hides the row-level-security wording but keeps a trigger's own message", () => {
    expect(
      describePackageWriteFailure({ code: "42501", message: 'new row violates row-level security policy for table "packages"' }).error,
    ).toBe("You do not have permission to do that.");
    expect(
      describePackageWriteFailure({ code: "42501", message: "MARKETING may only change a package's featured flag, not its other fields." }).error,
    ).toBe("MARKETING may only change a package's featured flag, not its other fields.");
  });

  it("passes through messages a database function raised on purpose", () => {
    expect(describePackageWriteFailure({ code: "P0001", message: "That package no longer exists." }).error).toBe(
      "That package no longer exists.",
    );
  });

  it("shows the lifecycle functions' own messages for a wrong starting state, a missing package and no agency", () => {
    expect(
      describePackageWriteFailure({
        code: "22023",
        message: "This package is Archived — that is not a valid starting point for this action.",
      }).error,
    ).toBe("This package is Archived — that is not a valid starting point for this action.");
    expect(describePackageWriteFailure({ code: "P0002", message: "That package no longer exists." }).error).toBe(
      "That package no longer exists.",
    );
    expect(describePackageWriteFailure({ code: "28000", message: "Your session has no active agency." }).error).toBe(
      "Your session has no active agency.",
    );
  });

  it("never shows Postgres's own wording for those SQLSTATEs or for a permission error", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(describePackageWriteFailure({ code: "22023", message: 'unrecognized configuration parameter "x"' }).error).toBe(
      "This package could not be saved. Please try again.",
    );
    expect(describePackageWriteFailure({ code: "42501", message: "permission denied for function packages_record_version" }).error).toBe(
      "You do not have permission to do that.",
    );
    expect(log).toHaveBeenCalledOnce();
  });

  it("shows the change-request functions' own messages and hides look-alikes", () => {
    expect(describePackageWriteFailure({ code: "42501", message: "You cannot approve your own change." }).error).toBe("You cannot approve your own change.");
    expect(
      describePackageWriteFailure({ code: "42501", message: "Changes to payment or booking terms on a package that is on sale must go through the review." }).error,
    ).toContain("must go through the review");
    expect(describePackageWriteFailure({ code: "22023", message: "Another change is already waiting for approval for this package." }).error).toBe(
      "Another change is already waiting for approval for this package.",
    );
    expect(describePackageWriteFailure({ code: "42501", message: "You cannot approve your own change. (internal detail)" }).error).toBe(
      "You do not have permission to do that.",
    );
  });

  it("shows the delete function's own messages", () => {
    expect(describePackageWriteFailure({ code: "22023", message: "The confirmation text does not match the package code." }).error).toBe(
      "The confirmation text does not match the package code.",
    );
    expect(
      describePackageWriteFailure({ code: "22023", message: "This package is Open for Sale — a package must be archived before it can be deleted." }).error,
    ).toContain("must be archived");
    expect(
      describePackageWriteFailure({ code: "22023", message: "This package cannot be deleted — departure groups use it. Archive it instead, or move those groups to another package first." }).error,
    ).toContain("departure groups use it");
  });

  it("explains the new guard on creating or changing a package's status directly", () => {
    expect(
      describePackageWriteFailure({
        code: "42501",
        message: "A package's status can only change through the publish, close sales, reopen, archive and restore actions.",
      }).error,
    ).toContain("status can only change");
  });

  it("logs and hides an unexpected error", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = describePackageWriteFailure({ code: "XX000", message: 'relation "packages" is on fire' });
    expect(result.error).toBe("This package could not be saved. Please try again.");
    expect(log).toHaveBeenCalledOnce();
  });
});
