import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261204090600_d2_trigram_search_indexes.sql"), "utf8");
const repository = readFileSync(join(process.cwd(), "lib/data/inbox-repository.ts"), "utf8");

/** Every column the Inbox search filters with ILIKE, by table, read from the source so a new search column cannot ship unindexed. */
function searchedColumns(table: "leads" | "conversations"): string[] {
  const start = repository.indexOf("export async function searchInboxConversations");
  const body = repository.slice(start, repository.indexOf("\n}\n", start));
  const anchor = table === "leads" ? '.from("leads")' : '.from("conversations")';
  const columns = new Set<string>();
  let from = 0;
  for (;;) {
    const at = body.indexOf(anchor, from);
    if (at < 0) break;
    const rest = body.slice(at, at + 400);
    for (const match of rest.matchAll(/\.or\(`([^`]*)`\)/g)) {
      for (const arm of match[1].split(",")) {
        const column = arm.split(".ilike.")[0];
        if (arm.includes(".ilike.")) columns.add(column);
      }
    }
    from = at + anchor.length;
  }
  return [...columns].sort();
}

describe("Inbox search indexes (D2)", () => {
  it("indexes every column the lead search filters with ILIKE (an OR only uses an index when every arm has one)", () => {
    const columns = searchedColumns("leads");
    expect(columns).toEqual(["desired_package_name", "full_name", "reference"]);
    for (const column of columns) {
      expect(migration).toContain(`on public.leads using gin (${column} extensions.gin_trgm_ops)`);
    }
  });

  it("indexes every column the conversation search filters with ILIKE", () => {
    const columns = searchedColumns("conversations");
    expect(columns).toEqual(["contact_name", "contact_phone"]);
    for (const column of columns) {
      expect(migration).toContain(`on public.conversations using gin (${column} extensions.gin_trgm_ops)`);
    }
  });
});

describe("D2 migration content", () => {
  it("moves pg_trgm out of public and qualifies the operator class, so it does not depend on the search path", () => {
    expect(migration).toContain("alter extension pg_trgm set schema extensions;");
    const code = migration.replace(/--.*$/gm, "");
    expect(code.match(/gin_trgm_ops/g)).toHaveLength(5);
    expect(code.match(/extensions\.gin_trgm_ops/g)).toHaveLength(5);
  });

  it("is idempotent and does not use CONCURRENTLY (a migration runs in a transaction)", () => {
    const code = migration.replace(/--.*$/gm, "");
    expect(code.match(/create index if not exists/g)).toHaveLength(5);
    expect(code).not.toMatch(/concurrently/i);
  });
});
