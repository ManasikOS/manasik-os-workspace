import { describe, expect, it } from "vitest";

import type { InboxConversation, InboxConversationListPatch, InboxMessage, InboxNote } from "@/app/inbox/types";

import {
  compareListOrder,
  compareMessageOrder,
  highestMessageSequence,
  mergeListPatch,
  mergeNotesDelta,
  mergeThreadDelta,
  newestNotePosition,
  pruneOlderChats,
} from "./inbox-sync-merge";

const uuid = (n: number) => `3f1d2c4e-5a6b-4c7d-8e9f-${String(n).padStart(12, "0")}`;

const chat = (n: number, activityAt: string, extra: Partial<InboxConversation> = {}) =>
  ({ id: uuid(n), last_activity_at: activityAt, contact_name: `Contact ${n}`, state: "AI_ACTIVE", ...extra }) as unknown as InboxConversation;

const patchFor = (conversation: InboxConversation | null, extra: Partial<InboxConversationListPatch> = {}): InboxConversationListPatch => ({
  conversation,
  inActiveView: conversation !== null,
  lastActivityAt: conversation ? ((conversation as { last_activity_at?: string }).last_activity_at ?? null) : null,
  conversationVersion: 1,
  queueCounts: null,
  viewCounts: null,
  ...extra,
});

describe("pruneOlderChats", () => {
  const row = (id: string, at: string) => ({ id, last_activity_at: at }) as never;
  const ids = (rows: Array<{ id: string }>) => rows.map((chat) => chat.id);

  it("drops a loaded older row that now falls inside the first page but is not in it (it left the view)", () => {
    const first = [row("b", "2026-09-24T10:00:05+00:00"), row("a", "2026-09-24T10:00:04+00:00")];
    const older = [row("gone", "2026-09-24T10:00:04.5+00:00"), row("z", "2026-09-24T10:00:01+00:00")];
    expect(ids(pruneOlderChats(older, first))).toEqual(["z"]);
  });

  it("keeps every older row that still sorts after the first page", () => {
    const first = [row("b", "2026-09-24T10:00:05+00:00")];
    const older = [row("y", "2026-09-24T10:00:02+00:00"), row("z", "2026-09-24T10:00:01+00:00")];
    expect(pruneOlderChats(older, first)).toEqual(older);
  });

  it("drops an older row the first page already holds", () => {
    const first = [row("b", "2026-09-24T10:00:05+00:00"), row("z", "2026-09-24T10:00:01+00:00")];
    expect(pruneOlderChats([row("z", "2026-09-24T10:00:01+00:00")], first)).toEqual([]);
  });

  it("holds nothing older when the first page is empty", () => {
    expect(pruneOlderChats([row("z", "2026-09-24T10:00:01+00:00")], [])).toEqual([]);
  });
});

describe("list order", () => {
  it("sorts newest activity first and breaks ties by id descending, on the exact timestamp string", () => {
    const rows = [chat(1, "2026-09-24T10:00:00.000001+00:00"), chat(2, "2026-09-24T10:00:00.000002+00:00"), chat(3, "2026-09-24T10:00:00.000002+00:00")];
    expect([...rows].sort(compareListOrder).map((row) => row.id)).toEqual([uuid(3), uuid(2), uuid(1)]);
  });
});

