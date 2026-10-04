import { describe, expect, it } from "vitest";

import {
  buildTemplateSendComponents,
  buildTemplateSendComponentsFromValues,
  countBodyVariables,
  renderTemplateText,
} from "./template-params";

describe("countBodyVariables", () => {
  it("returns 0 when components is not an array", () => {
    expect(countBodyVariables(null)).toBe(0);
    expect(countBodyVariables(undefined)).toBe(0);
    expect(countBodyVariables("not-an-array")).toBe(0);
  });

  it("returns 0 when there is no BODY component", () => {
    expect(countBodyVariables([{ type: "HEADER", text: "Hello {{1}}" }])).toBe(0);
  });

  it("returns 0 for a BODY with no placeholders", () => {
    expect(countBodyVariables([{ type: "BODY", text: "Thanks for booking with us!" }])).toBe(0);
  });

  it("returns the highest placeholder index in the BODY text", () => {
    expect(countBodyVariables([{ type: "BODY", text: "Hi {{1}}, your group departs on {{2}}." }])).toBe(2);
  });

  it("matches BODY case-insensitively", () => {
    expect(countBodyVariables([{ type: "body", text: "Hi {{1}}" }])).toBe(1);
  });
});

describe("multi-variable templates", () => {
  const components = [
    { type: "HEADER", text: "Booking update" },
    { type: "BODY", text: "Hi {{1}}, your departure is {{2}}." },
    { type: "FOOTER", text: "Royal Al-Fathima Travels" },
  ];

  it("builds all body parameters in placeholder order", () => {
    expect(buildTemplateSendComponentsFromValues(components, ["Ahmed", "confirmed"])).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "Ahmed" },
          { type: "text", text: "confirmed" },
        ],
      },
    ]);
  });

  it("renders the message snapshot shown in the inbox", () => {
    expect(renderTemplateText(components, ["Ahmed", "confirmed"])).toBe(
      "Booking update\n\nHi Ahmed, your departure is confirmed.\n\nRoyal Al-Fathima Travels",
    );
  });
});

describe("buildTemplateSendComponents", () => {
  it("returns an empty array when the template has no variables", () => {
    expect(buildTemplateSendComponents([{ type: "BODY", text: "Thanks for booking!" }], "ignored")).toEqual([]);
  });

  it("builds a single body text parameter when the template needs one", () => {
    expect(buildTemplateSendComponents([{ type: "BODY", text: "Hi {{1}}" }], "Ahmed")).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Ahmed" }] },
    ]);
  });

  it("falls back to an empty string when no param value was given", () => {
    expect(buildTemplateSendComponents([{ type: "BODY", text: "Hi {{1}}" }], null)).toEqual([
      { type: "body", parameters: [{ type: "text", text: "" }] },
    ]);
  });
});
