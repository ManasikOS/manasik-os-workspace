import { afterEach, describe, expect, it, vi } from "vitest";

import { EnvironmentBanner } from "@/components/environment-banner";
import { environmentBannerLabel } from "./environment-banner";

afterEach(() => vi.unstubAllEnvs());

/** The text a React element tree would show, found by walking its children. */
function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) return textOf((node as { props: { children?: unknown } }).props.children);
  return "";
}

describe("environmentBannerLabel", () => {
  it.each([
    ["staging", "Staging"],
    ["STAGING", "Staging"],
    [" preview ", "Preview"],
    ["qa-eu", "Qa-eu"],
  ])("labels %j as %j", (name, label) => {
    expect(environmentBannerLabel({ SENTRY_ENVIRONMENT: name })).toBe(label);
  });

  it.each([["production"], [" Production "], [""], ["   "], [undefined]])("shows nothing for %j", (name) => {
    expect(environmentBannerLabel({ SENTRY_ENVIRONMENT: name })).toBeNull();
  });
});

describe("EnvironmentBanner", () => {
  it("renders nothing in production", () => {
    vi.stubEnv("SENTRY_ENVIRONMENT", "production");
    expect(EnvironmentBanner()).toBeNull();
  });

  it("renders nothing when no environment is named, as in local development", () => {
    vi.stubEnv("SENTRY_ENVIRONMENT", "");
    expect(EnvironmentBanner()).toBeNull();
  });

  it("renders a fixed, non-interactive label naming the environment on staging", () => {
    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    const element = EnvironmentBanner();
    expect(element).not.toBeNull();
    expect(element?.props.role).toBe("status");
    expect(element?.props.className).toMatch(/\bfixed\b/);
    expect(element?.props.className).toMatch(/pointer-events-none/);
    expect(textOf(element)).toContain("Staging environment: test data only");
  });
});
