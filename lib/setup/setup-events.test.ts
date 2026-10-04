import { describe, expect, it } from "vitest";

import { buildOnboardingEventRow, summariseOnboardingFunnel, type OnboardingEventRow } from "./setup-events";

const agencyId = "11111111-1111-4111-8111-111111111111";

describe("buildOnboardingEventRow", () => {
  it("builds a step event with its step", () => {
    expect(buildOnboardingEventRow({ agencyId, event: "STEP_VIEWED", step: "team" })).toEqual({
      agency_id: agencyId,
      event: "STEP_VIEWED",
      step: "team",
      connector: null,
    });
  });

  it("builds a connector event with its connector", () => {
    expect(buildOnboardingEventRow({ agencyId, event: "CONNECTOR_SUCCEEDED", connector: "whatsapp" })).toEqual({
      agency_id: agencyId,
      event: "CONNECTOR_SUCCEEDED",
      step: null,
      connector: "whatsapp",
    });
  });

  it("refuses an event that is missing what its kind needs", () => {
    expect(buildOnboardingEventRow({ agencyId, event: "STEP_SKIPPED" })).toBeNull();
    expect(buildOnboardingEventRow({ agencyId, event: "CONNECTOR_STARTED" })).toBeNull();
  });

  it("refuses an unknown step, unknown connector or malformed agency id", () => {
    expect(buildOnboardingEventRow({ agencyId, event: "STEP_VIEWED", step: "billing" as never })).toBeNull();
    expect(buildOnboardingEventRow({ agencyId, event: "CONNECTOR_FAILED", connector: "tiktok" as never })).toBeNull();
    expect(buildOnboardingEventRow({ agencyId: "not-a-uuid", event: "STEP_VIEWED", step: "team" })).toBeNull();
  });
});

describe("summariseOnboardingFunnel", () => {
  const row = (agency: string, event: OnboardingEventRow["event"], step: string | null, connector: string | null = null): OnboardingEventRow => ({
    agency_id: agency,
    event,
    step: step as OnboardingEventRow["step"],
    connector: connector as OnboardingEventRow["connector"],
  });

  it("counts each agency once per step and event, however often it repeats", () => {
    const summary = summariseOnboardingFunnel([
      row("a", "STEP_VIEWED", "team"),
      row("a", "STEP_VIEWED", "team"),
      row("b", "STEP_VIEWED", "team"),
      row("a", "STEP_COMPLETED", "team"),
      row("b", "STEP_SKIPPED", "team"),
    ]);
    expect(summary.steps.team).toEqual({ viewed: 2, completed: 1, skipped: 1 });
    expect(summary.steps.package).toEqual({ viewed: 0, completed: 0, skipped: 0 });
  });

  it("counts connector outcomes per connector", () => {
    const summary = summariseOnboardingFunnel([
      row("a", "CONNECTOR_STARTED", null, "whatsapp"),
      row("b", "CONNECTOR_STARTED", null, "whatsapp"),
      row("a", "CONNECTOR_SUCCEEDED", null, "whatsapp"),
      row("b", "CONNECTOR_FAILED", null, "whatsapp"),
    ]);
    expect(summary.connectors.whatsapp).toEqual({ started: 2, succeeded: 1, failed: 1 });
    expect(summary.connectors.messenger).toEqual({ started: 0, succeeded: 0, failed: 0 });
  });

  it("returns zeroes for no events", () => {
    const summary = summariseOnboardingFunnel([]);
    expect(Object.values(summary.steps).every((s) => s.viewed === 0 && s.completed === 0 && s.skipped === 0)).toBe(true);
  });
});
