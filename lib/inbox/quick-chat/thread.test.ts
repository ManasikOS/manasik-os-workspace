import { describe, expect, it } from "vitest";

import { toQuickChatThread, type QuickChatMessageSource } from "./thread";

const row = (overrides: Partial<QuickChatMessageSource>): QuickChatMessageSource => ({
  id: "m",
  role: "user",
  actor_kind: "CUSTOMER",
  actor_name_snapshot: null,
  content: "Hi",
  message_type: "TEXT",
  delivery_status: null,
  delivery_error: null,
  created_at: "2030-01-10T10:00:00Z",
  ...overrides,
});

describe("toQuickChatThread", () => {
  it("orders oldest first and marks direction and author", () => {
    const thread = toQuickChatThread([
      row({ id: "b", role: "staff", actor_kind: "STAFF", actor_name_snapshot: "Amina", content: "Salaam", delivery_status: "READ", created_at: "2030-01-10T10:05:00Z" }),
      row({ id: "a" }),
    ]);
    expect(thread.map((message) => message.id)).toEqual(["a", "b"]);
    expect(thread[0]).toMatchObject({ direction: "IN", author: null, deliveryStatus: null });
    expect(thread[1]).toMatchObject({ direction: "OUT", author: "Amina", deliveryStatus: "READ" });
  });

  it("names the assistant, falls back to Staff, and drops system and tool rows", () => {
    const thread = toQuickChatThread([
      row({ id: "1", role: "assistant", actor_kind: "AI" }),
      row({ id: "2", role: "staff", actor_kind: "STAFF", actor_name_snapshot: " " }),
      row({ id: "3", role: "system", actor_kind: "SYSTEM" }),
      row({ id: "4", role: "tool", actor_kind: "SYSTEM" }),
    ]);
    expect(thread.map((message) => [message.id, message.author])).toEqual([
      ["1", "Assistant"],
      ["2", "Staff"],
    ]);
  });

  it("shows a label for a message with no text, and keeps a delivery failure's reason", () => {
    const [message] = toQuickChatThread([
      row({ content: "", message_type: "IMAGE", role: "staff", actor_kind: "STAFF", delivery_status: "FAILED", delivery_error: "Not delivered" }),
    ]);
    expect(message?.text).not.toBe("");
    expect(message).toMatchObject({ deliveryStatus: "FAILED", deliveryError: "Not delivered" });
  });
});
