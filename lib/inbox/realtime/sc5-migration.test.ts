import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261202094300_sc5_scoped_inbox_broadcasts.sql"), "utf8").replace(/\r\n/g, "\n");

/** Functions defined by this migration, by name → body, so a rule can be asserted about one routing function at a time. */
function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is defined`).toBeGreaterThan(-1);
  const bodyStart = sql.indexOf("$$", start);
  return sql.slice(bodyStart, sql.indexOf("$$;", bodyStart + 2));
}

describe("SC5 migration content — routing (docs/inbox/scaling.md §6.2)", () => {
  it("sends list events to the agency topic ONLY", () => {
    const body = functionBody("broadcast_inbox_list_event");
    expect(body).toContain("'inbox:' || (v_row ->> 'agency_id')");
    expect(body).not.toContain(":conversation:");
  });

  it("sends thread and intelligence events to the conversation topic ONLY", () => {
    const body = functionBody("broadcast_inbox_conversation_event");
    expect(body).toContain("':conversation:'");
    expect(body.match(/realtime\.send\(/g)).toHaveLength(1);
    expect(body).not.toMatch(/'inbox:' \|\| \(v_row ->> 'agency_id'\)\s*,/);
  });

  it("sends composer presence to the conversation topic only, and never as a list event", () => {
    const body = functionBody("broadcast_inbox_presence_event");
    expect(body.match(/realtime\.send\(/g)).toHaveLength(1);
    expect(body).toContain("':conversation:'");
    expect(body).toContain("'PRESENCE'");
    expect(body).not.toContain("'LIST'");
  });

  it("lets an intervention reach both: the list (queue membership can move) and the open conversation (its card changed)", () => {
    const body = functionBody("broadcast_inbox_intervention_event");
    expect(body.match(/realtime\.send\(/g)).toHaveLength(2);
    expect(body).toContain("'reason', 'INTERVENTION'");
  });

  it("emits a conversations UPDATE only when the visible version advanced, and presence only when the lease changed", () => {
    expect(sql).toContain("after update on public.conversations\n  for each row when (old.version is distinct from new.version)");
    expect(sql).toMatch(/after update of composing_by, composing_at on public\.conversations\s+for each row when \(old\.composing_by is distinct from new\.composing_by or old\.composing_at is distinct from new\.composing_at\)/);
  });

  it("emits a message, note, intelligence or analysis UPDATE only when something visible changed", () => {
    expect(sql).toContain("after update on public.conversation_messages\n  for each row when (old.* is distinct from new.*)");
    expect(sql).toContain("when (old.body is distinct from new.body)");
    expect(sql).toContain("(to_jsonb(old) - 'updated_at' - 'computed_at') is distinct from (to_jsonb(new) - 'updated_at' - 'computed_at')");
    expect(sql).toMatch(/message_media_analyses_inbox_realtime_update\s+after update on public\.message_media_analyses\s+for each row when \(old\.status is distinct/);
  });

  it("gives attachments and media analyses their first triggers, addressed to the message they belong to", () => {
    expect(sql).toContain("create trigger message_attachments_inbox_realtime");
    expect(sql).toContain("create trigger message_media_analyses_inbox_realtime");
    expect(sql).toContain("'messageId', (p_row ->> 'message_id')::uuid");
  });
});

describe("SC5 migration content — safety", () => {
  it("pins search_path on every function it defines and locks execution down", () => {
    const definitions = sql.match(/create or replace function public\.\w+\(/g) ?? [];
    expect(definitions.length).toBe(5);
    expect(sql.match(/set search_path = ''/g)?.length).toBe(5);
    for (const name of ["broadcast_inbox_list_event()", "broadcast_inbox_conversation_event()", "broadcast_inbox_presence_event()", "broadcast_inbox_intervention_event()", "build_inbox_realtime_event(text, text, jsonb)"]) {
      expect(sql).toContain(`revoke all on function public.${name} from public, anon, authenticated;`);
    }
  });

  it("carries no free text: nothing reads content, names, phones, previews or note bodies into a payload", () => {
    for (const forbidden of ["content", "contact_name", "contact_phone", "last_message_preview", "'body'", "transcript'", "summary"]) {
      expect(sql).not.toMatch(new RegExp(`p_row\\s*->>?\\s*${forbidden}`));
    }
  });

  it("does not create or alter objects in the managed realtime schema; it only calls realtime.send", () => {
    expect(sql).not.toMatch(/(create|alter|drop)\s+[a-z ]*realtime\./i);
    expect(sql).toContain("realtime.send(");
  });

  it("keeps the old agency-wide function untouched as the rollback target", () => {
    expect(sql).not.toContain("drop function public.broadcast_inbox_invalidation");
    expect(sql).not.toContain("create or replace function public.broadcast_inbox_invalidation");
  });

  it("never touches the composer-lease or version bookkeeping columns to make an event", () => {
    expect(sql).not.toMatch(/update public\.conversations/);
  });
});
