import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Regression for "Could not clear the chats." (2026-09-24): deleting a conversation failed when a record raised from
 * one of its messages existed, because the conversation-side foreign key nulls source_conversation_id first and the
 * table's own CHECK (source_message_id IS NULL OR source_conversation_id IS NOT NULL) then rejects the row. The
 * migration detaches source_message_id in a BEFORE DELETE trigger. This pins that it covers EVERY table that has the
 * check, so a ninth table added later cannot silently reintroduce the failure.
 */
const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261202094400_detach_source_messages_on_conversation_delete.sql"), "utf8");

const TABLES_WITH_SOURCE_PAIR_CHECK = [
  "departure_group_bookings",
  "departure_group_tasks",
  "leads",
  "lead_notes",
  "lead_quotes",
  "pilgrims",
  "pilgrim_support_requests",
  "booking_traveller_relationships",
];

describe("detach_conversation_source_messages migration", () => {
  it.each(TABLES_WITH_SOURCE_PAIR_CHECK)("clears source_message_id on %s, scoped to the deleted conversation's own agency", (table) => {
    const update = new RegExp(`update public\\.${table} set source_message_id = null\\s+where source_conversation_id = old\\.id and agency_id = old\\.agency_id and source_message_id is not null;`);
    expect(migration).toMatch(update);
  });

  it("runs BEFORE the delete, so the foreign-key actions never see a source message without its conversation", () => {
    expect(migration).toMatch(/create trigger conversations_detach_source_messages\s+before delete on public\.conversations\s+for each row/);
  });

  it("is a SECURITY DEFINER function with an empty search_path that the API roles cannot call", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("revoke all on function public.detach_conversation_source_messages() from public, anon, authenticated;");
  });

  it("never deletes CRM records: it only nulls the pointer to the deleted message", () => {
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
  });
});