describe("mergeListPatch", () => {
  const list = [chat(3, "2026-09-24T10:03:00+00:00"), chat(2, "2026-09-24T10:02:00+00:00"), chat(1, "2026-09-24T10:01:00+00:00")];

  it("replaces an existing row in place and re-sorts it to the top when its activity is newest", () => {
    const updated = chat(1, "2026-09-24T10:09:00+00:00", { state: "HUMAN_ACTIVE" });
    const result = mergeListPatch({ conversations: list, hasOlder: false, patch: patchFor(updated, { conversationVersion: 5 }), heldVersion: 4, conversationId: uuid(1) });
    expect(result).toMatchObject({ outcome: "REPLACED", changed: true, version: 5 });
    expect(result.conversations.map((row) => row.id)).toEqual([uuid(1), uuid(3), uuid(2)]);
    expect(result.conversations[0]).toMatchObject({ state: "HUMAN_ACTIVE" });
  });

  it("ignores a patch older than the version already held, so a slow old response cannot overwrite newer state", () => {
    const stale = chat(1, "2026-09-24T10:00:00+00:00", { state: "CLOSED" });
    const result = mergeListPatch({ conversations: list, hasOlder: false, patch: patchFor(stale, { conversationVersion: 3 }), heldVersion: 7, conversationId: uuid(1) });
    expect(result).toMatchObject({ outcome: "IGNORED_STALE", changed: false, version: 7 });
    expect(result.conversations).toBe(list);
  });

  it("accepts an equal version (an idempotent re-read) and never regresses the held version", () => {
    const same = chat(2, "2026-09-24T10:02:00+00:00");
    const result = mergeListPatch({ conversations: list, hasOlder: false, patch: patchFor(same, { conversationVersion: 7 }), heldVersion: 7, conversationId: uuid(2) });
    expect(result.outcome).toBe("REPLACED");
    expect(result.version).toBe(7);
  });

  it("removes a row that moved out of the active view", () => {
    const moved = chat(2, "2026-09-24T10:02:00+00:00");
    const result = mergeListPatch({ conversations: list, hasOlder: true, patch: patchFor(moved, { inActiveView: false, conversationVersion: 2 }), heldVersion: 1, conversationId: uuid(2) });
    expect(result).toMatchObject({ outcome: "REMOVED", changed: true });
    expect(result.conversations.map((row) => row.id)).toEqual([uuid(3), uuid(1)]);
  });

  it("removes a row that is no longer visible at all, and does nothing for a row it never had", () => {
    expect(mergeListPatch({ conversations: list, hasOlder: false, patch: patchFor(null), heldVersion: undefined, conversationId: uuid(1) }).outcome).toBe("REMOVED");
    const absent = mergeListPatch({ conversations: list, hasOlder: false, patch: patchFor(null), heldVersion: undefined, conversationId: uuid(99) });
    expect(absent).toMatchObject({ outcome: "UNCHANGED", changed: false });
    expect(absent.conversations).toBe(list);
  });

  it("inserts a row that newly enters the view inside the loaded window", () => {
    const entering = chat(4, "2026-09-24T10:04:00+00:00");
    const result = mergeListPatch({ conversations: list, hasOlder: true, patch: patchFor(entering), heldVersion: undefined, conversationId: uuid(4) });
    expect(result.outcome).toBe("INSERTED");
    expect(result.conversations.map((row) => row.id)).toEqual([uuid(4), uuid(3), uuid(2), uuid(1)]);
  });

  it("does not fabricate a page: a row older than the loaded window is left for pagination when more rows exist", () => {
    const old = chat(9, "2026-09-24T09:00:00+00:00");
    const result = mergeListPatch({ conversations: list, hasOlder: true, patch: patchFor(old), heldVersion: undefined, conversationId: uuid(9) });
    expect(result).toMatchObject({ outcome: "NOT_IN_WINDOW", changed: false });
    expect(result.conversations).toBe(list);
  });

  it("does insert an older row once the list is complete (no next page exists)", () => {
    const old = chat(9, "2026-09-24T09:00:00+00:00");
    const result = mergeListPatch({ conversations: list, hasOlder: false, patch: patchFor(old), heldVersion: undefined, conversationId: uuid(9) });
    expect(result.outcome).toBe("INSERTED");
    expect(result.conversations[result.conversations.length - 1].id).toBe(uuid(9));
  });

  it("keeps every already-loaded older page: only the one row is touched", () => {
    const withPages = Array.from({ length: 250 }, (_, index) => chat(index + 1, `2026-09-24T10:${String(59 - Math.floor(index / 10)).padStart(2, "0")}:${String(59 - (index % 10)).padStart(2, "0")}+00:00`));
    const sorted = [...withPages].sort(compareListOrder);
    const target = sorted[100];
    const result = mergeListPatch({ conversations: sorted, hasOlder: true, patch: patchFor({ ...target, state: "CLOSED" } as InboxConversation, { conversationVersion: 2 }), heldVersion: 1, conversationId: target.id });
    expect(result.conversations).toHaveLength(250);
    expect(new Set(result.conversations.map((row) => row.id)).size).toBe(250);
  });
});

const message = (n: number, sequence: number | null, extra: Partial<InboxMessage> = {}) =>
  ({ id: uuid(n), conversation_id: uuid(500), sequence_number: sequence, created_at: `2026-09-24T10:00:${String(n).padStart(2, "0")}Z`, content: `m${n}`, delivery_status: "SENT", ...extra }) as unknown as InboxMessage;

const noArtifacts = { attachments: [], mediaAnalyses: [] };

