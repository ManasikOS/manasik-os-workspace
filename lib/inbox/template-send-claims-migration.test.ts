import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** BUG-3: the claims table must stay server-only and keep its one-row-per-attempt rule, because the double-send protection rests on both. */
const migration = readFileSync(join(process.cwd(), "supabase/migrations/20270112090000_inbox_template_send_claims.sql"), "utf8").replace(/^\s*--.*$/gm, "");

describe("inbox_template_send_claims migration", () => {
  it("allows one row per agency and key, which is what makes the second request lose", () => {
    expect(migration).toMatch(/unique \(agency_id, idempotency_key\)/);
  });
  it("is server-only: row-level security on, no policy, no privilege for the client roles", () => {
    expect(migration).toContain("alter table public.inbox_template_send_claims enable row level security;");
    expect(migration).toContain("revoke all on table public.inbox_template_send_claims from anon, authenticated;");
    expect(migration).not.toMatch(/create policy/i);
    expect(migration).not.toMatch(/\bgrant\b/i);
  });
  it("only allows the three states the code uses", () => {
    expect(migration).toContain("check (status in ('SENDING', 'SENT', 'FAILED'))");
  });
});
