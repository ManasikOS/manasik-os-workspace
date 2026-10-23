import { describe, expect, it } from "vitest";

import { countUnreadInbound, latestMessageTime, shouldRefreshThread } from "./live";
import type { QuickChatMessage } from "./thread";

const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const thread = { schemaVersion: 1, scope: "THREAD", conversationId: CONVERSATION, entity: "MESSAGE", entityId: OTHER, operation: "INSERT" };

describe("shouldRefreshThread", () => {
  it("reads again for a message or list change of this conversation", () => {
    expect(shouldRefreshThread(thread, CONVERSATION)).toBe(true);
    expect(shouldRefreshThread({ schemaVersion: 1, scope: "LIST", conversationId: CONVERSATION, conversationVersion: 3, reason: "CONVERSATION" }, CONVERSATION)).toBe(true);
  });

  it("ignores other conversations and signals the popup does not show", () => {
    expect(shouldRefreshThread({ ...thread, conversationId: OTHER }, CONVERSATION)).toBe(false);
    expect(shouldRefreshThread({ schemaVersion: 1, scope: "PRESENCE", conversationId: CONVERSATION, revision: 2 }, CONVERSATION)).toBe(false);
  });

  it("reads once for a payload that does not match the contract, never trusting it", () => {
    expect(shouldRefreshThread({ ...thread, text: "leaked message body" }, CONVERSATION)).toBe(true);
    expect(shouldRefreshThread(null, CONVERSATION)).toBe(true);
  });
});

const message = (id: string, direction: "IN" | "OUT", createdAt: string): QuickChatMessage => ({
  id, direction, text: "x", createdAt, deliveryStatus: null, deliveryError: null, author: null,
});

describe("countUnreadInbound", () => {
  const messages = [message("1", "IN", "2030-01-01T10:00:00Z"), message("2", "OUT", "2030-01-01T10:05:00Z"), message("3", "IN", "2030-01-01T10:10:00Z")];

  it("counts only customer messages after the seen time", () => {
    expect(countUnreadInbound(messages, "2030-01-01T10:00:00Z")).toBe(1);
    expect(countUnreadInbound(messages, "2030-01-01T10:10:00Z")).toBe(0);
  });

  it("counts every customer message when nothing has been seen", () => {
    expect(countUnreadInbound(messages, null)).toBe(2);
  });
});

describe("latestMessageTime", () => {
  it("is the newest time, or null for an empty thread", () => {
    expect(latestMessageTime([message("1", "IN", "2030-01-01T10:00:00Z"), message("2", "OUT", "2030-01-01T11:00:00Z")])).toBe("2030-01-01T11:00:00Z");
    expect(latestMessageTime([])).toBeNull();
  });
});
