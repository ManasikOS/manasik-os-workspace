import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
const events = read("20261202094100_sc2_typed_inbox_realtime_events.sql");
const sequence = read("20261202094150_sc2_message_sequence_assignment.sql");

describe("SC2 migration content", () => {
  it("emits no free text: the event builder names only ids, enums and counters", () => {
    for (const forbidden of ["content", "contact_name", "contact_phone", "last_message_preview", "body", "note_body", "summary"]) {
      expect(events).not.toMatch(new RegExp(`p_row\\s*->>?\\s*'${forbidden}'`));
    }
  });

  it("pins search_path on the functions it defines and locks execution down", () => {
    expect(events.match(/set search_path = ''/g)?.length).toBeGreaterThanOrEqual(2);
    expect(events).toContain("revoke all on function public.build_inbox_realtime_event(text, text, jsonb) from public, anon, authenticated;");
    expect(events).toContain("revoke all on function public.broadcast_inbox_invalidation() from public, anon, authenticated;");
  });

  it("does not create or alter objects in the managed realtime schema; it only calls realtime.send", () => {
    expect(events).not.toMatch(/(create|alter|drop)\s+[a-z ]*realtime\./i);
    expect(sequence).not.toMatch(/(create|alter|drop)\s+[a-z ]*realtime\./i);
    expect(events).toContain("realtime.send(");
  });

  it("keeps the topic agency segment unchanged, so the existing realtime.messages policy still confines every event", () => {
    expect(events).toContain("'inbox:' || v_agency_id::text, true");
    expect(events).toContain("'inbox:' || v_agency_id::text || ':conversation:' || v_conversation_id::text, true");
  });

  it("keeps the sequence counter off the conversations table and unreadable by session roles", () => {
    expect(sequence).toContain("create table if not exists public.conversation_message_counters");
    expect(sequence).toContain("enable row level security");
    expect(sequence).toContain("revoke all on table public.conversation_message_counters from anon, authenticated;");
    expect(sequence).not.toMatch(/alter table public\.conversations/);
    expect(sequence).toContain("before insert on public.conversation_messages");
  });
});
