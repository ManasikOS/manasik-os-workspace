import { describe, expect, it } from "vitest";

import { agencyOfInboxTopic, inboxConversationTopic, inboxListTopic, parseInboxRealtimeEvent } from "./contracts";

const CONVERSATION = "897cec6c-4311-4ef7-8c38-0cccf6be4be9";
const ENTITY = "fc8f896c-5bd3-47dd-be24-eb2529ae7bd1";
const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** The payloads below are the exact shapes public.build_inbox_realtime_event emits (captured from staging). */
const list = { id: "b1", schemaVersion: 1, scope: "LIST", reason: "CONVERSATION", conversationId: CONVERSATION, conversationVersion: 1 };
const message = { id: "b2", schemaVersion: 1, scope: "THREAD", entity: "MESSAGE", entityId: ENTITY, operation: "INSERT", conversationId: CONVERSATION, sequenceNumber: 5 };
const note = { schemaVersion: 1, scope: "THREAD", entity: "NOTE", entityId: ENTITY, operation: "UPDATE", conversationId: CONVERSATION };
const intelligence = { schemaVersion: 1, scope: "INTELLIGENCE", conversationId: CONVERSATION, revision: "2026-09-24T03:38:23.792553+00:00" };

describe("parseInboxRealtimeEvent — every variant the database emits", () => {
  it.each([
    ["a list event", list],
    ["a message event with its sequence", message],
    ["a note event without a sequence", note],
    ["an intelligence event with a string revision", intelligence],
    ["a context event with a numeric revision", { schemaVersion: 1, scope: "CONTEXT", conversationId: CONVERSATION, revision: 3 }],
    ["a presence event", { schemaVersion: 1, scope: "PRESENCE", conversationId: CONVERSATION, revision: "lease-1" }],
    ["an attachment event", { ...note, entity: "ATTACHMENT" }],
    ["a media-analysis delete", { ...note, entity: "MEDIA_ANALYSIS", operation: "DELETE" }],
    ["an attachment event addressed to its message", { ...note, entity: "ATTACHMENT", operation: "INSERT", messageId: "3f1d2c4e-5a6b-4c7d-8e9f-000000000101" }],
  ])("accepts %s", (_name, payload) => {
    expect(parseInboxRealtimeEvent(payload)).toEqual({ status: "ok", event: payload });
  });
});

describe("parseInboxRealtimeEvent — anything else is one bounded reconciliation, never applied", () => {
  it("rejects a payload carrying any field beyond the contract, so PII cannot ride along", () => {
    for (const extra of [{ contact_name: "Aisha" }, { phone: "94771234567" }, { content: "hello" }, { preview: "Secret text" }]) {
      expect(parseInboxRealtimeEvent({ ...list, ...extra })).toEqual({ status: "unknown" });
      expect(parseInboxRealtimeEvent({ ...message, ...extra })).toEqual({ status: "unknown" });
    }
  });

  it("rejects an unknown schema version, scope, entity or operation", () => {
    expect(parseInboxRealtimeEvent({ ...list, schemaVersion: 2 })).toEqual({ status: "unknown" });
    expect(parseInboxRealtimeEvent({ ...list, scope: "BILLING" })).toEqual({ status: "unknown" });
    expect(parseInboxRealtimeEvent({ ...message, entity: "PAYMENT" })).toEqual({ status: "unknown" });
    expect(parseInboxRealtimeEvent({ ...message, operation: "TRUNCATE" })).toEqual({ status: "unknown" });
  });

  it("rejects a missing or malformed conversation id and a missing schema version", () => {
    expect(parseInboxRealtimeEvent({ ...list, conversationId: undefined })).toEqual({ status: "unknown" });
    expect(parseInboxRealtimeEvent({ ...list, conversationId: "not-a-uuid" })).toEqual({ status: "unknown" });
    expect(parseInboxRealtimeEvent({ ...list, schemaVersion: undefined })).toEqual({ status: "unknown" });
  });

  it("rejects the legacy untyped payload and non-object input", () => {
    expect(parseInboxRealtimeEvent({ conversation_id: CONVERSATION })).toEqual({ status: "unknown" });
    for (const junk of [null, undefined, "x", 4, [], [list]]) expect(parseInboxRealtimeEvent(junk)).toEqual({ status: "unknown" });
  });

  it("rejects a non-positive conversation version and a negative sequence", () => {
    expect(parseInboxRealtimeEvent({ ...list, conversationVersion: 0 })).toEqual({ status: "unknown" });
    expect(parseInboxRealtimeEvent({ ...message, sequenceNumber: -1 })).toEqual({ status: "unknown" });
  });
});

describe("topics", () => {
  it("builds the agency and conversation topics with the agency as the second segment the RLS policy reads", () => {
    expect(inboxListTopic(AGENCY)).toBe(`inbox:${AGENCY}`);
    expect(inboxConversationTopic(AGENCY, CONVERSATION)).toBe(`inbox:${AGENCY}:conversation:${CONVERSATION}`);
    expect(agencyOfInboxTopic(inboxListTopic(AGENCY))).toBe(AGENCY);
    expect(agencyOfInboxTopic(inboxConversationTopic(AGENCY, CONVERSATION))).toBe(AGENCY);
  });

  it("returns no agency for a foreign or malformed topic", () => {
    expect(agencyOfInboxTopic("billing:x")).toBeNull();
    expect(agencyOfInboxTopic("inbox")).toBeNull();
    expect(agencyOfInboxTopic("")).toBeNull();
  });
});
