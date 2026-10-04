import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const AGENCY = "0b8e7c3a-1f4d-4e6a-9d2b-7a1c5e3f9b10";
const CONVERSATION = "5d2f9a41-8c7e-4b3a-a6d1-2e9f0c7b4a83";
const START = new Date("2026-09-27T10:00:00.000Z");

type Row = { id: string; attempts: number; max_attempts: number; message_id: string };
type WriteRecord = { table: string; op: "update" | "insert"; values: Record<string, unknown>; filters: Array<[string, unknown]> };

const writes: WriteRecord[] = [];
let claimBatches: Row[][] = [];
let claimError: { message: string } | null = null;
let claimCalls = 0;
let connection: { provider: string } | null = null;
let conversation: { external_conversation_id: string } | null = null;
let message: { actor_kind: string; actor_id: string | null; metadata: Record<string, unknown> | null } | null = null;
let resolvedConnection: { accountId?: string; credentialRef?: string; status: string } | null = null;
let token: string | null = null;
let errorClass = "UNKNOWN";
let commandContent: unknown[] = [];
let commandSubject: string | null = null;
let commandCc: string[] | null = null;
let commandBcc: string[] | null = null;

const sendReply = vi.fn();
const reflectSendFailure = vi.fn();
const authorize = vi.fn();
const recordAutomatedSendDecision = vi.fn();
const getChannelAdapter = vi.fn();
let agencyIsTest = false;

vi.mock("@/lib/inbox/outbound/authorize-provider-send", () => ({ authorizeProviderSend: (...args: unknown[]) => authorize(...args) }));
vi.mock("@/lib/inbox/autonomy/runtime", () => ({ recordAutomatedSendDecision: (...args: unknown[]) => recordAutomatedSendDecision(...args) }));
vi.mock("@/lib/channels/registry", () => ({ getChannelAdapter: (...args: unknown[]) => getChannelAdapter(...args) }));
vi.mock("@/lib/inbox/outbound/test-agency-send-guard", () => ({ loadAgencyIsTest: async () => agencyIsTest }));

vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async () => {
      claimCalls++;
      if (claimError) return { data: null, error: claimError };
      return { data: (claimBatches.shift() ?? []).map((row) => ({ agency_id: AGENCY, connection_id: "cc-1", conversation_id: CONVERSATION, command: { content: commandContent, subject: commandSubject, cc: commandCc, bcc: commandBcc }, ...row })), error: null };
    },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: "not used" } }) }) },
    from: (table: string) => {
      const singles: Record<string, unknown> = { channel_connections: connection, conversations: conversation, conversation_messages: message };
      let current: WriteRecord | null = null;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          current?.filters.push([column, value]);
          return chain;
        },
        single: async () => ({ data: singles[table] ?? null, error: null }),
        update: (values: Record<string, unknown>) => {
          current = { table, op: "update", values, filters: [] };
          writes.push(current);
          return chain;
        },
        insert: async (values: Record<string, unknown>) => {
          writes.push({ table, op: "insert", values, filters: [] });
          return { error: null };
        },
        then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
      };
      return chain;
    },
  }),
}));

const { processDueInboxOutbox } = await import("./drain");

