import { describe, expect, it } from "vitest";

import { loginReturnPath } from "./login-return-path";

describe("loginReturnPath", () => {
  it("keeps the query string so a shared deep link survives the login round trip", () => {
    expect(loginReturnPath("/operations", "?tab=accommodation&view=rooming-board")).toBe(
      "/operations?tab=accommodation&view=rooming-board",
    );
  });

  it("returns the bare path when there is no query", () => {
    expect(loginReturnPath("/documents", "")).toBe("/documents");
  });

  it("returns null for the home page, which needs no return path", () => {
    expect(loginReturnPath("/", "")).toBeNull();
    expect(loginReturnPath("/", "?utm=x")).toBeNull();
  });
});
