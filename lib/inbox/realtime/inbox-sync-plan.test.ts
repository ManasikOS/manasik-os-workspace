import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseInboxRealtimeEvent } from "./contracts";
import { createInboxEventBatcher, isEmptyInboxSyncPlan, MAX_LIST_PATCHES_PER_FLUSH, planInboxSync, type InboxSyncPlan } from "./inbox-sync-plan";

const uuid = (n: number) => `3f1d2c4e-5a6b-4c7d-8e9f-${String(n).padStart(12, "0")}`;
const OPEN = uuid(1);
const OTHER = uuid(2);

const list = (conversationId: string, conversationVersion = 1) => ({ schemaVersion: 1, scope: "LIST", reason: "CONVERSATION", conversationId, conversationVersion });
const message = (conversationId: string, operation: "INSERT" | "UPDATE" | "DELETE", entityId = uuid(100), sequenceNumber = 5) => ({
  schemaVersion: 1, scope: "THREAD", entity: "MESSAGE", entityId, operation, conversationId, sequenceNumber,
});
const noteEvent = (conversationId: string, operation: "INSERT" | "UPDATE" | "DELETE", entityId = uuid(200)) => ({ schemaVersion: 1, scope: "THREAD", entity: "NOTE", entityId, operation, conversationId });
const revision = (scope: "CONTEXT" | "INTELLIGENCE" | "PRESENCE", conversationId: string) => ({ schemaVersion: 1, scope, conversationId, revision: "r1" });

const plan = (payloads: unknown[], activeConversationId: string | null = OPEN) => planInboxSync(payloads.map(parseInboxRealtimeEvent), { activeConversationId });

