import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDir = path.resolve(__dirname, "../../supabase/migrations");
const migrationFiles = readdirSync(migrationsDir);

function readMigration(needle: string) {
  const name = migrationFiles.find((file) => file.includes(needle));
  if (!name) throw new Error(`migration containing "${needle}" not found`);
  return readFileSync(path.join(migrationsDir, name), "utf8");
}

describe("onboarding M3 — pending signup hardening", () => {
  const sql = readMigration("onboarding_signup_hardening");

  it("adds expiry, country and the provisioned agency to pending signups", () => {
    expect(sql).toMatch(/add column if not exists expires_at timestamptz not null default now\(\) \+ interval '7 days'/i);
    expect(sql).toMatch(/add column if not exists country_code text/i);
    expect(sql).toMatch(/add column if not exists agency_id uuid references public\.agencies\(id\)/i);
  });

  it("stores emails lower-cased and enforces it", () => {
    expect(sql).toMatch(/update public\.pending_agency_signups set email = lower\(email\)/i);
    expect(sql).toMatch(/check \(email = lower\(email\)\)/i);
  });

  it("creates a service-role-only attempts table with RLS in the same migration", () => {
    expect(sql).toMatch(/create table if not exists public\.signup_attempts/i);
    expect(sql).toMatch(/alter table public\.signup_attempts enable row level security/i);
    expect(sql).toMatch(/revoke all on public\.signup_attempts from public, anon, authenticated/i);
    expect(sql).not.toMatch(/create policy[^;]*signup_attempts/i);
  });
});

describe("onboarding M2 — provision_agency_from_signup", () => {
  const sql = readMigration("provision_agency_from_signup");

  it("locks the pending row so two tabs cannot both provision", () => {
    expect(sql).toMatch(/from public\.pending_agency_signups[\s\S]*for update/i);
  });

  it("is idempotent: a consumed row returns its recorded agency", () => {
    expect(sql).toMatch(/consumed_at is not null/i);
    expect(sql).toMatch(/return v_pending\.agency_id/i);
  });

  it("rejects expired and email-mismatched signups with stable error codes", () => {
    expect(sql).toMatch(/pending_signup_expired/);
    expect(sql).toMatch(/pending_signup_email_mismatch/);
    expect(sql).toMatch(/pending_signup_not_found/);
  });

  it("resolves slug collisions and empty slugs instead of failing", () => {
    expect(sql).toMatch(/regexp_replace\(lower\(/i);
    expect(sql).toMatch(/'agency-'/);
    expect(sql).toMatch(/exception\s+when unique_violation/i);
  });

  it("provisions through provision_agency and marks the row consumed in the same transaction", () => {
    expect(sql).toMatch(/public\.provision_agency\(/);
    expect(sql).toMatch(/update public\.pending_agency_signups[\s\S]*consumed_at = now\(\)[\s\S]*agency_id = /i);
  });

  it("is executable by the service role only", () => {
    expect(sql).toMatch(/revoke all on function public\.provision_agency_from_signup\(uuid, uuid, text\) from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.provision_agency_from_signup\(uuid, uuid, text\) to service_role/i);
  });
});
