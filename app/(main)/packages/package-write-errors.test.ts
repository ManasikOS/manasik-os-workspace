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

  it("logs and hides an unexpected error", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = describePackageWriteFailure({ code: "XX000", message: 'relation "packages" is on fire' });
    expect(result.error).toBe("This package could not be saved. Please try again.");
    expect(log).toHaveBeenCalledOnce();
  });
});