describe("planInboxSync", () => {
  it("turns one inbound message into one list patch and one newer-messages read — never a four-part reload", () => {
    const result = plan([list(OPEN), list(OPEN), message(OPEN, "INSERT"), message(OPEN, "INSERT")]);
    expect(result.listPatchConversationIds).toEqual([OPEN]);
    expect(result.thread).toEqual({ refetchNewer: true, messageIds: [], fullReload: false });
    expect(result).toMatchObject({ reconcile: false, reloadList: false, context: false, intelligence: false, presence: false, notes: null });
  });

  it("coalesces several updates to the same message and folds different messages into one delivery read", () => {
    const result = plan([message(OPEN, "UPDATE", uuid(101)), message(OPEN, "UPDATE", uuid(101)), message(OPEN, "UPDATE", uuid(102))]);
    expect(result.thread).toEqual({ refetchNewer: false, messageIds: [uuid(101), uuid(102)], fullReload: false });
  });

  it("combines a new message with a delivery update in one thread read", () => {
    const result = plan([message(OPEN, "INSERT"), message(OPEN, "UPDATE", uuid(101))]);
    expect(result.thread).toEqual({ refetchNewer: true, messageIds: [uuid(101)], fullReload: false });
  });

  it("keeps context and intelligence independent, so a slow rail never gates the transcript", () => {
    const result = plan([revision("INTELLIGENCE", OPEN)]);
    expect(result).toMatchObject({ intelligence: true, context: false, thread: null });
    expect(plan([revision("CONTEXT", OPEN)])).toMatchObject({ context: true, intelligence: false });
    expect(plan([revision("PRESENCE", OPEN)])).toMatchObject({ presence: true, thread: null });
  });

  it("reads notes by delta: a new note asks for newer notes, an edit or delete names the note", () => {
    expect(plan([noteEvent(OPEN, "INSERT")]).notes).toEqual({ refetchNewer: true, noteIds: [] });
    expect(plan([noteEvent(OPEN, "UPDATE", uuid(201)), noteEvent(OPEN, "DELETE", uuid(202))]).notes).toEqual({ refetchNewer: false, noteIds: [uuid(201), uuid(202)] });
  });

  it("ignores thread, note, intelligence, context and presence events of a conversation nobody has open", () => {
    const result = plan([message(OTHER, "INSERT"), noteEvent(OTHER, "INSERT"), revision("INTELLIGENCE", OTHER), revision("CONTEXT", OTHER), revision("PRESENCE", OTHER)]);
    expect(isEmptyInboxSyncPlan(result)).toBe(true);
  });

  it("still patches the list row of a conversation nobody has open", () => {
    expect(plan([list(OTHER)]).listPatchConversationIds).toEqual([OTHER]);
  });

  it("does nothing thread-related when no conversation is open, but still patches the list", () => {
    const result = plan([list(OPEN), message(OPEN, "INSERT")], null);
    expect(result.listPatchConversationIds).toEqual([OPEN]);
    expect(result.thread).toBeNull();
  });

  it("asks for a full transcript reload only for what a delta cannot express: a deleted message, or an artifact event with no message to target", () => {
    expect(plan([message(OPEN, "DELETE")]).thread?.fullReload).toBe(true);
    const untargeted = { schemaVersion: 1, scope: "THREAD", entity: "ATTACHMENT", entityId: uuid(300), operation: "INSERT", conversationId: OPEN };
    expect(plan([untargeted]).thread?.fullReload).toBe(true);
  });

  it("re-reads just the message an attachment or media analysis belongs to, so a finished analysis reaches the open thread cheaply", () => {
    const attachment = { schemaVersion: 1, scope: "THREAD", entity: "ATTACHMENT", entityId: uuid(300), operation: "INSERT", conversationId: OPEN, messageId: uuid(101) };
    const analysis = { ...attachment, entity: "MEDIA_ANALYSIS", entityId: uuid(301), operation: "UPDATE" };
    expect(plan([attachment, analysis]).thread).toEqual({ refetchNewer: false, messageIds: [uuid(101)], fullReload: false });
    expect(plan([{ ...attachment, operation: "DELETE" }]).thread?.fullReload).toBe(true);
  });

  it("answers any unparseable event with ONE reconciliation and nothing else", () => {
    const result = plan([list(OPEN), message(OPEN, "INSERT"), { conversation_id: OPEN }, { schemaVersion: 2, scope: "LIST" }]);
    expect(result).toEqual({ reconcile: true, reloadList: false, listPatchConversationIds: [], thread: null, notes: null, context: false, intelligence: false, presence: false });
  });

  it("turns a burst across many conversations into one first-page reload instead of many patches", () => {
    const burst = Array.from({ length: MAX_LIST_PATCHES_PER_FLUSH + 1 }, (_, index) => list(uuid(1000 + index)));
    const result = plan(burst);
    expect(result.reloadList).toBe(true);
    expect(result.listPatchConversationIds).toEqual([]);
    const exactlyAtLimit = plan(burst.slice(0, MAX_LIST_PATCHES_PER_FLUSH));
    expect(exactlyAtLimit.reloadList).toBe(false);
    expect(exactlyAtLimit.listPatchConversationIds).toHaveLength(MAX_LIST_PATCHES_PER_FLUSH);
  });

  it("plans nothing for no events", () => {
    expect(isEmptyInboxSyncPlan(plan([]))).toBe(true);
  });
});

describe("open-chat catch-up", () => {
  it("asks for the newer messages and notes of the open chat, and nothing else", () => {
    const result = planInboxSync([{ status: "catchup" }], { activeConversationId: OPEN });
    expect(result.thread).toEqual({ refetchNewer: true, messageIds: [], fullReload: false });
    expect(result.notes).toEqual({ refetchNewer: true, noteIds: [] });
    expect(result).toMatchObject({ reconcile: false, reloadList: false, listPatchConversationIds: [] });
  });

  it("asks for nothing when no chat is open", () => {
    expect(isEmptyInboxSyncPlan(planInboxSync([{ status: "catchup" }], { activeConversationId: null }))).toBe(true);
  });
});

