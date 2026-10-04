export const inboxLr2FixtureAgencySlugs = { agencyA: "lr2-fixture-agency-a", agencyB: "lr2-fixture-agency-b" } as const;

/**
 * The simulated WhatsApp number each fixture agency is connected through (TASK-032 S3). Both fixture agencies are test agencies
 * (`agencies.is_test`), so their sends are answered by the in-memory simulator, and the ids start with `sim-` so the signed-webhook
 * builders in lib/inbox/simulator will address them and can never address a real account.
 */
export const inboxLr2FixtureSimulatedNumbers = {
  agencyA: { phoneNumberId: "sim-phone-lr2-a", displayPhoneNumber: "15550000001" },
  agencyB: { phoneNumberId: "sim-phone-lr2-b", displayPhoneNumber: "15550000002" },
} as const;

/** Not a secret and not in Vault: a simulated connection never reads one (the simulator supplies its own token). */
export const inboxLr2FixtureSimulatedCredentialRef = "simulator-no-secret";

/** The approved template seeded for Agency A (name is what INBOX_E2E_TEMPLATE_NAME must hold). Two variables, so the spec's variable-filling path runs. */
export const inboxLr2FixtureTemplate = { name: "lr2_fixture_followup", language: "en", bodyText: "Hello {{1}}, this is a follow-up about {{2}}." } as const;

export type InboxLr2FixtureStaffKey = "A1" | "A2" | "A_READONLY" | "B1";

/** A1/A2 can take control and send; CEO is view-only in Inbox, which is what the permission-denied scenario needs. */
export const inboxLr2FixtureStaff: Record<InboxLr2FixtureStaffKey, { role: "ADMIN" | "CEO"; agency: "agencyA" | "agencyB"; fullName: string }> = {
  A1: { role: "ADMIN", agency: "agencyA", fullName: "LR2 Staff A1" },
  A2: { role: "ADMIN", agency: "agencyA", fullName: "LR2 Staff A2" },
  A_READONLY: { role: "CEO", agency: "agencyA", fullName: "LR2 Staff A Read-only" },
  B1: { role: "ADMIN", agency: "agencyB", fullName: "LR2 Staff B1" },
};

export type InboxLr2FixtureConversationKey = "OPEN" | "TAKE_CONTROL" | "CLOSED_WINDOW" | "COWORKER" | "LEAD_LINKED" | "B";

export type InboxLr2FixtureConversationPlan = {
  envKey: string;
  agency: "agencyA" | "agencyB";
  externalId: string;
  contactName: string;
  state: "AI_ACTIVE" | "HUMAN_ACTIVE";
  owner: InboxLr2FixtureStaffKey | null;
  /** Hours from now the WhatsApp reply window closes; negative means already closed. */
  windowHours: number;
  message: string;
  /** True when the conversation is linked to a lead (reference, name, mobile), so the customer panel has a lead to open. */
  withLead?: boolean;
};

/** Order matters: a conversation's fictional phone number comes from its position, so new fixtures go at the END. */
export const inboxLr2FixtureConversations: Record<InboxLr2FixtureConversationKey, InboxLr2FixtureConversationPlan> = {
  OPEN: { envKey: "INBOX_E2E_A_OPEN_CONVERSATION_ID", agency: "agencyA", externalId: "lr2-fixture-a-open", contactName: "LR2 Open Window", state: "HUMAN_ACTIVE", owner: "A1", windowHours: 20, message: "LR2 fixture: is my umrah package still available?" },
  TAKE_CONTROL: { envKey: "INBOX_E2E_A_TAKE_CONTROL_CONVERSATION_ID", agency: "agencyA", externalId: "lr2-fixture-a-take-control", contactName: "LR2 Take Control", state: "AI_ACTIVE", owner: null, windowHours: 20, message: "LR2 fixture: can someone call me about visas?" },
  CLOSED_WINDOW: { envKey: "INBOX_E2E_A_CLOSED_WINDOW_CONVERSATION_ID", agency: "agencyA", externalId: "lr2-fixture-a-closed-window", contactName: "LR2 Closed Window", state: "HUMAN_ACTIVE", owner: "A1", windowHours: -30, message: "LR2 fixture: sent two days ago, window has closed." },
  COWORKER: { envKey: "INBOX_E2E_A_COWORKER_CONVERSATION_ID", agency: "agencyA", externalId: "lr2-fixture-a-coworker", contactName: "LR2 Coworker Owned", state: "HUMAN_ACTIVE", owner: "A2", windowHours: 20, message: "LR2 fixture: this chat belongs to a colleague." },
  B: { envKey: "INBOX_E2E_B_CONVERSATION_ID", agency: "agencyB", externalId: "lr2-fixture-b-only", contactName: "LR2 Agency B Only", state: "HUMAN_ACTIVE", owner: "B1", windowHours: 20, message: "LR2 fixture: Agency B private message, must never appear in Agency A." },
  LEAD_LINKED: { envKey: "INBOX_E2E_A_LEAD_LINKED_CONVERSATION_ID", agency: "agencyA", externalId: "lr2-fixture-a-lead-linked", contactName: "LR2 Lead Linked", state: "HUMAN_ACTIVE", owner: "A1", windowHours: 20, message: "LR2 fixture: I would like a quote for a family umrah in March.", withLead: true },
};

export type InboxLr2FixtureEnvironment = { url: string; projectRef: string };

/** Refuses anything that is not a named non-production project, matching the LR2 browser suite's own rule. */
export function assertInboxLr2FixtureTarget(values: Record<string, string | undefined>): InboxLr2FixtureEnvironment {
  const environment = values.INBOX_E2E_ENVIRONMENT?.trim();
  if (environment !== "staging" && environment !== "disposable") throw new Error("INBOX_E2E_ENVIRONMENT must be staging or disposable.");
  const url = values.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const projectRef = values.INBOX_E2E_PROJECT_REF?.trim();
  const productionRef = values.INBOX_E2E_PRODUCTION_PROJECT_REF?.trim();
  if (!url || !projectRef || !productionRef) throw new Error("NEXT_PUBLIC_SUPABASE_URL, INBOX_E2E_PROJECT_REF and INBOX_E2E_PRODUCTION_PROJECT_REF are required.");
  if (projectRef === productionRef) throw new Error("INBOX_E2E_PROJECT_REF must not match INBOX_E2E_PRODUCTION_PROJECT_REF.");
  if (new URL(url).hostname.split(".")[0] !== projectRef) throw new Error("NEXT_PUBLIC_SUPABASE_URL does not point at INBOX_E2E_PROJECT_REF; refusing to seed.");
  return { url, projectRef };
}

export function inboxLr2FixtureWindowTimes(windowHours: number, now: Date): { serviceWindowExpiresAt: string; lastInboundAt: string } {
  const expires = new Date(now.getTime() + windowHours * 3_600_000);
  // WhatsApp's customer-service window is 24h from the last inbound message.
  return { serviceWindowExpiresAt: expires.toISOString(), lastInboundAt: new Date(expires.getTime() - 24 * 3_600_000).toISOString() };
}
