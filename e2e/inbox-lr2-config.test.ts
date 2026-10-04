import { describe, expect, it } from "vitest";

import { parseInboxLr2BrowserEnvironment } from "./inbox-lr2-config";

const validEnvironment = {
  INBOX_E2E_ENVIRONMENT: "staging",
  INBOX_E2E_BASE_URL: "https://staging.example.test",
  INBOX_E2E_PROJECT_REF: "staging-project",
  INBOX_E2E_PRODUCTION_PROJECT_REF: "production-project",
  INBOX_E2E_A1_EMAIL: "a1@example.test",
  INBOX_E2E_A1_PASSWORD: "a1-password",
  INBOX_E2E_A2_EMAIL: "a2@example.test",
  INBOX_E2E_A2_PASSWORD: "a2-password",
  INBOX_E2E_A_READONLY_EMAIL: "readonly@example.test",
  INBOX_E2E_A_READONLY_PASSWORD: "readonly-password",
  INBOX_E2E_B1_EMAIL: "b1@example.test",
  INBOX_E2E_B1_PASSWORD: "b1-password",
  INBOX_E2E_A_OPEN_CONVERSATION_ID: "a-open",
  INBOX_E2E_A_TAKE_CONTROL_CONVERSATION_ID: "a-control",
  INBOX_E2E_A_CLOSED_WINDOW_CONVERSATION_ID: "a-closed",
  INBOX_E2E_A_COWORKER_CONVERSATION_ID: "a-coworker",
  INBOX_E2E_B_CONVERSATION_ID: "b-conversation",
};

describe("parseInboxLr2BrowserEnvironment", () => {
  it("accepts explicitly named staging fixtures", () => {
    expect(parseInboxLr2BrowserEnvironment(validEnvironment)).toMatchObject({
      environment: "staging",
      baseUrl: "https://staging.example.test",
    });
  });

  it("refuses a project ref that matches production", () => {
    expect(() =>
      parseInboxLr2BrowserEnvironment({
        ...validEnvironment,
        INBOX_E2E_PROJECT_REF: validEnvironment.INBOX_E2E_PRODUCTION_PROJECT_REF,
      }),
    ).toThrow("must not match");
  });

  it("refuses an unrecognised target environment", () => {
    expect(() =>
      parseInboxLr2BrowserEnvironment({
        ...validEnvironment,
        INBOX_E2E_ENVIRONMENT: "production",
      }),
    ).toThrow("staging or disposable");
  });
});