describe("createInboxEventBatcher", () => {
  let flushed: InboxSyncPlan[];
  beforeEach(() => {
    vi.useFakeTimers();
    flushed = [];
  });
  afterEach(() => vi.useRealTimers());

  const make = (options: { windowMs?: number; maxWaitMs?: number } = {}) => {
    const batcher = createInboxEventBatcher({ onFlush: (result) => flushed.push(result), now: () => Date.now(), ...options });
    batcher.setActiveConversation(OPEN);
    return batcher;
  };

  it("a catch-up for the open chat flushes one thread and notes read", () => {
    const batcher = make({ windowMs: 150 });
    batcher.requestOpenChatCatchUp();
    vi.advanceTimersByTime(150);
    expect(flushed).toHaveLength(1);
    expect(flushed[0].thread?.refetchNewer).toBe(true);
    expect(flushed[0].notes?.refetchNewer).toBe(true);
  });

  it("drops a catch-up asked for a chat that is no longer open", () => {
    const batcher = make({ windowMs: 150 });
    batcher.requestOpenChatCatchUp();
    batcher.setActiveConversation(OTHER);
    vi.advanceTimersByTime(150);
    expect(flushed).toHaveLength(0);
  });

  it("waits one short window, then flushes ONE plan for the whole burst", () => {
    const batcher = make({ windowMs: 150 });
    for (const payload of [list(OPEN), message(OPEN, "INSERT"), list(OPEN), message(OPEN, "INSERT")]) batcher.push(payload);
    expect(flushed).toHaveLength(0);
    vi.advanceTimersByTime(150);
    expect(flushed).toHaveLength(1);
    expect(flushed[0].listPatchConversationIds).toEqual([OPEN]);
    expect(flushed[0].thread?.refetchNewer).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(flushed).toHaveLength(1);
  });

  it("never holds an event past the cap, even when new ones keep arriving", () => {
    const batcher = make({ windowMs: 150, maxWaitMs: 400 });
    batcher.push(list(OPEN));
    for (let elapsed = 0; elapsed < 400; elapsed += 100) {
      vi.advanceTimersByTime(100);
      batcher.push(list(OPEN));
    }
    expect(flushed.length).toBeGreaterThanOrEqual(1);
  });

  it("stays far inside the 2-second inbound-visible budget by default", () => {
    const batcher = make();
    batcher.push(message(OPEN, "INSERT"));
    vi.advanceTimersByTime(499);
    expect(flushed.length).toBe(1);
  });

  it("collapses simultaneous reconnect signals into exactly one reconciliation", () => {
    const batcher = make();
    batcher.requestReconcile();
    batcher.requestReconcile();
    batcher.requestReconcile();
    vi.advanceTimersByTime(150);
    expect(flushed).toHaveLength(1);
    expect(flushed[0].reconcile).toBe(true);
  });

  it("reads nothing while the tab is hidden, then reconciles once when it is shown", () => {
    const batcher = make();
    batcher.setVisible(false);
    for (let index = 0; index < 20; index += 1) batcher.push(message(OPEN, "INSERT"));
    vi.advanceTimersByTime(10_000);
    expect(flushed).toHaveLength(0);
    batcher.setVisible(true);
    vi.advanceTimersByTime(150);
    expect(flushed).toHaveLength(1);
    expect(flushed[0].reconcile).toBe(true);
  });

  it("does not reconcile on becoming visible when nothing was missed", () => {
    const batcher = make();
    batcher.setVisible(false);
    batcher.setVisible(true);
    vi.advanceTimersByTime(1000);
    expect(flushed).toHaveLength(0);
  });

  it("drops held thread events when the person switches conversations, but keeps list and reconcile signals", () => {
    const batcher = make();
    batcher.push(message(OPEN, "INSERT"));
    batcher.push(list(OPEN));
    batcher.setActiveConversation(OTHER);
    vi.advanceTimersByTime(150);
    expect(flushed).toHaveLength(1);
    expect(flushed[0].thread).toBeNull();
    expect(flushed[0].listPatchConversationIds).toEqual([OPEN]);
  });

  it("stops after dispose", () => {
    const batcher = make();
    batcher.push(list(OPEN));
    batcher.dispose();
    vi.advanceTimersByTime(1000);
    batcher.push(list(OPEN));
    vi.advanceTimersByTime(1000);
    expect(flushed).toHaveLength(0);
  });
});