const allow = (text = "Hello") => ({ allowed: true, reasons: [], command: { text }, automatedAuthorization: null });
const row = (over: Partial<Row> = {}): Row => ({ id: "outbox-1", attempts: 1, max_attempts: 3, message_id: "msg-1", ...over });
const outboxWrite = () => writes.find((entry) => entry.table === "outbox_messages" && entry.op === "update")?.values;
const messageWrite = () => writes.find((entry) => entry.table === "conversation_messages" && entry.op === "update")?.values;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  writes.length = 0;
  claimBatches = [[row()]];
  claimError = null;
  claimCalls = 0;
  connection = { provider: "WHATSAPP" };
  conversation = { external_conversation_id: "94771234567" };
  message = { actor_kind: "STAFF", actor_id: "staff-1", metadata: {} };
  resolvedConnection = { accountId: "acct", credentialRef: "ref", status: "CONNECTED" };
  token = "token";
  errorClass = "UNKNOWN";
  commandContent = [{ type: "text", text: "Hello" }];
  commandSubject = null;
  commandCc = null;
  commandBcc = null;
  agencyIsTest = false;
  sendReply.mockReset().mockResolvedValue({ externalMessageId: "wamid.1" });
  reflectSendFailure.mockReset().mockResolvedValue(undefined);
  authorize.mockReset().mockImplementation(async () => allow());
  recordAutomatedSendDecision.mockReset().mockResolvedValue(undefined);
  getChannelAdapter.mockReset().mockImplementation(() => ({
    provider: "WHATSAPP",
    profile: { displayName: "WhatsApp" },
    resolveConnectionForChannelConnection: async () => resolvedConnection,
    readToken: async () => token,
    sendReply,
    classifyError: () => errorClass,
    reflectSendFailure,
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("outbox drain: claiming", () => {
  it("does not claim anything when the time budget is already spent", async () => {
    const result = await processDueInboxOutbox({ budgetMs: 0 });

    expect(result).toEqual({ processed: 0, failed: 0 });
    expect(claimCalls).toBe(0);
  });

  it("stops when the queue is empty", async () => {
    claimBatches = [];

    expect(await processDueInboxOutbox({ budgetMs: 5_000 })).toEqual({ processed: 0, failed: 0 });
    expect(claimCalls).toBe(1);
  });

  it("throws when the claim itself fails, so the caller can see the queue is unreadable", async () => {
    claimError = { message: "connection reset" };

    await expect(processDueInboxOutbox({ budgetMs: 5_000 })).rejects.toThrow("Unable to claim Inbox outbox: connection reset");
  });

  it("keeps claiming batches until one comes back empty", async () => {
    claimBatches = [[row({ id: "outbox-1" })], [row({ id: "outbox-2" })]];

    const result = await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(result).toEqual({ processed: 2, failed: 0 });
    expect(claimCalls).toBe(3);
  });

  it("hands unreached rows back, refunding the attempt, once the budget runs out mid-batch", async () => {
    claimBatches = [[row({ id: "outbox-1", attempts: 2 }), row({ id: "outbox-2", attempts: 2, message_id: "msg-2" }), row({ id: "outbox-3", attempts: 1, message_id: "msg-3" })]];
    sendReply.mockImplementation(async () => {
      vi.setSystemTime(new Date(START.getTime() + 10_000));
      return { externalMessageId: "wamid.1" };
    });

    const result = await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(result).toEqual({ processed: 1, failed: 0 });
    const handedBack = writes.filter((entry) => entry.table === "outbox_messages" && entry.values.status === "QUEUED");
    expect(handedBack.map((entry) => [entry.filters.find(([column]) => column === "id")?.[1], entry.values.attempts])).toEqual([
      ["outbox-2", 1],
      ["outbox-3", 0],
    ]);
    expect(handedBack.every((entry) => entry.values.locked_by === null && entry.filters.some(([column, value]) => column === "status" && value === "RUNNING"))).toBe(true);
  });
});

describe("outbox drain: a successful staff text", () => {
  it("sends the authorized command to the customer and records SENT on the outbox, the message and the delivery log", async () => {
    const result = await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(sendReply).toHaveBeenCalledWith(expect.anything(), "token", { to: "94771234567", text: "Hello" });
    expect(outboxWrite()).toMatchObject({ status: "SENT", provider_message_id: "wamid.1", locked_at: null, locked_by: null });
    expect(messageWrite()).toMatchObject({ external_message_id: "wamid.1", delivery_status: "SENT" });
    expect(writes.find((entry) => entry.op === "insert")?.values).toMatchObject({ message_id: "msg-1", provider_event_id: "wamid.1", status: "SENT" });
  });

  it("merges an email's subject/cc/bcc from the outbox command into the send, alongside authorizeProviderSend's own command", async () => {
    commandSubject = "Re: Your trip";
    commandCc = ["cc@example.com"];
    commandBcc = [];

    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(sendReply).toHaveBeenCalledWith(expect.anything(), "token", { to: "94771234567", text: "Hello", subject: "Re: Your trip", cc: ["cc@example.com"] });
  });

  it("never sends a subject/cc/bcc key for a channel whose outbox command never carried them", async () => {
    await processDueInboxOutbox({ budgetMs: 5_000 });

    const call = sendReply.mock.calls[0]?.[2];
    expect(call).not.toHaveProperty("subject");
    expect(call).not.toHaveProperty("cc");
    expect(call).not.toHaveProperty("bcc");
  });

  it("asks for authorization as the staff member who wrote the message, on the text that will be sent", async () => {
    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(authorize.mock.calls[0][1]).toMatchObject({ agencyId: AGENCY, conversationId: CONVERSATION, text: "Hello", author: { kind: "STAFF", actorId: "staff-1" } });
  });

  it("does not write an automated-send audit record for a person's message", async () => {
    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(recordAutomatedSendDecision).not.toHaveBeenCalled();
  });

  it("records every part id when a long reply was split, so each echo is recognised as ours", async () => {
    sendReply.mockResolvedValue({ externalMessageId: "wamid.1", partMessageIds: ["wamid.1", "wamid.2"] });

    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(messageWrite()).toMatchObject({ metadata: { part_mids: ["wamid.1", "wamid.2"] } });
  });

  it("does not touch the message metadata for a single-part reply", async () => {
    sendReply.mockResolvedValue({ externalMessageId: "wamid.1", partMessageIds: ["wamid.1"] });

    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(messageWrite()).not.toHaveProperty("metadata");
  });

  it("scopes every write to the row's agency", async () => {
    await processDueInboxOutbox({ budgetMs: 5_000 });

    for (const entry of writes.filter((candidate) => candidate.op === "update")) {
      expect(entry.filters, entry.table).toContainEqual(["agency_id", AGENCY]);
    }
  });
});

describe("outbox drain: an AI reply", () => {
  beforeEach(() => {
    message = { actor_kind: "AI", actor_id: null, metadata: { autonomy_source: "APPROVED_TEMPLATE", autonomy_action: "ACKNOWLEDGEMENT" } };
  });

  it("authorizes as the AI with the source and action the message declared", async () => {
    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(authorize.mock.calls[0][1].author).toEqual({ kind: "AI", source: "APPROVED_TEMPLATE", action: "ACKNOWLEDGEMENT" });
  });

  it.each([
    ["missing", {}],
    ["unrecognised", { autonomy_source: "MADE_UP", autonomy_action: "MADE_UP" }],
  ])("treats %s source and action as the least trusted values: GENERATED and OTHER", async (_label, metadata) => {
    message = { actor_kind: "AI", actor_id: null, metadata };

    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(authorize.mock.calls[0][1].author).toEqual({ kind: "AI", source: "GENERATED", action: "OTHER" });
  });

  it("copes with a message that has no metadata at all", async () => {
    message = { actor_kind: "AI", actor_id: null, metadata: null };

    const result = await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(result.processed).toBe(1);
    expect(authorize.mock.calls[0][1].author).toMatchObject({ source: "GENERATED", action: "OTHER" });
  });

  it("audits the send as SENT when the authorization carries an automated decision", async () => {
    const automatedAuthorization = { level: "L3" };
    authorize.mockImplementation(async () => ({ ...allow(), automatedAuthorization }));

    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(recordAutomatedSendDecision).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agencyId: AGENCY, messageId: "msg-1", authorization: automatedAuthorization, source: "APPROVED_TEMPLATE", decision: "SENT" }));
  });

  it("does not audit a send that carried no automated decision", async () => {
    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(recordAutomatedSendDecision).not.toHaveBeenCalled();
  });

  it("audits a refusal as REFUSED, sends nothing, and fails the row with the reasons", async () => {
    const automatedAuthorization = { level: "L3" };
    authorize.mockImplementation(async () => ({ allowed: false, reasons: ["A review is open.", "Second reason."], command: { text: "" }, automatedAuthorization }));

    const result = await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(result).toEqual({ processed: 0, failed: 1 });
    expect(sendReply).not.toHaveBeenCalled();
    expect(recordAutomatedSendDecision).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ decision: "REFUSED" }));
    expect(outboxWrite()?.last_error).toBe("Inbox send refused: A review is open. Second reason.");
  });

  it("audits a refusal once and leaves the row DEAD, so no later attempt can audit it again (promotion evidence counts these rows)", async () => {
    authorize.mockImplementation(async () => ({ allowed: false, reasons: ["A review is open."], command: { text: "" }, automatedAuthorization: { level: "L3" } }));
    claimBatches = [[row({ attempts: 1, max_attempts: 3 })]];

    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(recordAutomatedSendDecision.mock.calls.filter(([, input]) => input.decision === "REFUSED")).toHaveLength(1);
    expect(outboxWrite()).toMatchObject({ status: "DEAD" });
  });

  it("still fails the row when writing the refusal audit itself fails", async () => {
    authorize.mockImplementation(async () => ({ allowed: false, reasons: ["No."], command: { text: "" }, automatedAuthorization: { level: "L3" } }));
    recordAutomatedSendDecision.mockRejectedValue(new Error("audit table down"));

    const result = await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(result.failed).toBe(1);
    expect(sendReply).not.toHaveBeenCalled();
  });

  it("still marks the message SENT when writing the sent audit fails", async () => {
    authorize.mockImplementation(async () => ({ ...allow(), automatedAuthorization: { level: "L3" } }));
    recordAutomatedSendDecision.mockRejectedValue(new Error("audit table down"));

    const result = await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(outboxWrite()).toMatchObject({ status: "SENT" });
  });
});

