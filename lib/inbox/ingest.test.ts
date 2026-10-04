import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ConversationRow } from "@/lib/types/whatsapp";

const { ingestInboundMessage, isFirstContact } = await import("./ingest");

const conversationRow = (overrides: Partial<ConversationRow> = {}): ConversationRow =>
  ({
    id: "conv-1",
    agency_id: "agency-1",
    channel: "WHATSAPP",
    external_conversation_id: "94771234567",
    lead_id: null,
    state: "AI_ACTIVE",
    ai_enabled: true,
    created_at: "2026-09-01T10:00:00.000Z",
    ...overrides,
  }) as ConversationRow;

type AtomicResult = { messageId: string; sequenceNumber: number | null; duplicate: boolean; agentJobId: string | null; enrichJobId: string | null };

/**
 * `persistInbound` stands in for the `ingest_inbound_message_atomic` transaction: it reports what the database
 * committed. Its own atomicity (message + jobs all-or-nothing, duplicate handling, foreign-agency rejection) is proven
 * against Postgres by supabase/migrations/20261202094000_sc1_atomic_inbound_persistence.sql and its verify script.
 */
function harness(options: { conversation?: Partial<ConversationRow>; duplicate?: boolean; leadId?: string | null; persist?: Partial<AtomicResult>; lostCreateRace?: boolean } = {}) {
  const calls: string[] = [];
  const conversation = conversationRow(options.conversation);
  const deps = {
    upsertConversation: vi.fn(async (_db: unknown, request: { onLostCreateRace?: () => void }) => {
      calls.push("upsert");
      if (options.lostCreateRace) request.onLostCreateRace?.();
      return conversation;
    }),
    linkLead: vi.fn(async () => {
      calls.push("link");
      return { lead: options.leadId ? ({ id: options.leadId } as never) : null, source: "CREATED" as const };
    }),
    persistInbound: vi.fn(async (_db: unknown, request: { agentJobKind: string | null }): Promise<AtomicResult> => {
      calls.push("persist");
      if (options.duplicate) return { messageId: "msg-1", sequenceNumber: 7, duplicate: true, agentJobId: null, enrichJobId: null };
      return {
        messageId: "msg-1",
        sequenceNumber: 8,
        duplicate: false,
        agentJobId: request.agentJobKind ? "job-1" : null,
        enrichJobId: "enrich-1",
        ...options.persist,
      };
    }),
    setConversationState: vi.fn(async () => {
      calls.push("setState");
    }),
  };
  return { calls, conversation, deps };
}

const input = {
  agencyId: "agency-1",
  provider: "WHATSAPP" as const,
  externalConversationId: "94771234567",
  contactName: "Aisha",
  normalizedPhone: "771234567",
  externalMessageId: "wamid.IN1",
  content: "Hello",
  messageType: "TEXT" as const,
  metadata: { raw_type: "text" },
  agentJobKind: "PROCESS_INBOUND" as const,
};

const db = {} as never;

