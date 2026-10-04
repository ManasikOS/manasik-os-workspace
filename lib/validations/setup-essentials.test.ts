import { describe, expect, it } from "vitest";

import { agencyBasicsSchema, setupPasswordSchema, setupTeamInviteSchema } from "./setup";

describe("agencyBasicsSchema", () => {
  const valid = {
    agencyName: "Al-Noor Travels",
    defaultCountry: "GB",
    defaultCurrency: "GBP",
    timezone: "Europe/London",
    defaultLanguage: "en",
  };

  it("accepts a complete set of basics", () => {
    expect(agencyBasicsSchema.safeParse(valid).success).toBe(true);
  });

  it("requires a name, country, currency, timezone and language", () => {
    for (const key of Object.keys(valid)) {
      expect(agencyBasicsSchema.safeParse({ ...valid, [key]: "" }).success).toBe(false);
    }
  });

  it("rejects a timezone that is not an IANA-style identifier", () => {
    expect(agencyBasicsSchema.safeParse({ ...valid, timezone: "London time!" }).success).toBe(false);
    expect(agencyBasicsSchema.safeParse({ ...valid, timezone: "UTC" }).success).toBe(true);
  });

  it("rejects a language the app does not support", () => {
    expect(agencyBasicsSchema.safeParse({ ...valid, defaultLanguage: "xx" }).success).toBe(false);
  });
});

describe("setupTeamInviteSchema", () => {
  it("accepts a name, email and role, and lower-cases the email", () => {
    const parsed = setupTeamInviteSchema.parse({ fullName: "Aisha Khan", email: "Aisha@Agency.com", role: "OPERATIONS" });
    expect(parsed.email).toBe("aisha@agency.com");
  });

  it("does not let an invite create another administrator through setup", () => {
    expect(setupTeamInviteSchema.safeParse({ fullName: "A B", email: "a@b.com", role: "ADMIN" }).success).toBe(false);
  });

  it("rejects a bad email and an unknown role", () => {
    expect(setupTeamInviteSchema.safeParse({ fullName: "A B", email: "nope", role: "VISA" }).success).toBe(false);
    expect(setupTeamInviteSchema.safeParse({ fullName: "A B", email: "a@b.com", role: "OWNER" }).success).toBe(false);
  });
});

describe("setupPasswordSchema", () => {
  it("needs matching passwords that meet the strength rules", () => {
    expect(setupPasswordSchema.safeParse({ password: "abcdefg1", confirmPassword: "abcdefg1" }).success).toBe(true);
    expect(setupPasswordSchema.safeParse({ password: "abcdefg1", confirmPassword: "different1" }).success).toBe(false);
    expect(setupPasswordSchema.safeParse({ password: "short1", confirmPassword: "short1" }).success).toBe(false);
  });
});