describe("outbox drain: what is retried and what is given up on", () => {
  it.each([
    ["the message is gone", () => { message = null; }],
    ["the conversation is gone", () => { conversation = null; }],
    ["the connection is gone", () => { connection = null; }],
  ])("dead-letters at once when %s, because retrying cannot help", async (_label, arrange) => {
    arrange();

    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(outboxWrite()).toMatchObject({ status: "DEAD", last_error: "Outbox connection, conversation or message is no longer available." });
    expect(messageWrite()).toMatchObject({ delivery_status: "FAILED" });
    expect(sendReply).not.toHaveBeenCalled();
  });

  it("dead-letters at once when no adapter is installed for the provider", async () => {
    getChannelAdapter.mockImplementation(() => {
      throw new Error("No adapter is installed for TELEGRAM.");
    });

    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(outboxWrite()).toMatchObject({ status: "DEAD" });
  });

  it.each([
    ["the channel has no integration link", () => { resolvedConnection = null; }, "WhatsApp connection is missing its integration link."],
    ["the account is disconnected", () => { resolvedConnection = { accountId: "acct", credentialRef: "ref", status: "DISCONNECTED" }; }, "WhatsApp is not connected for this agency."],
    ["the credential reference is missing", () => { resolvedConnection = { accountId: "acct", status: "CONNECTED" }; }, "WhatsApp is not connected for this agency."],
    ["the access token cannot be read", () => { token = null; }, "Could not read the WhatsApp access token."],
  ])("retries with a clear message when %s, because staff can fix it", async (_label, arrange, expectedMessage) => {
    arrange();

    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(outboxWrite()).toMatchObject({ status: "QUEUED", last_error: expectedMessage });
    expect(messageWrite()).toBeUndefined();
    expect(sendReply).not.toHaveBeenCalled();
  });

  it("dead-letters a policy refusal at once, with attempts to spare, and marks the message FAILED so staff see it immediately", async () => {
    authorize.mockImplementation(async () => ({ allowed: false, reasons: ["The 24-hour window is closed."], command: { text: "" }, automatedAuthorization: null }));

    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(outboxWrite()).toMatchObject({ status: "DEAD", last_error: "Inbox send refused: The 24-hour window is closed." });
    expect(messageWrite()).toMatchObject({ delivery_status: "FAILED", delivery_error: "Inbox send refused: The 24-hour window is closed." });
  });

  it("still retries when authorization itself could not be checked, because that is an outage and not a decision", async () => {
    authorize.mockRejectedValue(new Error("Could not authorize provider send: connection reset"));

    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(outboxWrite()).toMatchObject({ status: "QUEUED", last_error: "Could not authorize provider send: connection reset" });
    expect(messageWrite()).toBeUndefined();
  });

  it.each([
    ["an author-less staff message", { actor_kind: "STAFF", actor_id: null, metadata: {} }],
    ["a message from an unsupported actor", { actor_kind: "CUSTOMER", actor_id: "c-1", metadata: {} }],
  ])("dead-letters %s at once, before contacting the provider, because no retry can add an author", async (_label, badMessage) => {
    message = badMessage;

    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(outboxWrite()).toMatchObject({ status: "DEAD", last_error: "Outbox message has no supported author." });
    expect(messageWrite()).toMatchObject({ delivery_status: "FAILED", delivery_error: "Outbox message has no supported author." });
    expect(authorize).not.toHaveBeenCalled();
    expect(sendReply).not.toHaveBeenCalled();
  });

  it("retries a provider failure while attempts remain, without marking the message failed", async () => {
    sendReply.mockRejectedValue(new Error("Meta timed out"));

    const result = await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(result).toEqual({ processed: 0, failed: 1 });
    expect(outboxWrite()).toMatchObject({ status: "QUEUED", last_error: "Meta timed out", locked_by: null });
    expect(messageWrite()).toBeUndefined();
  });

  it("dead-letters a provider failure on the last attempt and marks the message FAILED with the reason", async () => {
    claimBatches = [[row({ attempts: 3, max_attempts: 3 })]];
    sendReply.mockRejectedValue(new Error("Meta timed out"));

    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(outboxWrite()).toMatchObject({ status: "DEAD" });
    expect(messageWrite()).toMatchObject({ delivery_status: "FAILED", delivery_error: "Meta timed out" });
  });

  it("reports a thrown value that is not an Error by its text", async () => {
    sendReply.mockRejectedValue("plain string");

    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(outboxWrite()?.last_error).toBe("plain string");
  });

  it("stores at most 2,000 characters of the error", async () => {
    sendReply.mockRejectedValue(new Error("x".repeat(5_000)));
    claimBatches = [[row({ attempts: 3, max_attempts: 3 })]];

    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(String(outboxWrite()?.last_error)).toHaveLength(2_000);
    expect(String(messageWrite()?.delivery_error)).toHaveLength(2_000);
  });
});

