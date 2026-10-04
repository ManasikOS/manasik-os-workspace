import { describe, expect, it } from "vitest";

import { resolveConnectorCardState } from "./connector-card-state";

describe("resolveConnectorCardState", () => {
  it("shows connected when the connection is live, even if the deployment lost its credentials", () => {
    expect(resolveConnectorCardState({ rawStatus: "CONNECTED", available: false })).toBe("CONNECTED");
    expect(resolveConnectorCardState({ rawStatus: "CONNECTED", available: true })).toBe("CONNECTED");
  });

  it("shows not available, with no way to connect, when the deployment lacks credentials", () => {
    expect(resolveConnectorCardState({ rawStatus: "NOT_CONNECTED", available: false })).toBe("UNAVAILABLE");
    expect(resolveConnectorCardState({ rawStatus: null, available: false })).toBe("UNAVAILABLE");
  });

  it("treats no row and disconnected as not connected", () => {
    expect(resolveConnectorCardState({ rawStatus: null, available: true })).toBe("NOT_CONNECTED");
    expect(resolveConnectorCardState({ rawStatus: "NOT_CONNECTED", available: true })).toBe("NOT_CONNECTED");
    expect(resolveConnectorCardState({ rawStatus: "DISCONNECTED", available: true })).toBe("NOT_CONNECTED");
  });

  it("shows connecting while a connection is pending review", () => {
    expect(resolveConnectorCardState({ rawStatus: "PENDING", available: true })).toBe("CONNECTING");
    expect(resolveConnectorCardState({ rawStatus: "PENDING_REVIEW", available: true })).toBe("CONNECTING");
  });

  it("flags every problem status as needing attention", () => {
    for (const rawStatus of ["ERROR", "DEGRADED", "RESTRICTED", "UNFUNDED", "SOMETHING_NEW"]) {
      expect(resolveConnectorCardState({ rawStatus, available: true })).toBe("NEEDS_ATTENTION");
    }
  });

  it("still lets an agency fix a broken connection when credentials are missing", () => {
    expect(resolveConnectorCardState({ rawStatus: "ERROR", available: false })).toBe("NEEDS_ATTENTION");
  });
});
