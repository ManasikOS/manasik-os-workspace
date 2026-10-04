export type InboxLr2StaffCredentials = { email: string; password: string };

export type InboxLr2BrowserEnvironment = {
  environment: "staging" | "disposable";
  baseUrl: string;
  projectRef: string;
  agencyA: {
    staffA1: InboxLr2StaffCredentials;
    staffA2: InboxLr2StaffCredentials;
    staffReadonly: InboxLr2StaffCredentials;
    openConversationId: string;
    takeControlConversationId: string;
    closedWindowConversationId: string;
    coworkerConversationId: string;
  };
  agencyB: { staffB1: InboxLr2StaffCredentials; conversationId: string };
};

type InboxLr2EnvironmentValues = Record<string, string | undefined>;

const requiredEnvironmentKeys = [
  "INBOX_E2E_ENVIRONMENT", "INBOX_E2E_BASE_URL", "INBOX_E2E_PROJECT_REF", "INBOX_E2E_PRODUCTION_PROJECT_REF",
  "INBOX_E2E_A1_EMAIL", "INBOX_E2E_A1_PASSWORD", "INBOX_E2E_A2_EMAIL", "INBOX_E2E_A2_PASSWORD",
  "INBOX_E2E_A_READONLY_EMAIL", "INBOX_E2E_A_READONLY_PASSWORD", "INBOX_E2E_B1_EMAIL", "INBOX_E2E_B1_PASSWORD",
  "INBOX_E2E_A_OPEN_CONVERSATION_ID", "INBOX_E2E_A_TAKE_CONTROL_CONVERSATION_ID",
  "INBOX_E2E_A_CLOSED_WINDOW_CONVERSATION_ID", "INBOX_E2E_A_COWORKER_CONVERSATION_ID", "INBOX_E2E_B_CONVERSATION_ID",
] as const;

function inboxLr2RequiredValue(values: InboxLr2EnvironmentValues, key: (typeof requiredEnvironmentKeys)[number]): string {
  const value = values[key]?.trim();
  if (!value) throw new Error("Missing required LR2 browser-test environment variable: " + key + ".");
  return value;
}

/** Refuses production and ensures every test has distinct, named live fixtures. */
export function parseInboxLr2BrowserEnvironment(values: InboxLr2EnvironmentValues = process.env): InboxLr2BrowserEnvironment {
  const missing = requiredEnvironmentKeys.filter((key) => !values[key]?.trim());
  if (missing.length > 0) throw new Error("Missing required LR2 browser-test environment variables: " + missing.join(", ") + ".");
  const environment = inboxLr2RequiredValue(values, "INBOX_E2E_ENVIRONMENT");
  if (environment !== "staging" && environment !== "disposable") throw new Error("INBOX_E2E_ENVIRONMENT must be staging or disposable; production is never a valid LR2 browser-test target.");
  const baseUrl = inboxLr2RequiredValue(values, "INBOX_E2E_BASE_URL");
  let parsedBaseUrl: URL;
  try { parsedBaseUrl = new URL(baseUrl); } catch { throw new Error("INBOX_E2E_BASE_URL must be an absolute http(s) URL."); }
  if (!["http:", "https:"].includes(parsedBaseUrl.protocol)) throw new Error("INBOX_E2E_BASE_URL must be an absolute http(s) URL.");
  const projectRef = inboxLr2RequiredValue(values, "INBOX_E2E_PROJECT_REF");
  if (projectRef === inboxLr2RequiredValue(values, "INBOX_E2E_PRODUCTION_PROJECT_REF")) throw new Error("INBOX_E2E_PROJECT_REF must not match INBOX_E2E_PRODUCTION_PROJECT_REF.");
  return {
    environment, baseUrl: parsedBaseUrl.origin, projectRef,
    agencyA: {
      staffA1: { email: inboxLr2RequiredValue(values, "INBOX_E2E_A1_EMAIL"), password: inboxLr2RequiredValue(values, "INBOX_E2E_A1_PASSWORD") },
      staffA2: { email: inboxLr2RequiredValue(values, "INBOX_E2E_A2_EMAIL"), password: inboxLr2RequiredValue(values, "INBOX_E2E_A2_PASSWORD") },
      staffReadonly: { email: inboxLr2RequiredValue(values, "INBOX_E2E_A_READONLY_EMAIL"), password: inboxLr2RequiredValue(values, "INBOX_E2E_A_READONLY_PASSWORD") },
      openConversationId: inboxLr2RequiredValue(values, "INBOX_E2E_A_OPEN_CONVERSATION_ID"),
      takeControlConversationId: inboxLr2RequiredValue(values, "INBOX_E2E_A_TAKE_CONTROL_CONVERSATION_ID"),
      closedWindowConversationId: inboxLr2RequiredValue(values, "INBOX_E2E_A_CLOSED_WINDOW_CONVERSATION_ID"),
      coworkerConversationId: inboxLr2RequiredValue(values, "INBOX_E2E_A_COWORKER_CONVERSATION_ID"),
    },
    agencyB: {
      staffB1: { email: inboxLr2RequiredValue(values, "INBOX_E2E_B1_EMAIL"), password: inboxLr2RequiredValue(values, "INBOX_E2E_B1_PASSWORD") },
      conversationId: inboxLr2RequiredValue(values, "INBOX_E2E_B_CONVERSATION_ID"),
    },
  };
}