describe("outbox drain: backoff", () => {
  const delayMinutes = () => {
    const runAfter = String(outboxWrite()?.run_after);
    return (new Date(runAfter).getTime() - START.getTime()) / 60_000;
  };

  it.each([
    [1, 1],
    [2, 2],
    [3, 4],
    [5, 16],
    [6, 30],
    [20, 30],
  ])("waits %i-attempt failures for %i minutes", async (attempts, expectedMinutes) => {
    claimBatches = [[row({ attempts, max_attempts: 99 })]];
    sendReply.mockRejectedValue(new Error("Meta timed out"));

    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(delayMinutes()).toBe(expectedMinutes);
  });
});

describe("outbox drain: provider connection health", () => {
  it.each(["TOKEN_DEAD", "UNFUNDED"])("reflects a %s failure on the connection so the Inbox shows it, and still retries the row", async (kind) => {
    errorClass = kind;
    const failure = new Error("token rejected");
    sendReply.mockRejectedValue(failure);

    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(reflectSendFailure).toHaveBeenCalledWith(expect.anything(), expect.anything(), AGENCY, kind, failure);
    expect(outboxWrite()).toMatchObject({ status: "QUEUED", last_error: "token rejected" });
  });

  it("does not touch the connection for an ordinary failure", async () => {
    errorClass = "UNKNOWN";
    sendReply.mockRejectedValue(new Error("Meta timed out"));

    await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(reflectSendFailure).not.toHaveBeenCalled();
  });
});

