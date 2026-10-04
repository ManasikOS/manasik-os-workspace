import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TASK-032 S6. The behavioural proof is supabase/tests/database/composite_foreign_key_delete_behaviour.test.sql and needs a database. These checks run in
 * the normal suite: the migration's shape, and that the Inbox embeds the lead through the key every database has.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const withoutComments = (sql: string) => sql.replace(/^\s*--.*$/gm, "");

describe("composite foreign key delete behaviour migration", () => {
  const sql = withoutComments(read("supabase/migrations/20270107090000_composite_foreign_key_delete_behaviour.sql"));

  it("re-creates every composite SET NULL key with only its own column cleared", () => {
    expect(sql).toMatch(/c\.confdelsetcols is null/);
    expect(sql).toMatch(/array_length\(c\.conkey, 1\) > 1/);
    expect(sql).toMatch(/add constraint %I %s \(%I\)/);
  });

  it("adds the agency-scoped conversations -> leads key where it is missing, clearing only lead_id", () => {
    expect(sql).toMatch(/foreign key \(lead_id, agency_id\) references public\.leads \(id, agency_id\) on delete set null \(lead_id\)/);
    expect(sql).toMatch(/conversation points at a lead of another agency/);
  });

  it("keeps the old single-column key (a later cleanup drops it) and changes no data", () => {
    expect(sql).not.toMatch(/drop constraint (if exists )?conversations_lead_id_fkey/);
    expect(sql).not.toMatch(/\b(insert\s+into|update\s+[a-z_.]+\s+set|delete\s+from|truncate)\b/i);
  });
});

describe("the Inbox lead embed", () => {
  it("names the agency-scoped foreign key, never the single-column one a fresh database does not have", () => {
    const repository = read("lib/data/inbox-repository.ts");
    expect(repository).toContain("leads!conversations_lead_agency_fkey(");
    expect(repository).not.toContain("conversations_lead_id_fkey");
  });
});
