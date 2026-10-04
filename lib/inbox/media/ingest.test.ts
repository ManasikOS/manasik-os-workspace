import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const order: string[] = [];
const enqueued: Array<Record<string, unknown>> = [];
let enqueueResult: unknown = { ok: true, jobId: "job-1", lane: "BULK" };
vi.mock("@/lib/inbox/jobs/queue", () => ({
  enqueueChannelJob: async (_db: unknown, input: Record<string, unknown>) => {
    order.push(`enqueue:${String(input.kind)}`);
    enqueued.push(input);
    return typeof enqueueResult === "function" ? (enqueueResult as () => unknown)() : enqueueResult;
  },
}));

const { persistInboundMediaAttachments } = await import("./ingest");

const AGENCY = "0b8e7c3a-1f4d-4e6a-9d2b-7a1c5e3f9b10";
const MESSAGE = "5d2f9a41-8c7e-4b3a-a6d1-2e9f0c7b4a83";

type Write = { table: string; op: "insert" | "update"; values: Record<string, unknown>; filters: Array<[string, unknown]> };
const writes: Write[] = [];
let attachmentCount = 0;
let errors: Record<string, string | null> = {};

const db = {
  from(table: string) {
    const write: Write = { table, op: "insert", values: {}, filters: [] };
    const outcome = () => {
      const key = `${table}.${write.op}`;
      order.push(key);
      writes.push(write);
      return errors[key] ? { data: null, error: { message: errors[key] } } : { data: table === "message_attachments" ? { id: `att-${++attachmentCount}` } : null, error: null };
    };
    const query: Record<string, unknown> = {
      insert: (values: Record<string, unknown>) => Object.assign(write, { op: "insert", values }) && query,
      update: (values: Record<string, unknown>) => Object.assign(write, { op: "update", values }) && query,
      select: () => query,
      eq: (column: string, value: unknown) => write.filters.push([column, value]) && query,
      single: async () => outcome(),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(outcome()).then(resolve, reject),
    };
    return query;
  },
};

const persist = (attachments: unknown, over: Record<string, unknown> = {}) =>
  persistInboundMediaAttachments(db as never, { agencyId: AGENCY, messageId: MESSAGE, metadata: { attachments, ...over } });

const to = (table: string, op?: Write["op"]) => writes.filter((write) => write.table === table && (!op || write.op === op));
const messageMark = () => to("conversation_messages", "update")[0];

const passport = { type: "image", mime_type: "image/jpeg", filename: "passport.jpg", media_id: "wamid-1", url: "https://cdn.example/1" };
const receipt = { type: "image", mime_type: "image/png", filename: "bank transfer receipt.png" };
const voiceNote = { type: "audio", mime_type: "audio/ogg" };
const brochure = { type: "document", mime_type: "application/pdf", filename: "Umrah itinerary.pdf" };

beforeEach(() => {
  order.length = 0;
  enqueued.length = 0;
  writes.length = 0;
  attachmentCount = 0;
  errors = {};
  enqueueResult = { ok: true, jobId: "job-1", lane: "BULK" };
});

describe("persistInboundMediaAttachments: nothing to do", () => {
  it.each([
    ["no attachments key", {}],
    ["an empty list", { attachments: [] }],
    ["an attachments value that is not a list", { attachments: "passport.jpg" }],
    ["a list of things that are not objects", { attachments: [null, "x", 7, undefined] }],
  ])("writes and queues nothing for %s", async (_label, metadata) => {
    await persistInboundMediaAttachments(db as never, { agencyId: AGENCY, messageId: MESSAGE, metadata });

    expect(writes).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  it("skips entries that are not objects and still handles the ones that are", async () => {
    await persist([null, "x", voiceNote]);

    expect(to("message_attachments", "insert")).toHaveLength(1);
  });
});

describe("persistInboundMediaAttachments: what is stored for one attachment", () => {
  it("stores the attachment with its provider details, in this agency, against this message", async () => {
    await persist([passport]);

    expect(to("message_attachments", "insert")[0].values).toEqual({
      agency_id: AGENCY,
      message_id: MESSAGE,
      provider_media_id: "wamid-1",
      filename: "passport.jpg",
      mime_type: "image/jpeg",
      metadata: { source_url: "https://cdn.example/1", provider_type: "image" },
    });
  });

  it("uses null, never undefined, for details the provider did not send", async () => {
    await persist([{ type: "audio", mime_type: "audio/ogg" }]);

    expect(to("message_attachments", "insert")[0].values).toMatchObject({ provider_media_id: null, filename: null, metadata: { source_url: null, provider_type: "audio" } });
  });

  it("opens a pending analysis for the stored attachment, before anything reads it", async () => {
    await persist([passport]);

    expect(to("message_media_analyses", "insert")[0].values).toEqual({ agency_id: AGENCY, attachment_id: "att-1", message_id: MESSAGE, kind: "PASSPORT", status: "PENDING" });
  });
});

describe("persistInboundMediaAttachments: which job each kind of attachment gets", () => {
  it.each([
    ["a passport", passport, "READ_DOCUMENT", "PASSPORT"],
    ["a receipt", receipt, "EXTRACT_RECEIPT", "RECEIPT"],
    ["a voice note", voiceNote, "TRANSCRIBE_VOICE", "VOICE"],
    ["a brochure", brochure, "READ_DOCUMENT", "BROCHURE"],
    ["an unnamed image", { type: "image", mime_type: "image/jpeg" }, "READ_DOCUMENT", "OTHER"],
  ])("queues %s as %s (analysis kind %s)", async (_label, attachment, jobKind, analysisKind) => {
    await persist([attachment]);

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].kind).toBe(jobKind);
    expect(to("message_media_analyses", "insert")[0].values.kind).toBe(analysisKind);
  });

  it("gives each job a key of its own attachment and a payload of ids only, so a redelivery cannot queue it twice", async () => {
    await persist([passport, voiceNote]);

    expect(enqueued.map((job) => [job.coalesceKey, job.payload, job.agencyId])).toEqual([
      ["media:att-1", { attachmentId: "att-1", messageId: MESSAGE }, AGENCY],
      ["media:att-2", { attachmentId: "att-2", messageId: MESSAGE }, AGENCY],
    ]);
  });
});