describe("outbox drain: a disposable test agency", () => {
  it("is answered by the simulator and never reaches the real adapter, and the row is recorded as sent", async () => {
    agencyIsTest = true;
    authorize.mockImplementation(async () => ({ ...allow(), simulated: true }));

    const result = await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(sendReply).not.toHaveBeenCalled();
    expect(outboxWrite()).toMatchObject({ status: "SENT", provider_message_id: expect.stringMatching(/^sim\.whatsapp\./) });
    expect(messageWrite()).toMatchObject({ delivery_status: "SENT", external_message_id: expect.stringMatching(/^sim\.whatsapp\./) });
  });

  it("still applies the normal authorization: a refused send is refused for a test agency too", async () => {
    agencyIsTest = true;
    authorize.mockImplementation(async () => ({ allowed: false, simulated: true, reasons: ["Take control of this conversation before replying."], command: { text: "Hello" }, automatedAuthorization: null }));

    const result = await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(result.failed).toBe(1);
    expect(sendReply).not.toHaveBeenCalled();
    expect(outboxWrite()).toMatchObject({ status: "DEAD" });
  });

  it("sends nothing at all when the agency's test status changed between choosing the adapter and authorizing", async () => {
    agencyIsTest = true;
    authorize.mockImplementation(async () => ({ ...allow(), simulated: false }));

    const result = await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(result.failed).toBe(1);
    expect(sendReply).not.toHaveBeenCalled();
    expect(outboxWrite()?.provider_message_id).toBeUndefined();
    expect(outboxWrite()).toMatchObject({ last_error: expect.stringContaining("test status changed") });
  });

  it("never lets a real agency be answered by the simulator", async () => {
    agencyIsTest = false;
    authorize.mockImplementation(async () => ({ ...allow(), simulated: true }));

    const result = await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(result.failed).toBe(1);
    expect(sendReply).not.toHaveBeenCalled();
  });

  it("injects a provider failure by recipient, and reflects a dead token on the connection like the real path", async () => {
    agencyIsTest = true;
    conversation = { external_conversation_id: "sim-fail-token-dead" };
    authorize.mockImplementation(async () => ({ ...allow(), simulated: true }));

    const result = await processDueInboxOutbox({ budgetMs: 5_000 });

    expect(result.failed).toBe(1);
    expect(sendReply).not.toHaveBeenCalled();
    expect(reflectSendFailure).toHaveBeenCalledWith(expect.anything(), expect.anything(), AGENCY, "TOKEN_DEAD", expect.anything());
  });
});
