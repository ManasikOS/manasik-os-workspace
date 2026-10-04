import { describe, expect, it } from "vitest";

import { signupSchema } from "./auth";

const base = { agencyName: "Al-Noor Travels", ownerFullName: "Fatima Rizwan", email: "Owner@Agency.com" };

describe("signupSchema", () => {
  it("lower-cases the email", () => {
    expect(signupSchema.parse(base).email).toBe("owner@agency.com");
  });

  it("accepts an optional two-letter country and upper-cases it", () => {
    expect(signupSchema.parse({ ...base, countryCode: "gb" }).countryCode).toBe("GB");
    expect(signupSchema.parse(base).countryCode).toBeUndefined();
  });

  it("treats an empty country as not provided", () => {
    expect(signupSchema.parse({ ...base, countryCode: "" }).countryCode).toBeUndefined();
  });

  it("rejects a malformed country code", () => {
    expect(signupSchema.safeParse({ ...base, countryCode: "United Kingdom" }).success).toBe(false);
  });
});
