import { describe, expect, it } from "vitest";

import { contactAvatarColorClasses, contactAvatarInitials } from "./contact-avatar-color";

describe("contactAvatarColorClasses", () => {
  it("gives the same contact the same colour every time, ignoring case and spacing", () => {
    expect(contactAvatarColorClasses("Mohamed Afras")).toBe(contactAvatarColorClasses("  mohamed afras "));
  });

  it("always returns a colour, even with no name", () => {
    expect(contactAvatarColorClasses(null)).toContain("bg-");
    expect(contactAvatarColorClasses("")).toContain("bg-");
  });

  it("spreads different contacts across more than one colour", () => {
    const colours = new Set(["Ali", "Fatima", "Shafaath", "Afras", "Zainab", "Omar", "+94771234567"].map(contactAvatarColorClasses));
    expect(colours.size).toBeGreaterThan(2);
  });
});

describe("contactAvatarInitials", () => {
  it("uses the first letters of the first two words", () => {
    expect(contactAvatarInitials("mohamed afras khan", null)).toBe("MA");
  });

  it("falls back to the phone number, then to a question mark", () => {
    expect(contactAvatarInitials("", "+9477")).toBe("+");
    expect(contactAvatarInitials(null, null)).toBe("?");
  });

  it("skips the @ of an Instagram handle", () => {
    expect(contactAvatarInitials("@afras", null)).toBe("A");
  });
});
