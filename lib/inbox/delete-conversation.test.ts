import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { deleteConversationPermanently } from "./delete-conversation";

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONVERSATION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

interface RecordedStep { table: string; op: "select" | "delete"; filters: Record<string, unknown> }

/** A recording stand-in for the admin client: every query is logged in order, and each table answers from a small script. */
function fakeAdminDb(options: { conversation: { id: string; channel: string } | null; messageIds?: string[]; attachmentPaths?: string[]; failOn?: string }) {
  const steps: RecordedStep[] = [];
  const removedObjects: string[][] = [];
  let messagePages = 0;

  const db = {
    from(table: string) {
      const step: RecordedStep = { table, op: "select", filters: {} };
      let logged = false;
      const log = () => { if (!logged) { logged = true; steps.push(step); } };
      const builder: Record<string, unknown> = {
        select: () => builder,
        delete: () => { step.op = "delete"; return builder; },
        eq: (column: string, value: unknown) => { step.filters[column] = value; return builder; },
        in: (column: string, value: unknown) => { step.filters[column] = value; return builder; },
        limit: () => builder,
        maybeSingle: () => { log(); return Promise.resolve({ data: table === "conversations" ? options.conversation : null, error: null }); },
        then: (resolve: (value: { data: unknown; error: { message: string } | null; count?: number }) => void) => {
          log();
          if (options.failOn === table && step.op === "delete") return resolve({ data: null, error: { message: `${table} refused` } });
          if (table === "conversation_messages" && step.op === "select") {
            const ids = options.messageIds ?? [];
            messagePages += 1;
            return resolve({ data: messagePages === 1 ? ids.map((id) => ({ id })) : [], error: null });
          }
          if (table === "message_attachments") return resolve({ data: (options.attachmentPaths ?? []).map((storage_path, index) => ({ id: `att-${index}`, storage_path })), error: null });
          return resolve({ data: null, error: null, count: 1 });
        },
      };
      return builder;
    },
    storage: { from: () => ({ remove: (paths: string[]) => { removedObjects.push(paths); return Promise.resolve({ error: null }); } }) },
  };
  return { db: db as never, steps, removedObjects };
}

describe("deleteConversationPermanently", () => {
  it("deletes nothing when the conversation is not this agency's", async () => {
    const fake = fakeAdminDb({ conversation: null });

    const result = await deleteConversationPermanently(fake.db, { agencyId: AGENCY, conversationId: CONVERSATION });

    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(fake.steps.filter((step) => step.op === "delete")).toEqual([]);
    expect(fake.steps[0]).toMatchObject({ table: "conversations", filters: { agency_id: AGENCY, id: CONVERSATION } });
  });

  it("clears the send queue before the messages and the conversation, and scopes every delete to the agency", async () => {
    const fake = fakeAdminDb({ conversation: { id: CONVERSATION, channel: "WHATSAPP" }, messageIds: ["m1", "m2"] });

    const result = await deleteConversationPermanently(fake.db, { agencyId: AGENCY, conversationId: CONVERSATION });

    expect(result).toMatchObject({ ok: true, channel: "WHATSAPP" });
    const deletes = fake.steps.filter((step) => step.op === "delete");
    expect(deletes.map((step) => step.table)).toEqual(["outbox_messages", "conversation_messages", "ai_runs", "agent_runs", "conversations"]);
    for (const step of deletes) expect(step.filters.agency_id).toBe(AGENCY);
    expect(deletes[0].filters.conversation_id).toEqual([CONVERSATION]);
    expect(deletes.at(-1)?.filters.id).toEqual([CONVERSATION]);
  });

  it("removes the stored files of the conversation's attachments", async () => {
    const fake = fakeAdminDb({ conversation: { id: CONVERSATION, channel: "INSTAGRAM" }, messageIds: ["m1"], attachmentPaths: ["agency/a.pdf", "agency/b.jpg"] });

    const result = await deleteConversationPermanently(fake.db, { agencyId: AGENCY, conversationId: CONVERSATION });

    expect(result).toMatchObject({ ok: true, objectsDeleted: 2 });
    expect(fake.removedObjects).toEqual([["agency/a.pdf", "agency/b.jpg"]]);
  });

  it("stops and reports the failure when the send queue cannot be cleared, so the conversation is left whole", async () => {
    const fake = fakeAdminDb({ conversation: { id: CONVERSATION, channel: "WHATSAPP" }, messageIds: ["m1"], failOn: "outbox_messages" });

    await expect(deleteConversationPermanently(fake.db, { agencyId: AGENCY, conversationId: CONVERSATION })).rejects.toThrow("outbox_messages refused");

    const deletes = fake.steps.filter((step) => step.op === "delete").map((step) => step.table);
    expect(deletes).toEqual(["outbox_messages"]);
  });
});