describe("mergeThreadDelta", () => {
  it("appends new messages at their sequence position", () => {
    const result = mergeThreadDelta({ messages: [message(1, 1), message(2, 2)], ...noArtifacts }, { messages: [message(3, 3), message(4, 4)], ...noArtifacts });
    expect(result.messages.map((row) => row.id)).toEqual([uuid(1), uuid(2), uuid(3), uuid(4)]);
    expect(result.changed).toBe(true);
  });

  it("orders out-of-order arrival by sequence, not by arrival", () => {
    const first = mergeThreadDelta({ messages: [message(1, 1)], ...noArtifacts }, { messages: [message(4, 4)], ...noArtifacts });
    const second = mergeThreadDelta(first, { messages: [message(2, 2), message(3, 3)], ...noArtifacts });
    expect(second.messages.map((row) => row.id)).toEqual([uuid(1), uuid(2), uuid(3), uuid(4)]);
  });

  it("patches delivery status in place: same bubble, same position, same id", () => {
    const current = { messages: [message(1, 1), message(2, 2, { delivery_status: "SENT" }), message(3, 3)], ...noArtifacts };
    const result = mergeThreadDelta(current, { messages: [message(2, 2, { delivery_status: "DELIVERED" })], ...noArtifacts });
    expect(result.messages.map((row) => row.id)).toEqual([uuid(1), uuid(2), uuid(3)]);
    expect(result.messages[1].delivery_status).toBe("DELIVERED");
    expect(result.messages).toHaveLength(3);
  });

  it("is idempotent: the same delta twice returns the SAME arrays and reports no change", () => {
    const current = { messages: [message(1, 1)], ...noArtifacts };
    const once = mergeThreadDelta(current, { messages: [message(2, 2)], ...noArtifacts });
    const twice = mergeThreadDelta(once, { messages: [message(2, 2)], ...noArtifacts });
    expect(twice.changed).toBe(false);
    expect(twice.messages).toBe(once.messages);
    expect(twice.attachments).toBe(once.attachments);
  });

  it("an empty delta changes nothing", () => {
    const current = { messages: [message(1, 1)], ...noArtifacts };
    const result = mergeThreadDelta(current, { messages: [], ...noArtifacts });
    expect(result.changed).toBe(false);
    expect(result.messages).toBe(current.messages);
  });

  it("merges artifacts by their own ids without disturbing message order", () => {
    const attachment = { id: uuid(700), message_id: uuid(2), filename: "a.pdf", mime_type: "application/pdf", original_href: null, expires_at: null, promoted_document_id: null };
    const result = mergeThreadDelta({ messages: [message(1, 1), message(2, 2)], ...noArtifacts }, { messages: [], attachments: [attachment], mediaAnalyses: [] });
    expect(result.attachments).toEqual([attachment]);
    expect(result.changed).toBe(true);
  });

  it("falls back to time then id to place a legacy message with no sequence", () => {
    const result = mergeThreadDelta({ messages: [message(1, 1), message(3, 3)], ...noArtifacts }, { messages: [message(2, null)], ...noArtifacts });
    expect(result.messages.map((row) => row.id)).toEqual([uuid(1), uuid(2), uuid(3)]);
  });
});

describe("thread sequence helpers", () => {
  it("finds the highest sequence to ask after, and 0 when none carries one", () => {
    expect(highestMessageSequence([message(1, 1), message(2, 9), message(3, 4)])).toBe(9);
    expect(highestMessageSequence([message(1, null)])).toBe(0);
    expect(highestMessageSequence([])).toBe(0);
  });

  it("orders by sequence when both have one, by time otherwise", () => {
    expect(compareMessageOrder(message(1, 5), message(2, 3))).toBeGreaterThan(0);
    expect(compareMessageOrder(message(1, null), message(2, 3))).toBeLessThan(0);
  });
});

const note = (n: number) => ({ id: uuid(n), conversation_id: uuid(500), body: `n${n}`, author_id: uuid(600), author_name_snapshot: "A", created_at: `2026-09-24T10:00:0${n}.000001+00:00` }) as InboxNote;

describe("mergeNotesDelta", () => {
  it("adds new notes, updates a changed one in place, and removes a deleted one", () => {
    const current = [note(1), note(2), note(3)];
    const result = mergeNotesDelta(current, { notes: [{ ...note(2), body: "edited" }, note(4)], removedNoteIds: [uuid(3)], hasMore: false });
    expect(result.notes.map((row) => row.id)).toEqual([uuid(1), uuid(2), uuid(4)]);
    expect(result.notes[1].body).toBe("edited");
    expect(result.changed).toBe(true);
  });

  it("reports no change for a duplicate delta and returns the same array", () => {
    const current = [note(1), note(2)];
    const result = mergeNotesDelta(current, { notes: [note(2)], removedNoteIds: [], hasMore: false });
    expect(result.changed).toBe(false);
    expect(result.notes).toBe(current);
  });

  it("gives the keyset position of the newest note, or null with none", () => {
    expect(newestNotePosition([note(1), note(3), note(2)])).toEqual({ createdAt: note(3).created_at, id: uuid(3) });
    expect(newestNotePosition([])).toBeNull();
  });
});