describe("ingestInboundMessage — a WhatsApp inbound message", () => {
  it("runs conversation → lead link → one atomic write, in that order, with the arguments the webhook always used", async () => {
    const h = harness();
    const result = await ingestInboundMessage(db, input, h.deps);

    expect(h.calls).toEqual(["upsert", "link", "persist"]);
    expect(h.deps.upsertConversation).toHaveBeenCalledWith(db, {
      agencyId: "agency-1",
      channel: "WHATSAPP",
      externalConversationId: "94771234567",
      contactName: "Aisha",
      attribution: null,
      onLostCreateRace: expect.any(Function),
    });
    expect(h.deps.linkLead).toHaveBeenCalledWith(db, {
      agencyId: "agency-1",
      conversationId: "conv-1",
      provider: "WHATSAPP",
      externalSubjectId: "94771234567",
      displayName: "Aisha",
      normalizedPhone: "771234567",
      email: null,
      createIfMissing: true,
      // MI3.3: the first words a customer writes are extra evidence for the identity graph, never a reason to link.
      messageText: "Hello",
    });
    expect(h.deps.persistInbound).toHaveBeenCalledWith(db, {
      agencyId: "agency-1",
      conversationId: "conv-1",
      externalMessageId: "wamid.IN1",
      content: "Hello",
      messageType: "TEXT",
      metadata: { raw_type: "text" },
      agentJobKind: "PROCESS_INBOUND",
      enrichDelaySeconds: 4,
    });
    expect(result).toMatchObject({ status: "stored", jobId: "job-1", enrichQueued: true, message: { id: "msg-1", role: "user", actor_kind: "CUSTOMER" } });
  });

  it("forwards a sender email to the identity graph as extra evidence, never a reason to link by itself", async () => {
    const h = harness();
    await ingestInboundMessage(db, { ...input, provider: "GMAIL", email: "customer@example.com", normalizedPhone: null, agentAllowed: false }, h.deps);
    expect(h.deps.linkLead).toHaveBeenCalledWith(db, expect.objectContaining({ email: "customer@example.com", normalizedPhone: null }));
  });

  it("stores a redelivery once: no charge hook, no media work, no state change, no second job", async () => {
    const h = harness({ duplicate: true });
    const afterMessageStored = vi.fn();
    const persistMedia = vi.fn(async () => undefined);
    const result = await ingestInboundMessage(db, { ...input, afterMessageStored, agentAllowed: false }, { ...h.deps, persistMedia });

    expect(result.status).toBe("duplicate");
    expect(afterMessageStored).not.toHaveBeenCalled();
    expect(persistMedia).not.toHaveBeenCalled();
    expect(h.deps.setConversationState).not.toHaveBeenCalled();
    // The conversation is still touched and linked before the duplicate is discovered — as it always was.
    expect(h.calls).toEqual(["upsert", "link", "persist"]);
  });

  it("never asks for an agent job while a person owns the conversation", async () => {
    const h = harness({ conversation: { state: "HUMAN_ACTIVE" } });
    const result = await ingestInboundMessage(db, input, h.deps);
    expect(h.deps.persistInbound).toHaveBeenCalledWith(db, expect.objectContaining({ agentJobKind: null }));
    expect(result).toMatchObject({ status: "stored", jobId: null });
  });

  it("never asks for an agent job when it is switched off for the conversation", async () => {
    const h = harness({ conversation: { ai_enabled: false } });
    const result = await ingestInboundMessage(db, input, h.deps);
    expect(h.deps.persistInbound).toHaveBeenCalledWith(db, expect.objectContaining({ agentJobKind: null }));
    expect(result).toMatchObject({ status: "stored", jobId: null });
  });

  it("still asks for the agent while a handoff is only requested — only HUMAN_ACTIVE blocks, as before", async () => {
    const h = harness({ conversation: { state: "HUMAN_REQUESTED" } });
    const result = await ingestInboundMessage(db, input, h.deps);
    expect(result).toMatchObject({ jobId: "job-1" });
  });

  it("runs the after-store hook after the atomic write has committed", async () => {
    const h = harness();
    const afterMessageStored = vi.fn(async () => {
      h.calls.push("hook");
    });
    await ingestInboundMessage(db, { ...input, afterMessageStored }, h.deps);
    expect(h.calls).toEqual(["upsert", "link", "persist", "hook"]);
    expect(afterMessageStored).toHaveBeenCalledWith({ conversation: h.conversation, message: expect.objectContaining({ id: "msg-1", content: "Hello" }) });
  });

  it("reflects a newly linked lead on the conversation it returns", async () => {
    const h = harness({ leadId: "lead-9" });
    const result = await ingestInboundMessage(db, input, h.deps);
    expect(result.conversation.lead_id).toBe("lead-9");
  });

  it("leaves the lead alone when the resolver finds none (ambiguous phone)", async () => {
    const h = harness({ leadId: null });
    const result = await ingestInboundMessage(db, input, h.deps);
    expect(result.conversation.lead_id).toBeNull();
  });
});

describe("ingestInboundMessage — atomic persistence", () => {
  it("lets a failed atomic write throw, so the webhook answers retryably and never acknowledges a message with no jobs", async () => {
    const h = harness();
    h.deps.persistInbound.mockRejectedValueOnce(new Error("db down"));
    const afterMessageStored = vi.fn();
    await expect(ingestInboundMessage(db, { ...input, afterMessageStored }, h.deps)).rejects.toThrow("db down");
    expect(afterMessageStored).not.toHaveBeenCalled();
    expect(h.deps.setConversationState).not.toHaveBeenCalled();
  });

  it("makes exactly one write for the message and its jobs — never a separate insert followed by separate enqueues", async () => {
    const h = harness();
    await ingestInboundMessage(db, input, h.deps);
    expect(h.deps.persistInbound).toHaveBeenCalledTimes(1);
  });

  it("does not let optional media scheduling fail the acknowledged message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness();
    const persistMedia = vi.fn(async () => {
      throw new Error("storage down");
    });
    const result = await ingestInboundMessage(db, input, { ...h.deps, persistMedia });
    expect(result).toMatchObject({ status: "stored", jobId: "job-1" });
  });
});

