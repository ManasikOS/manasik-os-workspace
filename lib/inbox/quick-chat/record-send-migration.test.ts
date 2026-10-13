import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * T4 of tasks/quick-chat-todo.md: Finance and Visa send one narrow kind of message from a record page. The function must stay narrow:
 * these checks fail if someone widens it, and if the existing Inbox send gates are touched by the same migration.
 */
const migration = readFileSync(join(process.cwd(), "supabase/migrations/20270215090000_quick_chat_record_send.sql"), "utf8");
const code = migration.replace(/^--.*$/gm, "");

describe("enqueue_record_text_message migration", () => {
  it("is a definer function with a locked search path, callable only by signed-in users", () => {
    expect(code).toMatch(/create or replace function public\.enqueue_record_text_message\(/);
    expect(code).toMatch(/security definer\s+set search_path = ''/);
    expect(code).toContain("revoke all on function public.enqueue_record_text_message(uuid, text, uuid) from public, anon;");
    expect(code).toContain("grant execute on function public.enqueue_record_text_message(uuid, text, uuid) to authenticated;");
  });

  it("is limited to Finance and Visa and to a signed-in caller", () => {
    expect(code).toContain("if auth.uid() is null then");
    expect(code).toContain("if not public.staff_role_in('FINANCE', 'VISA') then");
    expect(code).not.toMatch(/staff_role_in\([^)]*'(ADMIN|MARKETING|OPERATIONS|CEO|GUIDE)'/);
  });

  it("scopes the conversation to the caller's agency and locks it", () => {
    expect(code).toMatch(/where id = p_conversation_id\s+and agency_id = public\.current_agency_id\(\)\s+for update;/);
  });

  it("enforces WhatsApp only, not closed, not a colleague's chat, and an open reply window", () => {
    expect(code).toContain("v_conversation.channel <> 'WHATSAPP'");
    expect(code).toContain("v_conversation.state = 'CLOSED'");
    expect(code).toContain("v_conversation.assigned_to_id <> auth.uid()");
    expect(code).toContain("v_conversation.service_window_expires_at <= now()");
  });

  it("checks for a repeat of the same send before the rules the first attempt may have changed", () => {
    expect(code.indexOf("client_idempotency_key = p_client_idempotency_key::text")).toBeGreaterThan(0);
    expect(code.indexOf("client_idempotency_key = p_client_idempotency_key::text")).toBeLessThan(code.indexOf("record send is WhatsApp only"));
  });

  it("carries no subject, cc, bcc, template or file, and records the owner change", () => {
    expect(code).toContain("'subject', null");
    expect(code).not.toMatch(/p_subject|p_cc|p_bcc|p_storage_path|template/i);
    expect(code).toContain("'OWNER_CHANGED'");
  });

  it("leaves the Inbox's own send functions and policies alone", () => {
    expect(code).not.toMatch(/enqueue_inbox_text_message|enqueue_inbox_media_message/);
    expect(code).not.toMatch(/create policy|alter policy|drop policy/i);
  });
});
