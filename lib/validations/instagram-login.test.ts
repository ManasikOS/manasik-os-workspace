import { describe, expect, it } from "vitest";

import { instagramLoginCodeSchema, parseInstagramLoginCallback } from "./instagram-login";

describe("parseInstagramLoginCallback", () => {
  it("reads the code and state Instagram sends back after approval", () => {
    const parsed = parseInstagramLoginCallback(new URLSearchParams("code=AQBabc&state=igl_xyz"));
    expect(parsed.success && parsed.data).toEqual({ code: "AQBabc", state: "igl_xyz" });
  });

  it("accepts a cancelled login, which carries only an error", () => {
    const parsed = parseInstagramLoginCallback(new URLSearchParams("error=access_denied&error_description=The+user+denied+your+request"));
    expect(parsed.success && parsed.data).toMatchObject({ error: "access_denied", error_description: "The user denied your request" });
  });

  it("rejects an oversized code or state, which is attacker-reachable input", () => {
    expect(parseInstagramLoginCallback(new URLSearchParams({ code: "a".repeat(2049), state: "s" })).success).toBe(false);
    expect(parseInstagramLoginCallback(new URLSearchParams({ code: "c", state: "s".repeat(257) })).success).toBe(false);
  });

  it("rejects an empty code rather than passing it to Meta", () => {
    expect(parseInstagramLoginCallback(new URLSearchParams("code=&state=igl_x")).success).toBe(false);
  });
});

describe("instagramLoginCodeSchema", () => {
  it("requires a non-empty, bounded code", () => {
    expect(instagramLoginCodeSchema.safeParse({ code: "AQB" }).success).toBe(true);
    expect(instagramLoginCodeSchema.safeParse({ code: "" }).success).toBe(false);
    expect(instagramLoginCodeSchema.safeParse({}).success).toBe(false);
    expect(instagramLoginCodeSchema.safeParse({ code: "a".repeat(2049) }).success).toBe(false);
  });
});
