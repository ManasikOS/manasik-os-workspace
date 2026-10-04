import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { profileDisplayName, needsProfileName, fetchMessengerProfileName, MESSENGER_NAME_PLACEHOLDER } = await import("./profile");

describe("profileDisplayName", () => {
  it("joins first and last name, falling back to name", () => {
    expect(profileDisplayName({ first_name: "Fatima", last_name: "Rizwan" })).toBe("Fatima Rizwan");
    expect(profileDisplayName({ first_name: "Fatima" })).toBe("Fatima");
    expect(profileDisplayName({ name: "Fatima R." })).toBe("Fatima R.");
  });

  it("is null when Meta returned nothing usable", () => {
    expect(profileDisplayName(null)).toBeNull();
    expect(profileDisplayName({})).toBeNull();
    expect(profileDisplayName({ first_name: "  ", last_name: "" })).toBeNull();
  });
});

describe("needsProfileName", () => {
  it("is true only for a missing name or our own placeholder", () => {
    expect(needsProfileName(null)).toBe(true);
    expect(needsProfileName("")).toBe(true);
    expect(needsProfileName(MESSENGER_NAME_PLACEHOLDER)).toBe(true);
    expect(needsProfileName("Fatima Rizwan")).toBe(false);
  });
});

describe("fetchMessengerProfileName", () => {
  it("returns null instead of throwing when Meta refuses (no Advanced Access, or a phone-number account)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { message: "nope", code: 2018218 } }), { status: 400 }));
    await expect(fetchMessengerProfileName("tok", "psid-1")).resolves.toBeNull();
  });

  it("returns the name and asks only for the fields it needs, with the Page token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify({ first_name: "Fatima", last_name: "Rizwan" }), { status: 200 })); // a fresh Response per call: a body can be read once
    await expect(fetchMessengerProfileName("tok", "psid-1")).resolves.toBe("Fatima Rizwan");
    // The Page inbox is asked first (it has no name here), then the direct lookup answers.
    const [url, init] = fetchMock.mock.calls.find((call) => String(call[0]).includes("/psid-1?fields="))!;
    expect(String(url)).toContain("/psid-1?fields=first_name,last_name");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
  });
});
