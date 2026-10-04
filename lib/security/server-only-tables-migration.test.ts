import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TASK-032 S4 / audit item D1. The behavioural proof lives in supabase/tests/database/server_only_tables.test.sql and needs a database.
 * These checks run in the normal suite and keep the migration, the test and the audit script describing the same twenty tables.
 */
const root = process.cwd();
const migration = readFileSync(join(root, "supabase/migrations/20270103090000_revoke_server_only_table_privileges.sql"), "utf8").replace(/^\s*--.*$/gm, "");
const pgtap = readFileSync(join(root, "supabase/tests/database/server_only_tables.test.sql"), "utf8");

const TABLES = [
  "agency_smtp_settings", "ai_conversation_meter_events", "conversation_message_counters", "conversation_queue_counts",
  "cron_route_calls", "inbox_intake_states", "inbox_reply_queue_agencies", "message_delivery_status_buffer",
  "onboarding_events", "outbox_messages", "reply_intents", "signup_attempts",
  "knowledge_chunks", "pending_agency_signups", "platform_admins", "whatsapp_webhook_hits",
  "package_content", "package_faqs", "package_media", "package_seo_analyses",
];

function listedTables(text: string): string[][] {
  return [...text.matchAll(/array\s*\[([^\]]+)\]/g)].map((match) => [...match[1].matchAll(/'([a-z_]+)'/g)].map((name) => name[1]));
}

describe("server-only tables migration", () => {
  it("names the same twenty tables in the revoke loop and in the guard", () => {
    const lists = listedTables(migration).filter((list) => list.length === TABLES.length);
    expect(lists.length).toBe(2);
    for (const list of lists) expect([...list].sort()).toEqual([...TABLES].sort());
  });

  it("revokes from the client roles only, and never grants anything", () => {
    expect(migration).toMatch(/revoke all on table public\.%I from anon, authenticated/);
    expect(migration).not.toMatch(/\bgrant\b/i);
    expect(migration).not.toMatch(/service_role/);
  });

  it("skips a table the database does not have, so a fresh build still works", () => {
    expect(migration).toMatch(/if to_regclass\(format\('public\.%I', v_table\)\) is not null then/);
  });

  it("ends with a guard that refuses to finish while a client role can still reach one of them", () => {
    expect(migration).toMatch(/raise exception 'Tenant isolation: these server-only tables are still reachable by a client role/);
    expect(migration).toMatch(/has_any_column_privilege\('anon'/);
    expect(migration).toMatch(/has_any_column_privilege\('authenticated'/);
  });

  it("is described by a database test that names the same tables", () => {
    const lists = listedTables(pgtap).filter((list) => list.length === TABLES.length);
    expect(lists.length).toBeGreaterThanOrEqual(2);
    for (const list of lists) expect([...list].sort()).toEqual([...TABLES].sort());
  });

  it("is covered by the audit script, which flags any policy-less table that a client role can reach", () => {
    const audit = readFileSync(join(root, "scripts/sql/verify-tenant-isolation.sql"), "utf8");
    expect(audit).toMatch(/server-only/i);
    expect(audit).toMatch(/has_any_column_privilege\('anon'/);
  });
});
