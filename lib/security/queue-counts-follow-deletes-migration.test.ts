import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TASK-032 S6. The behavioural proof is supabase/tests/database/queue_counts_follow_deletes.test.sql and needs a database. These checks run in the
 * normal suite and guard the shape of the migration.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const withoutComments = (sql: string) => sql.replace(/^\s*--.*$/gm, "");

describe("queue counts follow deletes migration", () => {
  const sql = withoutComments(read("supabase/migrations/20270108090000_queue_counts_follow_deletes.sql"));

  it("takes a deleted conversation out of the counts of the queues it is in, before the delete, as a locked-down definer function", () => {
    expect(sql).toMatch(/create trigger conversations_release_queues\s+before delete on public\.conversations\s+for each row/);
    expect(sql).toMatch(/security definer\s+set search_path = ''/);
    expect(sql).toMatch(/revoke all on function public\.trg_release_queues_for_deleted_conversation\(\) from public, anon, authenticated;/);
    expect(sql).toMatch(/conversation_count = q\.conversation_count - 1/);
  });

  it("recounts every agency from the membership rows, the source of truth, and checks the result", () => {
    expect(sql).toMatch(/from public\.conversation_queue_membership m\s+group by m\.agency_id, m\.queue_code/);
    expect(sql).toMatch(/on conflict \(agency_id, queue_code\) do update set conversation_count = excluded\.conversation_count/);
    expect(sql).toMatch(/raise exception 'Queue counts follow deletes: %'/);
  });

  it("changes no conversation, message or membership row", () => {
    expect(sql).not.toMatch(/\b(delete\s+from\s+public\.(conversations|conversation_messages|conversation_queue_membership)|update\s+public\.(conversations|conversation_messages)\b)/i);
  });
});
