import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

interface Scenario {
  connectError?: (Error & { authenticationFailed?: boolean }) | null;
  uidValidity: bigint;
  uidNext: number;
  messages: Array<{ uid: number; source?: Buffer }>;
}

const scenario: Scenario = { uidValidity: BigInt(1), uidNext: 1, messages: [] };
const releaseLock = vi.fn();

vi.mock("imapflow", () => ({
  ImapFlow: class {
    mailbox: { uidValidity: bigint; uidNext: number } | false = false;
    async connect() {
      if (scenario.connectError) throw scenario.connectError;
    }
    async getMailboxLock() {
      this.mailbox = { uidValidity: scenario.uidValidity, uidNext: scenario.uidNext };
      return { release: releaseLock };
    }
    async *fetch() {
      for (const message of scenario.messages) yield message;
    }
    async logout() {}
  },
}));

const simpleParser = vi.fn();
vi.mock("mailparser", () => ({ simpleParser }));

const ingestInboundMessage = vi.fn();
vi.mock("@/lib/inbox/ingest", () => ({ ingestInboundMessage }));

const { pollAgencyMailbox } = await import("./imap-poll");

/** A chainable stand-in for the Supabase admin client, tailored to imap-poll.ts's own query shapes. */
function fakeDb(options: {
  connectionRow?: Record<string, unknown> | null;
  cursorRow?: { sync_cursor: string | null } | null;
  password?: string | null;
} = {}) {
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const uploads: Array<{ path: string; contentType: string }> = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  const db = {
    from: (table: string) => ({
      select: (columns: string) => {
        const chain = {
          eq: () => chain,
          maybeSingle: async () => {
            if (table === "channel_connections" && columns.includes("credential_ref")) return { data: options.connectionRow ?? null, error: null };
            if (table === "channel_connections" && columns === "sync_cursor") return { data: options.cursorRow ?? { sync_cursor: null }, error: null };
            if (table === "agency_settings") return { data: null, error: null };
            return { data: null, error: null };
          },
        };
        return chain;
      },
      update: (patch: Record<string, unknown>) => {
        // Chainable and awaitable after any number of .eq() calls, like the real Supabase builder.
        const chain = {
          eq: () => chain,
          then: (resolve: (value: { error: null }) => void) => {
            updates.push({ table, patch });
            resolve({ error: null });
          },
        };
        return chain;
      },
      insert: async (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return { error: null };
      },
    }),
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "whatsapp_read_secret") return { data: options.password === undefined ? "the-password" : options.password, error: null };
      if (fn === "enqueue_channel_job") {
        rpcCalls.push({ fn, args: args ?? {} });
        return { data: "job-1", error: null };
      }
      return { data: null, error: null };
    },
    storage: {
      from: () => ({
        upload: async (path: string, _bytes: unknown, opts: { contentType: string }) => {
          uploads.push({ path, contentType: opts.contentType });
          return { error: null };
        },
      }),
    },
  };
  return { db: db as never, updates, inserts, uploads, rpcCalls };
}

const connectionRow = { id: "conn-1", credential_ref: "ref-1", provider_metadata: { imapHost: "imap.example.com", imapPort: 993, imapSecurity: "TLS", username: "agency@example.com" } };

beforeEach(() => {
  scenario.connectError = null;
  scenario.uidValidity = BigInt(1);
  scenario.uidNext = 1;
  scenario.messages = [];
  releaseLock.mockClear();
  simpleParser.mockReset();
  ingestInboundMessage.mockReset();
});

describe("pollAgencyMailbox — connection resolution", () => {
  it("reports no_connection when nothing is saved", async () => {
    const { db } = fakeDb({ connectionRow: null });
    const result = await pollAgencyMailbox(db, "a0000000-0000-0000-0000-000000000001");
    expect(result).toEqual({ agencyId: "a0000000-0000-0000-0000-000000000001", status: "no_connection", processed: 0, skipped: 0 });
  });

  it("reports no_connection when the saved metadata is missing an IMAP field", async () => {
    const { db } = fakeDb({ connectionRow: { id: "conn-1", credential_ref: "ref-1", provider_metadata: { imapHost: "imap.example.com" } } });
    const result = await pollAgencyMailbox(db, "a0000000-0000-0000-0000-000000000001");
    expect(result.status).toBe("no_connection");
  });

  it("reports an error when the saved password cannot be read", async () => {
    const { db } = fakeDb({ connectionRow, password: null });
    const result = await pollAgencyMailbox(db, "a0000000-0000-0000-0000-000000000001");
    expect(result).toMatchObject({ status: "error", error: expect.stringContaining("password") });
  });
});

