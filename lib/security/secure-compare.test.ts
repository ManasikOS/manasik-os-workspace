import { describe, expect, it } from "vitest";

import { hasValidBearerSecret, secureSecretEquals } from "./secure-compare";

describe("secureSecretEquals", () => {
  it("matches identical secrets only", () => {
    expect(secureSecretEquals("abc123", "abc123")).toBe(true);
    expect(secureSecretEquals("abc123", "abc124")).toBe(false);
    expect(secureSecretEquals("abc", "abc123")).toBe(false);
  });

  it("never matches a missing or blank value, even against a blank secret", () => {
    expect(secureSecretEquals(null, "x")).toBe(false);
    expect(secureSecretEquals("x", undefined)).toBe(false);
    expect(secureSecretEquals("", "")).toBe(false);
  });
});

describe("hasValidBearerSecret", () => {
  it("accepts the exact bearer secret", () => {
    expect(hasValidBearerSecret("Bearer s3cret", "s3cret")).toBe(true);
  });

  it("rejects a wrong scheme, wrong secret, missing header or unset secret", () => {
    expect(hasValidBearerSecret("Basic s3cret", "s3cret")).toBe(false);
    expect(hasValidBearerSecret("Bearer nope", "s3cret")).toBe(false);
    expect(hasValidBearerSecret(null, "s3cret")).toBe(false);
    expect(hasValidBearerSecret("Bearer ", undefined)).toBe(false);
    expect(hasValidBearerSecret("Bearer undefined", undefined)).toBe(false);
  });
});
