import { describe, expect, it } from "vitest";

import { isUuid } from "./utils";

describe("isUuid", () => {
  it("accepts a well-formed v4 UUID", () => {
    expect(isUuid("3fa85f64-5717-4562-b3fc-2c963f66afa6")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isUuid("3FA85F64-5717-4562-B3FC-2C963F66AFA6")).toBe(true);
  });

  it("rejects malformed route params instead of letting them reach a query", () => {
    expect(isUuid("not-a-real-id")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("3fa85f64-5717-4562-b3fc-2c963f66afa")).toBe(false); // too short
    expect(isUuid("3fa85f64-5717-4562-b3fc-2c963f66afa66")).toBe(false); // too long
  });

  it("rejects null and undefined", () => {
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