describe("pollAgencyMailbox — authentication", () => {
  it("marks the connection ERROR on an IMAP authentication failure, and reports auth_failed", async () => {
    scenario.connectError = Object.assign(new Error("bad credentials"), { authenticationFailed: true });
    const { db, updates } = fakeDb({ connectionRow });
    const result = await pollAgencyMailbox(db, "a0000000-0000-0000-0000-000000000001");
    expect(result.status).toBe("auth_failed");
    expect(updates).toEqual([{ table: "channel_connections", patch: { status: "ERROR", last_error: "The mail server rejected the stored IMAP password — save the email settings again." } }]);
  });

  it("reports a plain connection error without touching the connection row", async () => {
    scenario.connectError = new Error("connection refused");
    const { db, updates } = fakeDb({ connectionRow });
    const result = await pollAgencyMailbox(db, "a0000000-0000-0000-0000-000000000001");
    expect(result.status).toBe("error");
    expect(updates).toEqual([]);
  });
});

describe("pollAgencyMailbox — cursor bootstrap", () => {
  it("starts from the current UID next on first connect, without importing any existing mail", async () => {
    scenario.uidValidity = BigInt(42);
    scenario.uidNext = 1000;
    const { db, updates } = fakeDb({ connectionRow, cursorRow: { sync_cursor: null } });
    const result = await pollAgencyMailbox(db, "a0000000-0000-0000-0000-000000000001");
    expect(result).toEqual({ agencyId: "a0000000-0000-0000-0000-000000000001", status: "bootstrapped", processed: 0, skipped: 0 });
    expect(updates).toEqual([{ table: "channel_connections", patch: { sync_cursor: JSON.stringify({ uidValidity: "42", lastUid: 999 }), last_inbound_at: expect.any(String) } }]);
    expect(ingestInboundMessage).not.toHaveBeenCalled();
  });

  it("re-bootstraps when the mailbox's UIDVALIDITY no longer matches the stored cursor", async () => {
    scenario.uidValidity = BigInt(99);
    scenario.uidNext = 5;
    const { db } = fakeDb({ connectionRow, cursorRow: { sync_cursor: JSON.stringify({ uidValidity: "1", lastUid: 500 }) } });
    const result = await pollAgencyMailbox(db, "a0000000-0000-0000-0000-000000000001");
    expect(result.status).toBe("bootstrapped");
  });
});

describe("pollAgencyMailbox — normal poll", () => {
  const storedCursor = { sync_cursor: JSON.stringify({ uidValidity: "1", lastUid: 10 }) };

  it("ingests every new message and advances the cursor to the last one processed", async () => {
    scenario.messages = [{ uid: 11, source: Buffer.from("a") }, { uid: 12, source: Buffer.from("b") }];
    simpleParser.mockResolvedValue({ from: { value: [{ address: "customer@example.com", name: "Customer" }] }, subject: "Hi", text: "Hello", messageId: "<m@x>", attachments: [] });
    ingestInboundMessage.mockResolvedValue({ status: "stored", message: { id: "msg-1" } });

    const { db, updates } = fakeDb({ connectionRow, cursorRow: storedCursor });
    const result = await pollAgencyMailbox(db, "a0000000-0000-0000-0000-000000000001");

    expect(result).toEqual({ agencyId: "a0000000-0000-0000-0000-000000000001", status: "polled", processed: 2, skipped: 0 });
    expect(ingestInboundMessage).toHaveBeenCalledTimes(2);
    expect(ingestInboundMessage).toHaveBeenCalledWith(db, expect.objectContaining({ provider: "GMAIL", agentAllowed: false, email: "customer@example.com", externalConversationId: "customer@example.com" }));
    const cursorWrites = updates.filter((u) => "sync_cursor" in u.patch);
    expect(cursorWrites.at(-1)?.patch.sync_cursor).toBe(JSON.stringify({ uidValidity: "1", lastUid: 12 }));
  });

  it("skips a message with no usable From address, but still advances past it", async () => {
    scenario.messages = [{ uid: 11, source: Buffer.from("a") }];
    simpleParser.mockResolvedValue({ from: undefined, subject: "", text: "", attachments: [] });

    const { db, updates } = fakeDb({ connectionRow, cursorRow: storedCursor });
    const result = await pollAgencyMailbox(db, "a0000000-0000-0000-0000-000000000001");

    expect(result).toEqual({ agencyId: "a0000000-0000-0000-0000-000000000001", status: "polled", processed: 0, skipped: 1 });
    expect(ingestInboundMessage).not.toHaveBeenCalled();
    const cursorWrites = updates.filter((u) => "sync_cursor" in u.patch);
    expect(cursorWrites.at(-1)?.patch.sync_cursor).toBe(JSON.stringify({ uidValidity: "1", lastUid: 11 }));
  });

  it("stops without advancing past a message whose ingestion fails transiently, so the next tick retries it", async () => {
    scenario.messages = [{ uid: 11, source: Buffer.from("a") }, { uid: 12, source: Buffer.from("b") }];
    simpleParser.mockResolvedValue({ from: { value: [{ address: "customer@example.com", name: "Customer" }] }, subject: "Hi", text: "Hello", messageId: "<m@x>", attachments: [] });
    ingestInboundMessage.mockRejectedValueOnce(new Error("database is down"));

    const { db, updates } = fakeDb({ connectionRow, cursorRow: storedCursor });
    const result = await pollAgencyMailbox(db, "a0000000-0000-0000-0000-000000000001");

    expect(result).toMatchObject({ status: "error", processed: 0, skipped: 0, error: "database is down" });
    expect(ingestInboundMessage).toHaveBeenCalledTimes(1);
    const cursorWrites = updates.filter((u) => "sync_cursor" in u.patch);
    expect(cursorWrites).toEqual([]); // The stored cursor never moved past UID 11.
  });

  it("ignores a message with no source bytes but still advances past it", async () => {
    scenario.messages = [{ uid: 11 }];
    const { db, updates } = fakeDb({ connectionRow, cursorRow: storedCursor });
    const result = await pollAgencyMailbox(db, "a0000000-0000-0000-0000-000000000001");
    expect(result).toEqual({ agencyId: "a0000000-0000-0000-0000-000000000001", status: "polled", processed: 0, skipped: 1 });
    expect(simpleParser).not.toHaveBeenCalled();
    const cursorWrites = updates.filter((u) => "sync_cursor" in u.patch);
    expect(cursorWrites.at(-1)?.patch.sync_cursor).toBe(JSON.stringify({ uidValidity: "1", lastUid: 11 }));
  });
});

