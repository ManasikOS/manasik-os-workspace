import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8").replace(/\r\n/g, "\n");
const spam = read("20261222090000_inbox_spam_lifecycle_queues.sql");
const commercial = read("20261202091400_mi3_4_commercial_queues.sql");
const original = read("20261202090500_mi2_2_conversation_queues.sql");

function functionBody(sql: string): string {
  const start = sql.indexOf("create or replace function public.compute_conversation_queues");
  return sql.slice(start, sql.indexOf("revoke all on function public.compute_conversation_queues"));
}

describe("PRD-03 spam lifecycle queue migration", () => {
  it("treats a conversation as spam when its lifecycle is SPAM or its lead's stage is SPAM", () => {
    expect(functionBody(spam)).toContain("(coalesce(l.stage = 'SPAM', false) or coalesce(c.lifecycle_status = 'SPAM', false)) as is_spam,");
  });

  it("is null-safe: a conversation whose lifecycle_status is NULL must never become NULL spam and vanish from every queue", () => {
    const body = functionBody(spam);
    // `x or NULL` is NULL in SQL, and `not NULL` is NULL, which would exclude the row from ALL and every other queue.
    expect(body).toContain("coalesce(c.lifecycle_status = 'SPAM', false)");
    expect(body).not.toMatch(/or c\.lifecycle_status = 'SPAM'/);
  });

  it("changes nothing else about the queue function: it matches the latest definition apart from that one line", () => {
    const expected = functionBody(commercial).replace(
      "coalesce(l.stage = 'SPAM', false)                          as is_spam,",
      "(coalesce(l.stage = 'SPAM', false) or coalesce(c.lifecycle_status = 'SPAM', false)) as is_spam,",
    );
    expect(functionBody(spam).trim()).toBe(expected.trim());
  });

  it("is based on the newest definition of the function, not an older one", () => {
    const later = ["20261202091100_mi2_6_inbox_sla_policies.sql", "20261202091400_mi3_4_commercial_queues.sql"];
    for (const file of later) expect(read(file)).toContain("create or replace function public.compute_conversation_queues");
    expect(functionBody(commercial)).toContain("NEW_ENQUIRIES");
    expect(functionBody(spam)).toContain("NEW_ENQUIRIES");
  });

  it("keeps the spam queue and every exclusion driven by one is_spam flag", () => {
    const body = functionBody(spam);
    expect(body).toContain("('SPAM',          r.is_spam)");
    expect(body).toContain("('ALL',           not r.is_closed and not r.is_spam)");
    expect(body.match(/not r\.is_spam/g)!.length).toBeGreaterThan(10);
  });

  it("relies on the existing trigger that already refreshes membership when lifecycle_status changes", () => {
    expect(original).toMatch(/after insert or update of [^;]*lifecycle_status[^;]*on public\.conversations/);
  });

  it("keeps the function's grants and makes no table, policy or column change", () => {
    expect(spam).toContain("revoke all on function public.compute_conversation_queues(uuid[]) from public, anon, authenticated;");
    expect(spam).toContain("grant execute on function public.compute_conversation_queues(uuid[]) to service_role;");
    expect(spam).not.toMatch(/create table|alter table|drop table|create policy|drop policy|add column|drop column/i);
  });

  it("brings membership in line for conversations already marked spam, and documents the rollback", () => {
    expect(spam).toMatch(/select public\.refresh_conversation_queues\(c\.id\)\s+from public\.conversations c\s+where c\.lifecycle_status = 'SPAM'/);
    expect(spam).toMatch(/Rollback \(commented\)/);
  });
});
