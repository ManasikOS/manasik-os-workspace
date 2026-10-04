import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261228090000_inbox_unread_count.sql"), "utf8");

/** Pins the rules the unread-count SQL must keep. How Postgres behaves is proven against a database, not here. */
describe("unread count migration content", () => {
  it("counts only customer messages, after they are stored", () => {
    expect(sql).toContain("after insert on public.conversation_messages");
    expect(sql).toContain("when (new.role = 'user')");
  });

  it("only touches the conversation of the message's own agency", () => {
    expect(sql).toContain("c.id = new.conversation_id");
    expect(sql).toContain("c.agency_id = new.agency_id");
  });

  it("runs as definer with an empty search path and is not callable by clients", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("revoke all on function public.bump_conversation_unread_on_customer_message() from public, anon, authenticated;");
  });
});