describe("pollAgencyMailbox — attachments", () => {
  const storedCursor = { sync_cursor: JSON.stringify({ uidValidity: "1", lastUid: 10 }) };

  it("stores an accepted attachment with its bytes already retained, and queues its review job", async () => {
    scenario.messages = [{ uid: 11, source: Buffer.from("a") }];
    simpleParser.mockResolvedValue({
      from: { value: [{ address: "customer@example.com", name: "Customer" }] },
      subject: "Passport", text: "See attached", messageId: "<m@x>",
      attachments: [{ filename: "passport.pdf", contentType: "application/pdf", size: 1000, content: Buffer.from("pdf-bytes") }],
    });
    ingestInboundMessage.mockResolvedValue({ status: "stored", message: { id: "msg-1" } });

    const { db, inserts, uploads, rpcCalls } = fakeDb({ connectionRow, cursorRow: storedCursor });
    const result = await pollAgencyMailbox(db, "a0000000-0000-0000-0000-000000000001");

    expect(result.processed).toBe(1);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].contentType).toBe("application/pdf");
    expect(inserts.filter((i) => i.table === "message_attachments")).toHaveLength(1);
    expect(rpcCalls).toEqual([{ fn: "enqueue_channel_job", args: expect.objectContaining({ p_kind: "READ_DOCUMENT" }) }]);
    expect(inserts.filter((i) => i.table === "message_media_analyses")).toHaveLength(1);
  });

  it("never stores a video attachment or one over the size cap", async () => {
    scenario.messages = [{ uid: 11, source: Buffer.from("a") }];
    simpleParser.mockResolvedValue({
      from: { value: [{ address: "customer@example.com", name: "Customer" }] },
      subject: "Files", text: "See attached", messageId: "<m@x>",
      attachments: [
        { filename: "clip.mp4", contentType: "video/mp4", size: 1000, content: Buffer.from("video") },
        { filename: "huge.pdf", contentType: "application/pdf", size: 50 * 1024 * 1024, content: Buffer.alloc(10) },
      ],
    });
    ingestInboundMessage.mockResolvedValue({ status: "stored", message: { id: "msg-1" } });

    const { db, inserts, uploads } = fakeDb({ connectionRow, cursorRow: storedCursor });
    await pollAgencyMailbox(db, "a0000000-0000-0000-0000-000000000001");

    expect(uploads).toHaveLength(0);
    expect(inserts.filter((i) => i.table === "message_attachments")).toHaveLength(0);
  });
});
