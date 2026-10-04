import { describe, expect, it } from "vitest";

import { formatLogLine } from "./log";

const NOW = new Date("2026-10-02T06:00:00.000Z");

describe("formatLogLine", () => {
  it("writes one JSON line with the timestamp, level and event name", () => {
    const line = formatLogLine("info", "inbox.health.checked", { findings: 0 }, NOW);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({ findings: 0, ts: "2026-10-02T06:00:00.000Z", level: "info", event: "inbox.health.checked" });
  });

  it("scrubs phone numbers and e-mail addresses out of string fields", () => {
    const line = formatLogLine("error", "inbox.action_failed", { error: "could not reach +94 77 123 4567 or mohamed@example.com" }, NOW);
    expect(line).not.toContain("123 4567");
    expect(line).not.toContain("mohamed@example.com");
    expect(JSON.parse(line).error).toContain("could not reach");
  });

  it("leaves numbers, booleans and null alone, and drops undefined", () => {
    expect(JSON.parse(formatLogLine("warn", "x", { count: 3, ok: false, none: null, skipped: undefined }, NOW))).toMatchObject({ count: 3, ok: false, none: null });
    expect(formatLogLine("warn", "x", { skipped: undefined }, NOW)).not.toContain("skipped");
  });

  it("never lets a field overwrite the reserved keys", () => {
    const parsed = JSON.parse(formatLogLine("info", "real.event", { event: "fake", level: "error", ts: "yesterday" }, NOW));
    expect(parsed).toMatchObject({ event: "real.event", level: "info", ts: "2026-10-02T06:00:00.000Z" });
  });
});
