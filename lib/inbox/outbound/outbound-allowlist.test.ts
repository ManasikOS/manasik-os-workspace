import { describe, expect, it } from "vitest";

import { OUTBOUND_ALLOWLIST_VARIABLE, normalizeRecipient, outboundRecipientRefusal, resolveOutboundPolicy } from "./outbound-allowlist";

const staging = (allowlist?: string) => ({ SENTRY_ENVIRONMENT: "staging", ...(allowlist === undefined ? {} : { [OUTBOUND_ALLOWLIST_VARIABLE]: allowlist }) });

describe("normalizeRecipient", () => {
  it.each([
    ["+94 77 123 4567", "94771234567"],
    ["94771234567", "94771234567"],
    ["(077) 123-4567", "0771234567"],
    ["Customer@Example.COM ", "customer@example.com"],
    ["PSID-ABC123", "psid-abc123"],
  ])("%j becomes %j", (raw, expected) => {
    expect(normalizeRecipient(raw)).toBe(expected);
  });
});

describe("resolveOutboundPolicy", () => {
  it("does not restrict production, and ignores the list there", () => {
    expect(resolveOutboundPolicy({ SENTRY_ENVIRONMENT: "production", [OUTBOUND_ALLOWLIST_VARIABLE]: "94771234567" })).toEqual({ restricted: false });
    expect(resolveOutboundPolicy({ SENTRY_ENVIRONMENT: " Production " })).toEqual({ restricted: false });
  });

  it.each([["staging"], ["preview"], [""], [undefined]])("restricts an environment named %j", (name) => {
    expect(resolveOutboundPolicy({ SENTRY_ENVIRONMENT: name }).restricted).toBe(true);
  });

  it("splits on commas, semicolons and new lines, ignores empty entries, and keeps a phone number written with spaces whole", () => {
    const policy = resolveOutboundPolicy(staging("94771234567, a@b.test;\n +94 77 000 0000 ,,"));
    expect(policy).toMatchObject({ restricted: true, allowEveryone: false });
    expect(policy.restricted && [...policy.recipients].sort()).toEqual(["94770000000", "94771234567", "a@b.test"]);
  });

  it("allows everyone only through the explicit star", () => {
    expect(resolveOutboundPolicy(staging("*"))).toMatchObject({ restricted: true, allowEveryone: true });
    expect(resolveOutboundPolicy(staging("94771234567,*"))).toMatchObject({ allowEveryone: true });
    expect(resolveOutboundPolicy(staging(""))).toMatchObject({ allowEveryone: false });
  });
});

describe("outboundRecipientRefusal", () => {
  it("lets production send to anyone", () => {
    expect(outboundRecipientRefusal("94771234567", { SENTRY_ENVIRONMENT: "production" })).toBeNull();
    expect(outboundRecipientRefusal(null, { SENTRY_ENVIRONMENT: "production" })).toBeNull();
  });

  it("sends to nobody outside production when the list is empty or unset", () => {
    for (const env of [staging(), staging(""), staging("   "), {}]) {
      expect(outboundRecipientRefusal("94771234567", env)).toMatch(/no test contacts are approved/);
    }
  });

  it("allows a listed recipient whatever the spelling, and refuses an unlisted one", () => {
    const env = staging("+94 77 123 4567, tester@example.com, PSID-9");
    expect(outboundRecipientRefusal("94771234567", env)).toBeNull();
    expect(outboundRecipientRefusal("+94-77-123-4567", env)).toBeNull();
    expect(outboundRecipientRefusal("TESTER@example.com", env)).toBeNull();
    expect(outboundRecipientRefusal("psid-9", env)).toBeNull();
    expect(outboundRecipientRefusal("94779999999", env)).toMatch(/not one of them/);
  });

  it("refuses a missing recipient when restricted, rather than guessing", () => {
    expect(outboundRecipientRefusal(null, staging("94771234567"))).toMatch(/not one of them/);
    expect(outboundRecipientRefusal("", staging("94771234567"))).toMatch(/not one of them/);
  });

  it("allows everyone when the list is the star, including a missing recipient", () => {
    expect(outboundRecipientRefusal("94779999999", staging("*"))).toBeNull();
    expect(outboundRecipientRefusal(null, staging("*"))).toBeNull();
  });

  it("does not treat a longer number that merely contains a listed one as listed", () => {
    expect(outboundRecipientRefusal("9477123456789", staging("94771234567"))).toMatch(/not one of them/);
  });

  it("never puts the recipient or the list in the reason", () => {
    const env = staging("94771234567, secret.contact@example.com");
    const reason = outboundRecipientRefusal("94778887777", env) ?? "";
    expect(reason).not.toContain("94778887777");
    expect(reason).not.toContain("94771234567");
    expect(reason).not.toContain("secret.contact");
    expect(outboundRecipientRefusal("94778887777", staging()) ?? "").not.toContain("94778887777");
  });
});