describe("ingestInboundMessage — agent switched off for the connection", () => {
  it("stores the message, asks for no agent job, and puts an AI-owned thread in front of staff", async () => {
    const h = harness();
    const result = await ingestInboundMessage(db, { ...input, agentAllowed: false }, h.deps);
    expect(result).toMatchObject({ status: "stored", jobId: null });
    expect(h.deps.persistInbound).toHaveBeenCalledWith(db, expect.objectContaining({ agentJobKind: null }));
    expect(h.deps.setConversationState).toHaveBeenCalledWith(db, "conv-1", "HUMAN_REQUESTED");
    expect(result.conversation.state).toBe("HUMAN_REQUESTED");
  });

  it("does not disturb a thread a person already owns or has been asked to take", async () => {
    for (const state of ["HUMAN_ACTIVE", "HUMAN_REQUESTED"] as const) {
      const h = harness({ conversation: { state } });
      await ingestInboundMessage(db, { ...input, agentAllowed: false }, h.deps);
      expect(h.deps.setConversationState).not.toHaveBeenCalled();
    }
  });

  it("is the default allowed, so WhatsApp behaves exactly as before", async () => {
    const h = harness();
    await ingestInboundMessage(db, input, h.deps);
    expect(h.deps.setConversationState).not.toHaveBeenCalled();
    expect(h.deps.persistInbound).toHaveBeenCalledWith(db, expect.objectContaining({ agentJobKind: "PROCESS_INBOUND" }));
  });
});

describe("ingestInboundMessage — a customer's first two messages arriving together", () => {
  it("does not create a second lead when another request just created the conversation, but still stores the message", async () => {
    const h = harness({ lostCreateRace: true });
    const result = await ingestInboundMessage(db, input, h.deps);

    expect(h.deps.linkLead).toHaveBeenCalledWith(db, expect.objectContaining({ createIfMissing: false }));
    expect(h.calls).toEqual(["upsert", "link", "persist"]);
    expect(result.status).toBe("stored");
  });

  it("creates the lead as usual when this request created the conversation", async () => {
    const h = harness();
    await ingestInboundMessage(db, input, h.deps);
    expect(h.deps.linkLead).toHaveBeenCalledWith(db, expect.objectContaining({ createIfMissing: true }));
  });
});

describe("ingestInboundMessage — other channels use the same path", () => {
  it("passes the provider through and carries no phone for an Instagram sender", async () => {
    const h = harness({ conversation: { channel: "INSTAGRAM", external_conversation_id: "1784000000000001" } });
    await ingestInboundMessage(
      db,
      { ...input, provider: "INSTAGRAM", externalConversationId: "1784000000000001", normalizedPhone: null, contactName: "Instagram customer", connectionId: "cc-1" },
      h.deps,
    );
    expect(h.deps.upsertConversation).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ channel: "INSTAGRAM", externalConversationId: "1784000000000001", connectionId: "cc-1" }),
    );
    expect(h.deps.linkLead).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ provider: "INSTAGRAM", externalSubjectId: "1784000000000001", normalizedPhone: null }),
    );
  });
});

describe("ingestInboundMessage — Inbox intelligence enrichment", () => {
  it("queues the ENRICH job in the same write and reports it, so the webhook can kick the REALTIME drain", async () => {
    const h = harness();
    const result = await ingestInboundMessage(db, input, h.deps);
    expect(h.deps.persistInbound).toHaveBeenCalledWith(db, expect.objectContaining({ enrichDelaySeconds: 4 }));
    expect(result).toMatchObject({ status: "stored", enrichQueued: true });
  });

  it("queues it even when a person owns the conversation and no agent job is queued: the gate decides what is worth a model call", async () => {
    const h = harness({ conversation: { state: "HUMAN_ACTIVE" } });
    const result = await ingestInboundMessage(db, input, h.deps);
    expect(result).toMatchObject({ status: "stored", jobId: null, enrichQueued: true });
  });

  it("does not report enrichment for a redelivered message", async () => {
    const h = harness({ duplicate: true });
    const result = await ingestInboundMessage(db, input, h.deps);
    expect(result.status).toBe("duplicate");
  });

  it("an explicit firstContact wins and is not delayed; otherwise a conversation created moments before its message counts as first contact", async () => {
    const h = harness();
    await ingestInboundMessage(db, { ...input, firstContact: true }, h.deps);
    expect(h.deps.persistInbound).toHaveBeenLastCalledWith(db, expect.objectContaining({ enrichDelaySeconds: 0 }));
    expect(isFirstContact("2026-09-20T10:00:00.000Z", "2026-09-20T10:00:01.200Z")).toBe(true);
    expect(isFirstContact("2026-09-01T10:00:00.000Z", "2026-09-20T10:00:01.200Z")).toBe(false);
    expect(isFirstContact(null, "2026-09-20T10:00:01.200Z")).toBe(false);
  });
});
