import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDir = path.resolve(__dirname, "../../supabase/migrations");
const name = readdirSync(migrationsDir).find((file) => file.includes("agency_onboarding_state"));
const sql = name ? readFileSync(path.join(migrationsDir, name), "utf8") : "";

describe("onboarding M1 — agency_onboarding_state", () => {
  it("exists and stores only what cannot be derived", () => {
    expect(name).toBeDefined();
    expect(sql).toMatch(/create table if not exists public\.agency_onboarding_state/i);
    expect(sql).toMatch(/agency_id\s+uuid primary key references public\.agencies\(id\) on delete cascade/i);
    for (const column of ["steps", "basics_confirmed_at", "password_set_at", "guide_dismissed_at", "last_step"]) {
      expect(sql).toContain(column);
    }
  });

  it("enables RLS in the same migration", () => {
    expect(sql).toMatch(/alter table public\.agency_onboarding_state enable row level security/i);
  });

  it("scopes every policy to the caller's agency", () => {
    const policies = sql.match(/create policy[\s\S]*?;/gi) ?? [];
    expect(policies.length).toBeGreaterThanOrEqual(3);
    for (const policy of policies) expect(policy).toMatch(/current_agency_id\(\)/);
  });

  it("lets any member read but only an ADMIN write", () => {
    expect(sql).toMatch(/for select to authenticated/i);
    const writes = (sql.match(/create policy[\s\S]*?;/gi) ?? []).filter((p) => /for (insert|update)/i.test(p));
    expect(writes.length).toBe(2);
    for (const policy of writes) expect(policy).toMatch(/current_staff_role\(\)\s*\)?\s*=\s*'ADMIN'/i);
  });

  it("gives anon no access and keeps updated_at current", () => {
    expect(sql).toMatch(/revoke all on public\.agency_onboarding_state from public, anon/i);
    expect(sql).toMatch(/set_updated_at/);
  });
});
