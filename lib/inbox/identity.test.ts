import { describe, expect, it } from "vitest";

import { normalizeEmail, normalizePhone, toIdentityLookupKey } from "./identity";

describe("normalizePhone", () => {
  it.each([
    ["7 digits, one too few", "1234567", null],
    ["8 digits, the shortest accepted", "12345678", "12345678"],
    ["15 digits, the longest accepted", "123456789012345", "123456789012345"],
    ["16 digits, one too many", "1234567890123456", null],
  ])("handles %s", (_label, input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it("keeps only digits, whatever the formatting", () => {
    expect(normalizePhone("+94 (77) 123-4567")).toBe("94771234567");
    expect(normalizePhone("94.77.123.4567")).toBe("94771234567");
    expect(normalizePhone("  0771234567  ")).toBe("0771234567");
  });

  it("does not guess a country code: a local number stays local and a full number stays full", () => {
    expect(normalizePhone("0771234567")).toBe("0771234567");
    expect(normalizePhone("94771234567")).toBe("94771234567");
    expect(normalizePhone("0771234567")).not.toBe(normalizePhone("94771234567"));
  });

  it.each([null, undefined, "", "   ", "no digits here"])("returns null for %p", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it("counts digits only, so letters cannot make a short number long enough", () => {
    expect(normalizePhone("call 12 34 56 7")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Pilgrim@Example.COM  ")).toBe("pilgrim@example.com");
  });

  it("keeps a plus tag and dots in the local part, which identify the address", () => {
    expect(normalizeEmail("a.b+tag@example.com")).toBe("a.b+tag@example.com");
  });

  it("accepts a subdomain and the shortest possible form", () => {
    expect(normalizeEmail("a@b.c")).toBe("a@b.c");
    expect(normalizeEmail("a@mail.example.co.uk")).toBe("a@mail.example.co.uk");
  });

  it.each([
    ["no at sign", "pilgrim.example.com"],
    ["no domain dot", "pilgrim@example"],
    ["nothing before the at sign", "@example.com"],
    ["nothing after the dot", "pilgrim@example."],
    ["a space inside", "pil grim@example.com"],
    ["two at signs", "a@b@example.com"],
    ["empty", ""],
    ["only spaces", "   "],
  ])("rejects an address with %s", (_label, input) => {
    expect(normalizeEmail(input)).toBeNull();
  });

  it.each([null, undefined])("returns null for %p", (input) => {
    expect(normalizeEmail(input)).toBeNull();
  });
});

describe("toIdentityLookupKey", () => {
  it("trims the subject id and normalizes phone and email", () => {
    expect(toIdentityLookupKey({ provider: "WHATSAPP", externalSubjectId: "  94771234567  ", phone: "+94 77 123 4567", email: " A@B.com " })).toEqual({
      provider: "WHATSAPP",
      externalSubjectId: "94771234567",
      normalizedPhone: "94771234567",
      normalizedEmail: "a@b.com",
    });
  });

  it("uses null, not undefined, for a phone or email the provider did not give", () => {
    const key = toIdentityLookupKey({ provider: "INSTAGRAM", externalSubjectId: "ig-1" });

    expect(key.normalizedPhone).toBeNull();
    expect(key.normalizedEmail).toBeNull();
  });

  it("uses null for a phone or email that is present but unusable", () => {
    const key = toIdentityLookupKey({ provider: "GMAIL", externalSubjectId: "g-1", phone: "12", email: "nope" });

    expect(key.normalizedPhone).toBeNull();
    expect(key.normalizedEmail).toBeNull();
  });

  it("keeps the provider's own id exactly, apart from the outer whitespace, and never lowercases it", () => {
    expect(toIdentityLookupKey({ provider: "MESSENGER", externalSubjectId: "PSID-AbC 123" }).externalSubjectId).toBe("PSID-AbC 123");
  });

  it.each(["", "   ", "\t\n"])("refuses a blank subject id %p, because the exact provider identity is the primary match", (blank) => {
    expect(() => toIdentityLookupKey({ provider: "WHATSAPP", externalSubjectId: blank })).toThrow("A provider identity requires an external subject ID.");
  });

  it("does not let the phone stand in for a missing subject id", () => {
    expect(() => toIdentityLookupKey({ provider: "WHATSAPP", externalSubjectId: "", phone: "94771234567" })).toThrow();
  });
});
