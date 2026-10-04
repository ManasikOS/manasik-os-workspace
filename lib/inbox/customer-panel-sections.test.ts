import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPEN_CUSTOMER_PANEL_SECTIONS,
  parseOpenCustomerPanelSections,
  serializeOpenCustomerPanelSections,
} from "./customer-panel-sections";

describe("parseOpenCustomerPanelSections", () => {
  it("opens the trip and booking for a person who never chose", () => {
    expect(parseOpenCustomerPanelSections(null)).toEqual([...DEFAULT_OPEN_CUSTOMER_PANEL_SECTIONS]);
  });

  it("falls back to the defaults for unreadable or wrongly shaped storage", () => {
    expect(parseOpenCustomerPanelSections("not json")).toEqual(["trip", "booking"]);
    expect(parseOpenCustomerPanelSections('{"a":1}')).toEqual(["trip", "booking"]);
  });

  it("keeps an empty choice (everything closed) and drops ids that no longer exist", () => {
    expect(parseOpenCustomerPanelSections("[]")).toEqual([]);
    expect(parseOpenCustomerPanelSections('["history","retired-section",42]')).toEqual(["history"]);
  });
});

describe("serializeOpenCustomerPanelSections", () => {
  it("round-trips the open sections and ignores unknown ids", () => {
    const stored = serializeOpenCustomerPanelSections(["copilot", "nonsense", "follow-up"]);
    expect(parseOpenCustomerPanelSections(stored)).toEqual(["copilot", "follow-up"]);
  });
});