describe("persistInboundMediaAttachments: what is never stored", () => {
  it.each([
    ["a video by its mime type", { type: "video", mime_type: "video/mp4" }],
    ["a video the provider did not label", { mime_type: "video/quicktime" }],
    ["a video whose provider type says video", { type: "video", mime_type: "application/octet-stream" }],
    ["an archive", { type: "document", mime_type: "application/zip", filename: "photos.zip" }],
    ["an executable", { type: "document", mime_type: "application/x-msdownload", filename: "setup.exe" }],
    ["a file with no type and no mime type", { filename: "mystery" }],
  ])("skips %s: no row, no analysis, no job", async (_label, attachment) => {
    await persist([attachment]);

    expect(to("message_attachments")).toEqual([]);
    expect(to("message_media_analyses")).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  it("still stores the supported attachments that arrive with a video", async () => {
    await persist([{ type: "video", mime_type: "video/mp4" }, voiceNote]);

    expect(to("message_attachments", "insert")).toHaveLength(1);
    expect(enqueued.map((job) => job.kind)).toEqual(["TRANSCRIBE_VOICE"]);
  });
});

describe("persistInboundMediaAttachments: filling in a missing mime type", () => {
  it.each([
    ["audio", "audio/mp4"],
    ["image", "image/jpeg"],
  ])("assumes %s is %s", async (type, expected) => {
    await persist([{ type }]);

    expect(to("message_attachments", "insert")[0].values.mime_type).toBe(expected);
  });

  it("keeps a file that a provider sends without saying what it is, as a document to read", async () => {
    await persist([{ type: "file", filename: "notes" }]);

    expect(to("message_attachments", "insert")[0].values.mime_type).toBe("application/octet-stream");
    expect(enqueued.map((job) => job.kind)).toEqual(["READ_DOCUMENT"]);
  });

  it("prefers the mime type the provider gave over the guess from its type", async () => {
    await persist([{ type: "image", mime_type: "image/png" }]);

    expect(to("message_attachments", "insert")[0].values.mime_type).toBe("image/png");
  });
});

describe("persistInboundMediaAttachments: marking the message as sensitive", () => {
  const kindsMarked = () => messageMark().values.sensitive_kinds;

  it("marks a passport", async () => {
    await persist([passport]);

    expect(kindsMarked()).toEqual(["PASSPORT"]);
  });

  it("marks payment proof", async () => {
    await persist([receipt]);

    expect(kindsMarked()).toEqual(["PAYMENT_PROOF"]);
  });

  it("holds an image nobody has named until the reader has looked at it", async () => {
    await persist([{ type: "image", mime_type: "image/jpeg" }]);

    expect(kindsMarked()).toEqual(["UNCLASSIFIED_IMAGE"]);
  });

  it.each([
    ["a voice note", voiceNote],
    ["a brochure", brochure],
  ])("does not mark %s", async (_label, attachment) => {
    await persist([attachment]);

    expect(kindsMarked()).toEqual([]);
  });

  it("lists each kind once, however many attachments carry it", async () => {
    await persist([passport, { ...passport, filename: "passport page 2.jpg" }, receipt]);

    expect([...(kindsMarked() as string[])].sort()).toEqual(["PASSPORT", "PAYMENT_PROOF"]);
  });

  it("marks the one message it was given, in this agency", async () => {
    await persist([passport]);

    expect(messageMark().filters).toEqual([["id", MESSAGE], ["agency_id", AGENCY]]);
  });

  it("says so plainly when the mark cannot be saved", async () => {
    errors["conversation_messages.update"] = "row locked";

    await expect(persist([passport])).rejects.toThrow("Could not mark attachment sensitivity: row locked");
  });
});

describe("persistInboundMediaAttachments: the message is marked before anything can read its attachments", () => {
  // The column is documented as "marked at ingest, before any model sees the message". Marking after the loop left two gaps: a worker
  // could claim a passport's read job before the mark was written, and one attachment failing to store lost the mark for the others.
  it("marks the message before it stores an attachment or queues any job", async () => {
    await persist([passport, voiceNote]);

    expect(order[0]).toBe("conversation_messages.update");
    expect(order.indexOf("conversation_messages.update")).toBeLessThan(order.findIndex((entry) => entry.startsWith("enqueue:")));
    expect(order.indexOf("conversation_messages.update")).toBeLessThan(order.indexOf("message_attachments.insert"));
  });

  it("stores nothing and queues nothing when the mark cannot be saved, rather than letting a passport through unmarked", async () => {
    errors["conversation_messages.update"] = "row locked";

    await expect(persist([passport])).rejects.toThrow();

    expect(to("message_attachments")).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  it("keeps the mark when a later attachment cannot be stored", async () => {
    errors["message_attachments.insert"] = "disk full";

    await expect(persist([passport, voiceNote])).rejects.toThrow("Could not store the inbound attachment: disk full");

    expect(messageMark().values.sensitive_kinds).toEqual(["PASSPORT"]);
  });
});

describe("persistInboundMediaAttachments: when a write fails", () => {
  it("stops and queues nothing when an attachment cannot be stored", async () => {
    errors["message_attachments.insert"] = "disk full";

    await expect(persist([voiceNote])).rejects.toThrow("Could not store the inbound attachment: disk full");

    expect(to("message_media_analyses")).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  it("names a missing id as such when the store returns none", async () => {
    attachmentCount = 0;
    const original = db.from;
    db.from = ((table: string) => {
      const query = original(table) as Record<string, (...args: unknown[]) => unknown>;
      if (table === "message_attachments") query.single = async () => ({ data: null, error: null });
      return query;
    }) as never;
    try {
      await expect(persist([voiceNote])).rejects.toThrow("Could not store the inbound attachment: no id returned");
    } finally {
      db.from = original;
    }
  });

  it("queues no job for an attachment whose analysis could not be opened", async () => {
    errors["message_media_analyses.insert"] = "constraint";

    await expect(persist([voiceNote])).rejects.toThrow("Could not initialise attachment analysis: constraint");

    expect(enqueued).toEqual([]);
  });

  it("does not fail the message when a job cannot be queued (the failure comes back as a value), and still stores the rest", async () => {
    enqueueResult = { ok: false, error: "queue unavailable" };
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(persist([voiceNote, passport])).resolves.toBeUndefined();

    expect(to("message_attachments", "insert")).toHaveLength(2);
  });
});

describe("persistInboundMediaAttachments: a job that could not be queued is reported, not silent", () => {
  // An attachment whose job was never queued stays PENDING for good, and nothing repairs it, so the log is the only trace.
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("logs which attachment and which job, and why", async () => {
    enqueueResult = { ok: false, error: "queue unavailable" };

    await persist([voiceNote]);

    expect(console.error).toHaveBeenCalledWith("Could not queue the media job TRANSCRIBE_VOICE for attachment att-1:", "queue unavailable");
  });

  it("logs each attachment whose job failed, and only those", async () => {
    let calls = 0;
    enqueueResult = () => (++calls === 2 ? { ok: false, error: "queue unavailable" } : { ok: true, jobId: "job", lane: "BULK" });

    await persist([voiceNote, passport, receipt]);

    const logged = vi.mocked(console.error).mock.calls.map((call) => String(call[0]));
    expect(logged).toEqual(["Could not queue the media job READ_DOCUMENT for attachment att-2:"]);
  });

  it("stays quiet when every job was queued", async () => {
    await persist([voiceNote, passport]);

    expect(console.error).not.toHaveBeenCalled();
  });

  it("does not put a filename, a link or any customer detail in the log", async () => {
    enqueueResult = { ok: false, error: "queue unavailable" };

    await persist([{ ...passport, filename: "Aisha Perera passport N1234567.jpg" }]);

    const text = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(text).not.toContain("Aisha");
    expect(text).not.toContain("N1234567");
    expect(text).not.toContain("cdn.example");
  });

  it("still stores the remaining attachments after a failed job", async () => {
    enqueueResult = { ok: false, error: "queue unavailable" };

    await persist([voiceNote, passport]);

    expect(to("message_attachments", "insert")).toHaveLength(2);
    expect(to("conversation_messages", "update")).toHaveLength(1);
  });
});
